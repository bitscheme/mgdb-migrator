import { migrator } from '../src/';

const v0 = '0.0.0';
const v1 = '0.0.1';
const v2 = '0.1.2';
const v3 = '0.10.3';
const v4 = '1.0.4';
const v5 = '100.0.5';

describe('Migration', () => {
  beforeAll(async () => {
    try {
      await migrator.config({
        log: true,
        collectionName: '_migration',
        db: { connectionUrl: process.env.DB_URL },
      });
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

  describe('#migrate', () => {
    test('from v0 to v1, should migrate to v1', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.up(v1);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v1);
    });

    test('from v0 to v2, should migrate to v2', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.up(v2);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);
    });

    test('from v0 to v2, should migrate to latest', async () => {
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v0);
      await migrator.up('latest');
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);
    });

    test('from v1 to v2 to v1, should migrate back to v1', async () => {
      await migrator.up(v2);
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);

      await migrator.down(v1);
      currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v1);
    });

    test('from v1 to v2 to v0, should migrate back to v0', async () => {
      await migrator.up(v2);
      let currentVersion = await migrator.getVersion();
      expect(currentVersion).toBe(v2);

      await migrator.down(v0);
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
        await migrator.up(v3);
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v3);
      });

      test('from v0 to v4, should migrate to v4', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await migrator.up(v4);
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

      test('from v0 to v100, should stop due to v100 does not exist', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await expect(migrator.up('100.100.100')).rejects.toThrow();
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
      });

      test('from v0 to v5, should stop migration at v4 due to error in v5.up', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await expect(migrator.up(v5)).rejects.toThrow();
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
      });

      test('from v0 to v4 to v3, should stop migration at v4 due to error in v4.down', async () => {
        let currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v0);
        await migrator.up(v4);
        await expect(migrator.down(v3)).rejects.toThrow();
        currentVersion = await migrator.getVersion();
        expect(currentVersion).toBe(v4);
      });
    });
  });
});
