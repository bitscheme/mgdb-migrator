/*
  Adds migration capabilities. Migrations are defined like:

  Migrations.add({
    version: '0.0.1', //*required* semver to identify migration version
    up: function(db) {}, //*required* code to run to migrate upwards
    down: function(db) {}, //*required* code to run to migrate downwards
    name: 'Something' //*optional* display name for the migration
  });

  The ordering of migrations is determined by the semver.

  To run migrations using environment variables, set:

  MIGRATE_VERSION to either 'latest' or the version number you want to migrate to.
  MIGRATE_RERUN to rerun an migration.

  e.g:
  MIGRATE_VERSION="latest"  # ensure we'll be at the latest version and run the app
  MIGRATE_VERSION="0.0.2"   # migrate to the specific version
  MIGRATE_RERUN="true"      # re-run the migration at the version

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

export type SyslogLevels = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'crit' | 'alert';

export interface IDbProperties {
  connectionUrl: string;
  name?: string;
  options?: MongoClientOptions;
}

export interface IMigrationOptions {
  log?: boolean;
  logger?: (level: SyslogLevels, ...args: any[]) => void;
  logIfLatest?: boolean;
  collectionName?: string;
  db: IDbProperties | Db;
}
export interface IMigration {
  version: string;
  name: string;
  up: (db: Db) => Promise<any> | any;
  down: (db: Db) => Promise<any> | any;
}

export class Migration {

  private defaultMigration = {
    version: '0.0.0',
    up: () => {
      //
    },
  };
  private list: any[];
  private collection: Collection;
  private db: Db;
  private options: IMigrationOptions;

  /**
   * Creates an instance of Migration.
   * @param {IMigrationOptions} [opts]
   * @memberof Migration
   */
  constructor(opts?: IMigrationOptions) {
    // Since we'll be at version 0.0.0 by default, we should have a migration set for it.
    this.list = [this.defaultMigration];
    this.options = opts ? opts : {
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

    if (!this.options.logger && this.options.log) {
      // tslint:disable-next-line: no-console
      this.options.logger = (level: string, ...args) => console.log(level, ...args);
    }
    if (this.options.log === false) {
      // tslint:disable-next-line:no-empty
      this.options.logger = (level: string, ...args) => { };
    }
    if (!(this.db instanceof Db) && !this.options.db) {
      throw new ReferenceError('Option.db canno\'t be null');
    }
    let db: IDbProperties | Db;
    if (this.options.db instanceof Db) {
      db = this.options.db;
    } else {
      const options = { ...this.options.db.options };
      if (options.useNewUrlParser !== false) {
        options.useNewUrlParser = true;
      }
      const client = await MongoClient.connect(
        this.options.db.connectionUrl,
        options,
      );
      db = client.db(this.options.db.name || undefined);
    }
    this.collection = (db as Db).collection(this.options.collectionName);
    this.db = db as Db;
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

    this.list.push(migration);

    _.map(this.list).sort((a: IMigration, b: IMigration) =>
      semver.compare(a.version, b.version));
  }

  /**
   * Run the migrations
   * @param {string} version A semver version or 'latest'
   * @param {boolean} [rerun] Rerun the migration (default is false)
   * @example migrateTo('latest') - migrate to latest version
   * @example migrateTo('0.0.2') - migrate to version '0.0.2'
   * @example migrateTo('0.0.2', true) - if at version 2, re-run up migration
   */
  public async migrateTo(version: string, rerun: boolean = false): Promise<void> {
    if (!this.db) {
      throw new Error('Migration instance has not be configured/initialized.' +
        ' Call <instance>.config(..) to initialize this instance');
    }

    let target = version;

    if (target === 'latest') {
      target = _.last<any>(this.list).version;
    }

    if (!semver.valid(target)) {
      throw new Error('Invalid semver specified');
    }

    if (this.list.length === 0) {
      throw new Error('No pending migrations');
    }

    try {
      await this.execute(target, rerun);
    } catch (e) {
      this.options.
        logger('info', `Encountered an error while migrating. Migration failed.`);
      throw e;
    }
  }

  /**
   * Returns the number of migrations
   *
   * @returns {number}
   * @memberof Migration
   */
  public getNumberOfMigrations(): number {
    // Exclude default/base migration v0 since its not a configured migration
    return this.list.length - 1;
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
   * @memberof Migration
   */
  public unlock(): void {
    this.collection.updateOne({ _id: 'control' }, { $set: { locked: false } });
  }

  /**
   * Reset migration configuration. This is intended for dev and test mode only. Use wisely
   *
   * @returns {Promise<void>}
   * @memberof Migration
   */
  public async reset(): Promise<void> {
    this.list = [this.defaultMigration];
    await this.collection.deleteMany({});
  }

  /**
   * Migrate to the specific version passed in
   *
   * @private
   * @param {string} version
   * @param {boolean} rerun
   * @returns {Promise<void>}
   * @memberof Migration
   */
  private async execute(version: string, rerun: boolean = false): Promise<void> {
    const self = this;
    const control = await this.getControl(); // Side effect: upserts control document.
    let currentVersion = control.version;

    // Run the actual migration
    const migrate = async (direction, idx: number) => {
      const migration = self.list[idx];

      if (typeof migration[direction] !== 'function') {
        unlock();
        throw new Error('Cannot migrate ' + direction + ' on version ' + migration.version);
      }

      function maybeName() {
        return migration.name ? ' (' + migration.name + ')' : '';
      }

      this.options.logger('info',
        'Running ' + direction + '() on version ' + migration.version + maybeName());

      await migration[direction](self.db, migration);

    };

    // Returns true if lock was acquired.
    const lock = async () => {
      /*
       * This is an atomic op. The op ensures only one caller at a time will match the control
       * object and thus be able to update it.  All other simultaneous callers will not match the
       * object and thus will have null return values in the result of the operation.
       */
      const updateResult = await self.collection.findOneAndUpdate({
        _id: 'control',
        locked: false,
      }, {
        $set: {
          locked: true,
          lockedAt: new Date(),
        },
      });

      return null != updateResult.value && 1 === updateResult.ok;
    };

    // Side effect: saves version.
    const unlock = () => self.setControl({
      locked: false,
      version: currentVersion,
    });

    // Side effect: saves version.
    const updateVersion = async () => await self.setControl({
      locked: true,
      version: currentVersion,
    });

    if ((await lock()) === false) {
      this.options.logger('info', 'Not migrating, control is locked.');
      return;
    }

    if (rerun) {
      this.options.logger('info', 'Rerunning version ' + version);
      migrate('up', this.findIndexByVersion(version));
      this.options.logger('info', 'Finished migrating.');
      await unlock();
      return;
    }

    if (currentVersion === version) {
      if (this.options.logIfLatest) {
        this.options.logger('info', 'Not migrating, already at version ' + version);
      }
      await unlock();
      return;
    }

    const startIdx = this.findIndexByVersion(currentVersion);
    const endIdx = this.findIndexByVersion(version);

    // Log.info('startIdx:' + startIdx + ' endIdx:' + endIdx);
    this.options.logger('info', 'Migrating from version ' + this.list[startIdx].version
      + ' -> ' + this.list[endIdx].version);

    if (currentVersion < version) {
      for (let i = startIdx; i < endIdx; i++) {
        try {
          await migrate('up', i + 1);
          currentVersion = self.list[i + 1].version;
          await updateVersion();
        } catch (e) {
          const prevVersion = self.list[i].version;
          const destVersion = self.list[i + 1].version;
          this.options.logger(
            'error', `Encountered an error while migrating from ${prevVersion} to ${destVersion}`);
          throw e;
        }
      }
    } else {
      for (let i = startIdx; i > endIdx; i--) {
        try {
          await migrate('down', i);
          currentVersion = self.list[i - 1].version;
          await updateVersion();
        } catch (e) {
          const prevVersion = self.list[i].version;
          const destVersion = self.list[i - 1].version;
          this.options.logger(
            'error', `Encountered an error while migrating from ${prevVersion} to ${destVersion}`);
          throw e;
        }
      }
    }

    await unlock();
    this.options.logger('info', 'Finished migrating.');
  }

  /**
   * Gets the current control record, optionally creating it if non-existent
   *
   * @private
   * @returns {Promise<{ version: string, locked: boolean }>}
   * @memberof Migration
   */
  private async getControl(): Promise<{ version: string, locked: boolean }> {
    const con = await this.collection.findOne({ _id: 'control' });
    return con || (await this.setControl({
      version: '0.0.0',
      locked: false,
    }));
  }

  /**
   * Set the control record
   *
   * @private
   * @param {{ version: string, locked: boolean }} control
   * @returns {(Promise<{ version: string, locked: boolean } | null>)}
   * @memberof Migration
   */
  private async setControl(control: { version: string, locked: boolean }):
    Promise<{ version: string, locked: boolean } | null> {
    // Be quite strict
    check('String', control.version);
    check('Boolean', control.locked);

    const updateResult = await this.collection.updateOne({
      _id: 'control',
    }, {
      $set: {
        version: control.version,
        locked: control.locked,
      },
    }, {
      upsert: true,
    });

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
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].version === version) {
        return i;
      }
    }

    throw new Error('Migration version ' + version + ' not found');
  }

}
