#!/usr/bin/env bash
set -euo pipefail

db_url="${R2A_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

if [[ "$db_url" != postgresql://*127.0.0.1* && "$db_url" != postgresql://*localhost* ]]; then
  echo "Refusing Commerce R2A destructive fixtures outside an explicit local database URL." >&2
  exit 2
fi

psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/product_engine_release_1.sql
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/commerce_r2a_tracked_merchandise.sql
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/commerce_r2a_concurrency.sql
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/product_media_v2.sql
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/desk_order_customer_operability.sql
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/desk_order_customer_operability_concurrency.sql
