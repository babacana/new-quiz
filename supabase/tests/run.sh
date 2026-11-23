#!/usr/bin/env bash
# Aplica as migrações num Postgres descartável e executa os testes SQL de supabase/tests/*.test.sql.
# Uso: DATABASE_URL=postgres://... supabase/tests/run.sh
# Sem DATABASE_URL, sobe um cluster temporário (precisa de binários do Postgres e, como root, do usuário "postgres").
set -euo pipefail
cd "$(dirname "$0")/../.."

cleanup() { [[ -n "${TMP_CLUSTER:-}" ]] && { run_as pg_ctl -D "$TMP_CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP_CLUSTER"; }; }
run_as() { if [[ $EUID -eq 0 ]]; then runuser -u postgres -- "$PG_BIN/$1" "${@:2}"; else "$PG_BIN/$1" "${@:2}"; fi; }

if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  TMP_CLUSTER="$(mktemp -d)"; chmod 755 "$TMP_CLUSTER"; [[ $EUID -eq 0 ]] && chown postgres "$TMP_CLUSTER"
  trap cleanup EXIT
  run_as initdb -D "$TMP_CLUSTER/data" -A trust >/dev/null
  run_as pg_ctl -D "$TMP_CLUSTER/data" -o "-k $TMP_CLUSTER -c listen_addresses=''" -w start >/dev/null
  export DATABASE_URL="postgresql:///postgres?host=$TMP_CLUSTER&user=${PGUSER_LOCAL:-postgres}"
fi

psql_run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_run -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions" 2>/dev/null || true
psql_run -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "migração: $(basename "$f")"; psql_run -f "$f" >/dev/null; done

fail=0
for t in supabase/tests/*.test.sql; do
  echo "teste: $(basename "$t")"
  psql_run -f "$t" || fail=1
done
[[ $fail -eq 0 ]] && echo "OK: testes SQL passaram" || { echo "FALHA nos testes SQL"; exit 1; }
