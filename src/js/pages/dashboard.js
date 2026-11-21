import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import { formatCurrency } from '../utils/formatters.js';
import { navigate } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { TODAY } from '../data/seed-data.js';
import { ModuleAIAdvisor, ModuleHeader, StatTile, StatusText } from '../components/ui-components.js';
import { renderDonutChart, renderGroupedBarChart } from '../components/charts.js';
import dashboardHtml from '../../html/pages/dashboard.html?raw';

const cloneDashTpl = createTemplateLibrary(dashboardHtml);

const dashUi = {
  dateRange: 'hoy',
};

export function renderDashboardPage() {
  const root = parseHtmlTemplate(dashboardHtml);
  const headerSlot = getRef(root, 'header-slot');
  const kpisSlot = getRef(root, 'kpis-slot');
  const specializedSlot = getRef(root, 'specialized-slot');
  const shortcutsSlot = getRef(root, 'shortcuts-slot');
  const chartsSlot = getRef(root, 'charts-slot');
  const insightsSlot = getRef(root, 'insights-slot');
  const advisorSlot = getRef(root, 'advisor-slot');

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const currentPermissions = erpStore.currentPermissions;
    if (!state || !currentUser) return;

    const rangeFactor = dashUi.dateRange === 'hoy' ? 1 : dashUi.dateRange === '7d' ? 6.4 : 26.5;

    const totalRooms = state.rooms.length;
    const occupiedRooms = state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length;
    const occupancyPct = Math.round((occupiedRooms / Math.max(1, totalRooms)) * 100);
    const activeReservations = state.reservations.filter((r) => ['Confirmada', 'Check-in'].includes(r.status)).length;
    const arrToday = state.reservations.filter((r) => r.checkInDate === TODAY && r.status === 'Confirmada').length;
    const depToday = state.reservations.filter((r) => r.checkOutDate === TODAY && r.status === 'Check-in').length;
    const dirtyOrCleaning = state.rooms.filter((r) => r.housekeepingStatus === 'Sucia' || r.housekeepingStatus === 'En limpieza').length;
    const openIncidents = state.incidents.filter((i) => i.status !== 'Resuelta').length;
    const criticalStock = state.inventory.filter((i) => i.stock <= i.minStock).length;
    const totalRevenue = state.folios.reduce((sum, f) => sum + f.totalCharges, 0);
    const openReceivables = state.folios.reduce((sum, f) => sum + f.balance, 0) + state.receivables.reduce((sum, r) => sum + r.pendingAmount, 0);
    const openComplaints = state.complaints.filter((c) => c.status !== 'Resuelto').length;
    const avgSatisfaction =
      state.surveys.length > 0
        ? (state.surveys.reduce((s, r) => s + r.overallScore, 0) / state.surveys.length).toFixed(1)
        : '4.6';
    const adr =
      occupiedRooms > 0
        ? Math.round(state.rooms.filter((r) => r.commercialStatus === 'Ocupada').reduce((s, r) => s + r.baseRate, 0) / occupiedRooms)
        : 390;

    const revenueExpenseData = [
      { name: 'Alojamiento', ingresos: Math.round(6420 * rangeFactor), gastos: Math.round(1450 * rangeFactor) },
      { name: 'Restaurante/POS', ingresos: Math.round(1890 * rangeFactor), gastos: Math.round(740 * rangeFactor) },
      { name: 'Room Service', ingresos: Math.round(640 * rangeFactor), gastos: Math.round(210 * rangeFactor) },
      { name: 'Servicios/Spa', ingresos: Math.round(1120 * rangeFactor), gastos: Math.round(310 * rangeFactor) },
      { name: 'Minibar', ingresos: Math.round(320 * rangeFactor), gastos: Math.round(125 * rangeFactor) },
    ];

    const roomDistribution = [
      { name: 'Ocupadas', value: state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length, color: '#0B1F3A' },
      { name: 'Disponibles / Limpias', value: state.rooms.filter((r) => r.commercialStatus === 'Disponible' && ['Inspeccionada', 'Limpia'].includes(r.housekeepingStatus)).length, color: '#0D9488' },
      { name: 'Sucias / Limpieza', value: state.rooms.filter((r) => ['Sucia', 'En limpieza'].includes(r.housekeepingStatus)).length, color: '#D97706' },
      { name: 'Bloqueadas / Mant.', value: state.rooms.filter((r) => r.housekeepingStatus === 'Fuera de servicio').length, color: '#DC2626' },
    ];

    const canM1 = erpStore.canView('m1');
    const canM2 = erpStore.canView('m2');
    const canM3 = erpStore.canView('m3');
    const canM4 = erpStore.canView('m4');
    const canM5 = erpStore.canView('m5');
    const canConfig = erpStore.canView('config');

    const role = currentUser.role;
    const isAdminOrExec = ['admin', 'gerente_finanzas', 'jefe_finanzas', 'auditor'].includes(role);
    const isFinancialRole = ['admin', 'cajero', 'costos', 'jefe_finanzas', 'gerente_finanzas', 'auditor'].includes(role);
    const isOpsFrontRole = ['admin', 'recepcionista', 'supervisor_hk', 'atencion', 'comercial', 'auditor'].includes(role);

    const kpis = [];
    if (canM1 && isOpsFrontRole) {
      kpis.push(StatTile({ label: 'Ocupación actual', value: `${occupancyPct}%`, meta: `${occupiedRooms} de ${totalRooms} habitaciones ocupadas · ADR ${formatCurrency(adr)}`, tone: 'teal', onClick: () => navigate('/reservas/ocupacion') }));
    }
    if (canM1 && ['admin', 'recepcionista', 'atencion', 'comercial'].includes(role)) {
      kpis.push(StatTile({ label: 'Reservas activas / Hoy', value: String(activeReservations), meta: `${arrToday} llegadas · ${depToday} salidas previstas`, onClick: () => navigate('/reservas/reservas') }));
    }
    if (canM2) {
      kpis.push(StatTile({ label: 'Limpieza e incidencias', value: `${dirtyOrCleaning} / ${openIncidents}`, meta: `${dirtyOrCleaning} habs. por limpiar · ${openIncidents} incidencias`, tone: openIncidents > 2 ? 'warning' : 'default', onClick: () => navigate('/housekeeping') }));
    }
    if (canM3) {
      kpis.push(StatTile({ label: 'Alertas de inventario', value: String(criticalStock), meta: `${state.supplyRequisitions.filter((r) => r.status === 'Solicitada').length} req. pendientes de almacén`, tone: criticalStock > 0 ? 'warning' : 'success', onClick: () => navigate('/servicios/inventario') }));
    }
    if (canM4 && isFinancialRole) {
      kpis.push(StatTile({ label: 'Ingresos y CxC', value: formatCurrency(totalRevenue), meta: `Saldo por cobrar: ${formatCurrency(openReceivables)}`, tone: 'teal', onClick: () => navigate('/finanzas') }));
    }
    if (canM5) {
      kpis.push(StatTile({ label: 'Reclamos y Satisfacción', value: `${openComplaints} / ${avgSatisfaction}★`, meta: `${openComplaints} reclamos abiertos · Promedio encuestas`, tone: openComplaints > 0 ? 'danger' : 'success', onClick: () => navigate('/crm/reclamos') }));
    }

    const myCleaningOrders = state.cleaningOrders.filter((c) => (!currentPermissions?.onlyAssignedTasks || c.assignedStaffId === currentUser.assignedStaffId) && c.status !== 'Inspeccionada');
    const myWorkOrders = state.workOrders.filter((w) => (!currentPermissions?.onlyAssignedTasks || w.assignedStaffId === currentUser.assignedStaffId) && w.status !== 'Completada');
    const activeShift = state.cashShifts.find((c) => c.status === 'Abierta');

    const specializedCards = [];
    if (role === 'limpieza') {
      const card = cloneDashTpl('card-limpieza');
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/housekeeping/limpieza'));
      mountRef(
        card,
        'list',
        myCleaningOrders.length === 0
          ? h('p', { className: 'text-xs text-slate-500' }, 'No tienes órdenes pendientes en este turno.')
          : myCleaningOrders.map((ord) => {
              const row = cloneDashTpl('limpieza-item');
              setText(row, 'room', `Hab. ${ord.roomNumber}`);
              setText(row, 'meta', `${ord.type} · ${ord.priority}`);
              mountRef(row, 'status', StatusText({ label: ord.status, variant: ord.status === 'Completada' ? 'success' : 'warning' }));
              return row;
            })
      );
      specializedCards.push(card);
    }

    if (role === 'tecnico') {
      const card = cloneDashTpl('card-tecnico');
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/housekeeping/mant-correctivo'));
      mountRef(
        card,
        'list',
        myWorkOrders.length === 0
          ? h('p', { className: 'text-xs text-slate-500' }, 'Sin órdenes de trabajo abiertas asignadas.')
          : myWorkOrders.map((wo) => {
              const row = cloneDashTpl('tecnico-item');
              setText(row, 'code', `${wo.code} · ${wo.location}`);
              mountRef(row, 'priority', StatusText({ label: wo.priority, variant: wo.priority === 'Urgente' ? 'danger' : 'warning' }));
              setText(row, 'description', wo.description);
              return row;
            })
      );
      specializedCards.push(card);
    }

    if (role === 'cajero') {
      const card = cloneDashTpl('card-cajero');
      setText(card, 'title', activeShift ? 'Turno de caja activo' : 'Caja cerrada actualmente');
      setText(
        card,
        'subtitle',
        activeShift
          ? `Saldo esperado en caja: ${formatCurrency(activeShift.expectedBalance)} · ${state.folios.filter((f) => f.balance > 0).length} folios con saldo pendiente.`
          : 'Abre tu turno de caja en Finanzas para comenzar a recibir cobros.'
      );
      getRef(card, 'pay-btn')?.addEventListener('click', () => navigate('/finanzas/pagos'));
      getRef(card, 'cash-btn')?.addEventListener('click', () => navigate('/finanzas/caja'));
      specializedCards.push(card);
    }

    if (role === 'auditor') {
      const card = cloneDashTpl('card-auditor');
      setText(card, 'subtitle', `${state.auditLog.length} eventos trazados · Auditoría operativa y segregación RBAC.`);
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/configuracion/auditoria'));
      specializedCards.push(card);
    }

    const shortcutDefs = [
      { mod: 'm1', path: '/reservas', iconName: 'calendar', title: 'M01 · Reservas', desc: `${activeReservations} reservas · ${arrToday} llegadas` },
      { mod: 'm2', path: '/housekeeping', iconName: 'sparkles', title: 'M02 · Housekeeping', desc: `${dirtyOrCleaning} habs. · ${openIncidents} incidencias` },
      { mod: 'm3', path: '/servicios', iconName: 'utensils', title: 'M03 · POS y Almacén', desc: `${state.posOrders.filter((o) => o.status !== 'Entregado').length} pedidos · ${criticalStock} bajo mín.` },
      { mod: 'm4', path: '/finanzas', iconName: 'receipt', title: 'M04 · Finanzas', desc: `Cobrado ${formatCurrency(state.folios.reduce((s, f) => s + f.totalPayments, 0))}` },
      { mod: 'm5', path: '/crm', iconName: 'heart', title: 'M05 · CRM Huésped', desc: `${state.guests.length} perfiles · ${openComplaints} reclamos` },
    ].filter((s) => erpStore.canView(s.mod));

    let chartsSection = null;
    if ((canM4 && isFinancialRole) || (canM1 && isOpsFrontRole)) {
      chartsSection = cloneDashTpl('charts-section');
      const showFin = canM4 && isFinancialRole;
      const showRooms = canM1 && isOpsFrontRole;
      if (showFin) {
        const finCard = getRef(chartsSection, 'finance-card');
        finCard.classList.remove('hidden');
        finCard.classList.add(showRooms ? 'col-span-2-lg' : 'col-span-3-lg');
        mountRef(
          chartsSection,
          'finance-chart',
          renderGroupedBarChart({
            data: revenueExpenseData,
            labelKey: 'name',
            series: [
              { key: 'ingresos', name: 'Ingresos', color: '#0B1F3A' },
              { key: 'gastos', name: 'Costos / Gastos', color: '#0D9488' },
            ],
            formatValue: (v) => formatCurrency(v),
            height: 240,
          })
        );
      }
      if (showRooms) {
        const rmCard = getRef(chartsSection, 'rooms-card');
        rmCard.classList.remove('hidden');
        if (!showFin) rmCard.classList.add('col-span-3-lg');
        setText(chartsSection, 'rooms-subtitle', `Sincronización M1 ↔ M2 (${totalRooms} uds.)`);
        mountRef(chartsSection, 'rooms-chart', renderDonutChart({ data: roomDistribution, unit: 'habs.', size: 184 }));
        mountRef(
          chartsSection,
          'rooms-legend',
          roomDistribution.map((d) => {
            const item = cloneDashTpl('legend-item');
            const swatch = getRef(item, 'swatch');
            if (swatch) swatch.style.backgroundColor = d.color;
            setText(item, 'label', d.name);
            setText(item, 'value', String(d.value));
            return item;
          })
        );
      }
    }

    const aiAlerts = [];
    if (canM1) aiAlerts.push({ mod: 'Tarifas M1', detail: 'Demanda proyectada 89% este fin de semana: conviene ajustar +10% tarifas Suite Ocean.', actionLabel: 'Revisar Tarifas', to: '/reservas/tarifas' });
    if (canM3 && criticalStock > 0) aiAlerts.push({ mod: 'Almacén M3', detail: `${criticalStock} insumos críticos por debajo del stock mínimo. Revisar reposición sugerida.`, actionLabel: 'Ver Almacén', to: '/servicios/inventario' });
    if (canM2 && openIncidents > 0) aiAlerts.push({ mod: 'Mant. M2', detail: `${openIncidents} incidencias activas con riesgo de afectar check-ins del día.`, actionLabel: 'Ver Incidencias', to: '/housekeeping/incidencias' });
    if (canM5 && openComplaints > 0) aiAlerts.push({ mod: 'CRM M5', detail: `${openComplaints} reclamos abiertos requieren seguimiento de cierre para proteger NPS.`, actionLabel: 'Ver Reclamos', to: '/crm/reclamos' });

    const insightsGrid = cloneDashTpl('insights-section');
    mountRef(insightsGrid, 'ai-icon', icon('sparkles', 'w-4 text-teal'));
    mountRef(
      insightsGrid,
      'alerts-list',
      aiAlerts.map((a) => {
        const row = cloneDashTpl('ai-alert-row');
        setText(row, 'mod', a.mod);
        setText(row, 'detail', a.detail);
        const btn = getRef(row, 'action-btn');
        if (btn) {
          btn.textContent = a.actionLabel;
          btn.addEventListener('click', () => navigate(a.to));
        }
        return row;
      })
    );
    mountRef(
      insightsGrid,
      'activity-list',
      state.notifications.slice(0, 5).map((n) => {
        const row = cloneDashTpl('activity-row');
        if (n.flowTag) {
          setText(row, 'tag', n.flowTag);
          setVisible(row, 'tag', true);
        }
        setText(row, 'title', n.title);
        setText(row, 'message', n.message);
        setText(row, 'time', n.timestamp.slice(11));
        return row;
      })
    );

    const advisor = isAdminOrExec
      ? ModuleAIAdvisor({
          moduleId: 'dashboard-exec',
          moduleName: 'Dashboard Ejecutivo SGH-ERP',
          title: 'Asistente Analítico Ejecutivo con IA',
          description: 'Consulta proyecciones de ingresos, cuellos de botella entre módulos y recomendaciones estratégicas.',
          suggestedPrompts: [
            '¿Cuál es la situación operativa y financiera general de hoy y qué 3 acciones prioritarias recomiendas?',
            'Analiza el impacto de las habitaciones sucias/incidencias sobre los check-ins del día.',
            'Resume los riesgos de inventario, cuentas por cobrar y reclamos abiertos.',
          ],
          contextData: {
            ocupacionPct: occupancyPct,
            habitacionesOcupadas: occupiedRooms,
            totalHabitaciones: totalRooms,
            llegadasHoy: arrToday,
            salidasHoy: depToday,
            ingresosFolios: totalRevenue,
            saldoPorCobrar: openReceivables,
            stockCritico: criticalStock,
            incidenciasAbiertas: openIncidents,
            reclamosAbiertos: openComplaints,
          },
        })
      : null;

    const actions = cloneDashTpl('header-actions');
    actions.querySelectorAll('[data-range]').forEach((btn) => {
      if (btn.dataset.range === dashUi.dateRange) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        dashUi.dateRange = btn.dataset.range;
        renderContent();
      });
    });
    if (canConfig) {
      setVisible(actions, 'config-btn', true);
      mountRef(actions, 'config-icon', icon('shieldCheck', 'w-4 text-teal'));
      getRef(actions, 'config-btn')?.addEventListener('click', () => navigate('/configuracion'));
    }

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: `Bienvenido, ${currentUser.name} · ${currentUser.roleLabel}`,
        title: 'Dashboard General Hotelero',
        subtitle: currentPermissions?.scopeSummary || 'Vista operativa integrada SGH-ERP',
        actions,
      })
    );
    mount(kpisSlot, kpis);
    mount(specializedSlot, specializedCards);
    if (shortcutDefs.length > 0) {
      shortcutsSlot.classList.remove('hidden');
      mount(
        shortcutsSlot,
        shortcutDefs.map((s) => {
          const card = cloneDashTpl('shortcut-card');
          mountRef(card, 'icon', icon(s.iconName, 'w-4 text-teal'));
          mountRef(card, 'arrow', icon('arrowRight', 'w-3.5 text-slate-400'));
          setText(card, 'title', s.title);
          setText(card, 'desc', s.desc);
          card.addEventListener('click', () => navigate(s.path));
          return card;
        })
      );
    } else {
      shortcutsSlot.classList.add('hidden');
      shortcutsSlot.replaceChildren();
    }
    mount(chartsSlot, chartsSection);
    mount(insightsSlot, insightsGrid);
    mount(advisorSlot, advisor);
  }

  renderContent();
  return root;
}
