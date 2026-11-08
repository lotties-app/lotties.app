-- Lotties, "bring your own database": prepare YOUR OWN Postgres database for one baby's care records
-- (user guide docs/BYO-DATABASE.md, design docs/design/47-bring-your-own-database.md D6 and section 3.3).
--
-- This is the same SQL the app builds for you in Settings > Where your data lives > Set up my own database, step
-- "Prepare your database" (code/web/src/byoDatabase/setupSql.ts; byoSetupSql.test.ts in code/web keeps the two equal).
-- Use the app's copy in a web SQL editor (Supabase, Neon): it already holds the passwords. Use this file only with psql,
-- where the role names and passwords are psql variables, so nothing secret is written in a file:
--
--   psql "host=<host> port=5432 dbname=<database> user=<admin user> sslmode=verify-full" \
--     -v app_role=lotties_app -v migrator_role=lotties_migrator \
--     -v app_password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9')" \
--     -v migrator_password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9')" \
--     -f docs/sql/byo-setup.sql
--
-- (Type the same passwords in the app afterwards; keep them out of your shell history and out of any repository.)
--
-- Run it once, as the database's admin user, in the database you will give to Lotties. It creates two login roles that
-- can reach only a schema called lotties: the migrator owns that schema (Lotties' servers create and update the tables
-- with it), the app role only reads and writes those tables. Never give Lotties your admin user. Lotties checks the roles
-- when it connects and refuses an app role that can do more (store_role_too_powerful).
--
-- This is NOT docs/sql/grant-app-role.sql or grant-migrator-role.sql: those set up the roles of the Lotties database
-- itself (operators only).

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the everyday role: psql -v app_role=<role>'; END $$;
\endif
\if :{?migrator_role}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the migration role: psql -v migrator_role=<role>'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the everyday role password: psql -v app_password=<password>'; END $$;
\endif
\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'pass the migration role password: psql -v migrator_password=<password>'; END $$;
\endif

-- 1. The roles: no superuser, no new databases or roles, few connections.
CREATE ROLE :"migrator_role" LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 3;
CREATE ROLE :"app_role" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;

-- 2. The schema, owned by the migration role (it creates and updates the tables).
GRANT :"migrator_role" TO CURRENT_USER;
CREATE SCHEMA lotties AUTHORIZATION :"migrator_role";
REVOKE :"migrator_role" FROM CURRENT_USER;

-- 3. The everyday role only reads and writes the tables of that schema.
GRANT USAGE ON SCHEMA lotties TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA lotties
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA lotties
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
REVOKE ALL ON SCHEMA public FROM :"app_role", :"migrator_role";

-- 4. Both roles see only that schema, and long or stuck queries stop on their own.
ALTER ROLE :"migrator_role" SET search_path = lotties;
ALTER ROLE :"app_role" SET search_path = lotties;
ALTER ROLE :"app_role" SET statement_timeout = '15s';
ALTER ROLE :"app_role" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE :"migrator_role" SET statement_timeout = '5min';
ALTER ROLE :"migrator_role" SET idle_in_transaction_session_timeout = '60s';
