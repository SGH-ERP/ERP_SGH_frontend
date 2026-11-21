import {
  createTemplateLibrary,
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
import moduleShellHtml from '../../html/modules/modulo-base.html?raw';
import modalesHtml from '../../html/modules/housekeeping/modales.html?raw';
import resumenHtml from '../../html/modules/housekeeping/resumen.html?raw';
import estadoHabitacionesHtml from '../../html/modules/housekeeping/estado-habitaciones.html?raw';
import limpiezaHtml from '../../html/modules/housekeeping/limpieza.html?raw';
import inspeccionHtml from '../../html/modules/housekeeping/inspeccion.html?raw';
import incidenciasHtml from '../../html/modules/housekeeping/incidencias.html?raw';
import mantCorrectivoHtml from '../../html/modules/housekeeping/mant-correctivo.html?raw';
import mantPreventivoHtml from '../../html/modules/housekeeping/mant-preventivo.html?raw';
import mantPredictivoHtml from '../../html/modules/housekeeping/mant-predictivo.html?raw';
import activosHtml from '../../html/modules/housekeeping/activos.html?raw';
import insumosHtml from '../../html/modules/housekeeping/insumos.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  resumen: resumenHtml,
  estado_habitaciones: estadoHabitacionesHtml,
  limpieza: limpiezaHtml,
  inspeccion: inspeccionHtml,
  incidencias: incidenciasHtml,
  mant_correctivo: mantCorrectivoHtml,
  mant_preventivo: mantPreventivoHtml,
  mant_predictivo: mantPredictivoHtml,
  activos: activosHtml,
  insumos: insumosHtml,
};

const M2_TABS = [
  { id: 'resumen', label: 'Resumen Housekeeping & MTTO', subtitle: 'KPIs físicos en tiempo real, órdenes activas y asistente predictivo IA.' },
  { id: 'estado_habitaciones', label: 'Estado de Habitaciones', subtitle: 'Semáforo físico por unidad sincronizado con Front Desk (M1).' },
  { id: 'limpieza', label: 'Órdenes de Limpieza', subtitle: 'Asignaciones por salida (Flujo B), repaso y limpieza profunda.' },
  { id: 'inspeccion', label: 'Control e Inspección', subtitle: 'Checklist de calidad para liberar habitaciones a Check-in (Flujo B).' },
  { id: 'incidencias', label: 'Incidencias Técnicas', subtitle: 'Reportes de averías e infraestructura, incluyendo Flujo E desde CRM.' },
  { id: 'mant_correctivo', label: 'Mantenimiento Correctivo', subtitle: 'Órdenes de trabajo técnicas con imputación automática de costos (M4).' },
  { id: 'mant_preventivo', label: 'Mantenimiento Preventivo', subtitle: 'Cronograma periódico y checklist de equipos hoteleros.' },
  { id: 'mant_predictivo', label: 'Mantenimiento Predictivo', subtitle: 'Telemetría y probabilidad de falla asistida por IA.' },
  { id: 'activos', label: 'Inventario de Activos', subtitle: 'Catálogo de equipos e infraestructura crítica del hotel.' },
  { id: 'insumos', label: 'Insumos de Piso', subtitle: 'Stock operativo de Housekeeping y requisiciones al Almacén Central (Flujo D).' },
];

const m2Ui = {
  hkFilter: 'Todas',
};

export function renderHousekeepingModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Inspeccionada', 'Limpia', 'Completada', 'Aprobada', 'Resuelta', 'Operativo', 'Ejecutado'].includes(status)) return 'success';
    if (['En limpieza', 'En proceso', 'Pendiente', 'Asignada', 'En reparación', 'En revisión', 'Programado'].includes(status)) return 'warning';
    if (['Sucia', 'Fuera de servicio', 'Urgente', 'Alta', 'Crítica', 'Rechazada', 'Vencido'].includes(status)) return 'danger';
    return 'info';
  }

  function openCleaningModal() {
    const state = erpStore.state;
    const hkStaff = state.staff.filter((s) => s.area === 'Housekeeping');
    openModal({
      title: 'Nueva Orden de Limpieza',
      renderBody: (close) => {
        const form = cloneModal('modal-limpieza');
        const roomSel = getRef(form, 'roomId');
        const typeSel = getRef(form, 'type');
        const prioSel = getRef(form, 'priority');
        const staffSel = getRef(form, 'assignedStaffId');
        const notes = getRef(form, 'notes');

        mount(roomSel, state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number} (${rm.housekeepingStatus})`)));
        mount(staffSel, hkStaff.map((s) => h('option', { value: s.id }, s.name)));

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.createCleaningOrder({
            roomId: roomSel.value,
            type: typeSel.value,
            priority: prioSel.value,
            assignedStaffId: staffSel.value || 'stf-1',
            notes: notes.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openIncidentModal() {
    const state = erpStore.state;
    const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
    openModal({
      title: 'Reportar Incidencia de Mantenimiento',
      renderBody: (close) => {
        const form = cloneModal('modal-incidencia');
        const roomSel = getRef(form, 'roomId');
        const location = getRef(form, 'location');
        const category = getRef(form, 'category');
        const priority = getRef(form, 'priority');
        const desc = getRef(form, 'description');

        mount(
          roomSel,
          h('option', { value: '' }, 'Área común / Ninguna'),
          state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number}`))
        );
        location.value = 'Habitación 203';
        roomSel.addEventListener('change', (e) => {
          const rm = state.rooms.find((r) => r.id === e.target.value);
          if (rm) location.value = `Habitación ${rm.number}`;
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!desc.value.trim()) return;
          erpStore.createIncident({
            roomId: roomSel.value || undefined,
            location: location.value,
            category: category.value,
            priority: priority.value,
            assignedStaffId: maintStaff[0]?.id || undefined,
            description: desc.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openResolveWOModal(wo) {
    openModal({
      title: `Completar Orden de Trabajo ${wo.code}`,
      subtitle: `${wo.location} · Si proviene de un reclamo CRM (Flujo E), se marcará Resuelto automáticamente.`,
      renderBody: (close) => {
        const form = cloneModal('modal-completar-ot');
        const notes = getRef(form, 'notes');
        const parts = getRef(form, 'parts');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.completeWorkOrder(wo.id, notes.value || 'Trabajo ejecutado y validado', parts.value);
          close();
        });
        return form;
      },
    });
  }

  function openPreventiveModal() {
    const state = erpStore.state;
    const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
    openModal({
      title: 'Programar Mantenimiento Preventivo',
      renderBody: (close) => {
        const form = cloneModal('modal-preventivo');
        const assetSel = getRef(form, 'assetId');
        const freqSel = getRef(form, 'frequency');
        const nextDate = getRef(form, 'nextDueDate');
        const staffSel = getRef(form, 'responsibleStaffId');
        const checklist = getRef(form, 'checklistSummary');

        mount(assetSel, state.assets.map((a) => h('option', { value: a.id }, `${a.code} · ${a.name}`)));
        mount(staffSel, maintStaff.map((s) => h('option', { value: s.id }, s.name)));
        nextDate.value = '2026-12-05';
        checklist.value = 'Limpieza de filtros y medición eléctrica';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const asset = state.assets.find((a) => a.id === assetSel.value);
          erpStore.addPreventiveSchedule({
            assetId: assetSel.value,
            assetName: asset?.name || '',
            frequency: freqSel.value,
            nextDueDate: nextDate.value,
            responsibleStaffId: staffSel.value || 'stf-4',
            checklistSummary: checklist.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openAssetModal(editingAsset) {
    const formState = editingAsset
      ? { ...editingAsset }
      : { code: 'ACT-NEW', name: '', category: 'Climatización', location: 'Piso 2', status: 'Operativo', purchaseDate: '2026-01-15', failureRiskPct: 12, telemetryNote: 'Sin anomalías' };
    openModal({
      title: editingAsset ? `Editar Activo ${editingAsset.code}` : 'Registrar Nuevo Activo Hotelero',
      renderBody: (close) => {
        const form = cloneModal('modal-activo');
        const code = getRef(form, 'code');
        const name = getRef(form, 'name');
        const category = getRef(form, 'category');
        const location = getRef(form, 'location');
        const status = getRef(form, 'status');
        const risk = getRef(form, 'failureRiskPct');

        code.value = formState.code;
        name.value = formState.name;
        category.value = formState.category;
        location.value = formState.location;
        status.value = formState.status;
        risk.value = String(formState.failureRiskPct || 10);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!name.value.trim()) return;
          erpStore.upsertAsset({
            ...formState,
            code: code.value,
            name: name.value,
            category: category.value,
            location: location.value,
            status: status.value,
            failureRiskPct: Number(risk.value),
          });
          close();
        });
        return form;
      },
    });
  }

  function openReqModal(supply) {
    openModal({
      title: `Solicitar a Almacén (Flujo D) · ${supply.name}`,
      subtitle: 'Envía requisición directa al Módulo 03 (Almacén) para reposición.',
      renderBody: (close) => {
        const form = cloneModal('modal-requisicion');
        setText(form, 'qty-label', `Cantidad (${supply.unit})`);
        const qty = getRef(form, 'qty');
        const notes = getRef(form, 'notes');
        qty.value = String(Math.max(5, supply.minStock * 2 - supply.localStock));
        notes.value = `Reposición urgente para ${supply.name}`;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.requestSupplyFromWarehouse(supply.id, Number(qty.value), 'Housekeeping', notes.value);
          close();
        });
        return form;
      },
    });
  }

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const currentPermissions = erpStore.currentPermissions;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M2_TABS.filter((t) => erpStore.canViewTab('m2', t.id));
    const defaultTab = erpStore.getDefaultTab('m2') || visibleTabs[0]?.id || 'resumen';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m2', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m2', activeTab);
    const onlyMine = Boolean(currentPermissions?.onlyAssignedTasks);

    const staffById = new Map(state.staff.map((s) => [s.id, s]));
    const scopedCleaningOrders = onlyMine
      ? state.cleaningOrders.filter((c) => c.assignedStaffId === currentUser.assignedStaffId)
      : state.cleaningOrders;
    const scopedWorkOrders = onlyMine
      ? state.workOrders.filter((w) => w.assignedStaffId === currentUser.assignedStaffId)
      : state.workOrders;

    const dirtyRooms = state.rooms.filter((r) => r.housekeepingStatus === 'Sucia').length;
    const readyToInspect = state.rooms.filter((r) => r.housekeepingStatus === 'Limpia').length;
    const openInc = state.incidents.filter((i) => i.status !== 'Resuelta').length;
    const highRiskAssets = state.assets.filter((a) => (a.failureRiskPct || 0) >= 35).length;

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `M02 · ${M2_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        scopeSummary: currentPermissions?.scopeSummary,
        onBack: () => navigateToView('/housekeeping', defaultTab, true),
      });
    } else if (activeTab === 'resumen') {
      const { root: view } = loadViewTemplate(VIEW_HTML.resumen);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Habs. Sucias / Limpieza', value: `${dirtyRooms} / ${state.rooms.filter((r) => r.housekeepingStatus === 'En limpieza').length}`, meta: 'Sincronizado con Check-out M1', tone: dirtyRooms > 0 ? 'warning' : 'success', onClick: () => navigateToView('/housekeeping', 'limpieza') }),
        StatTile({ label: 'Por Inspeccionar', value: readyToInspect, meta: 'Habilita Check-in (Flujo B)', tone: 'teal', onClick: () => navigateToView('/housekeeping', 'inspeccion') }),
        StatTile({ label: 'Incidencias Activas', value: openInc, meta: `${state.workOrders.filter((w) => w.status !== 'Completada').length} OTs en ejecución`, tone: openInc > 0 ? 'danger' : 'success', onClick: () => navigateToView('/housekeeping', 'incidencias') }),
        StatTile({ label: 'Activos Alto Riesgo', value: highRiskAssets, meta: 'Alertas mantenimiento predictivo', tone: highRiskAssets > 0 ? 'warning' : 'default', onClick: () => navigateToView('/housekeeping', 'mant_predictivo') })
      );
      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm2-housekeeping',
          moduleName: 'Módulo 02 - Housekeeping y Mantenimiento',
          title: 'Asistente IA de Housekeeping y Mantenimiento Predictivo',
          description: 'Prioriza limpieza según check-ins próximos y analiza probabilidad de falla de equipos.',
          suggestedPrompts: [
            'Prioriza el orden óptimo de limpieza e inspección de habitaciones para desbloquear llegadas de hoy.',
            'Analiza los activos con mayor riesgo de falla y sugiere acciones preventivas para evitar habitaciones fuera de servicio.',
            'Resume las incidencias vinculadas a reclamos CRM (Flujo E).',
          ],
          contextData: {
            habitaciones: state.rooms.map((r) => ({ num: r.number, com: r.commercialStatus, hk: r.housekeepingStatus })),
            ordenesLimpieza: scopedCleaningOrders,
            incidencias: state.incidents,
            activos: state.assets,
          },
        })
      );
    } else if (activeTab === 'estado_habitaciones') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.estado_habitaciones);
      tabBody = view;
      tabBody.querySelectorAll('[data-filter]').forEach((btn) => {
        if (btn.dataset.filter === m2Ui.hkFilter) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
          m2Ui.hkFilter = btn.dataset.filter;
          renderContent();
        });
      });
      const filtered = state.rooms.filter((r) => m2Ui.hkFilter === 'Todas' || r.housekeepingStatus === m2Ui.hkFilter);
      mountRef(
        tabBody,
        'grid',
        filtered.map((rm) => {
          const card = clone('card-estado-hab');
          setText(card, 'number', `Hab. ${rm.number}`);
          mountRef(card, 'status', StatusText({ label: rm.housekeepingStatus, variant: getStatusVariant(rm.housekeepingStatus) }));
          setText(card, 'meta', `${rm.type} · Comercial: ${rm.commercialStatus}`);
          if (canEditCurrentTab) {
            setVisible(card, 'hk-select', true);
            const sel = getRef(card, 'hk-select');
            sel.value = rm.housekeepingStatus;
            sel.addEventListener('change', (e) => erpStore.updateRoomHousekeepingStatus(rm.id, e.target.value));
          }
          return card;
        })
      );
    } else if (activeTab === 'limpieza') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.limpieza);
      tabBody = view;
      setText(tabBody, 'title', onlyMine ? 'Mis Órdenes de Limpieza Asignadas' : 'Órdenes de Limpieza Operativas');
      if (canEditCurrentTab && !onlyMine) {
        setVisible(tabBody, 'new-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', openCleaningModal);
      }
      mountRef(
        tabBody,
        'tbody',
        scopedCleaningOrders.map((ord) => {
          const stf = staffById.get(ord.assignedStaffId);
          const tr = clone('fila-limpieza');
          setText(tr, 'room', `Hab. ${ord.roomNumber}`);
          setText(tr, 'type', ord.type);
          setText(tr, 'priority', `Prioridad ${ord.priority}`);
          setText(tr, 'staff', stf?.name || '—');
          setText(tr, 'origin', ord.sourceFlow || 'Manual');
          mountRef(tr, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
          if (canEditCurrentTab) {
            setVisible(tr, 'actions', true);
            if (ord.status === 'Pendiente') {
              setVisible(tr, 'start-btn', true);
              getRef(tr, 'start-btn')?.addEventListener('click', () => erpStore.advanceCleaningOrder(ord.id, 'En proceso'));
            }
            if (ord.status === 'En proceso') {
              setVisible(tr, 'finish-btn', true);
              getRef(tr, 'finish-btn')?.addEventListener('click', () => erpStore.advanceCleaningOrder(ord.id, 'Completada'));
            }
          }
          return tr;
        })
      );
    } else if (activeTab === 'inspeccion') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.inspeccion);
      tabBody = view;
      mountRef(tabBody, 'info-icon', icon('clipboardCheck', 'w-4 shrink-0'));
      const pendingInsp = state.rooms.filter((r) => r.housekeepingStatus === 'Limpia');
      if (pendingInsp.length === 0) {
        mountRef(tabBody, 'pending-slot', EmptyState({ iconName: 'clipboardCheck', title: 'Sin habitaciones pendientes de inspección', description: 'Las habitaciones aparecerán aquí cuando el personal marque su limpieza como Completada.' }));
      } else {
        mountRef(
          tabBody,
          'pending-slot',
          h(
            'div',
            { className: 'grid-2' },
            pendingInsp.map((rm) => {
              const ord = state.cleaningOrders.find((c) => c.roomId === rm.id && c.status === 'Completada');
              const checklist = {
                tendidoCama: true,
                banoDesinfectado: true,
                amenitiesReposicion: true,
                minibarVerificado: true,
                sinDanosVisibles: true,
              };
              const card = clone('card-inspeccion');
              setText(card, 'title', `Hab. ${rm.number} · ${rm.type}`);
              mountRef(card, 'badge', StatusText({ label: 'Limpia', variant: 'info' }));
              card.querySelectorAll('[data-check]').forEach((cb) => {
                cb.addEventListener('change', (e) => { checklist[cb.dataset.check] = e.target.checked; });
              });
              if (canEditCurrentTab) {
                setVisible(card, 'actions', true);
                getRef(card, 'reject-btn')?.addEventListener('click', () => erpStore.submitInspection({ roomId: rm.id, cleaningOrderId: ord?.id, checklist, result: 'Rechazada', observations: 'Requiere repaso según checklist' }));
                mountRef(card, 'check-icon', icon('check', 'w-3.5'));
                getRef(card, 'approve-btn')?.addEventListener('click', () => erpStore.submitInspection({ roomId: rm.id, cleaningOrderId: ord?.id, checklist, result: 'Aprobada', observations: 'Aprobada para check-in inmediato' }));
              }
              return card;
            })
          )
        );
      }
      mountRef(
        tabBody,
        'history-list',
        state.inspections.slice(0, 6).map((ins) => {
          const row = clone('fila-historial-inspeccion');
          setText(row, 'title', `Hab. ${ins.roomNumber} · Inspector: ${ins.inspector}`);
          setText(row, 'obs', ins.observations);
          mountRef(row, 'result', StatusText({ label: ins.result, variant: ins.result === 'Aprobada' ? 'success' : 'danger' }));
          return row;
        })
      );
    } else if (activeTab === 'incidencias') {
      const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.incidencias);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', openIncidentModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.incidents.map((inc) => {
          const tr = clone('fila-incidencia');
          setText(tr, 'code', inc.code);
          if (inc.linkedComplaintId) setVisible(tr, 'flow-e', true);
          setText(tr, 'location', `${inc.location} (${inc.category})`);
          setText(tr, 'desc', inc.description);
          mountRef(tr, 'priority', StatusText({ label: inc.priority, variant: getStatusVariant(inc.priority) }));
          mountRef(tr, 'status', StatusText({ label: inc.status, variant: getStatusVariant(inc.status) }));
          mountRef(
            tr,
            'action',
            canEditCurrentTab && (inc.status === 'Abierta' || inc.status === 'Asignada')
              ? h('button', {
                  type: 'button',
                  className: 'btn btn-teal btn-xs',
                  onClick: () => erpStore.createWorkOrderFromIncident(inc.id, inc.assignedStaffId || maintStaff[0]?.id || 'stf-4', 180, inc.description),
                }, 'Generar OT')
              : h('span', { className: 'text-11 text-slate-400' }, inc.status)
          );
          return tr;
        })
      );
    } else if (activeTab === 'mant_correctivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_correctivo);
      tabBody = view;
      setText(tabBody, 'title', onlyMine ? 'Mis Órdenes de Trabajo (Mantenimiento)' : 'Órdenes de Trabajo Correctivas');
      mountRef(
        tabBody,
        'tbody',
        scopedWorkOrders.map((wo) => {
          const tr = clone('fila-ot');
          setText(tr, 'code', wo.code);
          setText(tr, 'location', wo.location);
          setText(tr, 'desc', wo.description);
          setText(tr, 'staff', staffById.get(wo.assignedStaffId)?.name || '—');
          setText(tr, 'cost', formatCurrency(wo.estimatedCost));
          mountRef(tr, 'status', StatusText({ label: wo.status, variant: getStatusVariant(wo.status) }));
          mountRef(
            tr,
            'action',
            wo.status !== 'Completada' && canEditCurrentTab
              ? h('button', { type: 'button', className: 'btn btn-teal btn-xs', onClick: () => openResolveWOModal(wo) }, 'Completar OT')
              : h('span', { className: 'text-11 text-slate-400' }, wo.completedAt || wo.status)
          );
          return tr;
        })
      );
    } else if (activeTab === 'mant_preventivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_preventivo);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', openPreventiveModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.preventiveSchedules.map((p) => {
          const tr = clone('fila-preventivo');
          setText(tr, 'asset', p.assetName);
          setText(tr, 'frequency', p.frequency);
          setText(tr, 'date', p.nextDueDate);
          setText(tr, 'checklist', p.checklistSummary);
          mountRef(tr, 'status', StatusText({ label: p.status, variant: getStatusVariant(p.status) }));
          mountRef(
            tr,
            'action',
            p.status !== 'Ejecutado' && canEditCurrentTab
              ? h('button', { type: 'button', className: 'btn btn-teal btn-xs', onClick: () => erpStore.completePreventiveSchedule(p.id) }, 'Registrar ejecución')
              : h('span', { className: 'text-11 text-slate-400' }, p.lastCompletedDate || p.status)
          );
          return tr;
        })
      );
    } else if (activeTab === 'mant_predictivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_predictivo);
      tabBody = view;
      mountRef(
        tabBody,
        'grid',
        state.assets.map((a) => {
          const risk = a.failureRiskPct || 10;
          const card = clone('card-predictivo');
          setText(card, 'code', a.code);
          mountRef(card, 'risk', StatusText({ label: `Riesgo ${risk}%`, variant: risk >= 40 ? 'danger' : risk >= 20 ? 'warning' : 'success' }));
          setText(card, 'name', a.name);
          setText(card, 'meta', `${a.location} · ${a.category}`);
          setText(card, 'telemetry', a.telemetryNote || 'Operación nominal');
          if (canEditCurrentTab && risk >= 25) {
            setVisible(card, 'action-btn', true);
            getRef(card, 'action-btn')?.addEventListener('click', () =>
              erpStore.createIncident({
                location: a.location,
                category: 'Equipos',
                description: `[Predictivo IA] Intervención preventiva sobre ${a.name}: ${a.telemetryNote}`,
                priority: 'Alta',
              })
            );
          }
          return card;
        })
      );
    } else if (activeTab === 'activos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.activos);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', () => openAssetModal(null));
      }
      mountRef(
        tabBody,
        'tbody',
        state.assets.map((a) => {
          const tr = clone('fila-activo');
          setText(tr, 'code', a.code);
          setText(tr, 'name', a.name);
          setText(tr, 'category', a.category);
          setText(tr, 'location', a.location);
          setText(tr, 'date', a.purchaseDate);
          mountRef(tr, 'status', StatusText({ label: a.status, variant: getStatusVariant(a.status) }));
          mountRef(
            tr,
            'action',
            canEditCurrentTab ? h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openAssetModal(a) }, 'Editar') : null
          );
          return tr;
        })
      );
    } else if (activeTab === 'insumos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.insumos);
      tabBody = view;
      mountRef(
        tabBody,
        'tbody',
        state.hkSupplies.map((s) => {
          const low = s.localStock <= s.minStock;
          const tr = clone('fila-insumo');
          setText(tr, 'name', s.name);
          setText(tr, 'unit', `(${s.unit})`);
          setText(tr, 'stock', String(s.localStock));
          setText(tr, 'min-stock', String(s.minStock));
          mountRef(tr, 'status', StatusText({ label: low ? 'Stock bajo' : 'Óptimo', variant: low ? 'warning' : 'success' }));
          if (canEditCurrentTab) {
            setVisible(tr, 'actions', true);
            getRef(tr, 'consume-btn')?.addEventListener('click', () => erpStore.consumeHKSupply(s.id, 1));
            mountRef(tr, 'pkg-icon', icon('packagePlus', 'w-3'));
            getRef(tr, 'req-btn')?.addEventListener('click', () => openReqModal(s));
          }
          return tr;
        })
      );
    }

    const activeMeta = M2_TABS.find((t) => t.id === activeTab) || M2_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'MÓDULO 02 · HOUSEKEEPING Y MANTENIMIENTO',
        title: activeMeta.label,
        subtitle: activeMeta.subtitle,
        actions: canEditCurrentTab && !onlyMine
          ? h('div', { className: 'row-wrap' },
              erpStore.canEditTab('m2', 'incidencias')
                ? h('button', { type: 'button', className: 'btn btn-outline', onClick: openIncidentModal }, icon('wrench', 'w-4'), h('span', null, 'Reportar Incidencia'))
                : null,
              erpStore.canEditTab('m2', 'limpieza')
                ? h('button', { type: 'button', className: 'btn btn-primary', onClick: openCleaningModal }, icon('plus', 'w-4'), h('span', null, 'Orden Limpieza'))
                : null
            )
          : null,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
