/*
  Adds migration capabilities. Migrations are defined like:

  Migrations.add({
    version: '0.0.1', //*required* semver to identify migration version
    up: function(db) {}, //*required* code to run to migrate upwards
    down: function(db) {}, //*required* code to run to migrate downwards
    name: 'Something' //*optional* display name for the migration
  });

  The ordering of migrations is determined by the semver.

  Note: Migrations will lock ensuring only 1 app can be migrating at once. If
  a migration crashes, the control record in the migrations collection will
  remain locked and at the version it was at previously, however the db could
  be in an inconsistent state.
*/

import * as _ from 'lodash';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';
import * as semver from 'semver';
import { typeCheck } from 'type-check';

const check = typeCheck;
const E_CONFIG_NO_DB = 'Migration is not configured.  Ensure Migration.config() has been called';

export type LogLevels = 'debug' | 'info' | 'notice' | 'warn' | 'error' | 'crit' | 'alert';

export interface IDbProperties {
  connectionUrl: string;
  name?: string;
  options?: MongoClientOptions;
}

export interface IMigrationOptions {
  log?: boolean;
  logger?: (level: LogLevels, ...args: any[]) => void;
  logIfLatest?: boolean;
  collectionName?: string;
  db: IDbProperties;
}
export interface IMigration {
  version: string;
  name: string;
  up: (db: Db, client: MongoClient) => Promise<any> | any;
  down: (db: Db, client: MongoClient) => Promise<any> | any;
}

export class Migration {
  private initialMigration: IMigration = {
    version: '0.0.0',
    name: 'v0',
    up: () => {
      //
    },
    down: () => {
      //
    },
  };
  private migrations: IMigration[];
  private collection: Collection;
  private db: Db;
  private client: MongoClient;
  private options: IMigrationOptions;

  /**
   * Creates an instance of Migration.
   * @param {IMigrationOptions} [opts]
   * @memberof Migration
   */
  constructor(opts?: IMigrationOptions) {
    // Since we'll be at version 0.0.0 by default, we should have a migration set for it.
    this.migrations = [this.initialMigration];
    this.options = opts
      ? opts
      : {
          // False disables logging
          log: true,
          // Null or a function
          logger: null,
          // Enable/disable info log "already at latest."
          logIfLatest: true,
          // Migrations collection name
          collectionName: 'migrations',
          // Mongodb url or mongo Db instance
          db: null,
        };
  }

  /**
   * Configure migration
   *
   * @param {IMigrationOptions} [opts]
   * @returns {Promise<void>}
   * @memberof Migration
   */
  public async config(opts?: IMigrationOptions): Promise<void> {
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
   *
   * @param {IMigration} migration
   * @memberof Migration
   */
  public add(migration: IMigration): void {
    if (typeof migration.up !== 'function') {
      throw new Error('Migration must supply an up function.');
    }

    if (typeof migration.down !== 'function') {
      throw new Error('Migration must supply a down function.');
    }

    if (typeof migration.version !== 'string' || !semver.valid(migration.version)) {
      throw new Error('Migration must supply a SemVer version string.');
    }

    if (semver.lte(migration.version, '0.0.0')) {
      throw new Error('Migration version must be greater than 0.0.0');
    }

    // Freeze the migration object to make it hereafter immutable
    Object.freeze(migration);

    this.migrations.push(migration);
    this.migrations.sort((a: IMigration, b: IMigration) => semver.compare(a.version, b.version));
  }

  /**
   * Perform migrations down to a specific version
   * @param {string} version A semver version
   * @example down('1.2.3') - migrate down to version '1.2.3'
   */
  public async down(version: string): Promise<void> {
    try {
      await this.execute('down', version);
    } catch (e) {
      this.logger('error', `Encountered an error while migrating. Migration failed.`);
      throw e;
    }
  }

  /**
   * Perform migrations up to the latest or specific version
   * @param {string} version A semver version or 'latest'
   * @example up('latest') - migrate up to latest version
   * @example up('1.2.3') - migrate up to version '1.2.3'
   */
  public async up(version: string | 'latest'): Promise<void> {
    let targetVersion = version;

    if (targetVersion === 'latest') {
      targetVersion = _.last(this.migrations).version;
    }

    try {
      await this.execute('up', targetVersion);
    } catch (e) {
      this.logger('error', `Encountered an error while migrating. Migration failed.`);
      throw e;
    }
  }

  /**
   * Closes the connection
   *
   * @returns {Promise<void>}
   * @memberof Migration
   */
  public async close(force: boolean = false): Promise<void> {
    if (this.client) {
      await this.client.close(force);
    }
  }

  /**
   * Returns the migrations
   *
   * @returns {IMigration[]}
   * @memberof Migration
   */
  public getMigrations(): IMigration[] {
    // Exclude default/base migration v0 since its not a configured migration
    return this.migrations.slice(1);
  }

  /**
   * Returns the current version
   *
   * @returns {Promise<string>}
   * @memberof Migration
   */
  public async getVersion(): Promise<string> {
    const control = await this.getControl();

    return control.version;
  }

  /**
   * Unlock control
   *
   * @returns {Promise<void>}
   * @memberof Migration
   */
  public async unlock(): Promise<void> {
    await this.collection.updateOne({ _id: 'control' }, { $set: { locked: false } });
  }

  /**
   * Reset migration collection and configuration
   * Intended for dev and test mode only. Use wisely
   *
   * @returns {Promise<void>}
   * @memberof Migration
   */
  public async reset(): Promise<void> {
    this.migrations = [this.initialMigration];

    await this.collection.deleteMany({});
  }

  /**
   * Logger
   */
  private logger(level: LogLevels, ...args: any[]): void {
    if (this.options.log === false) {
      return;
    }

    this.options.logger
      ? this.options.logger(level, ...args)
      : // tslint:disable-next-line:no-console
        console[level](...args);
  }

  private async migrate(direction, idx: number) {
    const migration = this.migrations[idx];

    if (typeof migration[direction] !== 'function') {
      this.unlock();
      throw new Error('Cannot migrate ' + direction + ' on version ' + migration.version);
    }

    function maybeName() {
      return migration.name ? ' (' + migration.name + ')' : '';
    }

    this.logger('info', 'Running ' + direction + '() on version ' + migration.version + maybeName());

    await migration[direction](this.db, this.client, this.logger);
  }

  // Returns true if lock was acquired.
  private async _lock(): Promise<boolean> {
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

  // Side effect: saves version.
  private _unlock(version: string) {
    return this.setControl({
      locked: false,
      version,
    });
  }

  // Side effect: saves version.
  private _updateVersion(version: string) {
    return this.setControl({
      locked: true,
      version,
    });
  }

  /**
   * Executes migration of the specific version
   *
   * @param {string} targetVersion
   * @returns {Promise<void>}
   * @memberof Migration
   */
  private async execute(direction: 'up' | 'down', targetVersion: string): Promise<void> {
    if (!semver.valid(targetVersion)) {
      throw new Error(`Invalid semver specified: ${targetVersion}`);
    }

    if (!this.db) {
      throw new Error(E_CONFIG_NO_DB);
    }

    if (this.migrations.length <= 1) {
      this.logger('warn', 'No migrations are pending');
      return;
    }

    // Side effect: upserts control document.
    const control = await this.getControl();
    let currentVersion = control.version;

    if ((await this._lock()) === false) {
      this.logger('warn', 'Not migrating, control is locked.');
      return;
    }

    if (currentVersion === targetVersion) {
      if (this.options.logIfLatest) {
        this.logger('warn', 'Not migrating, already at version ' + targetVersion);
      }
      await this._unlock(currentVersion);
      return;
    }

    const startIdx = this.findIndexByVersion(currentVersion);
    const endIdx = this.findIndexByVersion(targetVersion);

    this.logger(
      'info',
      'Migrating ' + direction + ' from version ' + currentVersion + ' -> ' + targetVersion,
    );

    if (direction === 'up') {
      if (semver.gt(currentVersion, targetVersion)) {
        throw new Error(
          'Up migration aborted: current version ' +
            currentVersion +
            ' > ' +
            ' target version ' +
            targetVersion,
        );
      }

      for (let i = startIdx; i < endIdx; i++) {
        try {
          await this.migrate(direction, i + 1);
          currentVersion = this.migrations[i + 1].version;
          await this._updateVersion(currentVersion);
        } catch (e) {
          const prevVersion = this.migrations[i].version;
          const destVersion = this.migrations[i + 1].version;
          this.logger(
            'error',
            `Encountered an error while migrating from ${prevVersion} to ${destVersion}`,
            e.message,
          );
          throw e;
        }
      }
    } else if (direction === 'down') {
      if (semver.lt(currentVersion, targetVersion)) {
        throw new Error(
          'Down migration aborted: current version ' +
            currentVersion +
            ' < ' +
            ' target version ' +
            targetVersion,
        );
      }

      for (let i = startIdx; i > endIdx; i--) {
        try {
          await this.migrate(direction, i);
          currentVersion = this.migrations[i - 1].version;
          await this._updateVersion(currentVersion);
        } catch (e) {
          const prevVersion = this.migrations[i].version;
          const destVersion = this.migrations[i - 1].version;
          this.logger(
            'error',
            `Encountered an error while migrating from ${prevVersion} to ${destVersion}`,
          );
          throw e;
        }
      }
    }

    await this.unlock();

    this.logger('info', 'Finished migrating.');
  }

  /**
   * Gets the current control record, optionally creating it if non-existent
   *
   * @private
   * @returns {Promise<{ version: string, locked: boolean }>}
   * @memberof Migration
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
   *
   * @private
   * @param {{ version: string, locked: boolean }} control
   * @returns {(Promise<{ version: string, locked: boolean } | null>)}
   * @memberof Migration
   */
  private async setControl(control: {
    version: string
    locked: boolean,
  }): Promise<{ version: string; locked: boolean } | null> {
    // Be quite strict
    check('String', control.version);
    check('Boolean', control.locked);

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
   * Returns the migration index in _list or throws if not found
   *
   * @private
   * @param {string} version
   * @returns {number}
   * @memberof Migration
   */
  private findIndexByVersion(version: string): number {
    for (let i = 0; i < this.migrations.length; i++) {
      if (this.migrations[i].version === version) {
        return i;
      }
    }

    throw new Error('Migration version ' + version + ' not found');
  }
}
