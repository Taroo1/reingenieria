-- GENERADO desde database/tools/spec.py: cambios marcados since="stage3".
-- Etapa 3: referencia y vencimiento del bloqueo del proveedor por item; sincronizacion de catalogo.

-- AlterEnum
ALTER TYPE "sync_kind" ADD VALUE 'CATALOG';

-- AlterTable
ALTER TABLE "booking_items" ADD COLUMN "provider_hold_ref" TEXT,
ADD COLUMN "hold_expires_at" TIMESTAMPTZ(6);

CREATE INDEX "booking_items_status_hold_expires_at_idx" ON "booking_items"("status", "hold_expires_at");

