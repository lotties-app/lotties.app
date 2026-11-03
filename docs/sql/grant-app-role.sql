-- If a dedicated migrator role runs the migrations, use docs/sql/grant-migrator-role.sql instead: it also owns the tables and
-- sets the default privileges for the objects that role creates.
-- Run as the migrator/admin role (the role that owns the tables), connected to database lotties. The role names are psql
-- variables, so nothing here names a real role:
--
--   psql -h <host> -U <admin> -d lotties -v app_role=<app role> -v migrator_role=<role that runs migrations> \
--     -f docs/sql/grant-app-role.sql
--
-- Create the login role first (choose your own password, do not commit it), e.g. for app_role=lotties_app:
--   CREATE ROLE lotties_app LOGIN PASSWORD '<password>';
--
-- Least privilege: the API role may read/write data but never change the schema.

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the API role: psql -v app_role=<role>'; END $$;
\endif
\if :{?migrator_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the role that runs migrations: psql -v migrator_role=<role>'; END $$;
\endif

GRANT CONNECT ON DATABASE lotties TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Existing tables (the EF migrations history table is intentionally excluded).
-- Idempotent: re-run after each migration that adds tables (e.g. PushNotifications) if the default privileges below were not set.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
REVOKE ALL ON TABLE public."__EFMigrationsHistory" FROM :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Tables/sequences created by FUTURE migrations (the ones migrator_role creates).
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- Optional read-only role for inspection (create it the same way):
-- GRANT CONNECT ON DATABASE lotties TO <readonly_role>;
-- GRANT USAGE ON SCHEMA public TO <readonly_role>;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO <readonly_role>;
-- ALTER DEFAULT PRIVILEGES FOR ROLE <migrator_role> IN SCHEMA public GRANT SELECT ON TABLES TO <readonly_role>;
