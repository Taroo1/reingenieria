-- Reglas que Prisma no modela: CHECK, triggers de solo-insercion y guarda de confirmacion de reservas.
-- Prisma las ignora al comparar el esquema; no las elimina.

ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_timeout_ms_pos" CHECK (timeout_ms > 0);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_max_retries_nonneg" CHECK (max_retries >= 0 AND max_retries <= 10);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_retry_base_pos" CHECK (retry_base_ms > 0);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_retry_max_ge_base" CHECK (retry_max_ms >= retry_base_ms);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_cb_threshold_pos" CHECK (cb_failure_threshold > 0);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_cb_reset_pos" CHECK (cb_reset_timeout_ms > 0);
ALTER TABLE "provider_configs" ADD CONSTRAINT "chk_provider_configs_cb_half_open_pos" CHECK (cb_half_open_max_calls > 0);
ALTER TABLE "circuit_breaker_states" ADD CONSTRAINT "chk_circuit_breaker_states_counts_nonneg" CHECK (failure_count >= 0 AND success_count >= 0);
ALTER TABLE "hotels" ADD CONSTRAINT "chk_hotels_stars_range" CHECK (stars IS NULL OR (stars BETWEEN 1 AND 5));
ALTER TABLE "product_flight" ADD CONSTRAINT "chk_product_flight_arrival_after_departure" CHECK (arrival_at > departure_at);
ALTER TABLE "product_room" ADD CONSTRAINT "chk_product_room_occupancy_pos" CHECK (max_occupancy > 0);
ALTER TABLE "currencies" ADD CONSTRAINT "chk_currencies_decimals_range" CHECK (decimals BETWEEN 0 AND 4);
ALTER TABLE "exchange_rates" ADD CONSTRAINT "chk_exchange_rates_rate_pos" CHECK (rate > 0);
ALTER TABLE "exchange_rates" ADD CONSTRAINT "chk_exchange_rates_distinct_currencies" CHECK (base_currency <> quote_currency);
ALTER TABLE "availability_snapshots" ADD CONSTRAINT "chk_availability_snapshots_available_nonneg" CHECK (available_quantity >= 0);
ALTER TABLE "allotments" ADD CONSTRAINT "chk_allotments_period_valid" CHECK (valid_to >= valid_from);
ALTER TABLE "allotments" ADD CONSTRAINT "chk_allotments_quantity_nonneg" CHECK (quantity >= 0);
ALTER TABLE "allotments" ADD CONSTRAINT "chk_allotments_release_nonneg" CHECK (release_days >= 0);
ALTER TABLE "inventory_levels" ADD CONSTRAINT "chk_inventory_levels_non_negative" CHECK (total_quantity >= 0 AND held_quantity >= 0 AND sold_quantity >= 0);
ALTER TABLE "inventory_levels" ADD CONSTRAINT "chk_inventory_levels_no_oversell" CHECK (held_quantity + sold_quantity <= total_quantity);
ALTER TABLE "inventory_holds" ADD CONSTRAINT "chk_inventory_holds_quantity_pos" CHECK (quantity > 0);
ALTER TABLE "rates" ADD CONSTRAINT "chk_rates_amount_nonneg" CHECK (amount >= 0 AND taxes_amount >= 0);
ALTER TABLE "rates" ADD CONSTRAINT "chk_rates_period_valid" CHECK (valid_to >= valid_from);
ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_total_nonneg" CHECK (total_amount >= 0);
ALTER TABLE "quote_items" ADD CONSTRAINT "chk_quote_items_quantity_pos" CHECK (quantity > 0);
ALTER TABLE "quote_items" ADD CONSTRAINT "chk_quote_items_amount_nonneg" CHECK (unit_amount >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "chk_bookings_total_nonneg" CHECK (total_amount >= 0);
ALTER TABLE "booking_items" ADD CONSTRAINT "chk_booking_items_quantity_pos" CHECK (quantity > 0);
ALTER TABLE "booking_items" ADD CONSTRAINT "chk_booking_items_amounts_nonneg" CHECK (unit_amount >= 0 AND total_amount >= 0);
ALTER TABLE "booking_items" ADD CONSTRAINT "chk_booking_items_confirmed_needs_locator" CHECK (status <> 'CONFIRMED' OR external_locator IS NOT NULL);
ALTER TABLE "integration_transactions" ADD CONSTRAINT "chk_integration_transactions_attempts_nonneg" CHECK (attempts >= 0);
ALTER TABLE "integration_transactions" ADD CONSTRAINT "chk_integration_transactions_duration_nonneg" CHECK (duration_ms IS NULL OR duration_ms >= 0);
ALTER TABLE "transaction_attempts" ADD CONSTRAINT "chk_transaction_attempts_attempt_pos" CHECK (attempt_number > 0);

ALTER TABLE "bookings" ADD CONSTRAINT "chk_bookings_confirmed_has_timestamp" CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL);

-- Tablas de solo insercion: auditoria y libro de movimientos de inventario.
CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es de solo insercion: % no permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "inventory_movements_append_only" BEFORE UPDATE OR DELETE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Una reserva solo puede quedar CONFIRMED si tiene items y todos estan CONFIRMED (con localizador externo, por el CHECK de booking_items).
CREATE OR REPLACE FUNCTION enforce_booking_confirmation() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM booking_items WHERE booking_id = NEW.id) THEN
    RAISE EXCEPTION 'la reserva % no puede confirmarse sin items', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM booking_items WHERE booking_id = NEW.id AND status <> 'CONFIRMED') THEN
    RAISE EXCEPTION 'la reserva % tiene items sin confirmacion del proveedor', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_confirmation_guard" BEFORE INSERT OR UPDATE OF status ON "bookings"
  FOR EACH ROW WHEN (NEW.status = 'CONFIRMED') EXECUTE FUNCTION enforce_booking_confirmation();
