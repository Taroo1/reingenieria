"""
Genera backend/prisma/schema.prisma y las migraciones SQL desde database/tools/spec.py.
Uso: py database/tools/gen_db.py <raiz-del-proyecto>

- schema.prisma refleja el modelo COMPLETO (todas las etapas).
- Las migraciones base (init + constraints_and_triggers) solo contienen lo que no tiene marca `since`:
  salen byte-identicas a las ya aplicadas y Prisma no detecta cambios de checksum.
- Cada etapa declarada en spec.MIGRATIONS genera su migracion incremental con lo marcado `since=<etapa>`.
- Los archivos se escriben siempre con LF y UTF-8 (en Windows, open(..., 'w') usaria CRLF y cambiaria el checksum).
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from spec import T, ENUMS, D, APPEND_ONLY, MIGRATIONS

OUT = sys.argv[1]  # project root
TABLES = {t['name']: t for t in T}
STAGES = [m[0] for m in MIGRATIONS]

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)

def camel(s):
    p = s.split('_'); return p[0] + ''.join(x.capitalize() for x in p[1:])
def pascal(s): return ''.join(x.capitalize() for x in s.split('_'))

def enum_values(name):
    """Valores del enum como lista de (valor, since)."""
    return [(v, None) if isinstance(v, str) else (v[0], v[1]) for v in ENUMS[name][1]]

def prisma_type(col):
    t = col['typ']
    if isinstance(t, tuple):
        if t[0] == 'enum': return t[1], ''
        if t[0] == 'dec': return 'Decimal', f'@db.Decimal({t[1]}, {t[2]})'
    return {'uuid': ('String', '@db.Uuid'), 'text': ('String', ''), 'int': ('Int', ''), 'smallint': ('Int', '@db.SmallInt'),
            'bool': ('Boolean', ''), 'ts': ('DateTime', '@db.Timestamptz(6)'), 'date': ('DateTime', '@db.Date'),
            'json': ('Json', ''), 'char3': ('String', '@db.Char(3)')}[t]

def sql_type(col):
    t = col['typ']
    if isinstance(t, tuple):
        if t[0] == 'enum': return f'"{ENUMS[t[1]][0]}"'
        if t[0] == 'dec': return f'DECIMAL({t[1]},{t[2]})'
    return {'uuid': 'UUID', 'text': 'TEXT', 'int': 'INTEGER', 'smallint': 'SMALLINT', 'bool': 'BOOLEAN',
            'ts': 'TIMESTAMPTZ(6)', 'date': 'DATE', 'json': 'JSONB', 'char3': 'CHAR(3)'}[t]

def prisma_default(col):
    d = col['default']
    if d is None: return ''
    if d.kind == 'now': return '@default(now())'
    if d.kind == 'uuid': return '@default(dbgenerated("gen_random_uuid()"))'
    if d.kind == 'enum': return f'@default({d.val})'
    if d.kind == 'json': return f'@default("{d.val}")'
    v = d.val
    if isinstance(v, bool): return f'@default({"true" if v else "false"})'
    if isinstance(v, int): return f'@default({v})'
    return f'@default("{v}")'

def sql_default(col):
    d = col['default']
    if d is None: return ''
    if d.kind == 'now': return ' DEFAULT CURRENT_TIMESTAMP'
    if d.kind == 'uuid': return ' DEFAULT gen_random_uuid()'
    if d.kind in ('enum', 'json'): return f" DEFAULT '{d.val}'"
    v = d.val
    if isinstance(v, bool): return f' DEFAULT {"true" if v else "false"}'
    if isinstance(v, int): return f' DEFAULT {v}'
    return f" DEFAULT '{v}'"

def name63(n):
    assert len(n) <= 63, f'identifier too long: {n} ({len(n)})'
    return n

def col_of(t, name): return next(c for c in t['cols'] if c['name'] == name)

def stage_of_col(t, col):
    """Etapa en la que aparece una columna: la suya o la de su tabla."""
    return col['since'] or t['since']

def stage_of_fk(t, f):
    return f.get('since') or stage_of_col(t, col_of(t, f['col']))

def stage_of_group(t, g):
    """Indice/unico: su propia etapa, o la mas nueva entre su tabla y sus columnas."""
    if g['since']: return g['since']
    stages = [s for s in [t['since']] + [stage_of_col(t, col_of(t, c)) for c in g['cols']] if s]
    return max(stages, key=STAGES.index) if stages else None

# ---- validaciones del spec
for t in T:
    for s in [t['since']] + [c['since'] for c in t['cols']] + [g['since'] for g in t['uniques'] + t['indexes']] + [ch[2] for ch in t['checks']]:
        assert s is None or s in STAGES, f'{t["name"]}: etapa desconocida {s}'
    for c in t['cols']:
        if stage_of_col(t, c) and not t['since']:
            assert c['null'] or c['default'] is not None, f'{t["name"]}.{c["name"]}: una columna nueva en una tabla existente debe ser NULL o tener DEFAULT'
for en in ENUMS:
    for _, s in enum_values(en):
        assert s is None or s in STAGES, f'{en}: etapa desconocida {s}'

# ---- relation bookkeeping
def fwd_field(fkd):
    col = fkd['col']
    return camel(col[:-3]) if col.endswith('_id') else camel(col) + 'Ref'
def rel_name(t, fkd): return f"{t['name']}_{fkd['col']}"
def is_unique_fk(t, fkd):
    col = col_of(t, fkd['col'])
    return col['unique'] or col['pk'] and (t['pk'] == [fkd['col']])
back = {}
for t in T:
    for f in t['fks']:
        back.setdefault(f['ref'], []).append((t, f))

# ================= schema.prisma (modelo completo) =================
L = []
L.append('// GENERADO desde database/tools/spec.py. No editar a mano: cambie la especificacion y regenere.')
L.append('generator client {\n  provider = "prisma-client-js"\n}\n')
L.append('datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n')
for en, (dbn, _) in ENUMS.items():
    L.append(f'enum {en} {{\n' + ''.join(f'  {v}\n' for v, _ in enum_values(en)) + f'  @@map("{dbn}")\n}}\n')
for t in T:
    out = [f'model {t["model"]} {{']
    for col in t['cols']:
        pt, db = prisma_type(col)
        opt = '?' if col['null'] else ''
        parts = [f'  {camel(col["name"])}', f'{pt}{opt}']
        attrs = []
        if col['name'] in (t['pk'] or ['id']) and len(t['pk'] or ['id']) == 1: attrs.append('@id')
        if col['unique']: attrs.append('@unique')
        pd = prisma_default(col)
        if pd: attrs.append(pd)
        if col['updated']: attrs.append('@updatedAt')
        if db: attrs.append(db)
        if camel(col['name']) != col['name']: attrs.append(f'@map("{col["name"]}")')
        out.append(' '.join(parts + attrs))
    for f in t['fks']:
        tgt = TABLES[f['ref']]
        col = col_of(t, f['col'])
        opt = '?' if col['null'] else ''
        od = {'RESTRICT': 'Restrict', 'CASCADE': 'Cascade', 'SET NULL': 'SetNull'}[f['on_delete']]
        out.append(f'  {fwd_field(f)} {tgt["model"]}{opt} @relation("{rel_name(t, f)}", fields: [{camel(f["col"])}], references: [{camel(f["ref_col"])}], onDelete: {od})')
    for (st, f) in back.get(t['name'], []):
        nm = camel(st['name']) + 'By' + pascal(f['col'])
        if is_unique_fk(st, f):
            out.append(f'  {camel(st["model"])}By{pascal(f["col"])} {st["model"]}? @relation("{rel_name(st, f)}")')
        else:
            out.append(f'  {nm} {st["model"]}[] @relation("{rel_name(st, f)}")')
    for u in t['uniques']:
        out.append('  @@unique([' + ', '.join(camel(x) for x in u['cols']) + '])')
    for i in t['indexes']:
        out.append('  @@index([' + ', '.join(camel(x) for x in i['cols']) + '])')
    out.append(f'  @@map("{t["name"]}")')
    out.append('}\n')
    L.append('\n'.join(out))
write(f'{OUT}/backend/prisma/schema.prisma', '\n'.join(L))

# ================= piezas SQL reutilizables =================
def column_sql(col):
    return f'"{col["name"]}" {sql_type(col)}{"" if col["null"] else " NOT NULL"}{sql_default(col)}'

def create_table_sql(t, cols):
    lines = [f'    {column_sql(c)}' for c in cols]
    pkcols = t['pk'] or ['id']
    lines.append(f'    CONSTRAINT "{name63(t["name"] + "_pkey")}" PRIMARY KEY (' + ', '.join(f'"{x}"' for x in pkcols) + ')')
    return f'-- CreateTable\nCREATE TABLE "{t["name"]}" (\n' + ',\n'.join(lines) + '\n);\n'

def unique_col_sql(t, col):
    return f'CREATE UNIQUE INDEX "{name63(t["name"] + "_" + col["name"] + "_key")}" ON "{t["name"]}"("{col["name"]}");\n'

def unique_sql(t, u):
    return f'CREATE UNIQUE INDEX "{name63(t["name"] + "_" + "_".join(u) + "_key")}" ON "{t["name"]}"(' + ', '.join(f'"{x}"' for x in u) + ');\n'

def index_sql(t, i):
    return f'CREATE INDEX "{name63(t["name"] + "_" + "_".join(i) + "_idx")}" ON "{t["name"]}"(' + ', '.join(f'"{x}"' for x in i) + ');\n'

def fk_sql(t, f):
    return (f'ALTER TABLE "{t["name"]}" ADD CONSTRAINT "{name63(t["name"] + "_" + f["col"] + "_fkey")}" FOREIGN KEY ("{f["col"]}") '
            f'REFERENCES "{f["ref"]}"("{f["ref_col"]}") ON DELETE {f["on_delete"]} ON UPDATE CASCADE;\n')

def check_sql(t, n, expr):
    return f'ALTER TABLE "{t["name"]}" ADD CONSTRAINT "{name63("chk_" + t["name"] + "_" + n)}" CHECK ({expr});'

# ================= init migration SQL (solo la base) =================
BASE = [t for t in T if not t['since']]
S = ['-- GENERADO desde database/tools/spec.py (mismas convenciones de nombres que Prisma).', '-- Restricciones CHECK y triggers: ver la migracion siguiente.\n']
for en, (dbn, _) in ENUMS.items():
    vals = [v for v, s in enum_values(en) if s is None]
    S.append(f'-- CreateEnum\nCREATE TYPE "{dbn}" AS ENUM (' + ', '.join(f"'{v}'" for v in vals) + ');\n')
for t in BASE:
    S.append(create_table_sql(t, [c for c in t['cols'] if not c['since']]))
for t in BASE:
    for col in t['cols']:
        if col['unique'] and not col['since']: S.append(unique_col_sql(t, col))
    for u in t['uniques']:
        if stage_of_group(t, u) is None: S.append(unique_sql(t, u['cols']))
    for i in t['indexes']:
        if stage_of_group(t, i) is None: S.append(index_sql(t, i['cols']))
for t in BASE:
    for f in t['fks']:
        if stage_of_fk(t, f) is None: S.append(fk_sql(t, f))
write(f'{OUT}/backend/prisma/migrations/20261111150000_init/migration.sql', '\n'.join(S))
write(f'{OUT}/backend/prisma/migrations/migration_lock.toml', '# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n')

# ================= constraints + triggers migration (solo la base) =================
C = ['-- Reglas que Prisma no modela: CHECK, triggers de solo-insercion y guarda de confirmacion de reservas.', '-- Prisma las ignora al comparar el esquema; no las elimina.\n']
for t in BASE:
    for (n, expr, since) in t['checks']:
        if since is None: C.append(check_sql(t, n, expr))
C.append('''
ALTER TABLE "bookings" ADD CONSTRAINT "chk_bookings_confirmed_has_timestamp" CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL);

-- Tablas de solo insercion: auditoria y libro de movimientos de inventario.
CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es de solo insercion: % no permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
''')
for tn in APPEND_ONLY:
    C.append(f'CREATE TRIGGER "{tn}_append_only" BEFORE UPDATE OR DELETE ON "{tn}" FOR EACH ROW EXECUTE FUNCTION forbid_modification();')
C.append('''
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
''')
# Un unico salto de linea final: asi quedo la migracion aplicada (su checksum no debe cambiar).
write(f'{OUT}/backend/prisma/migrations/20261111150100_constraints_and_triggers/migration.sql', '\n'.join(C).rstrip('\n') + '\n')

# ================= migraciones incrementales por etapa =================
for stage, folder, description in MIGRATIONS:
    M = [f'-- GENERADO desde database/tools/spec.py: cambios marcados since="{stage}".', f'-- {description}\n']
    for en, (dbn, _) in ENUMS.items():
        for v, s in enum_values(en):
            if s == stage: M.append(f'-- AlterEnum\nALTER TYPE "{dbn}" ADD VALUE \'{v}\';\n')
    new_tables = [t for t in T if t['since'] == stage]
    for t in new_tables:
        M.append(create_table_sql(t, t['cols']))
    for t in T:
        if t['since']: continue
        added = [c for c in t['cols'] if c['since'] == stage]
        if added:
            M.append(f'-- AlterTable\nALTER TABLE "{t["name"]}" ' + ',\n'.join(f'ADD COLUMN {column_sql(c)}' for c in added) + ';\n')
    for t in T:
        for col in t['cols']:
            if col['unique'] and stage_of_col(t, col) == stage: M.append(unique_col_sql(t, col))
        for u in t['uniques']:
            if stage_of_group(t, u) == stage: M.append(unique_sql(t, u['cols']))
        for i in t['indexes']:
            if stage_of_group(t, i) == stage: M.append(index_sql(t, i['cols']))
    for t in T:
        for f in t['fks']:
            if stage_of_fk(t, f) == stage: M.append(fk_sql(t, f))
    checks = [check_sql(t, n, expr) for t in T for (n, expr, s) in t['checks'] if (s or t['since']) == stage]
    if checks:
        M.append('-- Restricciones CHECK de esta etapa')
        M.extend(checks)
    write(f'{OUT}/backend/prisma/migrations/{folder}/migration.sql', '\n'.join(M) + '\n')

print('ok', len(T), 'tables', '|', 'etapas:', ', '.join(STAGES) or '-')
