-- Verificacion de reglas de negocio a nivel de base de datos.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f database/verify/01_constraints.sql
-- Cada bloque DO intenta una operacion que DEBE fallar y reporta PASS/FAIL. Todo se revierte al final.
BEGIN;

CREATE TEMP TABLE _results(test text, outcome text);

CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO _results VALUES (label, 'FAIL (no fallo)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES (label, 'PASS (' || SQLSTATE || ')');
  END;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO _results VALUES (label, 'PASS');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES (label, 'FAIL (' || SQLERRM || ')');
  END;
END $$ LANGUAGE plpgsql;

-- Datos base
INSERT INTO currencies(code, name) VALUES ('USD','Dolar estadounidense'), ('ARS','Peso argentino');
INSERT INTO providers(id, code, name, type, updated_at) VALUES ('00000000-0000-0000-0000-000000000001','T-HOTEL','Hotel de prueba','HOTEL', now());
INSERT INTO products(id, provider_id, type, code, name, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','ROOM','R1','Habitacion', now());
INSERT INTO inventory_levels(id, product_id, stay_date, total_quantity, updated_at) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1', current_date, 2, now());

-- Sobreventa
SELECT pg_temp.expect_error('sobreventa: held+sold > total',
  $q$UPDATE inventory_levels SET held_quantity = 2, sold_quantity = 1 WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$);
SELECT pg_temp.expect_error('stock negativo',
  $q$UPDATE inventory_levels SET held_quantity = -1 WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$);
SELECT pg_temp.expect_ok('bloqueo valido hasta el total',
  $q$UPDATE inventory_levels SET held_quantity = 2 WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$);
SELECT pg_temp.expect_error('hold con cantidad 0',
  $q$INSERT INTO inventory_holds(level_id, quantity, expires_at) VALUES ('00000000-0000-0000-0000-0000000000b1', 0, now())$q$);
SELECT pg_temp.expect_error('un nivel por producto y fecha (unico)',
  $q$INSERT INTO inventory_levels(product_id, stay_date, total_quantity, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1', current_date, 5, now())$q$);

-- Reservas: no confirmar sin proveedor
INSERT INTO bookings(id, reference, currency, total_amount, holder_name, holder_email, updated_at)
  VALUES ('00000000-0000-0000-0000-0000000000c1','B-1','USD',100,'Ana','ana@example.com', now());
INSERT INTO booking_items(id, booking_id, product_id, quantity, start_date, unit_amount, total_amount, updated_at)
  VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',1,current_date,100,100, now());
SELECT pg_temp.expect_error('reserva CONFIRMED con item pendiente',
  $q$UPDATE bookings SET status='CONFIRMED', confirmed_at=now() WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
SELECT pg_temp.expect_error('item CONFIRMED sin localizador externo',
  $q$UPDATE booking_items SET status='CONFIRMED', confirmed_at=now() WHERE id='00000000-0000-0000-0000-0000000000d1'$q$);
SELECT pg_temp.expect_ok('item CONFIRMED con localizador',
  $q$UPDATE booking_items SET status='CONFIRMED', confirmed_at=now(), external_locator='LOC123' WHERE id='00000000-0000-0000-0000-0000000000d1'$q$);
SELECT pg_temp.expect_error('reserva CONFIRMED sin confirmed_at',
  $q$UPDATE bookings SET status='CONFIRMED' WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
SELECT pg_temp.expect_ok('reserva CONFIRMED con todos los items confirmados',
  $q$UPDATE bookings SET status='CONFIRMED', confirmed_at=now() WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
SELECT pg_temp.expect_error('insertar reserva CONFIRMED sin items',
  $q$INSERT INTO bookings(reference, status, currency, total_amount, holder_name, holder_email, confirmed_at, updated_at) VALUES ('B-2','CONFIRMED','USD',10,'Bo','bo@example.com', now(), now())$q$);

-- Idempotencia y operaciones duplicadas
INSERT INTO idempotency_keys(idem_key, scope, request_hash, expires_at) VALUES ('k1','POST /bookings','h', now() + interval '1 day');
SELECT pg_temp.expect_error('clave de idempotencia duplicada (mismo alcance)',
  $q$INSERT INTO idempotency_keys(idem_key, scope, request_hash, expires_at) VALUES ('k1','POST /bookings','h', now() + interval '1 day')$q$);
SELECT pg_temp.expect_ok('misma clave en otro alcance',
  $q$INSERT INTO idempotency_keys(idem_key, scope, request_hash, expires_at) VALUES ('k1','POST /bookings/confirm','h', now() + interval '1 day')$q$);
INSERT INTO integration_transactions(correlation_id, operation, operation_key) VALUES ('c1','CONFIRM','item-1:CONFIRM');
SELECT pg_temp.expect_error('operacion de escritura duplicada (operation_key)',
  $q$INSERT INTO integration_transactions(correlation_id, operation, operation_key) VALUES ('c2','CONFIRM','item-1:CONFIRM')$q$);
SELECT pg_temp.expect_ok('lecturas sin operation_key pueden repetirse',
  $q$INSERT INTO integration_transactions(correlation_id, operation) VALUES ('c3','SEARCH'), ('c4','SEARCH')$q$);

-- Auditoria de solo insercion
INSERT INTO audit_logs(action, entity) VALUES ('TEST','x');
SELECT pg_temp.expect_error('UPDATE sobre audit_logs', $q$UPDATE audit_logs SET action='HACK'$q$);
SELECT pg_temp.expect_error('DELETE sobre audit_logs', $q$DELETE FROM audit_logs$q$);
INSERT INTO inventory_movements(level_id, kind) VALUES ('00000000-0000-0000-0000-0000000000b1','HOLD');
SELECT pg_temp.expect_error('DELETE sobre inventory_movements', $q$DELETE FROM inventory_movements$q$);

-- Proveedores: no se eliminan con operaciones asociadas
SELECT pg_temp.expect_error('eliminar proveedor con productos',
  $q$DELETE FROM providers WHERE id='00000000-0000-0000-0000-000000000001'$q$);

-- Configuracion y moneda
SELECT pg_temp.expect_error('timeout_ms <= 0',
  $q$INSERT INTO provider_configs(provider_id, base_url, timeout_ms, updated_at) VALUES ('00000000-0000-0000-0000-000000000001','http://x',0, now())$q$);
SELECT pg_temp.expect_error('tarifa negativa',
  $q$INSERT INTO rates(product_id, currency, amount, valid_from, valid_to, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1','USD',-1,current_date,current_date, now())$q$);
SELECT pg_temp.expect_error('tarifa con moneda inexistente',
  $q$INSERT INTO rates(product_id, currency, amount, valid_from, valid_to, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1','XXX',1,current_date,current_date, now())$q$);
SELECT pg_temp.expect_error('periodo de allotment invertido',
  $q$INSERT INTO allotments(product_id, valid_from, valid_to, quantity, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1', current_date + 5, current_date, 1, now())$q$);

SELECT test, outcome FROM _results ORDER BY test;
SELECT count(*) FILTER (WHERE outcome LIKE 'PASS%') AS pass, count(*) FILTER (WHERE outcome LIKE 'FAIL%') AS fail FROM _results;
ROLLBACK;
