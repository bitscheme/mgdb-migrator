A simple migration system for mongodb supporting up/downwards migrations.

## Status

| Branch |                                                    Status                                                     |
| ------ | :-----------------------------------------------------------------------------------------------------------: |
| Next   |  ![CI Workflow](https://github.com/emmanuelbuah/mgdb-migrator/workflows/CI%20Workflow/badge.svg?branch=next)  |
| Master | ![CI Workflow](https://github.com/emmanuelbuah/mgdb-migrator/workflows/CI%20Workflow/badge.svg?branch=master) |

## Installation

Migrations can be installed through yarn or npm. Type:

```sh
$ npm install mgdb-migrator
```

or

```sh
$ yarn add mgdb-migrator
```

## API

### Versioning

Migration versions are strings specified using semver _major.minor.patch_ syntax (e.g. '1.2.3') and follow the precedence rules concerning order. They must be exact versions as ranges are not allowed. See [semver](https://www.npmjs.com/package/semver) for more information.

### Basics

Import and use the migration instance - migrator. User the migrator to configure and setup your migration

```javascript
import { migrator } from 'mgdb-migrator'

await migrator.config({
  // false disables logging
  log: true,
  // null or a function
  logger: (level, ...args) => console.log(level, ...args),
  // enable/disable info log "already at latest."
  logIfLatest: true,
  // migrations collection name. Defaults to 'migrations'
  collectionName: 'migrations',
  // mongodb connection properties object
  db: {
    // mongodb connection url
    connectionUrl: 'your connection string',
    // optional database name, in case using it in connection string is not an option
    name: 'your database name',
    // optional mongodb Client options
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  }
}) // Returns a promise
```

Or ...

Define a new instance of migration and configure it as you see fit

```javascript
import { Migration } from 'mgdb-migrator'

var migrator = new Migration({
  // false disables logging
  log: true,
  // null or a function
  logger: (level, ...args) => console.log(level, ...args),
  // enable/disable info log "already at latest."
  logIfLatest: true,
  // migrations collection name
  collectionName: 'migrations',
  // mongodb connection properties object
  db: {
    // mongodb connection url
    connectionUrl: 'your connection string',
    // optional database name, in case using it in connection string is not an option
    name: 'your database name',
    // optional mongodb Client options
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  }
})

await migrator.config() // Returns a promise
```

To write a simple migration, somewhere in the server section of your project define:

```javascript
migrator.add({
  version: '0.0.1',
  up: function(db, client) {
    // use `db`(mongo driver Db instance) for migration setup to version 0.0.1
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
  },
  down: function(db, client) {
    //
  }
})
```

To run this migration to the latest version:

```javascript
migrator.up('latest')
```

### Advanced

A more complete set of migrations might look like:

```javascript
migrator.add({
  version: '1.1.1',
  name: 'Name for this migration',
  up: (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to version 1.1.1
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
  },
  down: (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to previous version
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
  }
})

migrator.add({
  version: '1.1.2',
  name: 'Name for this migration',
  up: (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to version 1.1.2
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
  },
  down: (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to previous version
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
  }
})
```

Control execution flow with async/await (promises):

```javascript
migrator.add({
  version: '1.1.2',
  name: 'Name for this migration',
  up: async (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to version 1.1.2
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
     await db.collections('someCollection')....
  },
  down: async (db, client) => {
    // use `db`(mongo driver Db instance) for migration setup to previous version
    // See http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html for db api
    await db.collections('someCollection')....
  }
});
```

As in 'Basics', you can migrate to the latest by running:

```javascript
migrator.up('latest')
```

By specifying a version, you can migrate directly to that version (if possible).
In the above example, you could migrate directly to version 1.1.2 by running:

```javascript
migrator.up('1.1.2')
```

If you wanted to undo all of your migrations, you could migrate back down to version 0.0.0 by running:

```javascript
migrator.down('0.0.0')
```

Sometimes (usually when something goes awry), you may need to retry a migration. You can do this by updating the `migrations.version` field in mongodb to the previous version and re-executing your migration.

To see what version the database is at, call:

```javascript
migrator.getVersion()
```

To see the configured migrations (excludes 0.0.0), call:

```javascript
migrator.getMigrations()
```

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
module.exports = {
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

**IMPORTANT**:

- You cannot create your own migration at version 0.0.0. This version is reserved by `migrator` for initial state when no migrations have been applied.
- If migrating from vTa to vTz and migration fails from a vTx to vTy, where vTx & vTy are incremental versions between vTa to vTz, migration will stop at vTx.
- Prefer an async function (async | promise) for both up()/down() setup. This will ensure migration completes before version bump during execution.

### Configuration

You can configure Migration with the `config` method. Defaults are:

```javascript
migrator.config({
  // Log job run details to console
  log: true,
  // Use a custom logger function (level, ...args) => void
  logger: null,
  // Enable/disable logging "Not migrating, already at version {number}"
  logIfLatest: true,
  // migrations collection name to use in the database
  collectionName: "migrations"
  // mongodb connection properties object or mongo Db instance
  db: {
    // mongodb connection url
    connectionUrl: "your connection string",
    // optional database name, in case using it in connection string is not an option
    name: null,
    // optional mongodb Client options
    options: null,
  }
});
```

### Logging

Migrations uses console by default for logging if not provided. If you want to use your
own logger (for sending to other consumers or similar) you can do so by
configuring the `logger` option when calling `migrator.config` .

Migrations expects a function as `logger`, and will pass an argument with properties level, message,
to it for
you to take action on.

```javascript
var MyLogger = function(opts) {
  console.log('Level', opts.level);
  console.log('Message', opts.message);
}

Migrations.config({
  ...
  logger: MyLogger
  ...
});

```

The `opts` object passed to `MyLogger` above includes `level`, `message`, and any other additional
info needed.

- `level` will be one of `info`, `warn`, `error`, `debug`.
- `message` is something like `Finished migrating.`.

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
