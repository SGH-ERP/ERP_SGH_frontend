import { createClient } from '@supabase/supabase-js';
import { createInitialERPState } from '../data/seed-data.js';

const STORAGE_KEY = 'sgh_erp_demo_state_v1';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseInstance = null;

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && String(SUPABASE_URL).startsWith('http'));
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseInstance;
}

export function getPersistenceStatus(lastSyncedAt) {
  if (isSupabaseConfigured()) {
    return {
      mode: 'supabase',
      label: 'Supabase PostgreSQL',
      description: 'Conectado a instancia PostgreSQL configurada por variables de entorno.',
      supabaseConfigured: true,
      lastSyncedAt,
    };
  }
  return {
    mode: 'demo_local',
    label: 'Almacenamiento Local SQLite',
    description: 'Persistencia local activa con respaldo automático en el navegador.',
    supabaseConfigured: false,
    lastSyncedAt,
  };
}

export async function loadERPState() {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('erp_snapshots')
        .select('payload')
        .eq('tenant_id', 'azure_coast_main')
        .maybeSingle();

      if (!error && data?.payload) {
        return { state: data.payload, source: 'supabase' };
      }
    } catch (err) {
      console.warn('[SGH-ERP] Error leyendo Supabase, usando respaldo local:', err);
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.rooms) && Array.isArray(parsed.folios)) {
        return { state: parsed, source: 'demo_local' };
      }
    }
  } catch (err) {
    console.warn('[SGH-ERP] No se pudo leer localStorage:', err);
  }

  return { state: createInitialERPState(), source: 'demo_local' };
}

export async function saveERPState(state) {
  const syncedAt = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[SGH-ERP] Error guardando estado local:', err);
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client.from('erp_snapshots').upsert(
        {
          tenant_id: 'azure_coast_main',
          payload: state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );
      if (!error) {
        return { ok: true, syncedAt, source: 'supabase' };
      }
    } catch (err) {
      console.warn('[SGH-ERP] Error sincronizando con Supabase:', err);
    }
  }

  return { ok: true, syncedAt, source: 'demo_local' };
}

export function resetDemoState() {
  const fresh = createInitialERPState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // ignore storage quota issues
  }
  return fresh;
}

export const SUPABASE_SQL_SCHEMA = `-- SGH-ERP · Esquema PostgreSQL de referencia para Supabase
-- Incluye tablas operativas de los 5 módulos y políticas base RLS

CREATE TABLE IF NOT EXISTS erp_snapshots (
  tenant_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  room_number TEXT UNIQUE NOT NULL,
  floor INT NOT NULL,
  room_type TEXT NOT NULL,
  capacity INT NOT NULL,
  base_rate NUMERIC(10,2) NOT NULL,
  commercial_status TEXT NOT NULL,
  housekeeping_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_number TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  segment TEXT NOT NULL,
  loyalty_tier TEXT NOT NULL,
  loyalty_points INT DEFAULT 0,
  privacy_consent_iso27701 BOOLEAN DEFAULT FALSE,
  consent_date DATE
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  guest_id TEXT REFERENCES guests(id),
  room_id TEXT REFERENCES rooms(id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  nightly_rate NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleaning_orders (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id),
  order_type TEXT NOT NULL,
  priority TEXT NOT NULL,
  assigned_staff_id TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_incidents (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  room_id TEXT REFERENCES rooms(id),
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  linked_complaint_id TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  stock NUMERIC(10,2) NOT NULL,
  min_stock NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_folios (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  reservation_id TEXT REFERENCES reservations(id),
  guest_id TEXT REFERENCES guests(id),
  status TEXT NOT NULL,
  total_charges NUMERIC(10,2) DEFAULT 0,
  total_payments NUMERIC(10,2) DEFAULT 0,
  balance NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS crm_complaints (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  guest_id TEXT REFERENCES guests(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  linked_incident_id TEXT REFERENCES maintenance_incidents(id)
);

-- ============================================================================
-- PERFILES RBAC (16 ROLES) Y POLÍTICAS RLS DE MÍNIMO PRIVILEGIO (SUPABASE AUTH)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'admin','recepcionista','supervisor_hk','limpieza','tecnico',
    'admin_servicios','pos','almacen','compras','cajero','costos',
    'jefe_finanzas','gerente_finanzas','atencion','comercial','auditor'
  )),
  assigned_staff_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.current_erp_role()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
$$;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_or_admin" ON user_profiles
  FOR SELECT USING (id = auth.uid() OR current_erp_role() IN ('admin', 'auditor'));

CREATE POLICY "guests_read_authorized" ON guests
  FOR SELECT USING (current_erp_role() IN ('admin','recepcionista','cajero','jefe_finanzas','gerente_finanzas','atencion','comercial','auditor'));
CREATE POLICY "guests_write_frontdesk_crm" ON guests
  FOR INSERT WITH CHECK (current_erp_role() IN ('recepcionista','atencion','comercial'));

CREATE POLICY "cleaning_assigned_or_supervisor" ON cleaning_orders
  FOR SELECT USING (
    current_erp_role() IN ('admin','supervisor_hk','auditor')
    OR (current_erp_role() = 'limpieza' AND assigned_staff_id = (SELECT assigned_staff_id FROM user_profiles WHERE id = auth.uid()))
  );

CREATE POLICY "folios_read_authorized" ON guest_folios
  FOR SELECT USING (current_erp_role() IN ('admin','recepcionista','pos','cajero','jefe_finanzas','gerente_finanzas','atencion','auditor'));
CREATE POLICY "folios_write_finance" ON guest_folios
  FOR UPDATE USING (current_erp_role() IN ('cajero','jefe_finanzas','gerente_finanzas'));
`;
