import { last } from 'lodash';
import { Collection, MongoClient, MongoClientOptions } from 'mongodb';
import ow from 'ow';
import pTimeout, { TimeoutError } from 'p-timeout';

enum MigrationDirection {
  up = 'up',
  down = 'down',
}

export type Logger = (level: string, ...args: any[]) => void;

export interface IDbProperties {
  connectionUrl: string;
  name?: string;
  options?: MongoClientOptions;
}

export interface IMigrationOptions {
  log?: boolean;
  logger?: Logger;
  collectionName?: string;
  db: IDbProperties;
  timeout?: number;
}

export interface IMigration {
  version: number;
  name: string;
  up: (client?: MongoClient, logger?: Logger) => Promise<any> | any;
  down: (client?: MongoClient, logger?: Logger) => Promise<any> | any;
}

export class Migration {
  private initialMigration: IMigration = {
    version: 0,
    name: 'v0',
    up: async () => {
      //
    },
    down: async () => {
      //
    },
  };
  private migrations: IMigration[];
  private collection: Collection;
  private client: MongoClient;
  private options: IMigrationOptions;

  /**
   * Creates an instance of Migration
   */
  constructor() {
    this.migrations = [this.initialMigration];
    this.options = {
      log: true,
      logger: (level: string, ...args: any[]) => console[level](...args),
      collectionName: 'migrations',
      db: null,
      timeout: Number.POSITIVE_INFINITY,
    };
  }

  /**
   * Configure migration
   */
  public async config(opts: IMigrationOptions): Promise<void> {
    this.options = Object.assign({}, this.options, opts);

    ow(this.options.logger, ow.function);
    ow(this.options.db.connectionUrl, ow.string.nonEmpty);
    ow(this.options.collectionName, ow.string.nonEmpty);

    this.client = await MongoClient.connect(this.options.db.connectionUrl, this.options.db.options);

    const db = this.client.db(this.options.db.name || undefined);
    this.collection = db.collection(this.options.collectionName);
  }

  /**
   * Add a new migration
   */
  public add(migration: IMigration): void {
    ow(migration.up, ow.function);
    ow(migration.down, ow.function);
    ow(migration.version, ow.number.greaterThan(0));
    ow(migration.name, ow.string);

    // Freeze the migration object to make it hereafter immutable
    Object.freeze(migration);

    this.migrations.push(migration);
    this.migrations.sort((a: IMigration, b: IMigration) => a.version - b.version);
  }

  /**
   * Perform migrations down to a specific version
   * @example down(1) - migrate down to version 1
   */
  public async down(version: number): Promise<void> {
    try {
      await this.lock();
      await this.execute(MigrationDirection.down, version);
    } catch (e) {
      this.logger('error', `migration failed:`, e.message);

      throw e;
    } finally {
      await this.unlock();
    }
  }

  /**
   * Perform migrations up to the latest or specific configured version
   * @example up() - migrate up to latest version
   * @example up(2) - migrate up to version 2
   */
  public async up(version?: number): Promise<void> {
    const targetVersion = version || last(this.migrations).version;

    ow(targetVersion, ow.number.greaterThan(0));

    try {
      await this.lock();
      await this.execute(MigrationDirection.up, targetVersion);
    } catch (e) {
      this.logger('error', `migration failed:`, e.message);

      throw e;
    } finally {
      await this.unlock();
    }
  }

  /**
   * Closes the connection
   */
  public async close(force: boolean = false): Promise<void> {
    if (this.client) {
      await this.client.close(force);
    }
  }

  /**
   * Returns the migrations
   */
  public getMigrations(): IMigration[] {
    // Exclude default base migration v0 since its not a configured migration
    return this.migrations.slice(1);
  }

  /**
   * Returns the current version
   */
  public async getVersion(): Promise<number> {
    const control = await this.getControl();

    return control.version;
  }

  /**
   * Reset migration collection and configuration
   * Intended for dev and test mode only. Use wisely
   */
  public async reset(): Promise<void> {
    this.migrations = [this.initialMigration];

    await this.collection.deleteMany({});
  }

  /**
   * Logger
   */
  private logger(level: string, ...args: any[]): void {
    if (this.options.log) {
      this.options.logger(level, ...args);
    }
  }

  /**
   * Invoke the migration
   */
  private async migrate(direction: MigrationDirection, idx: number) {
    const migration = this.migrations[idx];

    this.logger(
      'info',
      `running migration ${direction}() on version ${migration.version}`,
      `${migration.name || ''}`,
    );

    // Wrap in a promise in case migration is not promise-able
    const p = Promise.resolve(migration[direction](this.client, this.logger.bind(this)));

    await pTimeout(p, this.options.timeout);
  }

  /**
   * Returns true if lock was acquired.
   */
  private async lock(): Promise<boolean> {
    /*
     * This is an atomic op. The op ensures only one caller at a time will match the control
     * object and thus be able to update it.  All other simultaneous callers will not match the
     * object and thus will have null return values in the result of the operation.
     */
    const updateResult = await this.collection.findOneAndUpdate(
      {
        _id: 'control',
        locked: false,
      },
      {
        $set: {
          locked: true,
          lockedAt: new Date(),
        },
      },
    );

    return null != updateResult.value && 1 === updateResult.ok;
  }

  /**
   * Unlock control
   */
  private async unlock(): Promise<void> {
    await this.collection.updateOne(
      {
        _id: 'control',
      },
      { $set: { locked: false } },
    );
  }

  // Side effect: saves version.
  private updateVersion(version: number) {
    return this.setControl({
      locked: true,
      version,
    });
  }

  /**
   * Executes migration of the specific version
   */
  private async execute(direction: MigrationDirection, targetVersion: number): Promise<void> {
    if (!this.client) {
      throw new Error('migrator has not been configured');
    }

    if (this.migrations.length <= 1) {
      this.logger('warn', 'no migrations are pending');
      return;
    }

    // Side effect: upserts control document.
    const control = await this.getControl();
    let currentVersion = control.version;

    if (currentVersion === targetVersion) {
      this.logger('warn', 'skipping migration...current version already at ' + targetVersion);
      return;
    }

    const startIdx = this.findIndexByVersion(currentVersion);
    const endIdx = this.findIndexByVersion(targetVersion);

    this.logger('info', `starting migration from ${currentVersion} to ${targetVersion}`);

    if (direction === MigrationDirection.up) {
      if (currentVersion > targetVersion) {
        throw new Error(`current version ${currentVersion} > target version ${targetVersion}`);
      }

      for (let i = startIdx; i < endIdx; i++) {
        try {
          await this.migrate(direction, i + 1);
          currentVersion = this.migrations[i + 1].version;
          this.logger('info', `migration ${currentVersion} completed`);
          await this.updateVersion(currentVersion);
        } catch (e) {
          const previousVersion = this.migrations[i].version;
          const destVersion = this.migrations[i + 1].version;
          throw new Error(`migration from ${previousVersion} to ${destVersion}: ${e.message}`);
        }
      }
    } else if (direction === MigrationDirection.down) {
      if (currentVersion < targetVersion) {
        throw new Error(`current version ${currentVersion} < target version ${targetVersion}`);
      }

      for (let i = startIdx; i > endIdx; i--) {
        try {
          await this.migrate(direction, i);
          currentVersion = this.migrations[i - 1].version;
          this.logger('info', `migration ${currentVersion} completed`);
          await this.updateVersion(currentVersion);
        } catch (e) {
          const previousVersion = this.migrations[i].version;
          const destVersion = this.migrations[i - 1].version;
          throw new Error(`migration from ${previousVersion} to ${destVersion}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Gets the current control record, optionally creating it if non-existent
   */
  private async getControl(): Promise<{ version: number; locked: boolean }> {
    const con = await this.collection.findOne({ _id: 'control' });

    return (
      con ||
      (await this.setControl({
        version: 0,
        locked: false,
      }))
    );
  }

  /**
   * Set the control record
   */
  private async setControl(control: {
    version: number
    locked: boolean,
  }): Promise<{ version: number; locked: boolean } | null> {
    const updateResult = await this.collection.updateOne(
      {
        _id: 'control',
      },
      {
        $set: {
          version: control.version,
          locked: control.locked,
        },
      },
      {
        upsert: true,
      },
    );

    if (updateResult && updateResult.result.ok) {
      return control;
    } else {
      return null;
    }
  }

  /**
   * Returns the migration index or throws if not found
   */
  private findIndexByVersion(version: number): number {
    for (let i = 0; i < this.migrations.length; i++) {
      if (this.migrations[i].version === version) {
        return i;
      }
    }

    throw new Error(`migration version ${version} not found`);
  }
}
