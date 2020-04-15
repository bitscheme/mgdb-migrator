import { IMigrationOptions, LogLevels, Migration } from './migration';

const migrator = new Migration();

const rerun = process.env.MIGRATE_RERUN === 'true' || false;
const version = process.env.MIGRATE_VERSION;

if (version) {
  migrator.migrateTo(version, rerun);
}

export { migrator, Migration, IMigrationOptions, LogLevels };
