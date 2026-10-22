-- Makes a dedicated, NON-superuser role able to run the EF Core migrations (`dotnet ef database update`, or the API with
-- DB_AUTO_MIGRATE=true). Run ONCE as a superuser/admin, connected to the application database. Idempotent.
--
--   psql -h <host> -U <admin> -d <database> -f docs/sql/grant-migrator-role.sql
--
-- Names used below (replace them everywhere if yours differ):
--   k_lotties_migration_usr   the migrator (runs migrations, owns the tables)
--   k_lotties_usr             the limited runtime role of the API
-- Do NOT make the migrator a member of a superuser role: membership would give it superuser power.

-- 1. The migrator may create objects in the schema (new tables in a migration).
GRANT USAGE, CREATE ON SCHEMA public TO k_lotties_migration_usr;

-- 2. It owns every table and sequence of the schema: ALTER TABLE, and INSERT into the seeded tables and into
--    "__EFMigrationsHistory", need ownership. Grants already given to other roles are kept.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO k_lotties_migration_usr', r.name);
  END LOOP;
  FOR r IN SELECT format('%I.%I', sequence_schema, sequence_name) AS name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO k_lotties_migration_usr', r.name);
  END LOOP;
END $$;

-- 3. The API role gets what it needs on today's tables and on tables the migrator creates from now on.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO k_lotties_usr;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO k_lotties_usr;
REVOKE ALL ON TABLE public."__EFMigrationsHistory" FROM k_lotties_usr;
ALTER DEFAULT PRIVILEGES FOR ROLE k_lotties_migration_usr IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO k_lotties_usr;
ALTER DEFAULT PRIVILEGES FOR ROLE k_lotties_migration_usr IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO k_lotties_usr;

-- 4. Check (read-only): every table is owned by the migrator, and the migrator can create in the schema.
SELECT tableowner, count(*) AS tables FROM pg_tables WHERE schemaname = 'public' GROUP BY tableowner;
SELECT has_schema_privilege('k_lotties_migration_usr', 'public', 'CREATE') AS migrator_can_create;
