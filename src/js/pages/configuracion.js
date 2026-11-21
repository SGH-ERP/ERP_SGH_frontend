import {
  getRef,
  h,
  icon,
  loadViewTemplate,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import { getRoute } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { ALL_ROLE_IDS, ROLE_LABELS } from '../data/rbac.js';
import { SUPABASE_SQL_SCHEMA } from '../services/data-adapter.js';
import { ModuleHeader, StatusText } from '../components/ui-components.js';
import moduloBaseHtml from '../../html/modules/modulo-base.html?raw';
import rbacHtml from '../../html/pages/configuracion/rbac.html?raw';
import usuariosHtml from '../../html/pages/configuracion/usuarios.html?raw';
import baseDatosHtml from '../../html/pages/configuracion/base-datos.html?raw';
import auditoriaHtml from '../../html/pages/configuracion/auditoria.html?raw';

const VIEW_HTML = {
  rbac: rbacHtml,
  usuarios: usuariosHtml,
  supabase: baseDatosHtml,
  auditoria: auditoriaHtml,
};

const VIEW_META = {
  rbac: { title: 'Matriz RBAC (16 Roles)', subtitle: 'Control de acceso granular por módulo, submódulo y visibilidad de datos.' },
  usuarios: { title: 'Directorio de Usuarios', subtitle: 'Cuentas corporativas activas en SQLite con credenciales cifradas PBKDF2.' },
  supabase: { title: 'Base de Datos y Reinicio', subtitle: 'Estado de persistencia, restauración de base de datos y esquema PostgreSQL RLS.' },
  auditoria: { title: 'Bitácora de Auditoría', subtitle: 'Registro inmutable de acciones críticas, accesos y cambios de privacidad.' },
};

const cfgUi = {
  confirmReset: false,
  copiedSql: false,
  savingRole: null,
};

const MODULE_META = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'm1', label: 'M1 Reservas' },
  { id: 'm2', label: 'M2 Housekeeping' },
  { id: 'm3', label: 'M3 POS/Almacén' },
  { id: 'm4', label: 'M4 Finanzas' },
  { id: 'm5', label: 'M5 CRM' },
  { id: 'config', label: 'Configuración' },
];

export function renderConfigPage() {
  const root = parseHtmlTemplate(moduloBaseHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const allRolePermissions = erpStore.allRolePermissions;
    const directoryUsers = erpStore.directoryUsers;
    const persistence = erpStore.persistence;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleIds = ['rbac', 'usuarios', 'supabase', 'auditoria'].filter((id) =>
      erpStore.canViewTab('config', id)
    );
    const defaultTab = erpStore.getDefaultTab('config') || visibleIds[0] || 'rbac';
    const activeTab = visibleIds.includes(route.tab) ? route.tab : defaultTab;
    const canEditRbac = erpStore.canEdit('config') && erpStore.canEditTab('config', 'rbac');

    const toggleModulePerm = async (role, mod, type) => {
      if (!canEditRbac) return;
      const current = allRolePermissions[role];
      if (!current) return;
      const list = [...current[type]];
      const has = list.includes(mod);
      let nextView = [...current.view];
      let nextEdit = [...current.edit];

      if (type === 'view') {
        nextView = has ? nextView.filter((m) => m !== mod) : [...nextView, mod];
        if (has) nextEdit = nextEdit.filter((m) => m !== mod);
      } else {
        nextEdit = has ? nextEdit.filter((m) => m !== mod) : [...nextEdit, mod];
        if (!has && !nextView.includes(mod)) nextView.push(mod);
      }

      cfgUi.savingRole = role;
      renderContent();
      await erpStore.updateRolePermissions(role, { ...current, view: nextView, edit: nextEdit });
      cfgUi.savingRole = null;
      renderContent();
    };

    const togglePii = async (role) => {
      if (!canEditRbac) return;
      const current = allRolePermissions[role];
      if (!current) return;
      cfgUi.savingRole = role;
      renderContent();
      await erpStore.updateRolePermissions(role, { ...current, canViewFullPII: !current.canViewFullPII });
      cfgUi.savingRole = null;
      renderContent();
    };

    const { root: tabNode, clone } = loadViewTemplate(VIEW_HTML[activeTab] || rbacHtml);

    if (activeTab === 'rbac') {
      if (!canEditRbac) {
        mountRef(tabNode, 'readonly-badge', StatusText({ label: 'Solo lectura (Auditor)', variant: 'info' }));
      }
      const headRow = getRef(tabNode, 'head-row');
      if (headRow) {
        for (const m of MODULE_META) headRow.appendChild(h('th', { className: 'text-center' }, m.label));
        headRow.appendChild(h('th', { className: 'text-center' }, 'PII Completo'));
      }
      mountRef(
        tabNode,
        'tbody',
        ALL_ROLE_IDS.map((roleId) => {
          const perms = allRolePermissions[roleId];
          const isSaving = cfgUi.savingRole === roleId;
          const tr = clone('fila-rbac');
          setText(tr, 'role-name', ROLE_LABELS[roleId]);
          setText(tr, 'scope', perms?.scopeSummary || '—');

          for (const m of MODULE_META) {
            const v = perms?.view.includes(m.id);
            const e = perms?.edit.includes(m.id);
            const cell = clone('celda-rbac-permiso');
            const viewBtn = getRef(cell, 'view-btn');
            const editBtn = getRef(cell, 'edit-btn');
            if (viewBtn) {
              viewBtn.disabled = !canEditRbac || isSaving;
              if (v) viewBtn.classList.add('is-view-on');
              viewBtn.addEventListener('click', () => toggleModulePerm(roleId, m.id, 'view'));
            }
            if (editBtn) {
              editBtn.disabled = !canEditRbac || isSaving;
              if (e) editBtn.classList.add('is-edit-on');
              editBtn.addEventListener('click', () => toggleModulePerm(roleId, m.id, 'edit'));
            }
            tr.appendChild(cell);
          }

          tr.appendChild(
            h(
              'td',
              { className: 'text-center' },
              h(
                'button',
                {
                  type: 'button',
                  disabled: !canEditRbac || isSaving,
                  className: 'btn btn-outline btn-xs font-mono',
                  onClick: () => togglePii(roleId),
                },
                perms?.canViewFullPII ? 'Sí' : 'Enmasc.'
              )
            )
          );
          return tr;
        })
      );
    } else if (activeTab === 'usuarios') {
      mountRef(
        tabNode,
        'tbody',
        directoryUsers.map((u) => {
          const tr = clone('fila-usuario');
          setText(tr, 'name', u.name);
          setText(tr, 'email', u.email);
          setText(tr, 'role', u.roleLabel);
          setText(tr, 'staff-id', u.assignedStaffId || 'N/A');
          mountRef(tr, 'status', StatusText({ label: u.active ? 'Activo' : 'Inactivo', variant: u.active ? 'success' : 'danger' }));
          return tr;
        })
      );
    } else if (activeTab === 'supabase') {
      mountRef(tabNode, 'db-icon', icon('database', 'w-5 text-teal'));
      setText(tabNode, 'persistence-label', `Persistencia: ${persistence.label}`);
      setText(tabNode, 'persistence-desc', persistence.description);
      mountRef(
        tabNode,
        'persistence-status',
        StatusText({
          label: persistence.supabaseConfigured ? 'Supabase Conectado' : 'SQLite + LocalStorage Activo',
          variant: persistence.supabaseConfigured ? 'success' : 'info',
        })
      );

      if (erpStore.canEdit('config')) {
        setVisible(tabNode, 'reset-row', true);
        mountRef(tabNode, 'reset-icon', icon('rotateCcw', 'w-3.5'));
        setVisible(tabNode, 'reset-btn', !cfgUi.confirmReset);
        setVisible(tabNode, 'confirm-group', cfgUi.confirmReset);

        getRef(tabNode, 'reset-btn')?.addEventListener('click', () => {
          cfgUi.confirmReset = true;
          renderContent();
        });
        getRef(tabNode, 'confirm-reset-btn')?.addEventListener('click', () => {
          erpStore.resetAllDemoData();
          cfgUi.confirmReset = false;
          renderContent();
        });
        getRef(tabNode, 'cancel-reset-btn')?.addEventListener('click', () => {
          cfgUi.confirmReset = false;
          renderContent();
        });
      }

      mountRef(tabNode, 'copy-icon', icon('copy', 'w-3.5'));
      setText(tabNode, 'copy-label', cfgUi.copiedSql ? 'Copiado' : 'Copiar SQL');
      getRef(tabNode, 'copy-sql-btn')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
          cfgUi.copiedSql = true;
          renderContent();
          setTimeout(() => {
            cfgUi.copiedSql = false;
            renderContent();
          }, 2200);
        } catch {
          erpStore.pushToast({ title: 'No se pudo copiar al portapapeles', type: 'warning' });
        }
      });
      setText(tabNode, 'sql-pre', SUPABASE_SQL_SCHEMA);
    } else if (activeTab === 'auditoria') {
      mountRef(
        tabNode,
        'tbody',
        state.auditLog.slice(0, 60).map((entry) => {
          const tr = clone('fila-auditoria');
          setText(tr, 'timestamp', entry.timestamp);
          setText(tr, 'user', entry.user);
          setText(tr, 'role', entry.role);
          setText(tr, 'module', entry.module.toUpperCase());
          setText(tr, 'action', entry.action);
          if (entry.privacyImpact) setVisible(tr, 'pii-flag', true);
          setText(tr, 'ref', entry.entityRef || '—');
          return tr;
        })
      );
    }

    const meta = VIEW_META[activeTab] || VIEW_META.rbac;
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'CONFIGURACIÓN DEL SISTEMA',
        title: meta.title,
        subtitle: meta.subtitle,
      })
    );
    mount(bodySlot, tabNode);
  }

  renderContent();
  return root;
}

