#!/usr/bin/env bash
# Verifica que el UPDATE atomico condicional impide la sobreventa bajo concurrencia real.
# Requiere psql y pgbench. Uso: DATABASE_URL=postgresql://... ./database/verify/02_concurrency.sh
# Crea y elimina sus propios datos; no toca otras filas.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
STOCK="${STOCK:-5}"; CLIENTS="${CLIENTS:-32}"; TXNS="${TXNS:-20}"
P=00000000-0000-0000-0000-00000000f001; PR=00000000-0000-0000-0000-00000000f0a1; L=00000000-0000-0000-0000-00000000f0b1
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq "$@"; }
cleanup() { q -c "DROP TABLE IF EXISTS _hold_results; DELETE FROM inventory_levels WHERE id='$L'; DELETE FROM products WHERE id='$PR'; DELETE FROM providers WHERE id='$P';" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
q -c "INSERT INTO providers(id,code,name,type,updated_at) VALUES ('$P','T-CONC','Proveedor concurrencia','HOTEL',now());
      INSERT INTO products(id,provider_id,type,code,name,updated_at) VALUES ('$PR','$P','ROOM','R-CONC','Habitacion',now());
      INSERT INTO inventory_levels(id,product_id,stay_date,total_quantity,updated_at) VALUES ('$L','$PR',current_date,$STOCK,now());
      CREATE TABLE _hold_results(ok boolean);"
SCRIPT=$(mktemp)
cat > "$SCRIPT" <<SQL
WITH u AS (
  UPDATE inventory_levels
     SET held_quantity = held_quantity + 1, version = version + 1, updated_at = now()
   WHERE id = '$L' AND total_quantity - held_quantity - sold_quantity >= 1
  RETURNING 1)
INSERT INTO _hold_results SELECT EXISTS (SELECT 1 FROM u);
SQL
pgbench "$DATABASE_URL" -n -f "$SCRIPT" -c "$CLIENTS" -j 4 -t "$TXNS" >/dev/null
OK=$(q -c "SELECT count(*) FROM _hold_results WHERE ok")
TOTAL=$(q -c "SELECT count(*) FROM _hold_results")
HELD=$(q -c "SELECT held_quantity FROM inventory_levels WHERE id='$L'")
echo "intentos=$TOTAL bloqueos_exitosos=$OK held_final=$HELD stock=$STOCK"
if [ "$OK" -eq "$STOCK" ] && [ "$HELD" -eq "$STOCK" ]; then echo "PASS: no hubo sobreventa"; else echo "FAIL: sobreventa o perdida de bloqueos"; exit 1; fi
rm -f "$SCRIPT"
