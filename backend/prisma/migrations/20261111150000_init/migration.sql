-- GENERADO desde database/tools/spec.py (mismas convenciones de nombres que Prisma).
-- Restricciones CHECK y triggers: ver la migracion siguiente.

-- CreateEnum
CREATE TYPE "provider_type" AS ENUM ('GDS', 'AIRLINE', 'CONSOLIDATOR', 'HOTEL', 'BEDBANK', 'TRAVEL_ASSISTANCE');

-- CreateEnum
CREATE TYPE "adapter_kind" AS ENUM ('SIMULATED', 'HTTP', 'BOOMI');

-- CreateEnum
CREATE TYPE "auth_type" AS ENUM ('NONE', 'API_KEY', 'BEARER', 'BASIC', 'OAUTH2_CLIENT');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "circuit_state" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- CreateEnum
CREATE TYPE "product_type" AS ENUM ('FLIGHT', 'ROOM', 'ASSISTANCE_PLAN');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "hold_status" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "movement_kind" AS ENUM ('LOAD', 'HOLD', 'RELEASE', 'CONFIRM', 'CANCEL', 'ADJUST', 'EXPIRE');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('OPEN', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('DRAFT', 'QUOTED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REQUIRES_REVIEW', 'COMPENSATING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "booking_item_status" AS ENUM ('PENDING', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "integration_operation" AS ENUM ('HEALTH_CHECK', 'SEARCH', 'GET_RATES', 'HOLD', 'CONFIRM', 'CANCEL', 'QUERY_BOOKING', 'SYNC');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'REJECTED', 'SHORT_CIRCUITED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "log_level" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "exception_type" AS ENUM ('PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'NO_AVAILABILITY', 'PRICE_CHANGED', 'PARTIAL_CONFIRMATION', 'CANCELLATION_FAILED', 'RECONCILIATION_MISMATCH', 'MANUAL_PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "exception_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('PROVIDER_DOWN', 'CIRCUIT_OPEN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY', 'SYNC_FAILED', 'INCONSISTENCY', 'EXCEPTION_OPENED');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "sync_kind" AS ENUM ('AVAILABILITY', 'RATES', 'BOOKINGS');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "inconsistency_kind" AS ENUM ('AVAILABILITY_MISMATCH', 'RATE_MISMATCH', 'BOOKING_STATUS_MISMATCH', 'MISSING_AT_PROVIDER', 'MISSING_LOCAL');

-- CreateEnum
CREATE TYPE "inconsistency_status" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "provider_type" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "base_url" TEXT NOT NULL,
    "auth_type" "auth_type" NOT NULL DEFAULT 'NONE',
    "auth_header_name" TEXT,
    "credentials_enc" TEXT,
    "timeout_ms" INTEGER NOT NULL DEFAULT 8000,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "retry_base_ms" INTEGER NOT NULL DEFAULT 200,
    "retry_max_ms" INTEGER NOT NULL DEFAULT 5000,
    "cb_failure_threshold" INTEGER NOT NULL DEFAULT 5,
    "cb_reset_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "cb_half_open_max_calls" INTEGER NOT NULL DEFAULT 1,
    "supports_idempotency" BOOLEAN NOT NULL DEFAULT false,
    "params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "service_type" "product_type" NOT NULL,
    "can_search" BOOLEAN NOT NULL DEFAULT true,
    "can_hold" BOOLEAN NOT NULL DEFAULT false,
    "can_confirm" BOOLEAN NOT NULL DEFAULT true,
    "can_cancel" BOOLEAN NOT NULL DEFAULT true,
    "can_query_status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "adapter_kind" "adapter_kind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "integration_status" NOT NULL DEFAULT 'UNKNOWN',
    "last_health_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_health_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_id" UUID NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latency_ms" INTEGER,
    "status_code" INTEGER,
    "message" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_by_id" UUID,
    CONSTRAINT "integration_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_breaker_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_id" UUID NOT NULL,
    "state" "circuit_state" NOT NULL DEFAULT 'CLOSED',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "circuit_breaker_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "type" "product_type" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "product_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "stars" SMALLINT,
    "all_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_flight" (
    "product_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "origin" CHAR(3) NOT NULL,
    "destination" CHAR(3) NOT NULL,
    "departure_at" TIMESTAMPTZ(6) NOT NULL,
    "arrival_at" TIMESTAMPTZ(6) NOT NULL,
    "cabin" TEXT NOT NULL DEFAULT 'ECONOMY',
    CONSTRAINT "product_flight_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "product_room" (
    "product_id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "room_type" TEXT NOT NULL,
    "board_basis" TEXT NOT NULL DEFAULT 'ALL_INCLUSIVE',
    "max_occupancy" INTEGER NOT NULL,
    CONSTRAINT "product_room_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "product_assistance" (
    "product_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "coverage_summary" TEXT,
    "max_days" INTEGER,
    "medical_coverage_usd" DECIMAL(12,2),
    CONSTRAINT "product_assistance_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "external_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw_hash" TEXT,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" SMALLINT NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "source" TEXT NOT NULL,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "available_quantity" INTEGER NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_hash" TEXT,
    CONSTRAINT "availability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allotments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "release_days" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "allotments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "held_quantity" INTEGER NOT NULL DEFAULT 0,
    "sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "level_id" UUID NOT NULL,
    "booking_item_id" UUID,
    "quantity" INTEGER NOT NULL,
    "status" "hold_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    CONSTRAINT "inventory_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "level_id" UUID NOT NULL,
    "kind" "movement_kind" NOT NULL,
    "delta_total" INTEGER NOT NULL DEFAULT 0,
    "delta_held" INTEGER NOT NULL DEFAULT 0,
    "delta_sold" INTEGER NOT NULL DEFAULT 0,
    "reference_type" TEXT,
    "reference_id" UUID,
    "user_id" UUID,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "rate_code" TEXT NOT NULL DEFAULT 'BAR',
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxes_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "provider_rate_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rate_id" UUID NOT NULL,
    "old_amount" DECIMAL(14,2),
    "new_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" UUID,
    CONSTRAINT "rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "rate_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_amount" DECIMAL(14,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "provider_quote_ref" TEXT,
    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "quote_id" UUID,
    "status" "booking_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "holder_name" TEXT NOT NULL,
    "holder_email" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "status" "booking_item_status" NOT NULL DEFAULT 'PENDING',
    "quantity" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "unit_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "external_locator" TEXT,
    "provider_booking_ref" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travelers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "document_type" TEXT,
    "document_number" TEXT,
    "birth_date" DATE,
    "email" TEXT,
    "is_holder" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "from_status" "booking_status",
    "to_status" "booking_status" NOT NULL,
    "reason" TEXT,
    "user_id" UUID,
    "correlation_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correlation_id" TEXT NOT NULL,
    "integration_id" UUID,
    "provider_id" UUID,
    "operation" "integration_operation" NOT NULL,
    "operation_key" TEXT,
    "idempotency_key" TEXT,
    "status" "transaction_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "http_status" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "booking_item_id" UUID,
    "user_id" UUID,
    CONSTRAINT "integration_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "status" "transaction_status" NOT NULL,
    "backoff_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    CONSTRAINT "transaction_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idem_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "level" "log_level" NOT NULL,
    "context" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "correlation_id" TEXT,
    "meta" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "correlation_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "exception_type" NOT NULL,
    "severity" "severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "exception_status" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "booking_id" UUID,
    "transaction_id" UUID,
    "provider_id" UUID,
    "assigned_to_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "exception_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exception_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exception_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "alert_kind" NOT NULL,
    "severity" "severity" NOT NULL DEFAULT 'HIGH',
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "integration_id" UUID,
    "provider_id" UUID,
    "message" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "sync_kind" NOT NULL,
    "provider_id" UUID,
    "integration_id" UUID,
    "status" "sync_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_changed" INTEGER NOT NULL DEFAULT 0,
    "inconsistencies_found" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "triggered_by_id" UUID,
    "correlation_id" TEXT,
    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inconsistencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "inconsistency_kind" NOT NULL,
    "status" "inconsistency_status" NOT NULL DEFAULT 'OPEN',
    "provider_id" UUID NOT NULL,
    "product_id" UUID,
    "booking_item_id" UUID,
    "sync_run_id" UUID,
    "expected" JSONB,
    "actual" JSONB,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "notes" TEXT,
    CONSTRAINT "inconsistencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE INDEX "users_role_id_idx" ON "users"("role_id");

CREATE INDEX "users_active_idx" ON "users"("active");

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

CREATE UNIQUE INDEX "providers_code_key" ON "providers"("code");

CREATE INDEX "providers_type_idx" ON "providers"("type");

CREATE INDEX "providers_active_idx" ON "providers"("active");

CREATE UNIQUE INDEX "provider_configs_provider_id_key" ON "provider_configs"("provider_id");

CREATE UNIQUE INDEX "provider_services_provider_id_service_type_key" ON "provider_services"("provider_id", "service_type");

CREATE UNIQUE INDEX "integrations_provider_id_name_key" ON "integrations"("provider_id", "name");

CREATE INDEX "integrations_enabled_idx" ON "integrations"("enabled");

CREATE INDEX "integrations_status_idx" ON "integrations"("status");

CREATE INDEX "integration_health_checks_integration_id_checked_at_idx" ON "integration_health_checks"("integration_id", "checked_at");

CREATE UNIQUE INDEX "circuit_breaker_states_integration_id_key" ON "circuit_breaker_states"("integration_id");

CREATE UNIQUE INDEX "products_provider_id_code_key" ON "products"("provider_id", "code");

CREATE INDEX "products_type_status_idx" ON "products"("type", "status");

CREATE INDEX "hotels_city_idx" ON "hotels"("city");

CREATE INDEX "product_flight_origin_destination_departure_at_idx" ON "product_flight"("origin", "destination", "departure_at");

CREATE INDEX "product_room_hotel_id_idx" ON "product_room"("hotel_id");

CREATE UNIQUE INDEX "external_references_provider_id_entity_type_external_id_key" ON "external_references"("provider_id", "entity_type", "external_id");

CREATE INDEX "external_references_entity_type_entity_id_idx" ON "external_references"("entity_type", "entity_id");

CREATE UNIQUE INDEX "exchange_rates_base_currency_quote_currency_as_of_key" ON "exchange_rates"("base_currency", "quote_currency", "as_of");

CREATE UNIQUE INDEX "availability_snapshots_product_id_stay_date_key" ON "availability_snapshots"("product_id", "stay_date");

CREATE INDEX "availability_snapshots_provider_id_synced_at_idx" ON "availability_snapshots"("provider_id", "synced_at");

CREATE INDEX "allotments_product_id_valid_from_valid_to_idx" ON "allotments"("product_id", "valid_from", "valid_to");

CREATE UNIQUE INDEX "inventory_levels_product_id_stay_date_key" ON "inventory_levels"("product_id", "stay_date");

CREATE INDEX "inventory_levels_stay_date_idx" ON "inventory_levels"("stay_date");

CREATE INDEX "inventory_holds_status_expires_at_idx" ON "inventory_holds"("status", "expires_at");

CREATE INDEX "inventory_holds_booking_item_id_idx" ON "inventory_holds"("booking_item_id");

CREATE INDEX "inventory_holds_level_id_idx" ON "inventory_holds"("level_id");

CREATE INDEX "inventory_movements_level_id_at_idx" ON "inventory_movements"("level_id", "at");

CREATE INDEX "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");

CREATE INDEX "rates_product_id_valid_from_valid_to_idx" ON "rates"("product_id", "valid_from", "valid_to");

CREATE INDEX "rate_history_rate_id_changed_at_idx" ON "rate_history"("rate_id", "changed_at");

CREATE UNIQUE INDEX "quotes_reference_key" ON "quotes"("reference");

CREATE INDEX "quotes_status_expires_at_idx" ON "quotes"("status", "expires_at");

CREATE INDEX "quote_items_quote_id_idx" ON "quote_items"("quote_id");

CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

CREATE UNIQUE INDEX "bookings_quote_id_key" ON "bookings"("quote_id");

CREATE INDEX "bookings_status_requested_at_idx" ON "bookings"("status", "requested_at");

CREATE INDEX "booking_items_booking_id_idx" ON "booking_items"("booking_id");

CREATE INDEX "booking_items_status_idx" ON "booking_items"("status");

CREATE INDEX "booking_items_product_id_idx" ON "booking_items"("product_id");

CREATE INDEX "travelers_booking_id_idx" ON "travelers"("booking_id");

CREATE INDEX "booking_status_history_booking_id_at_idx" ON "booking_status_history"("booking_id", "at");

CREATE UNIQUE INDEX "integration_transactions_operation_key_key" ON "integration_transactions"("operation_key");

CREATE INDEX "integration_transactions_correlation_id_idx" ON "integration_transactions"("correlation_id");

CREATE INDEX "integration_transactions_integration_id_started_at_idx" ON "integration_transactions"("integration_id", "started_at");

CREATE INDEX "integration_transactions_provider_id_started_at_idx" ON "integration_transactions"("provider_id", "started_at");

CREATE INDEX "integration_transactions_status_started_at_idx" ON "integration_transactions"("status", "started_at");

CREATE INDEX "integration_transactions_operation_started_at_idx" ON "integration_transactions"("operation", "started_at");

CREATE INDEX "integration_transactions_booking_item_id_idx" ON "integration_transactions"("booking_item_id");

CREATE UNIQUE INDEX "transaction_attempts_transaction_id_attempt_number_key" ON "transaction_attempts"("transaction_id", "attempt_number");

CREATE UNIQUE INDEX "idempotency_keys_idem_key_scope_key" ON "idempotency_keys"("idem_key", "scope");

CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

CREATE INDEX "system_logs_level_at_idx" ON "system_logs"("level", "at");

CREATE INDEX "system_logs_correlation_id_idx" ON "system_logs"("correlation_id");

CREATE INDEX "system_logs_context_at_idx" ON "system_logs"("context", "at");

CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

CREATE INDEX "audit_logs_user_id_at_idx" ON "audit_logs"("user_id", "at");

CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

CREATE INDEX "exception_cases_status_severity_idx" ON "exception_cases"("status", "severity");

CREATE INDEX "exception_cases_booking_id_idx" ON "exception_cases"("booking_id");

CREATE INDEX "exception_cases_provider_id_idx" ON "exception_cases"("provider_id");

CREATE INDEX "exception_cases_assigned_to_id_idx" ON "exception_cases"("assigned_to_id");

CREATE INDEX "exception_events_exception_id_at_idx" ON "exception_events"("exception_id", "at");

CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

CREATE INDEX "alerts_dedupe_key_idx" ON "alerts"("dedupe_key");

CREATE INDEX "alerts_integration_id_created_at_idx" ON "alerts"("integration_id", "created_at");

CREATE INDEX "sync_runs_kind_started_at_idx" ON "sync_runs"("kind", "started_at");

CREATE INDEX "sync_runs_provider_id_started_at_idx" ON "sync_runs"("provider_id", "started_at");

CREATE INDEX "inconsistencies_status_detected_at_idx" ON "inconsistencies"("status", "detected_at");

CREATE INDEX "inconsistencies_provider_id_idx" ON "inconsistencies"("provider_id");

CREATE INDEX "inconsistencies_product_id_idx" ON "inconsistencies"("product_id");

ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_health_checks" ADD CONSTRAINT "integration_health_checks_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_health_checks" ADD CONSTRAINT "integration_health_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "circuit_breaker_states" ADD CONSTRAINT "circuit_breaker_states_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_flight" ADD CONSTRAINT "product_flight_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_room" ADD CONSTRAINT "product_room_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_room" ADD CONSTRAINT "product_room_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_assistance" ADD CONSTRAINT "product_assistance_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_references" ADD CONSTRAINT "external_references_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_fkey" FOREIGN KEY ("base_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_fkey" FOREIGN KEY ("quote_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allotments" ADD CONSTRAINT "allotments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allotments" ADD CONSTRAINT "allotments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "inventory_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "inventory_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rates" ADD CONSTRAINT "rates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rates" ADD CONSTRAINT "rates_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "travelers" ADD CONSTRAINT "travelers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_transactions" ADD CONSTRAINT "integration_transactions_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_transactions" ADD CONSTRAINT "integration_transactions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_transactions" ADD CONSTRAINT "integration_transactions_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_transactions" ADD CONSTRAINT "integration_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transaction_attempts" ADD CONSTRAINT "transaction_attempts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "integration_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "integration_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "exception_events" ADD CONSTRAINT "exception_events_exception_id_fkey" FOREIGN KEY ("exception_id") REFERENCES "exception_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exception_events" ADD CONSTRAINT "exception_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inconsistencies" ADD CONSTRAINT "inconsistencies_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inconsistencies" ADD CONSTRAINT "inconsistencies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inconsistencies" ADD CONSTRAINT "inconsistencies_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inconsistencies" ADD CONSTRAINT "inconsistencies_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inconsistencies" ADD CONSTRAINT "inconsistencies_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
