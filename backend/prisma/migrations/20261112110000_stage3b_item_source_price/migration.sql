-- GENERADO desde database/tools/spec.py: cambios marcados since="stage3b".
-- Etapa 3: precio del item en la moneda del proveedor o de la tarifa (para detectar cambios de precio con conversion de moneda).

-- AlterTable
ALTER TABLE "quote_items" ADD COLUMN "source_currency" CHAR(3),
ADD COLUMN "source_amount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "booking_items" ADD COLUMN "source_currency" CHAR(3),
ADD COLUMN "source_amount" DECIMAL(14,2);

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones CHECK de esta etapa
ALTER TABLE "quote_items" ADD CONSTRAINT "chk_quote_items_source_price_pair" CHECK ((source_currency IS NULL) = (source_amount IS NULL) AND (source_amount IS NULL OR source_amount >= 0));
ALTER TABLE "booking_items" ADD CONSTRAINT "chk_booking_items_source_price_pair" CHECK ((source_currency IS NULL) = (source_amount IS NULL) AND (source_amount IS NULL OR source_amount >= 0));
