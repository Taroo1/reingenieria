/** Roles del sistema. Coinciden con las filas de la tabla `roles`. */
export enum RoleName {
  /** Control total: usuarios, credenciales, auditoria. */
  ADMIN = 'ADMIN',
  /** Gestion de Proveedores y Producto: opera proveedores, integraciones, inventario, reservas y excepciones. */
  OPERADOR = 'OPERADOR',
  /** Solo lectura. */
  CONSULTA = 'CONSULTA',
}

export const ALL_ROLES: string[] = Object.values(RoleName);
