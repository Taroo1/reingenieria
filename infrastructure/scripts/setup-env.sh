#!/usr/bin/env bash
# Genera .env (raiz) y backend/.env a partir de .env.example con secretos aleatorios.
# Uso: ./infrastructure/scripts/setup-env.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/.env.example"
DST="$ROOT/.env"

[ -f "$SRC" ] || { echo "No se encuentra $SRC" >&2; exit 1; }
if [ -f "$DST" ] && [ "${1:-}" != "--force" ]; then
  echo "Ya existe $DST. No se sobrescribe (use --force para regenerarlo)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "Se requiere openssl" >&2; exit 1; }

# openssl entrega salida finita: evita SIGPIPE de 'tr | head' sobre /dev/urandom bajo pipefail.
rand_alnum() { openssl rand -base64 96 | tr -d '\n' | tr -dc 'A-Za-z0-9' | head -c "$1"; }
# Cumple la politica de contrasenas (12+, mayuscula, minuscula, numero).
rand_password() { printf '%sAa1' "$(rand_alnum 18)"; }

PG_PASS="$(rand_alnum 28)"
JWT="$(openssl rand -base64 48 | tr -d '\n')"
KEY="$(openssl rand -base64 32 | tr -d '\n')"
ADMIN_PASS="$(rand_password)"
OPER_PASS="$(rand_password)"
VIEW_PASS="$(rand_password)"
SIM_TOKEN="$(rand_alnum 40)"

: > "$DST"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    POSTGRES_PASSWORD=*)          echo "POSTGRES_PASSWORD=$PG_PASS" ;;
    DATABASE_URL=*)               echo "${line/CHANGE_ME_postgres_password/$PG_PASS}" ;;
    JWT_ACCESS_SECRET=*)          echo "JWT_ACCESS_SECRET=$JWT" ;;
    CREDENTIALS_ENCRYPTION_KEY=*) echo "CREDENTIALS_ENCRYPTION_KEY=$KEY" ;;
    SEED_ADMIN_PASSWORD=*)        echo "SEED_ADMIN_PASSWORD=$ADMIN_PASS" ;;
    SEED_OPERATOR_PASSWORD=*)     echo "SEED_OPERATOR_PASSWORD=$OPER_PASS" ;;
    SEED_VIEWER_PASSWORD=*)       echo "SEED_VIEWER_PASSWORD=$VIEW_PASS" ;;
    SIMULATOR_ADMIN_TOKEN=*)      echo "SIMULATOR_ADMIN_TOKEN=$SIM_TOKEN" ;;
    *)                            echo "$line" ;;
  esac
done < "$SRC" >> "$DST"

chmod 600 "$DST"
mkdir -p "$ROOT/backend"
cp "$DST" "$ROOT/backend/.env"
chmod 600 "$ROOT/backend/.env"

echo "Creados: .env y backend/.env (no se versionan; no los comparta)."
echo
echo "Credenciales iniciales (se muestran una sola vez; cambielas al ingresar):"
grep -E '^SEED_(ADMIN|OPERATOR|VIEWER)_EMAIL=' "$DST" | sed 's/^/  /'
echo "  ADMIN    : $ADMIN_PASS"
echo "  OPERADOR : $OPER_PASS"
echo "  CONSULTA : $VIEW_PASS"
echo
echo "IMPORTANTE: respalde CREDENTIALS_ENCRYPTION_KEY. Sin ella no se pueden descifrar las credenciales de proveedores."
