#!/usr/bin/env bash
# Wipe all telemetry from the Postgres/TimescaleDB instance so the dashboard
# only shows data ingested from real extension clients after this point.
#
# Keeps the schema (migrations stay applied). Drops every row from:
#   - events        (telemetry, finding_counts via cascade)
#   - devices       (enrollment entries)
#
# Leaves untouched:
#   - the database user, roles, Keycloak realm
#   - Flyway/Liquibase history tables
#
# Usage:
#   bash infra/wipe-db.sh          # interactive confirmation
#   bash infra/wipe-db.sh --yes    # skip confirmation (CI / scripts)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! docker compose ps --services --status running | grep -qx postgres; then
  echo "[wipe-db] postgres container is not running. Start the stack first:"
  echo "          docker compose up -d postgres"
  exit 1
fi

if [[ ${1:-} != "--yes" ]]; then
  read -r -p "This deletes ALL telemetry and device enrollments. Continue? (yes/N) " REPLY
  [[ $REPLY == "yes" ]] || { echo "[wipe-db] Cancelled."; exit 0; }
fi

echo "[wipe-db] Truncating telemetry tables…"
docker compose exec -T postgres psql -U llmguard -d llmguard -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  tbl text;
BEGIN
  -- Collect existing tables so we don't fail on a clean install where a table
  -- hasn't been created yet.
  FOR tbl IN
    SELECT unnest(ARRAY[
      'finding_counts',
      'events',
      'attachments',
      'devices'
    ])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', tbl);
      RAISE NOTICE '  truncated %', tbl;
    END IF;
  END LOOP;
END $$;
SQL

echo "[wipe-db] Done. Refresh the dashboard — it will show empty state until"
echo "          a real extension begins posting telemetry."
