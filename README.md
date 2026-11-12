# MundoGlobal Travel — Motor Orquestador Backend

Acción de Mejora 2: integración con proveedores + inventario y reservas centralizados.
Estado: **Etapa 3 (integraciones y lógica de negocio)**. Ver «Alcance actual».

## Requisitos
- Node.js 22 o superior (probado con 26), Docker con Compose.
- `openssl` (Linux/macOS) o PowerShell (Windows) para generar los secretos.
- Python 3 solo si se modifica el modelo de datos (`database/tools`).

## Puesta en marcha
```bash
# 1. Variables de entorno con secretos aleatorios (muestra las claves iniciales una sola vez)
./infrastructure/scripts/setup-env.sh            # Windows: infrastructure\scripts\setup-env.ps1

# 2. Base de datos, Redis y simulador de proveedores
docker compose up -d db redis provider-simulator

# 3. Backend
cd backend
npm install                    # npm 11 pide aprobar scripts: ya estan aprobados en package.json (allowScripts)
npx prisma generate
npx prisma migrate deploy      # 4 migraciones
npx prisma db seed             # roles, usuarios, proveedores, catalogo y cupos de ejemplo, tipos de cambio ficticios
npm run start:dev
```
- API: `http://localhost:3001/api/v1` · Swagger: `http://localhost:3001/api/docs` · Sondas: `/api/v1/health/live`, `/api/v1/health/ready`.
- Simulador: `http://localhost:4100/health`.
- Primer uso: `POST /api/v1/auth/login` con el correo del admin y la contraseña que mostró `setup-env`; use el `accessToken` en *Authorize* de Swagger.
- Si su `.env` es anterior a la Etapa 3, agregue el bloque `SIMULATOR_*` y (opcional) `JOBS_ENABLED`… de `.env.example`; las variables de la Etapa 3 tienen valores por defecto salvo `SIMULATOR_ADMIN_TOKEN`.

### Activar los proveedores del simulador
El seed crea seis proveedores HTTP **deshabilitados** que apuntan al simulador (`SIM_HTTP` = SKYJET, `HTTP_GDS`, `HTTP_CONSOLIDATOR`, `HTTP_HOTEL`, `HTTP_BEDBANK`, `HTTP_ASSIST`). Para usarlos: `POST /api/v1/integrations/{id}/enable`. Los proveedores `SIM_*` con adaptador SIMULATED (en memoria) ya vienen habilitados.

## Dashboard web (`dashboard/`, Etapa 4)
```bash
cd dashboard
npm install
npm run dev                    # http://localhost:3000 (el backend debe estar corriendo en :3001)
# produccion: npm run build && npm start   (sin https local: COOKIE_SECURE=false)
```
- Pantallas: login, panel de monitoreo, búsqueda → cotización → reserva, reservas (listado y detalle con bloquear, confirmar, cancelar y conciliar) y excepciones y alertas.
- Seguridad: Next.js hace de intermediario con el backend.
  - Los tokens viven en cookies `httpOnly` y `SameSite=Strict`; el navegador nunca los ve.
  - Las escrituras exigen la cabecera `x-mgt-csrf` y un Origin del mismo host.
  - La renovación de sesión se serializa, para no disparar la detección de reuso del refresh token.
- La interfaz oculta lo que el rol no puede hacer; quien autoriza es siempre el backend.
- Variables (`dashboard/.env.example`): `API_URL` y `REFRESH_TOKEN_TTL_DAYS`.
- Pruebas: `npm test` (capa de servidor).
- Limitación: con varias instancias del dashboard, la renovación de sesión necesita afinidad de sesión.

## Flujo de una reserva (API)
| Paso | Endpoint | Resultado |
|---|---|---|
| Buscar | `POST /search` | Ofertas de cupo propio (ALLOTMENT) y de proveedores en vivo (PROVIDER_LIVE). Si un proveedor falla, se informa en `providers[]` sin anular el resto |
| Cotizar | `POST /quotes` | Precio vigente de cada item, convertido a una sola moneda; guarda el precio de origen |
| Reservar | `POST /bookings` | Reserva `QUOTED` (cabecera `Idempotency-Key` obligatoria) |
| Bloquear | `POST /bookings/{id}/hold` | Cupo propio atómico + bloqueo en el proveedor si lo permite → `HELD` |
| Confirmar | `POST /bookings/{id}/confirm` | Revalida lo que es en vivo y confirma → `CONFIRMED`, `PENDING_CONFIRMATION`, `FAILED` o `REQUIRES_REVIEW` |
| Cancelar | `POST /bookings/{id}/cancel` | `CANCEL_REQUESTED` → `CANCELLED` (devuelve el cupo) |
| Conciliar | `POST /bookings/{id}/reconcile` | Consulta al proveedor los items pendientes (también lo hace el planificador) |

`hold`, `confirm` y `cancel` responden `200` con `{ booking, outcome }`: el resultado de negocio (por ejemplo, sin cupo) va en `outcome.status` y `outcome.errors`.

## Arquitectura
Monolito modular NestJS, hexagonal: el dominio solo habla con el puerto `ProviderAdapter` a través del **motor de integración**.

- **Adaptadores** (`modules/adapters`)
  - `SIMULATED`: en memoria y sin red.
  - `HTTP`: protocolo REST propio del proveedor, normalizado a los tipos canónicos y con validación estricta de cada respuesta.
  - `BOOMI`: **preparado, sin conexión real**. Implementa el puerto, pero no envía nada: faltan credenciales, licencia y documentación oficial. La integración no puede habilitarse.
- **Motor** (`modules/integration-engine`)
  - Persiste el `operation_key` *antes* de llamar al proveedor.
  - Aplica un timeout por intento y reintenta solo lo seguro (lecturas, y escrituras si el proveedor soporta `Idempotency-Key`), con espera `min(cap, base·2^n) + jitter`.
  - Circuit breaker persistido con bloqueo de fila, que abre una alerta deduplicada.
  - Cada llamada queda en `integration_transactions` + `transaction_attempts`, con su correlationId.
- **Inventario**
  - ALLOTMENT: la base es la fuente de verdad. El bloqueo es un `UPDATE` condicional (`total - held - sold >= n`) y el `CHECK` de la base es la segunda defensa. Respeta el plazo de release. Todo movimiento queda en `inventory_movements` (solo inserción).
  - PROVIDER_LIVE: caché consultiva (`availability_snapshots`) que se revalida antes de confirmar.
- **Reservas**
  - Máquina de estados con transiciones condicionales (dos operaciones simultáneas no pueden avanzar la misma reserva) e historial en `booking_status_history`.
  - Un timeout al confirmar es resultado **desconocido**: se consulta al proveedor y se concilia; nunca se marca `CONFIRMED` sin localizador.
  - Una falla parcial **compensa**: cancela lo ya confirmado y libera el cupo.
- **Sincronización** (`modules/sync`): CATALOG, AVAILABILITY, RATES y BOOKINGS, con `sync_runs` e `inconsistencies`. Las diferencias que desaparecen se resuelven solas.
- **Excepciones** (`/exceptions`): bandeja de casos para intervención humana (asignar, anotar, resolver o descartar).
- **Monitoreo**:
  - `/monitoring/overview`: tasa de éxito y latencias p50/p95 por integración en 24 h, circuitos, alertas, excepciones y reservas.
  - `/alerts`: reconocer y resolver alertas.
- **Planificador** (`modules/jobs`, `JOBS_ENABLED`): corre dentro del proceso, sin Redis.
  - Tareas: vencimientos (bloqueos, cotizaciones, claves de idempotencia), conciliación de pendientes y sincronización periódica.
  - Es seguro con varias réplicas: las transiciones son condicionales y la sincronización toma un lease con advisory lock de Postgres.
- **Roles**: ADMIN, OPERADOR y CONSULTA. Las escrituras exigen ADMIN u OPERADOR; CONSULTA solo lee.

## Simulador de proveedores (`provider-simulator/`)
Seis proveedores ficticios (SKYJET, GLOBALGDS, CONSOLIDA, HOTELNET, BEDSPLUS, ASSISTPRO) bajo `/p/<CODIGO>`. Cada uno tiene un formato propio de API, inventario, bloqueos con vencimiento, confirmación inmediata o a pedido, y soporte de `Idempotency-Key`.

API de control (cabecera `X-Simulator-Admin-Token: $SIMULATOR_ADMIN_TOKEN`) para inyectar fallas:
```bash
# 2 errores 503 en la busqueda de SKYJET
curl -X POST localhost:4100/__control/faults -H "X-Simulator-Admin-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"provider":"SKYJET","rules":[{"route":"availability","type":"error","status":503,"times":2}]}'
```
- Tipos de falla: `latency`, `error`, `timeout`, `malformed`, `duplicate`, `commit_then_error`, `commit_then_timeout`. Las dos últimas procesan la operación pero no responden bien: el caso de resultado desconocido.
- Otras acciones: `POST /__control/reset`, `GET /__control/stats`, `POST /__control/inventory`, `POST /__control/price`.

## Pruebas
```bash
cd provider-simulator && npm test        # 20 pruebas del simulador
cd backend && npm test                   # 81 pruebas unitarias
cd backend && npm run test:e2e           # 43 pruebas e2e contra Postgres y el simulador reales
```
- Las e2e usan una base **propia** (`<db>_test`). Su preparación no borra nada: `migrate deploy` + `db seed`.
- **Las e2e reinician el estado del simulador.** No las corra contra un simulador que esté usando su entorno de desarrollo: las reservas de prueba que vivan en él desaparecerían, y la sincronización `BOOKINGS` las reportaría como faltantes en el proveedor.
- Verificación de la base: `psql "$DATABASE_URL" -f database/verify/01_constraints.sql` y `bash database/verify/02_concurrency.sh`.

## Modelo de datos
`backend/prisma/schema.prisma` y las migraciones se **generan** desde `database/tools/spec.py` con `py database/tools/gen_db.py .` (Linux/macOS: `python3`). No se editan a mano.
- Lo agregado después de la base se marca `since='<etapa>'` en el spec y se declara en `MIGRATIONS`. El generador reproduce byte a byte las migraciones ya aplicadas y escribe una migración nueva por etapa.
- Comprobación: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <base-descartable> --script` debe salir vacío.

| Migración | Contenido |
|---|---|
| `20261111150000_init` | 40 tablas |
| `20261111150100_constraints_and_triggers` | CHECK, auditoría de solo inserción, guarda de confirmación |
| `20261112100000_stage3_booking_holds_catalog_sync` | `sync_kind` += CATALOG; `booking_items.provider_hold_ref`, `hold_expires_at` |
| `20261112110000_stage3b_item_source_price` | precio de origen (`source_currency`, `source_amount`) en items de cotización y de reserva |

## Seguridad
- Sin secretos en el código: todo viene de `.env` (no versionado). `.env.example` solo trae marcadores.
- Contraseñas con argon2id; JWT de acceso corto + refresh token rotativo con detección de reutilización.
- Credenciales de proveedores cifradas con AES-256-GCM (clave `CREDENTIALS_ENCRYPTION_KEY`, **respáldela**). Son de solo escritura: la API nunca las devuelve.
- Validación estricta de entrada, límite de peticiones, `helmet`, anti-SSRF en las URL de proveedores y logs con campos sensibles redactados. El número de documento de los viajeros se muestra enmascarado.
- `Idempotency-Key` obligatoria en las operaciones de reserva y opcional en las altas.

## Alcance actual
| Módulo | Estado |
|---|---|
| Base de datos (40 tablas, restricciones, triggers, auditoría append-only) | Hecho y verificado en PostgreSQL 16 |
| Auth, usuarios, roles, proveedores, integraciones, auditoría | Hecho (Etapa 2) |
| Adaptadores SIMULATED y HTTP, motor de integración con resiliencia, simulador de proveedores | Hecho y probado con fallas inyectadas |
| Adaptador BOOMI | **Preparado, sin conexión real** (requiere credenciales, licencia y documentación oficial) |
| Catálogo normalizado, inventario/allotments, tarifas, búsqueda, cotizaciones, reservas con compensación y conciliación | Hecho |
| Sincronización, inconsistencias, excepciones, alertas, monitoreo, planificador | Hecho |
| Dashboard web (núcleo: panel, búsqueda y reserva, reservas, excepciones y alertas) | Hecho (Etapa 4) |

Limitaciones conocidas:
- **Adaptador SIMULATED:** pierde su estado al reiniciar el proceso; es para desarrollo y pruebas.
- **OAuth2 `client_credentials`:** probado solo con pruebas unitarias; no hay un servidor de tokens real.
- **Varias réplicas:** el circuit breaker y los leases de sincronización están diseñados para varias réplicas, pero solo se probaron con un proceso.
- **Tipos de cambio:** los del seed son ficticios.
