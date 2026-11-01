-- If a dedicated migrator role runs the migrations, use docs/sql/grant-migrator-role.sql instead: it also owns the tables and
-- sets the default privileges for the objects that role creates.
-- Run as the migrator/admin role (the role that owns the tables), connected to database lotties.
-- Create the login role first (choose your own password, do not commit it):
--   CREATE ROLE k_lotties_usr LOGIN PASSWORD '<password>';
--
-- Least privilege: the API role may read/write data but never change the schema.

GRANT CONNECT ON DATABASE lotties TO k_lotties_usr;
GRANT USAGE ON SCHEMA public TO k_lotties_usr;

-- Existing tables (the EF migrations history table is intentionally excluded).
-- Idempotent: re-run after each migration that adds tables (e.g. PushNotifications) if the default privileges below were not set.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO k_lotties_usr;
REVOKE ALL ON TABLE public."__EFMigrationsHistory" FROM k_lotties_usr;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO k_lotties_usr;

-- Tables/sequences created by FUTURE migrations. Replace claude_admin_user with the role that runs migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE claude_admin_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO k_lotties_usr;
ALTER DEFAULT PRIVILEGES FOR ROLE claude_admin_user IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO k_lotties_usr;

-- Optional read-only role for inspection (create it the same way):
-- GRANT CONNECT ON DATABASE lotties TO <readonly_role>;
-- GRANT USAGE ON SCHEMA public TO <readonly_role>;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO <readonly_role>;
-- ALTER DEFAULT PRIVILEGES FOR ROLE claude_admin_user IN SCHEMA public GRANT SELECT ON TABLES TO <readonly_role>;
