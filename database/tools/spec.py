# Single source of truth for the relational model (Prisma schema + SQL migration are generated from it).
class D:  # default markers
    def __init__(self, kind, val=None): self.kind, self.val = kind, val
NOW = D('now'); UUID = D('uuid')
def LIT(v): return D('lit', v)
def ENUMV(v): return D('enum', v)
def JSON_DEFAULT(v): return D('json', v)

# ---- Etapas: lo que se agrega despues de la base se marca since='<etapa>' y va a su propia migracion.
# Las migraciones aplicadas NUNCA se reescriben: el generador las reproduce byte a byte sin lo marcado.
MIGRATIONS = [  # (etapa, carpeta de la migracion, descripcion)
    ('stage3', '20261112100000_stage3_booking_holds_catalog_sync',
     'Etapa 3: referencia y vencimiento del bloqueo del proveedor por item; sincronizacion de catalogo.'),
    ('stage3b', '20261112110000_stage3b_item_source_price',
     'Etapa 3: precio del item en la moneda del proveedor o de la tarifa (para detectar cambios de precio con conversion de moneda).'),
]

def SINCE(value, stage):
    """Valor de enum agregado en una etapa posterior."""
    return (value, stage)

def IX(cols, since=None):
    """Indice o unico compuesto con etapa explicita."""
    return dict(cols=list(cols), since=since)

def c(name, typ, null=False, default=None, unique=False, pk=False, updated=False, since=None):
    return dict(name=name, typ=typ, null=null, default=default, unique=unique, pk=pk, updated=updated, since=since)
def pkid(): return c('id', 'uuid', pk=True, default=UUID)
def created(): return c('created_at', 'ts', default=NOW)
def updated(): return c('updated_at', 'ts', updated=True)
def E(name): return ('enum', name)
def DEC(p, s): return ('dec', p, s)
def fk(col, ref, on_delete='RESTRICT', ref_col='id'): return dict(col=col, ref=ref, on_delete=on_delete, ref_col=ref_col)

ENUMS = {
 'ProviderType': ('provider_type', ['GDS','AIRLINE','CONSOLIDATOR','HOTEL','BEDBANK','TRAVEL_ASSISTANCE']),
 'AdapterKind': ('adapter_kind', ['SIMULATED','HTTP','BOOMI']),
 'AuthType': ('auth_type', ['NONE','API_KEY','BEARER','BASIC','OAUTH2_CLIENT']),
 'IntegrationStatus': ('integration_status', ['UNKNOWN','HEALTHY','DEGRADED','DOWN']),
 'CircuitState': ('circuit_state', ['CLOSED','OPEN','HALF_OPEN']),
 'ProductType': ('product_type', ['FLIGHT','ROOM','ASSISTANCE_PLAN']),
 'ProductStatus': ('product_status', ['ACTIVE','INACTIVE']),
 'HoldStatus': ('hold_status', ['ACTIVE','CONSUMED','RELEASED','EXPIRED']),
 'MovementKind': ('movement_kind', ['LOAD','HOLD','RELEASE','CONFIRM','CANCEL','ADJUST','EXPIRE']),
 'QuoteStatus': ('quote_status', ['OPEN','EXPIRED','CONVERTED']),
 'BookingStatus': ('booking_status', ['DRAFT','QUOTED','HELD','PENDING_CONFIRMATION','CONFIRMED','REQUIRES_REVIEW','COMPENSATING','CANCEL_REQUESTED','CANCELLED','FAILED','EXPIRED']),
 'BookingItemStatus': ('booking_item_status', ['PENDING','HELD','PENDING_CONFIRMATION','CONFIRMED','FAILED','CANCEL_REQUESTED','CANCELLED','REQUIRES_REVIEW']),
 'IntegrationOperation': ('integration_operation', ['HEALTH_CHECK','SEARCH','GET_RATES','HOLD','CONFIRM','CANCEL','QUERY_BOOKING','SYNC']),
 'TransactionStatus': ('transaction_status', ['PENDING','SUCCESS','FAILED','TIMEOUT','REJECTED','SHORT_CIRCUITED']),
 'IdempotencyStatus': ('idempotency_status', ['IN_PROGRESS','COMPLETED','FAILED']),
 'LogLevel': ('log_level', ['DEBUG','INFO','WARN','ERROR']),
 'ExceptionType': ('exception_type', ['PROVIDER_ERROR','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','NO_AVAILABILITY','PRICE_CHANGED','PARTIAL_CONFIRMATION','CANCELLATION_FAILED','RECONCILIATION_MISMATCH','MANUAL_PROVIDER','OTHER']),
 'ExceptionStatus': ('exception_status', ['OPEN','IN_PROGRESS','RESOLVED','DISMISSED']),
 'Severity': ('severity', ['LOW','MEDIUM','HIGH','CRITICAL']),
 'AlertKind': ('alert_kind', ['PROVIDER_DOWN','CIRCUIT_OPEN','HIGH_ERROR_RATE','HIGH_LATENCY','SYNC_FAILED','INCONSISTENCY','EXCEPTION_OPENED']),
 'AlertStatus': ('alert_status', ['OPEN','ACKNOWLEDGED','RESOLVED']),
 'SyncKind': ('sync_kind', ['AVAILABILITY','RATES','BOOKINGS', SINCE('CATALOG','stage3')]),
 'SyncStatus': ('sync_status', ['RUNNING','SUCCESS','PARTIAL','FAILED']),
 'InconsistencyKind': ('inconsistency_kind', ['AVAILABILITY_MISMATCH','RATE_MISMATCH','BOOKING_STATUS_MISMATCH','MISSING_AT_PROVIDER','MISSING_LOCAL']),
 'InconsistencyStatus': ('inconsistency_status', ['OPEN','RESOLVED','IGNORED']),
}

T = []
def _group(g):
    return dict(g) if isinstance(g, dict) else IX(g)

def _check(ch):
    return (ch[0], ch[1], ch[2] if len(ch) > 2 else None)

def table(name, model, cols, fks=(), uniques=(), indexes=(), checks=(), pk=None, since=None):
    T.append(dict(name=name, model=model, cols=cols, fks=list(fks), uniques=[_group(u) for u in uniques],
                  indexes=[_group(i) for i in indexes], checks=[_check(ch) for ch in checks], pk=pk, since=since))

# ---------------- Identidad ----------------
table('roles','Role',[pkid(), c('name','text',unique=True), c('description','text',null=True), created()])
table('users','User',[pkid(), c('email','text',unique=True), c('password_hash','text'), c('full_name','text'),
  c('role_id','uuid'), c('active','bool',default=LIT(True)), c('last_login_at','ts',null=True), created(), updated()],
  fks=[fk('role_id','roles')], indexes=[['role_id'],['active']])
table('refresh_tokens','RefreshToken',[pkid(), c('user_id','uuid'), c('token_hash','text',unique=True), c('expires_at','ts'),
  c('revoked_at','ts',null=True), c('user_agent','text',null=True), c('ip','text',null=True), created()],
  fks=[fk('user_id','users','CASCADE')], indexes=[['user_id'],['expires_at']])

# ---------------- Proveedores e integraciones ----------------
table('providers','Provider',[pkid(), c('code','text',unique=True), c('name','text'), c('type',E('ProviderType')),
  c('active','bool',default=LIT(True)), c('description','text',null=True), created(), updated()], indexes=[['type'],['active']])
table('provider_configs','ProviderConfig',[pkid(), c('provider_id','uuid',unique=True), c('base_url','text'),
  c('auth_type',E('AuthType'),default=ENUMV('NONE')), c('auth_header_name','text',null=True), c('credentials_enc','text',null=True),
  c('timeout_ms','int',default=LIT(8000)), c('max_retries','int',default=LIT(3)), c('retry_base_ms','int',default=LIT(200)),
  c('retry_max_ms','int',default=LIT(5000)), c('cb_failure_threshold','int',default=LIT(5)), c('cb_reset_timeout_ms','int',default=LIT(30000)),
  c('cb_half_open_max_calls','int',default=LIT(1)), c('supports_idempotency','bool',default=LIT(False)),
  c('params','json',default=JSON_DEFAULT('{}')), created(), updated()],
  fks=[fk('provider_id','providers','CASCADE')],
  checks=[('timeout_ms_pos','timeout_ms > 0'),('max_retries_nonneg','max_retries >= 0 AND max_retries <= 10'),
          ('retry_base_pos','retry_base_ms > 0'),('retry_max_ge_base','retry_max_ms >= retry_base_ms'),
          ('cb_threshold_pos','cb_failure_threshold > 0'),('cb_reset_pos','cb_reset_timeout_ms > 0'),('cb_half_open_pos','cb_half_open_max_calls > 0')])
table('provider_services','ProviderService',[pkid(), c('provider_id','uuid'), c('service_type',E('ProductType')),
  c('can_search','bool',default=LIT(True)), c('can_hold','bool',default=LIT(False)), c('can_confirm','bool',default=LIT(True)),
  c('can_cancel','bool',default=LIT(True)), c('can_query_status','bool',default=LIT(True)), created()],
  fks=[fk('provider_id','providers','CASCADE')], uniques=[['provider_id','service_type']])
table('integrations','Integration',[pkid(), c('provider_id','uuid'), c('name','text'), c('adapter_kind',E('AdapterKind')),
  c('enabled','bool',default=LIT(False)), c('status',E('IntegrationStatus'),default=ENUMV('UNKNOWN')),
  c('last_health_at','ts',null=True), c('last_error','text',null=True), created(), updated()],
  fks=[fk('provider_id','providers','CASCADE')], uniques=[['provider_id','name']], indexes=[['enabled'],['status']])
table('integration_health_checks','IntegrationHealthCheck',[pkid(), c('integration_id','uuid'), c('success','bool'),
  c('latency_ms','int',null=True), c('status_code','int',null=True), c('message','text',null=True),
  c('checked_at','ts',default=NOW), c('checked_by_id','uuid',null=True)],
  fks=[fk('integration_id','integrations','CASCADE'), fk('checked_by_id','users','SET NULL')], indexes=[['integration_id','checked_at']])
table('circuit_breaker_states','CircuitBreakerState',[pkid(), c('integration_id','uuid',unique=True),
  c('state',E('CircuitState'),default=ENUMV('CLOSED')), c('failure_count','int',default=LIT(0)), c('success_count','int',default=LIT(0)),
  c('opened_at','ts',null=True), c('next_attempt_at','ts',null=True), updated()],
  fks=[fk('integration_id','integrations','CASCADE')], checks=[('counts_nonneg','failure_count >= 0 AND success_count >= 0')])

# ---------------- Catalogo normalizado ----------------
table('products','Product',[pkid(), c('provider_id','uuid'), c('type',E('ProductType')), c('code','text'), c('name','text'),
  c('status',E('ProductStatus'),default=ENUMV('ACTIVE')), created(), updated()],
  fks=[fk('provider_id','providers')], uniques=[['provider_id','code']], indexes=[['type','status']])
table('hotels','Hotel',[pkid(), c('name','text'), c('city','text'), c('country','text'), c('stars','smallint',null=True),
  c('all_inclusive','bool',default=LIT(False)), created(), updated()], indexes=[['city']],
  checks=[('stars_range','stars IS NULL OR (stars BETWEEN 1 AND 5)')])
table('product_flight','ProductFlight',[c('product_id','uuid',pk=True), c('carrier','text'), c('flight_number','text'),
  c('origin','char3'), c('destination','char3'), c('departure_at','ts'), c('arrival_at','ts'), c('cabin','text',default=LIT('ECONOMY'))],
  fks=[fk('product_id','products','CASCADE')], indexes=[['origin','destination','departure_at']],
  checks=[('arrival_after_departure','arrival_at > departure_at')], pk=['product_id'])
table('product_room','ProductRoom',[c('product_id','uuid',pk=True), c('hotel_id','uuid'), c('room_type','text'),
  c('board_basis','text',default=LIT('ALL_INCLUSIVE')), c('max_occupancy','int')],
  fks=[fk('product_id','products','CASCADE'), fk('hotel_id','hotels')], indexes=[['hotel_id']],
  checks=[('occupancy_pos','max_occupancy > 0')], pk=['product_id'])
table('product_assistance','ProductAssistance',[c('product_id','uuid',pk=True), c('plan_name','text'),
  c('coverage_summary','text',null=True), c('max_days','int',null=True), c('medical_coverage_usd',DEC(12,2),null=True)],
  fks=[fk('product_id','products','CASCADE')], pk=['product_id'])
table('external_references','ExternalReference',[pkid(), c('provider_id','uuid'), c('entity_type','text'), c('entity_id','uuid'),
  c('external_id','text'), c('raw_hash','text',null=True), c('first_seen_at','ts',default=NOW), c('last_seen_at','ts',default=NOW)],
  fks=[fk('provider_id','providers')], uniques=[['provider_id','entity_type','external_id']], indexes=[['entity_type','entity_id']])
table('currencies','Currency',[c('code','char3',pk=True), c('name','text'), c('decimals','smallint',default=LIT(2)), c('active','bool',default=LIT(True))],
  pk=['code'], checks=[('decimals_range','decimals BETWEEN 0 AND 4')])
table('exchange_rates','ExchangeRate',[pkid(), c('base_currency','char3'), c('quote_currency','char3'), c('rate',DEC(18,8)),
  c('as_of','ts'), c('source','text')],
  fks=[fk('base_currency','currencies',ref_col='code'), fk('quote_currency','currencies',ref_col='code')],
  uniques=[['base_currency','quote_currency','as_of']], checks=[('rate_pos','rate > 0'),('distinct_currencies','base_currency <> quote_currency')])

# ---------------- Disponibilidad e inventario ----------------
table('availability_snapshots','AvailabilitySnapshot',[pkid(), c('product_id','uuid'), c('provider_id','uuid'), c('stay_date','date'),
  c('available_quantity','int'), c('synced_at','ts',default=NOW), c('source_hash','text',null=True)],
  fks=[fk('product_id','products','CASCADE'), fk('provider_id','providers')], uniques=[['product_id','stay_date']], indexes=[['provider_id','synced_at']],
  checks=[('available_nonneg','available_quantity >= 0')])
table('allotments','Allotment',[pkid(), c('product_id','uuid'), c('valid_from','date'), c('valid_to','date'), c('quantity','int'),
  c('release_days','int',default=LIT(0)), c('active','bool',default=LIT(True)), c('notes','text',null=True),
  c('created_by_id','uuid',null=True), created(), updated()],
  fks=[fk('product_id','products'), fk('created_by_id','users','SET NULL')], indexes=[['product_id','valid_from','valid_to']],
  checks=[('period_valid','valid_to >= valid_from'),('quantity_nonneg','quantity >= 0'),('release_nonneg','release_days >= 0')])
table('inventory_levels','InventoryLevel',[pkid(), c('product_id','uuid'), c('stay_date','date'), c('total_quantity','int'),
  c('held_quantity','int',default=LIT(0)), c('sold_quantity','int',default=LIT(0)), c('version','int',default=LIT(0)), updated()],
  fks=[fk('product_id','products')], uniques=[['product_id','stay_date']], indexes=[['stay_date']],
  checks=[('non_negative','total_quantity >= 0 AND held_quantity >= 0 AND sold_quantity >= 0'),
          ('no_oversell','held_quantity + sold_quantity <= total_quantity')])
table('inventory_holds','InventoryHold',[pkid(), c('level_id','uuid'), c('booking_item_id','uuid',null=True), c('quantity','int'),
  c('status',E('HoldStatus'),default=ENUMV('ACTIVE')), c('expires_at','ts'), created(), c('released_at','ts',null=True)],
  fks=[fk('level_id','inventory_levels'), fk('booking_item_id','booking_items','SET NULL')],
  indexes=[['status','expires_at'],['booking_item_id'],['level_id']], checks=[('quantity_pos','quantity > 0')])
table('inventory_movements','InventoryMovement',[pkid(), c('level_id','uuid'), c('kind',E('MovementKind')),
  c('delta_total','int',default=LIT(0)), c('delta_held','int',default=LIT(0)), c('delta_sold','int',default=LIT(0)),
  c('reference_type','text',null=True), c('reference_id','uuid',null=True), c('user_id','uuid',null=True), c('at','ts',default=NOW)],
  fks=[fk('level_id','inventory_levels'), fk('user_id','users','SET NULL')], indexes=[['level_id','at'],['reference_type','reference_id']])

# ---------------- Tarifas ----------------
table('rates','Rate',[pkid(), c('product_id','uuid'), c('rate_code','text',default=LIT('BAR')), c('currency','char3'),
  c('amount',DEC(14,2)), c('taxes_amount',DEC(14,2),default=LIT(0)), c('valid_from','date'), c('valid_to','date'),
  c('provider_rate_ref','text',null=True), c('active','bool',default=LIT(True)), created(), updated()],
  fks=[fk('product_id','products'), fk('currency','currencies',ref_col='code')], indexes=[['product_id','valid_from','valid_to']],
  checks=[('amount_nonneg','amount >= 0 AND taxes_amount >= 0'),('period_valid','valid_to >= valid_from')])
table('rate_history','RateHistory',[pkid(), c('rate_id','uuid'), c('old_amount',DEC(14,2),null=True), c('new_amount',DEC(14,2)),
  c('currency','char3'), c('reason','text'), c('changed_at','ts',default=NOW), c('changed_by_id','uuid',null=True)],
  fks=[fk('rate_id','rates'), fk('currency','currencies',ref_col='code'), fk('changed_by_id','users','SET NULL')], indexes=[['rate_id','changed_at']])

# ---------------- Reservas ----------------
table('quotes','Quote',[pkid(), c('reference','text',unique=True), c('status',E('QuoteStatus'),default=ENUMV('OPEN')), c('currency','char3'),
  c('total_amount',DEC(14,2)), c('expires_at','ts'), c('created_by_id','uuid',null=True), created()],
  fks=[fk('currency','currencies',ref_col='code'), fk('created_by_id','users','SET NULL')], indexes=[['status','expires_at']],
  checks=[('total_nonneg','total_amount >= 0')])
table('quote_items','QuoteItem',[pkid(), c('quote_id','uuid'), c('product_id','uuid'), c('rate_id','uuid',null=True), c('quantity','int'),
  c('unit_amount',DEC(14,2)), c('start_date','date'), c('end_date','date',null=True), c('provider_quote_ref','text',null=True),
  # Total del item en su moneda de origen (tarifa propia o proveedor), antes de convertir a la moneda de la cotizacion.
  c('source_currency','char3',null=True,since='stage3b'), c('source_amount',DEC(14,2),null=True,since='stage3b')],
  fks=[fk('quote_id','quotes','CASCADE'), fk('product_id','products'), fk('rate_id','rates','SET NULL'),
       fk('source_currency','currencies',ref_col='code')], indexes=[['quote_id']],
  checks=[('quantity_pos','quantity > 0'),('amount_nonneg','unit_amount >= 0'),
          ('source_price_pair','(source_currency IS NULL) = (source_amount IS NULL) AND (source_amount IS NULL OR source_amount >= 0)','stage3b')])
table('bookings','Booking',[pkid(), c('reference','text',unique=True), c('quote_id','uuid',null=True,unique=True),
  c('status',E('BookingStatus'),default=ENUMV('DRAFT')), c('currency','char3'), c('total_amount',DEC(14,2)),
  c('holder_name','text'), c('holder_email','text'), c('requested_at','ts',default=NOW), c('confirmed_at','ts',null=True),
  c('cancelled_at','ts',null=True), c('created_by_id','uuid',null=True), created(), updated()],
  fks=[fk('quote_id','quotes','SET NULL'), fk('currency','currencies',ref_col='code'), fk('created_by_id','users','SET NULL')],
  indexes=[['status','requested_at']], checks=[('total_nonneg','total_amount >= 0')])
table('booking_items','BookingItem',[pkid(), c('booking_id','uuid'), c('product_id','uuid'),
  c('status',E('BookingItemStatus'),default=ENUMV('PENDING')), c('quantity','int'), c('start_date','date'), c('end_date','date',null=True),
  c('unit_amount',DEC(14,2)), c('total_amount',DEC(14,2)), c('external_locator','text',null=True), c('provider_booking_ref','text',null=True),
  c('confirmed_at','ts',null=True), created(), updated(),
  # Bloqueo previo en el proveedor (HoldResult): referencia que exige ConfirmRequest.providerHoldRef y su vencimiento.
  c('provider_hold_ref','text',null=True,since='stage3'), c('hold_expires_at','ts',null=True,since='stage3'),
  # Total en la moneda del proveedor: es el expectedTotal que se le envia y contra el que se detecta un cambio de precio.
  c('source_currency','char3',null=True,since='stage3b'), c('source_amount',DEC(14,2),null=True,since='stage3b')],
  fks=[fk('booking_id','bookings'), fk('product_id','products'), fk('source_currency','currencies',ref_col='code')],
  indexes=[['booking_id'],['status'],['product_id'], IX(['status','hold_expires_at'], since='stage3')],
  checks=[('quantity_pos','quantity > 0'),('amounts_nonneg','unit_amount >= 0 AND total_amount >= 0'),
          ('confirmed_needs_locator',"status <> 'CONFIRMED' OR external_locator IS NOT NULL"),
          ('source_price_pair','(source_currency IS NULL) = (source_amount IS NULL) AND (source_amount IS NULL OR source_amount >= 0)','stage3b')])
table('travelers','Traveler',[pkid(), c('booking_id','uuid'), c('first_name','text'), c('last_name','text'),
  c('document_type','text',null=True), c('document_number','text',null=True), c('birth_date','date',null=True),
  c('email','text',null=True), c('is_holder','bool',default=LIT(False))],
  fks=[fk('booking_id','bookings','CASCADE')], indexes=[['booking_id']])
table('booking_status_history','BookingStatusHistory',[pkid(), c('booking_id','uuid'), c('from_status',E('BookingStatus'),null=True),
  c('to_status',E('BookingStatus')), c('reason','text',null=True), c('user_id','uuid',null=True), c('correlation_id','text',null=True), c('at','ts',default=NOW)],
  fks=[fk('booking_id','bookings'), fk('user_id','users','SET NULL')], indexes=[['booking_id','at']])

# ---------------- Trazabilidad ----------------
table('integration_transactions','IntegrationTransaction',[pkid(), c('correlation_id','text'), c('integration_id','uuid',null=True),
  c('provider_id','uuid',null=True), c('operation',E('IntegrationOperation')), c('operation_key','text',null=True,unique=True),
  c('idempotency_key','text',null=True), c('status',E('TransactionStatus'),default=ENUMV('PENDING')),
  c('started_at','ts',default=NOW), c('finished_at','ts',null=True), c('duration_ms','int',null=True), c('attempts','int',default=LIT(0)),
  c('http_status','int',null=True), c('error_code','text',null=True), c('error_message','text',null=True),
  c('request_payload','json',null=True), c('response_payload','json',null=True), c('booking_item_id','uuid',null=True), c('user_id','uuid',null=True)],
  fks=[fk('integration_id','integrations'), fk('provider_id','providers'), fk('booking_item_id','booking_items'), fk('user_id','users','SET NULL')],
  indexes=[['correlation_id'],['integration_id','started_at'],['provider_id','started_at'],['status','started_at'],['operation','started_at'],['booking_item_id']],
  checks=[('attempts_nonneg','attempts >= 0'),('duration_nonneg','duration_ms IS NULL OR duration_ms >= 0')])
table('transaction_attempts','TransactionAttempt',[pkid(), c('transaction_id','uuid'), c('attempt_number','int'),
  c('started_at','ts',default=NOW), c('duration_ms','int',null=True), c('status',E('TransactionStatus')), c('backoff_ms','int',null=True),
  c('error_code','text',null=True), c('error_message','text',null=True)],
  fks=[fk('transaction_id','integration_transactions','CASCADE')], uniques=[['transaction_id','attempt_number']],
  checks=[('attempt_pos','attempt_number > 0')])
table('idempotency_keys','IdempotencyKey',[pkid(), c('idem_key','text'), c('scope','text'), c('request_hash','text'),
  c('status',E('IdempotencyStatus'),default=ENUMV('IN_PROGRESS')), c('response_status','int',null=True), c('response_body','json',null=True),
  c('locked_at','ts',default=NOW), c('completed_at','ts',null=True), c('expires_at','ts'), c('user_id','uuid',null=True), created()],
  fks=[fk('user_id','users','SET NULL')], uniques=[['idem_key','scope']], indexes=[['expires_at']])
table('system_logs','SystemLog',[pkid(), c('level',E('LogLevel')), c('context','text'), c('message','text'), c('correlation_id','text',null=True),
  c('meta','json',null=True), c('at','ts',default=NOW)], indexes=[['level','at'],['correlation_id'],['context','at']])
table('audit_logs','AuditLog',[pkid(), c('user_id','uuid',null=True), c('action','text'), c('entity','text'), c('entity_id','text',null=True),
  c('before','json',null=True), c('after','json',null=True), c('ip','text',null=True), c('user_agent','text',null=True),
  c('correlation_id','text',null=True), c('at','ts',default=NOW)],
  fks=[fk('user_id','users')], indexes=[['entity','entity_id'],['user_id','at'],['at'],['correlation_id']])

# ---------------- Excepciones y sincronizacion ----------------
table('exception_cases','ExceptionCase',[pkid(), c('type',E('ExceptionType')), c('severity',E('Severity'),default=ENUMV('MEDIUM')),
  c('status',E('ExceptionStatus'),default=ENUMV('OPEN')), c('title','text'), c('description','text',null=True), c('booking_id','uuid',null=True),
  c('transaction_id','uuid',null=True), c('provider_id','uuid',null=True), c('assigned_to_id','uuid',null=True), c('resolution','text',null=True),
  c('resolved_at','ts',null=True), c('resolved_by_id','uuid',null=True), created(), updated()],
  fks=[fk('booking_id','bookings'), fk('transaction_id','integration_transactions'), fk('provider_id','providers'),
       fk('assigned_to_id','users','SET NULL'), fk('resolved_by_id','users','SET NULL')],
  indexes=[['status','severity'],['booking_id'],['provider_id'],['assigned_to_id']])
table('exception_events','ExceptionEvent',[pkid(), c('exception_id','uuid'), c('user_id','uuid',null=True), c('kind','text'), c('message','text'), c('at','ts',default=NOW)],
  fks=[fk('exception_id','exception_cases','CASCADE'), fk('user_id','users','SET NULL')], indexes=[['exception_id','at']])
table('alerts','Alert',[pkid(), c('kind',E('AlertKind')), c('severity',E('Severity'),default=ENUMV('HIGH')), c('status',E('AlertStatus'),default=ENUMV('OPEN')),
  c('integration_id','uuid',null=True), c('provider_id','uuid',null=True), c('message','text'), c('dedupe_key','text',null=True),
  created(), c('acknowledged_by_id','uuid',null=True), c('acknowledged_at','ts',null=True), c('resolved_at','ts',null=True)],
  fks=[fk('integration_id','integrations'), fk('provider_id','providers'), fk('acknowledged_by_id','users','SET NULL')],
  indexes=[['status','severity'],['dedupe_key'],['integration_id','created_at']])
table('sync_runs','SyncRun',[pkid(), c('kind',E('SyncKind')), c('provider_id','uuid',null=True), c('integration_id','uuid',null=True),
  c('status',E('SyncStatus'),default=ENUMV('RUNNING')), c('started_at','ts',default=NOW), c('finished_at','ts',null=True),
  c('items_processed','int',default=LIT(0)), c('items_changed','int',default=LIT(0)), c('inconsistencies_found','int',default=LIT(0)),
  c('error_message','text',null=True), c('triggered_by_id','uuid',null=True), c('correlation_id','text',null=True)],
  fks=[fk('provider_id','providers'), fk('integration_id','integrations'), fk('triggered_by_id','users','SET NULL')],
  indexes=[['kind','started_at'],['provider_id','started_at']])
table('inconsistencies','Inconsistency',[pkid(), c('kind',E('InconsistencyKind')), c('status',E('InconsistencyStatus'),default=ENUMV('OPEN')),
  c('provider_id','uuid'), c('product_id','uuid',null=True), c('booking_item_id','uuid',null=True), c('sync_run_id','uuid',null=True),
  c('expected','json',null=True), c('actual','json',null=True), c('detected_at','ts',default=NOW), c('resolved_at','ts',null=True),
  c('resolved_by_id','uuid',null=True), c('notes','text',null=True)],
  fks=[fk('provider_id','providers'), fk('product_id','products'), fk('booking_item_id','booking_items'),
       fk('sync_run_id','sync_runs','SET NULL'), fk('resolved_by_id','users','SET NULL')],
  indexes=[['status','detected_at'],['provider_id'],['product_id']])

APPEND_ONLY = ['audit_logs','inventory_movements']
assert len(T) == 40, len(T)
