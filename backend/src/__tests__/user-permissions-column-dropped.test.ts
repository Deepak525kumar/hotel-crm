import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// ADR-031 M-3 (PR-7): User.permissions is dropped — permissions are derived
// request-time from ROLE_PERMISSIONS[role] (D-1), never stored. This pins
// the schema-level fact so a future change can't silently reintroduce the
// column without this test failing.
describe('ADR-031 M-3: User.permissions column is dropped', () => {
  it('the Prisma schema no longer declares a permissions field on User', () => {
    const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    const userModelMatch = schema.match(/model User \{([\s\S]*?)\n\}/);
    expect(userModelMatch).not.toBeNull();

    const userModelBody = userModelMatch![1];
    expect(userModelBody).not.toMatch(/^\s*permissions\s+String\[\]/m);
  });

  it('a migration exists that drops the User.permissions column', () => {
    const migrationsDir = path.join(__dirname, '../../prisma/migrations');
    const migrationDirs = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

    const dropMigration = migrationDirs.find((dir) => {
      const sqlPath = path.join(migrationsDir, dir.name, 'migration.sql');
      if (!fs.existsSync(sqlPath)) return false;
      const sql = fs.readFileSync(sqlPath, 'utf8');
      return /DROP COLUMN\s+"permissions"/i.test(sql);
    });

    expect(dropMigration).toBeDefined();
  });
});
