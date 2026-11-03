-- Makes a dedicated, NON-superuser role able to run the EF Core migrations (`dotnet ef database update`, or the API with
-- DB_AUTO_MIGRATE=true). Run ONCE as a superuser/admin, connected to the application database. Idempotent.
-- The role names are psql variables, so nothing here names a real role:
--
--   psql -h <host> -U <admin> -d <database> -v migrator_role=<migrator role> -v app_role=<app role> \
--     -f docs/sql/grant-migrator-role.sql
--
--   migrator_role   the migrator (runs migrations, owns the tables; DB_MIGRATOR_USER), e.g. lotties_migrator
--   app_role        the limited runtime role of the API (DB_APP_USER), e.g. lotties_app
-- Do NOT make the migrator a member of a superuser role: membership would give it superuser power.

\set ON_ERROR_STOP on
\if :{?migrator_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the migrator role: psql -v migrator_role=<role>'; END $$;
\endif
\if :{?app_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the API role: psql -v app_role=<role>'; END $$;
\endif
-- psql variables are not expanded inside a DO block: the block reads the migrator role from this session setting.
SET lotties.migrator_role = :'migrator_role';

-- 1. The migrator may create objects in the schema (new tables in a migration).
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_role";

-- 2. It owns every table and sequence of the schema: ALTER TABLE, and INSERT into the seeded tables and into
--    "__EFMigrationsHistory", need ownership. Grants already given to other roles are kept.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO %I', r.name, current_setting('lotties.migrator_role'));
  END LOOP;
  FOR r IN SELECT format('%I.%I', sequence_schema, sequence_name) AS name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO %I', r.name, current_setting('lotties.migrator_role'));
  END LOOP;
END $$;

-- 3. The API role gets what it needs on today's tables and on tables the migrator creates from now on.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
REVOKE ALL ON TABLE public."__EFMigrationsHistory" FROM :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- 4. Check (read-only): every table is owned by the migrator, and the migrator can create in the schema.
SELECT tableowner, count(*) AS tables FROM pg_tables WHERE schemaname = 'public' GROUP BY tableowner;
SELECT has_schema_privilege(:'migrator_role', 'public', 'CREATE') AS migrator_can_create;
