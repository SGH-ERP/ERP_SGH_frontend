import crypto from 'crypto';
import type { ModuleKey, RoleId, RolePermissions, SubmoduleMap, UserAccount } from './types.ts';
import { getDb, hashPassword, initDatabase, type DbUserRow } from './db.ts';

const ALL_M1 = ['habitaciones', 'disponibilidad', 'reservas', 'tarifas', 'checkin', 'checkout', 'sobreventa', 'ocupacion', 'huespedes', 'ia'];
const ALL_M2 = ['estado', 'ordenes', 'inspecciones', 'personal', 'incidencias', 'preventivo', 'correctivo', 'activos', 'insumos', 'ia'];
const ALL_M3 = ['productos', 'servicios', 'pos', 'restaurante', 'roomservice', 'minibar', 'complementarios', 'inventario', 'proveedores', 'recetario', 'ia'];
const ALL_M4 = ['folios', 'facturacion', 'pagos', 'cxc', 'caja', 'gastos', 'costos', 'reportes', 'sunat', 'ia'];
const ALL_M5 = ['perfil360', 'segmentacion', 'fidelizacion', 'campanas', 'reclamos', 'solicitudes', 'encuestas', 'resenas', 'autoatencion', 'ia'];

function makePerm(
  view: ModuleKey[],
  edit: ModuleKey[],
  allowedTabs: SubmoduleMap,
  editableTabs: SubmoduleMap,
  opts: {
    canViewFullPII: boolean;
    canApproveFinancials: boolean;
    canManageRoles: boolean;
    scopeSummary: string;
    onlyAssignedTasks?: boolean;
  }
): RolePermissions {
  return {
    view,
    edit,
    allowedTabs,
    editableTabs,
    ...opts,
  };
}

/**
 * Matriz RBAC autoritativa por defecto para los 16 roles (persistida en SQLite).
 * Aplica el principio de mínimo privilegio a nivel de módulo y submódulo.
 */
const DEFAULT_ROLE_PERMISSIONS: Record<RoleId, RolePermissions> = {
  admin: makePerm(
    ['dashboard', 'm1', 'm2', 'm3', 'm4', 'm5', 'config'],
    ['config', 'm1', 'm2', 'm3', 'm4', 'm5'],
    { m1: ALL_M1, m2: ALL_M2, m3: ALL_M3, m4: ALL_M4, m5: ALL_M5 },
    {
      m1: ['habitaciones', 'tarifas', 'sobreventa', 'ia'],
      m2: ['personal', 'activos', 'ia'],
      m3: ['productos', 'servicios', 'proveedores', 'ia'],
      m4: ['reportes', 'ia'],
      m5: ['campanas', 'ia'],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: true,
      scopeSummary: 'Consulta global M01–M05, funciones administrativas autorizadas y gestión de usuarios/permisos.',
    }
  ),
  recepcionista: makePerm(
    ['dashboard', 'm1', 'm2', 'm4', 'm5'],
    ['m1', 'm4', 'm5'],
    {
      m1: ALL_M1,
      m2: ['estado'],
      m4: ['folios', 'pagos'],
      m5: ['perfil360', 'solicitudes'],
    },
    {
      m1: ALL_M1,
      m2: [],
      m4: ['pagos'],
      m5: ['solicitudes'],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Operaciones completas M01, consulta de estado físico M02, cobros autorizados M04 y consulta limitada M05.',
    }
  ),
  supervisor_hk: makePerm(
    ['dashboard', 'm2', 'm1', 'm3'],
    ['m2'],
    {
      m2: ['estado', 'ordenes', 'inspecciones', 'personal', 'insumos', 'ia'],
      m1: ['checkin', 'ocupacion'],
      m3: ['inventario'],
    },
    {
      m2: ['estado', 'ordenes', 'inspecciones', 'insumos'],
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Gestión de limpieza e inspecciones M02, consulta de próximas llegadas M01 y solicitudes de insumos M03.',
    }
  ),
  limpieza: makePerm(
    ['dashboard', 'm2'],
    ['m2'],
    {
      m2: ['ordenes', 'estado'],
    },
    {
      m2: ['ordenes'],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      onlyAssignedTasks: true,
      scopeSummary: 'Únicamente tareas de limpieza asignadas y estado operativo de sus habitaciones en M02.',
    }
  ),
  tecnico: makePerm(
    ['dashboard', 'm2', 'm3'],
    ['m2'],
    {
      m2: ['incidencias', 'preventivo', 'correctivo', 'activos', 'insumos', 'ia'],
      m3: ['inventario'],
    },
    {
      m2: ['incidencias', 'preventivo', 'correctivo', 'insumos'],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      onlyAssignedTasks: true,
      scopeSummary: 'Mantenimiento e incidencias asignadas en M02 y solicitudes autorizadas de insumos M03.',
    }
  ),
  admin_servicios: makePerm(
    ['dashboard', 'm3', 'm1', 'm4'],
    ['m3'],
    {
      m3: ALL_M3,
      m1: ['ocupacion'],
      m4: ['reportes'],
    },
    {
      m3: ALL_M3,
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Administración integral M03, consulta limitada de ocupación M01 e indicadores de M04.',
    }
  ),
  pos: makePerm(
    ['dashboard', 'm3', 'm1', 'm4'],
    ['m3'],
    {
      m3: ['pos', 'restaurante', 'roomservice', 'minibar', 'complementarios', 'productos'],
      m1: ['ocupacion', 'checkout'],
      m4: ['folios'],
    },
    {
      m3: ['pos', 'restaurante', 'roomservice', 'minibar', 'complementarios'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Comandas y ventas POS/Restaurante M03, validación de estadías M01 y consulta de cargos aplicados en M04.',
    }
  ),
  almacen: makePerm(
    ['dashboard', 'm3', 'm2', 'm4'],
    ['m3'],
    {
      m3: ['inventario', 'proveedores', 'recetario', 'ia'],
      m2: ['insumos'],
      m4: ['gastos'],
    },
    {
      m3: ['inventario', 'recetario'],
      m2: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Inventarios y abastecimiento M03, atención de solicitudes M02 y consulta limitada de compras M04.',
    }
  ),
  compras: makePerm(
    ['dashboard', 'm3', 'm4'],
    ['m3'],
    {
      m3: ['proveedores', 'inventario', 'ia'],
      m4: ['gastos', 'costos'],
    },
    {
      m3: ['proveedores'],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Gestión de proveedores y órdenes de compra M03 y consulta limitada de presupuesto en M04.',
    }
  ),
  cajero: makePerm(
    ['dashboard', 'm4', 'm1'],
    ['m4'],
    {
      m4: ['folios', 'facturacion', 'pagos', 'caja', 'sunat'],
      m1: ['checkout', 'ocupacion'],
    },
    {
      m4: ['folios', 'facturacion', 'pagos', 'caja'],
      m1: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Operaciones de caja, facturación y cobros M04 con consulta de estadías activas M01.',
    }
  ),
  costos: makePerm(
    ['dashboard', 'm4', 'm3'],
    ['m4'],
    {
      m4: ['gastos', 'costos', 'reportes'],
      m3: ['proveedores', 'inventario', 'recetario'],
    },
    {
      m4: ['gastos', 'costos'],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Control de costos y gastos operativos M04 con consulta de compras y recetario M03.',
    }
  ),
  jefe_finanzas: makePerm(
    ['dashboard', 'm4', 'm1', 'm3'],
    ['m4'],
    {
      m4: ALL_M4,
      m1: ['reservas', 'tarifas', 'ocupacion'],
      m3: ['proveedores', 'inventario', 'productos'],
    },
    {
      m4: ['folios', 'facturacion', 'pagos', 'cxc', 'gastos', 'costos'],
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: false,
      scopeSummary: 'Supervisión integral M04 con consulta autorizada de operaciones M01 y abastecimiento M03.',
    }
  ),
  gerente_finanzas: makePerm(
    ['dashboard', 'm4', 'm1', 'm3'],
    ['m4'],
    {
      m4: ALL_M4,
      m1: ['ocupacion', 'tarifas', 'ia'],
      m3: ['inventario', 'proveedores', 'ia'],
    },
    {
      m4: ALL_M4,
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: false,
      scopeSummary: 'Supervisión ejecutiva, aprobaciones y excepciones M04, más indicadores clave de M01 y M03.',
    }
  ),
  atencion: makePerm(
    ['dashboard', 'm5', 'm1', 'm2', 'm4'],
    ['m5', 'm2'],
    {
      m5: ['perfil360', 'reclamos', 'solicitudes', 'encuestas', 'resenas', 'autoatencion', 'ia'],
      m1: ['reservas', 'huespedes'],
      m2: ['incidencias'],
      m4: ['folios'],
    },
    {
      m5: ['reclamos', 'solicitudes', 'encuestas', 'resenas', 'autoatencion'],
      m2: ['incidencias'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Atención al huésped, reclamos y solicitudes M05, derivaciones a M02 y consulta limitada M01/M04.',
    }
  ),
  comercial: makePerm(
    ['dashboard', 'm5', 'm1', 'm4'],
    ['m5'],
    {
      m5: ['perfil360', 'segmentacion', 'fidelizacion', 'campanas', 'encuestas', 'resenas', 'ia'],
      m1: ['ocupacion', 'tarifas', 'reservas'],
      m4: ['reportes'],
    },
    {
      m5: ['segmentacion', 'fidelizacion', 'campanas', 'resenas'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Administración comercial, segmentación, fidelización y campañas M05; consulta limitada M01 y M04.',
    }
  ),
  auditor: makePerm(
    ['dashboard', 'm1', 'm2', 'm3', 'm4', 'm5', 'config'],
    [],
    { m1: ALL_M1, m2: ALL_M2, m3: ALL_M3, m4: ALL_M4, m5: ALL_M5 },
    {},
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Acceso en modo estrictamente solo lectura de M01 a M05, configuración y bitácora de auditoría.',
    }
  ),
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const VALID_ROLES = new Set<RoleId>(Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleId[]);

let dbInitialized = false;
export function ensureAuthDatabase(): void {
  if (!dbInitialized) {
    initDatabase(DEFAULT_ROLE_PERMISSIONS);
    dbInitialized = true;
  }
}

function rowToPublicUser(row: DbUserRow): UserAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: row.role_label,
    department: row.department,
    shift: row.shift,
    ...(row.assigned_staff_id ? { assignedStaffId: row.assigned_staff_id } : {}),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

function getPermissionsForRoleFromDb(role: RoleId): RolePermissions {
  ensureAuthDatabase();
  const db = getDb();
  const row = db
    .prepare('SELECT permissions_json FROM role_permissions WHERE role = ?')
    .get(role) as { permissions_json: string } | undefined;
  if (!row) {
    return structuredClone(DEFAULT_ROLE_PERMISSIONS[role]);
  }
  return JSON.parse(row.permissions_json) as RolePermissions;
}

export function authenticateUser(
  email: string,
  password: string
): { ok: true; token: string; user: UserAccount; permissions: RolePermissions } | { ok: false; error: string } {
  ensureAuthDatabase();
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const found = db
    .prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1')
    .get(normalized) as DbUserRow | undefined;

  if (!found) {
    return { ok: false, error: 'Correo electrónico o contraseña incorrectos.' };
  }

  const candidateHex = hashPassword(password, found.salt);
  const candidateBuf = Buffer.from(candidateHex, 'hex');
  const storedBuf = Buffer.from(found.password_hash, 'hex');
  if (candidateBuf.length !== storedBuf.length || !crypto.timingSafeEqual(candidateBuf, storedBuf)) {
    return { ok: false, error: 'Correo electrónico o contraseña incorrectos.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    found.id,
    now,
    now + SESSION_TTL_MS
  );

  return {
    ok: true,
    token,
    user: rowToPublicUser(found),
    permissions: getPermissionsForRoleFromDb(found.role),
  };
}

export function getSessionContext(token: string | null | undefined): {
  user: UserAccount;
  permissions: RolePermissions;
} | null {
  if (!token) return null;
  ensureAuthDatabase();
  const db = getDb();
  const session = db
    .prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { token: string; user_id: string; expires_at: number } | undefined;

  if (!session) return null;
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const found = db
    .prepare('SELECT * FROM users WHERE id = ? AND active = 1')
    .get(session.user_id) as DbUserRow | undefined;
  if (!found) return null;

  return {
    user: rowToPublicUser(found),
    permissions: getPermissionsForRoleFromDb(found.role),
  };
}

export function destroySession(token: string | null | undefined): void {
  if (!token) return;
  ensureAuthDatabase();
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getAllRolePermissions(): Record<RoleId, RolePermissions> {
  ensureAuthDatabase();
  const db = getDb();
  const rows = db.prepare('SELECT role, permissions_json FROM role_permissions').all() as Array<{
    role: RoleId;
    permissions_json: string;
  }>;
  const result = structuredClone(DEFAULT_ROLE_PERMISSIONS);
  for (const row of rows) {
    if (VALID_ROLES.has(row.role)) {
      result[row.role] = JSON.parse(row.permissions_json) as RolePermissions;
    }
  }
  return result;
}

export function isValidRoleId(role: string): role is RoleId {
  return VALID_ROLES.has(role as RoleId);
}

export function updateServerRolePermissions(role: RoleId, next: RolePermissions): Record<RoleId, RolePermissions> {
  ensureAuthDatabase();
  if (!VALID_ROLES.has(role) || role === 'admin') {
    return getAllRolePermissions();
  }
  const db = getDb();
  db.prepare(
    'INSERT INTO role_permissions (role, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(role) DO UPDATE SET permissions_json = excluded.permissions_json, updated_at = excluded.updated_at'
  ).run(role, JSON.stringify(next), new Date().toISOString());
  return getAllRolePermissions();
}

export function listPublicDirectory(): Array<{ name: string; email: string; role: RoleId; roleLabel: string; department: string }> {
  ensureAuthDatabase();
  const db = getDb();
  const rows = db
    .prepare('SELECT name, email, role, role_label, department FROM users WHERE active = 1 ORDER BY id ASC')
    .all() as Array<{
      name: string;
      email: string;
      role: RoleId;
      role_label: string;
      department: string;
    }>;
  return rows.map((u) => ({
    name: u.name,
    email: u.email,
    role: u.role,
    roleLabel: u.role_label,
    department: u.department,
  }));
}

export function getDatabaseStats(): { usersCount: number; rolesCount: number } {
  ensureAuthDatabase();
  const db = getDb();
  const u = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE active = 1').get() as { cnt: number };
  const r = db.prepare('SELECT COUNT(*) as cnt FROM role_permissions').get() as { cnt: number };
  return { usersCount: u.cnt, rolesCount: r.cnt };
}

export function extractTokenFromRequest(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookieHeader = headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const parts = cookieHeader.split(';').map((p) => p.trim());
    for (const part of parts) {
      if (part.startsWith('sgh_erp_session=')) {
        return decodeURIComponent(part.slice('sgh_erp_session='.length));
      }
    }
  }
  return null;
}
