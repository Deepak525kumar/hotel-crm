-- Database provisioning for the Version Control service.
--
-- Run ONCE on the EC2 host as the Postgres superuser:
--   sudo -u postgres psql -d hotelcrm_dev -v vc_password="'<a-strong-password>'" \
--     -f scripts/provision-db.sql
--
-- Why a separate role rather than reusing `hotelcrm`:
--
-- This service accepts file uploads and serves anonymous public pages, so it is
-- the most exposed process on the box. Reusing the CRM's database role would
-- mean that any SQL injection or RCE in *this* service reads guests, payslips,
-- users and audit logs. The role below can only see its own schema — it has no
-- rights on `public` at all, and USAGE on the CRM's schema is explicitly revoked.

\set ON_ERROR_STOP on

-- 1. The role. NOSUPERUSER/NOCREATEDB/NOCREATEROLE are the defaults but are
--    stated so a future edit cannot widen them by accident.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotelcrm_vc') THEN
    EXECUTE format('CREATE ROLE hotelcrm_vc LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :vc_password);
  ELSE
    EXECUTE format('ALTER ROLE hotelcrm_vc PASSWORD %L', :vc_password);
  END IF;
END
$$;

-- 2. Its own schema, owned by it, so Prisma migrations can create and alter
--    tables there without any privilege on the rest of the database.
CREATE SCHEMA IF NOT EXISTS version_control AUTHORIZATION hotelcrm_vc;

-- 3. Lock it out of everything else.
--    PUBLIC holds USAGE + CREATE on `public` by default in Postgres < 15, which
--    would let this role read CRM tables and create its own objects among them.
REVOKE ALL ON SCHEMA public FROM hotelcrm_vc;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hotelcrm_vc;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hotelcrm_vc;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM hotelcrm_vc;

-- Future CRM tables must not become readable either: without this, tables the
-- CRM creates tomorrow could inherit permissive defaults.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM hotelcrm_vc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM hotelcrm_vc;

-- 4. Connect rights only to this database, and no ability to create new schemas.
REVOKE CREATE ON DATABASE hotelcrm_dev FROM hotelcrm_vc;
REVOKE CREATE ON DATABASE hotelcrm_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE hotelcrm_dev TO hotelcrm_vc;

-- 5. Make its own schema the only thing on its search_path, so an unqualified
--    table name can never silently resolve to a CRM table.
ALTER ROLE hotelcrm_vc SET search_path = version_control;

-- Verify: this should list version_control and nothing from public.
--   \c hotelcrm_dev hotelcrm_vc
--   SELECT table_schema, table_name FROM information_schema.tables
--    WHERE table_schema NOT IN ('pg_catalog','information_schema');
--   SELECT * FROM public."User";   -- must fail with: permission denied for schema public
