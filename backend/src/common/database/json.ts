import { Prisma } from '@prisma/client';

/** Valor para una columna JSON anulable: null/undefined se guardan como NULL de SQL. */
export function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}
