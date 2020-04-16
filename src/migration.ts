import { last } from 'lodash';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';
import pTimeout, { TimeoutError } from 'p-timeout';
import * as semver from 'semver';

const E_CONFIG_NO_DB = 'Migration is not configured.  Ensure Migration.config() has been called';

export interface IDbProperties {
  connectionUrl: string;
  name?: string;
  options?: MongoClientOptions;
}

export interface IMigrationOptions {
  log?: boolean;
  logger?: (level: string, ...args: any[]) => void;
  collectionName?: string;
  db: IDbProperties;
  timeout?: number;
}

export interface IMigration {
  version: string;
  name: string;
  up: (
    db?: Db,
    client?: MongoClient,
    logger?: (level: string, ...args: any[]) => void,
  ) => Promise<any> | any;
  down: (
    db?: Db,
    client?: MongoClient,
    logger?: (level: string, ...args: any[]) => void,
  ) => Promise<any> | any;
}

export class Migration {
  private initialMigration: IMigration = {
    version: '0.0.0',
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
  private db: Db;
  private client: MongoClient;
  private options: IMigrationOptions;

  /**
   * Creates an instance of Migration
   */
  constructor() {
    this.migrations = [this.initialMigration];
    this.options = {
      log: true,
      logger: null,
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

    const clientOptions = { ...this.options.db.options };

    if (clientOptions.useNewUrlParser !== false) {
      clientOptions.useNewUrlParser = true;
    }

    this.client = await MongoClient.connect(this.options.db.connectionUrl, clientOptions);
    this.db = this.client.db(this.options.db.name || undefined);
    this.collection = this.db.collection(this.options.collectionName);
  }

  /**
   * Add a new migration
   */
  public add(migration: IMigration): void {
    if (typeof migration.up !== 'function') {
      throw new Error('migration must supply an up function');
    }

    if (typeof migration.down !== 'function') {
      throw new Error('migration must supply a down function');
    }

    if (typeof migration.version !== 'string' || !semver.valid(migration.version)) {
      throw new Error('migration must supply a SemVer version string');
    }

    if (semver.lte(migration.version, '0.0.0')) {
      throw new Error('migration version must be greater than 0.0.0');
    }

    // Freeze the migration object to make it hereafter immutable
    Object.freeze(migration);

    this.migrations.push(migration);
    this.migrations.sort((a: IMigration, b: IMigration) => semver.compare(a.version, b.version));
  }

  /**
   * Perform migrations down to a specific version
   * @example down('1.2.3') - migrate down to version '1.2.3'
   */
  public async down(version: string): Promise<void> {
    try {
      await this.lock();
      await this.execute('down', version);
    } catch (e) {
      this.logger('error', `migration failed:`, e.message);

      throw e;
    } finally {
      await this.unlock();
    }
  }

  /**
   * Perform migrations up to the latest or specific version
   * @example up('latest') - migrate up to latest version
   * @example up('1.2.3') - migrate up to version '1.2.3'
   */
  public async up(version: string | 'latest'): Promise<void> {
    let targetVersion = version;

    if (targetVersion === 'latest') {
      targetVersion = last(this.migrations).version;
    }

    try {
      await this.lock();
      await this.execute('up', targetVersion);
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
    // Exclude default/base migration v0 since its not a configured migration
    return this.migrations.slice(1);
  }

  /**
   * Returns the current version
   */
  public async getVersion(): Promise<string> {
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
    if (this.options.log === false) {
      return;
    }

    this.options.logger ? this.options.logger(level, ...args) : console[level](...args);
  }

  /**
   * Invoke the migration
   */
  private async migrate(direction, idx: number) {
    const migration = this.migrations[idx];

    this.logger(
      'info',
      `running migration ${direction}() on version ${migration.version}`,
      `${migration.name || ''}`,
    );

    // Wrap in a promise in case migration is not promise-able
    const p = Promise.resolve(migration[direction](this.db, this.client, this.logger));

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
  private updateVersion(version: string) {
    return this.setControl({
      locked: true,
      version,
    });
  }

  /**
   * Executes migration of the specific version
   */
  private async execute(direction: 'up' | 'down', targetVersion: string): Promise<void> {
    if (!semver.valid(targetVersion)) {
      throw new Error(`invalid semver: ${targetVersion}`);
    }

    if (!this.db) {
      throw new Error(E_CONFIG_NO_DB);
    }

    if (this.migrations.length <= 1) {
      this.logger('warn', 'no migrations are pending');
      return;
    }

    // Side effect: upserts control document.
    const control = await this.getControl();
    let currentVersion = control.version;

    if (semver.eq(currentVersion, targetVersion)) {
      this.logger('warn', 'migration already at version ' + targetVersion);
      return;
    }

    const startIdx = this.findIndexByVersion(currentVersion);
    const endIdx = this.findIndexByVersion(targetVersion);

    this.logger('info', `${direction} migration started from ${currentVersion} to ${targetVersion}`);

    if (direction === 'up') {
      if (semver.gt(currentVersion, targetVersion)) {
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
    } else if (direction === 'down') {
      if (semver.lt(currentVersion, targetVersion)) {
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
  private async getControl(): Promise<{ version: string; locked: boolean }> {
    const con = await this.collection.findOne({ _id: 'control' });

    return (
      con ||
      (await this.setControl({
        version: '0.0.0',
        locked: false,
      }))
    );
  }

  /**
   * Set the control record
   */
  private async setControl(control: {
    version: string
    locked: boolean,
  }): Promise<{ version: string; locked: boolean } | null> {
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
  private findIndexByVersion(version: string): number {
    for (let i = 0; i < this.migrations.length; i++) {
      if (this.migrations[i].version === version) {
        return i;
      }
    }

    throw new Error(`migration version ${version} not found`);
  }
}
