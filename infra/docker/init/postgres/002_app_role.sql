-- Postgres superusers (and any role with BYPASSRLS) skip row-level
-- security entirely, regardless of FORCE ROW LEVEL SECURITY on the table.
-- The docker-compose POSTGRES_USER ("voai") is a superuser by default —
-- if the application connected as that role, every RLS policy in
-- packages/db/migrations/ would be silently inert. This was caught by
-- the cross-tenant boundary test/seed script returning a row that should
-- have been blocked.
--
-- Fix: a separate non-superuser role for application runtime traffic.
-- "voai" (superuser) is reserved for running migrations (DDL needs
-- elevated privileges anyway); "voai_app" is what @voai/db connects as
-- in normal operation, and it is subject to every RLS policy like any
-- other tenant of the database.

CREATE ROLE voai_app LOGIN PASSWORD 'voai-app-dev-password' NOSUPERUSER NOBYPASSRLS;

GRANT CONNECT ON DATABASE voai_dev TO voai_app;
GRANT USAGE ON SCHEMA public TO voai_app;

-- Migrations run as "voai" and create tables after this script runs, so
-- grant on future tables too — otherwise every new migration would need
-- a matching GRANT statement of its own.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO voai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO voai_app;
