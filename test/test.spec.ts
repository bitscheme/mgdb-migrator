import { Migration } from '../src/';

const dbURL = process.env.DBURL;
const v0 = '0.0.0';
const v1 = '0.0.1';
const v2 = '0.1.2';
const v3 = '0.10.3';
const v4 = '1.0.4';
const v5 = '100.0.5';

describe('Migration', () => {
  let migrator: Migration;

  beforeAll(async () => {
    try {
      migrator = new Migration({
        log: true,
        logIfLatest: true,
        collectionName: '_migration',
        db: { connectionUrl: dbURL },
      });
      await migrator.config();
    } catch (e) {
      throw e;
    }
  });

  beforeEach(() => {
    migrator.add({
      version: v1,
      name: 'v1',
      up: () => {
        //
      },
      down: () => {
        //
      },
    });

    migrator.add({
      version: v2,
      name: 'v2',
      up: () => {
        //
      },
      down: () => {
        //
      },
    });
  });

  afterEach(async () => {
    await migrator.reset();
  });

  afterAll(async () => {
    await migrator.close();
  });

  describe('#add', () => {
    test('sorts added migrations', async () => {
      migrator.add({
        version: v5,
        name: 'v5',
        up: () => {
          //
        },
        down: () => {
          //
        },
      });
      migrator.add({
        version: v3,
        name: 'v3',
        up: () => {
          //
        },
        down: () => {
          //
        },
      });
      migrator.add({
        version: v4,
        name: 'v4',
        up: () => {
          //
        },
        down: () => {
          //
        },
      });
      migrator.getMigrations().map((m, index) => expect(Number(m.name.charAt(1))).toBe(index + 1));
    });
  });

  describe('#migrateTo', () => {
    test('from v0 to v1, should migrate to v1', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.migrateTo(v1);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v1);
    });

    test('from v0 to v2, should migrate to v2', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.migrateTo(v2);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);
    });

    test('from v0 to v2, should migrate to latest', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.migrateTo('latest');
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);
    });

    test('from v2 to v1, should migrate to v1', async () => {
      await migrator.migrateTo(v2);
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);

      await migrator.migrateTo(v1);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v1);
    });

    test('from v2 to v0, should migrate to v0', async () => {
      await migrator.migrateTo(v2);
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);

      await migrator.migrateTo(v0);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
    });

    test('rerun 0 to 0, should migrate to v0', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);

      await migrator.migrateTo(v0, true);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
    });

    describe('With async up() & down()', () => {
      beforeEach(() => {
        migrator.add({
          version: v3,
          name: 'v3',
          up: async () => {
            //
          },
          down: async () => {
            //
          },
        });

        migrator.add({
          version: v4,
          name: 'v4',
          up: async () => {
            //
          },
          down: async () => {
            //
          },
        });
      });

      test('from v0 to v3, should migrate to v3', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await migrator.migrateTo(v3);
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v3);
      });

      test('from v0 to v4, should migrate to v4', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await migrator.migrateTo(v4);
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
      });
    });

    describe('On Error', () => {
      beforeEach(() => {
        migrator.add({
          version: v3,
          name: 'v3',
          up: async () => {
            //
          },
          down: async () => {
            //
          },
        });

        migrator.add({
          version: v4,
          name: 'v4',
          up: async () => {
            //
          },
          down: async () => {
            throw new Error('Something went wrong');
          },
        });

        migrator.add({
          version: v5,
          name: 'v5',
          up: async () => {
            throw new Error('Something went wrong');
          },
          down: async () => {
            //
          },
        });
      });

      test('from v0 to v5, should stop migration at v4 due to error from v4 to v5', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        try {
          await migrator.migrateTo(v5);
        } catch (e) {
          expect(e).toBeTruthy();
          expect(e).toBeInstanceOf(Error);
        }
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
      });

      test('from v4 to v3, should stop migration at 4 due to error from v4 to v3', async () => {
        await migrator.migrateTo(v4);
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
        try {
          await migrator.migrateTo(v3);
        } catch (e) {
          expect(e).toBeTruthy();
          expect(e).toBeInstanceOf(Error);
        }
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
      });
    });
  });
});
