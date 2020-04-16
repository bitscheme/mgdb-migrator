A simple migration system for mongodb supporting up/downwards migrations.

## Status

| Branch |                                                   Status                                                   |
| ------ | :--------------------------------------------------------------------------------------------------------: |
| Next   |  ![CI Workflow](https://github.com/bitscheme/mgdb-migrator/workflows/CI%20Workflow/badge.svg?branch=next)  |
| Master | ![CI Workflow](https://github.com/bitscheme/mgdb-migrator/workflows/CI%20Workflow/badge.svg?branch=master) |

## Install

```sh
$ npm i mgdb-migrator
```

or

```sh
$ yarn add mgdb-migrator
```

## Quick Start

```js
import { migrator } from 'mgdb-migrator'

await migrator.config({
  // false disables logging
  log: true,
  // optional logging function
  logger: (level, ...args) => console.log(level, ...args),
  // migrations collection name defaults to 'migrations'
  collectionName: 'migrations',
  // max time allowed in ms for a migration to finish, default Number.POSITIVE_INFINITY
  timeout: 30000,
  // connection properties object
  db: {
    // mongodb connection url
    connectionUrl: 'mongodb://localhost:27017/my-db',
    // optional database name, in case using it in connection string is not an option
    name: 'my-db',
    // optional mongodb MongoClientOptions
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  }
})

migrator.add({
  version: '1.0.1',
  name: 'Name for this migration',
  up: async (db: Db, client: MongoClient, logger: Logger) => {
    // write your migration here
  },
  down: async (db: Db, client: MongoClient, logger: Logger) => {
    // write your reverting migration here
  }
})

// run all configured migrations greater than the current version in order
await migrator.up()
```

## Versioning

Migration versions are strings specified using semver _major.minor.patch_ syntax (e.g. '1.2.3') and follow the precedence rules concerning order. They must be exact versions as ranges are not allowed. See [semver](https://www.npmjs.com/package/semver) for more information.

Migration version 0.0.0 is reserved by `migrator` for initial state to indicate no migrations have been applied.

## Flow

Migration state is implemented in the MongoDB collection `migrations`. It contains a single document used for locking migration control. Only one set of migrations is allowed to execute at a time.

> _You can override the collection name in `config` if needed._

```js
{
  _id: string, // 'control'
  version: string,
  locked: boolean,
  lockedAt: date
}
```

When a migration is performed, all migrations that include versions between `current` and `target` are executed serially in order.

For example, if you have added the following migrations:

- 1.0.0
- 1.0.1
- 1.0.2
- 1.1.0

and the `current` version is at 1.0.0, executing `up('1.1.0')` will run migration 1.0.1, 1.0.2 and 1.1.0. If all migrations were successful, the `current` version becomes 1.1.0.

If any particular migration rejects or throws an error, subsequent migrations are halted and the `current` version is set to the last successfully completed migration.

## API

### `config(opts: IMigrationOptions) ⇒ Promise<void>`

See the [Quick Start](#quick-start) for options.

### `add(migration: IMigration)`

To setup a new database migration script, call `migrator.add`.

You must implement `up` and `down` functions. Return a promise (or use async/await) and
resolve to indicate success, throw an error or reject to abort.

### `up(target?: string) ⇒ Promise<void>`

To migrate to the latest configured migration:

```js
migrator.up()
```

Or by specifying a target version, you can migrate directly to that version (if possible).

```js
migrator.up('1.0.1')
```

### `down(target: string) ⇒ Promise<void>`

To revert a migration:

```javascript
migrator.down('1.0.1')
```

If you want to undo all of your migrations, you can migrate back down to version 0.0.0 by running:

```javascript
migrator.down('0.0.0')
```

Sometimes (usually when something goes awry), you may need to retry a migration. You can do this by updating the `migrations.version` field in mongodb to the previous version and re-executing your migration.

### `getVersion() ⇒ string`

To see what version the database is at, call:

```javascript
migrator.getVersion()
```

### `getMigrations() ⇒ IMigration[]`

To see the configured migrations (excluding 0.0.0), call:

```javascript
migrator.getMigrations()
```

### `close(force?: boolean) ⇒ Promise<void>`

To close the mongodb connection, call:

```javascript
migrator.close()
```

### Using MongoDB Transactions API

You can make use of the [MongoDB Transaction API](https://docs.mongodb.com/manual/core/transactions/) in your migration scripts.

Note: this requires

- MongoDB 4.0 or higher

`migrator` will call your migration `up` and `down` function with a second argument: `client`, a [MongoClient](https://mongodb.github.io/node-mongodb-native/3.3/api/MongoClient.html) instance to give you access to the `startSession` function.

Example:

```javascript
const albumMigration = {
  version: '1.0.0',
  async up(db, client) {
    const session = client.startSession()
    try {
      await session.withTransaction(async () => {
        await db
          .collection('albums')
          .updateOne({ artist: 'The Beatles' }, { $set: { blacklisted: true } })
        await db.collection('albums').updateOne({ artist: 'The Doors' }, { $set: { stars: 5 } })
      })
    } finally {
      await session.endSession()
    }
  },
  async down(db, client) {
    const session = client.startSession()
    try {
      await session.withTransaction(async () => {
        await db
          .collection('albums')
          .updateOne({ artist: 'The Beatles' }, { $set: { blacklisted: false } })
        await db.collection('albums').updateOne({ artist: 'The Doors' }, { $set: { stars: 0 } })
      })
    } finally {
      await session.endSession()
    }
  }
}
```

### Logging

Migrations uses the console by default for logging if not provided. If you want to use your own logger (for sending to other consumers or similar) you can do so by
configuring the `logger` option when calling `migrator.config`.

Log levels conform to those in node.js [Console](https://nodejs.org/api/console.html) API.

```javascript
import { createLogger } from 'winston';

const logger = createLogger({
  transports: [
    new winston.transports.Console();
  ]
});

const myLogger = (level, message) => {
  logger.log({
    level,
    message
  });
}

migrator.config({
  ...
  logger: myLogger
  ...
});

```

## Development

Run docker-compose to execute lib in dev mode

```sh
$ npm run docker:dev
```

## Test

Run docker-compose to execute lib in test mode

```sh
$ npm run docker:test
```

## Credits

Migration builds on [percolatestudio/meteor-migrations](https://github.com/percolatestudio/meteor-migrations) with the goal of creating a generic mongodb migration library
