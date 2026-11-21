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
import modalesHtml from '../../html/modules/reservas/modales.html?raw';
import resumenHtml from '../../html/modules/reservas/resumen.html?raw';
import reservasHtml from '../../html/modules/reservas/reservas.html?raw';
import checkinHtml from '../../html/modules/reservas/checkin.html?raw';
import checkoutHtml from '../../html/modules/reservas/checkout.html?raw';
import habitacionesHtml from '../../html/modules/reservas/habitaciones.html?raw';
import tarifasHtml from '../../html/modules/reservas/tarifas.html?raw';
import listaEsperaHtml from '../../html/modules/reservas/lista-espera.html?raw';
import disponibilidadHtml from '../../html/modules/reservas/disponibilidad.html?raw';
import ocupacionHtml from '../../html/modules/reservas/ocupacion.html?raw';
import huespedesHtml from '../../html/modules/reservas/huespedes.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { maskDocument, maskEmail, maskPhone } from '../data/rbac.js';
import { TODAY } from '../data/seed-data.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  SearchInput,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';
import { renderStackedBarChart } from '../components/charts.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  resumen: resumenHtml,
  reservas: reservasHtml,
  checkin: checkinHtml,
  checkout: checkoutHtml,
  habitaciones: habitacionesHtml,
  tarifas: tarifasHtml,
  lista_espera: listaEsperaHtml,
  disponibilidad: disponibilidadHtml,
  ocupacion: ocupacionHtml,
  huespedes: huespedesHtml,
};

const M1_TABS = [
  { id: 'resumen', label: 'Resumen Ejecutivo', subtitle: 'KPIs de recepción, llegadas previstas (Flujo A), riesgo de no-show e IA.' },
  { id: 'reservas', label: 'Gestión de Reservas', subtitle: 'Control integral de reservas, estados, canales e historial operativo.' },
  { id: 'checkin', label: 'Registro Check-in', subtitle: 'Ingreso con bloqueo automático si Housekeeping reporta habitación no lista (Flujo A).' },
  { id: 'checkout', label: 'Registro Check-out', subtitle: 'Validación de Folio (Flujo F) y disparo automático de limpieza (Flujo B).' },
  { id: 'habitaciones', label: 'Inventario de Habitaciones', subtitle: 'Estado comercial vs. estado físico sincronizado con Housekeeping.' },
  { id: 'tarifas', label: 'Tarifas y Temporadas', subtitle: 'Planes tarifarios por categoría y precios dinámicos asistidos por IA.' },
  { id: 'lista_espera', label: 'Sobreventa y Lista de Espera', subtitle: 'Resolución autorizada de conflictos de fechas y solicitudes en espera.' },
  { id: 'disponibilidad', label: 'Calendario de Disponibilidad', subtitle: 'Disponibilidad real con bloqueos físicos de Mantenimiento (M2).' },
  { id: 'ocupacion', label: 'Análisis de Ocupación', subtitle: 'Comparativa gráfica de unidades ocupadas, libres y bloqueadas por categoría.' },
  { id: 'huespedes', label: 'Directorio de Huéspedes', subtitle: 'Registro y edición de perfiles con protección de datos personales.' },
];

const m1Ui = {
  search: '',
  statusFilter: 'Todas',
  roomFloorFilter: 'Todos',
  occupancyTypeFilter: 'Todos',
  checkInRoomOverride: {},
};

export function renderReservasModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (status === 'Confirmada' || status === 'Check-in' || status === 'Disponible' || status === 'Inspeccionada' || status === 'Resuelta') return 'success';
    if (status === 'Pendiente' || status === 'Sucia' || status === 'En limpieza' || status === 'Reservada') return 'warning';
    if (status === 'Cancelada' || status === 'No-Show' || status === 'Fuera de servicio' || status === 'Bloqueada') return 'danger';
    return 'info';
  }

  function openRoomModal(editingRoom) {
    const formState = editingRoom
      ? { ...editingRoom }
      : {
          number: '',
          floor: 2,
          type: 'Doble Superior',
          capacity: 2,
          baseRate: 340,
          commercialStatus: 'Disponible',
          housekeepingStatus: 'Inspeccionada',
          amenities: ['Wi-Fi 6', 'Smart TV', 'Aire Acondicionado'],
        };

    openModal({
      title: editingRoom ? `Editar Habitación ${editingRoom.number}` : 'Registrar Nueva Habitación',
      subtitle: 'La disponibilidad comercial y física se sincroniza con Módulo 02 (Housekeeping).',
      renderBody: (close) => {
        const form = cloneModal('modal-habitacion');
        const num = getRef(form, 'number');
        const floor = getRef(form, 'floor');
        const type = getRef(form, 'type');
        const cap = getRef(form, 'capacity');
        const rate = getRef(form, 'baseRate');
        const hk = getRef(form, 'hkStatus');
        const amenities = getRef(form, 'amenities');

        num.value = formState.number;
        floor.value = String(formState.floor);
        type.value = formState.type;
        cap.value = String(formState.capacity);
        rate.value = String(formState.baseRate);
        hk.value = formState.housekeepingStatus;
        amenities.value = (formState.amenities || []).join(', ');

        setText(form, 'submit-btn', editingRoom ? 'Guardar cambios' : 'Registrar habitación');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          formState.number = num.value;
          formState.floor = Number(floor.value);
          formState.type = type.value;
          formState.capacity = Number(cap.value);
          formState.baseRate = Number(rate.value);
          formState.housekeepingStatus = hk.value;
          formState.amenities = amenities.value.split(',').map((s) => s.trim()).filter(Boolean);
          if (!formState.number.trim()) return;
          erpStore.upsertRoom(formState);
          close();
        });
        return form;
      },
    });
  }

  function openReservationModal() {
    const state = erpStore.state;
    if (!state) return;
    const defaultRoom = state.rooms.find((r) => r.commercialStatus === 'Disponible') || state.rooms[0];
    const formState = {
      guestId: state.guests[0]?.id || '',
      roomId: defaultRoom?.id || '',
      checkInDate: TODAY,
      checkOutDate: '2026-11-23',
      adults: 2,
      children: 0,
      channel: 'Web Directa',
      nightlyRate: defaultRoom?.baseRate || 340,
      specialRequests: '',
    };

    openModal({
      title: 'Nueva Reserva de Alojamiento',
      subtitle: 'Valida automáticamente cruces de fechas. Si hay conflicto, deriva a Sobreventa / Lista de Espera.',
      size: 'lg',
      renderBody: (close) => {
        const form = cloneModal('modal-reserva');
        const guestSel = getRef(form, 'guestId');
        const roomSel = getRef(form, 'roomId');
        const inDate = getRef(form, 'checkInDate');
        const outDate = getRef(form, 'checkOutDate');
        const channel = getRef(form, 'channel');
        const rate = getRef(form, 'nightlyRate');
        const adults = getRef(form, 'adults');
        const children = getRef(form, 'children');
        const reqs = getRef(form, 'specialRequests');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id, selected: formState.guestId === g.id }, `${g.fullName} (${g.loyaltyTier})`)));
        mount(roomSel, state.rooms.map((rm) => h('option', { value: rm.id, selected: formState.roomId === rm.id }, `Hab. ${rm.number} · ${rm.type} (${rm.commercialStatus} / ${rm.housekeepingStatus})`)));

        inDate.value = formState.checkInDate;
        outDate.value = formState.checkOutDate;
        channel.value = formState.channel;
        rate.value = String(formState.nightlyRate);
        adults.value = String(formState.adults);
        children.value = String(formState.children);

        roomSel.addEventListener('change', (e) => {
          const rm = state.rooms.find((r) => r.id === e.target.value);
          if (rm) rate.value = String(rm.baseRate);
        });
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.createReservation({
            guestId: guestSel.value,
            roomId: roomSel.value,
            checkInDate: inDate.value,
            checkOutDate: outDate.value,
            adults: Number(adults.value),
            children: Number(children.value),
            channel: channel.value,
            nightlyRate: Number(rate.value),
            specialRequests: reqs.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openHistoryModal(res) {
    const state = erpStore.state;
    const guest = state?.guests.find((g) => g.id === res.guestId);
    openModal({
      title: `Historial de Reserva ${res.code}`,
      subtitle: `${guest?.fullName || 'Huésped'} · ${res.checkInDate} → ${res.checkOutDate}`,
      renderBody: () =>
        h(
          'div',
          { className: 'stack-sm' },
          res.history.map((hItem) =>
            h('div', { className: 'p-3 border rounded-md row-between items-start' },
              h('div', null,
                h('div', { className: 'text-xs font-semibold text-navy' }, hItem.action),
                h('div', { className: 'text-11 text-slate-500 mt-0.5' }, `Usuario: ${hItem.user}`)
              ),
              h('span', { className: 'font-mono text-11 text-slate-400' }, hItem.timestamp)
            )
          )
        ),
    });
  }

  function openRateModal(rp) {
    const formState = rp
      ? { id: rp.id, name: rp.name, roomType: rp.roomType, season: rp.season, startDate: rp.startDate, endDate: rp.endDate, price: rp.price, active: rp.active, reason: '' }
      : { name: 'Tarifa Temporada Especial', roomType: 'Doble Superior', season: 'Alta', startDate: TODAY, endDate: '2026-12-31', price: 360, active: true, reason: 'Creación inicial' };

    openModal({
      title: rp ? `Editar Tarifa · ${rp.roomType}` : 'Nuevo Plan Tarifario',
      subtitle: 'Los cambios actualizan la tarifa base de las habitaciones del tipo seleccionado.',
      renderBody: (close) => {
        const form = cloneModal('modal-tarifa');
        const name = getRef(form, 'name');
        const roomType = getRef(form, 'roomType');
        const season = getRef(form, 'season');
        const price = getRef(form, 'price');
        const startDate = getRef(form, 'startDate');
        const endDate = getRef(form, 'endDate');
        const reason = getRef(form, 'reason');

        name.value = formState.name;
        roomType.value = formState.roomType;
        season.value = formState.season;
        price.value = String(formState.price);
        startDate.value = formState.startDate;
        endDate.value = formState.endDate;
        reason.value = formState.reason;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.upsertRatePlan({
            ...formState,
            name: name.value,
            roomType: roomType.value,
            season: season.value,
            price: Number(price.value),
            startDate: startDate.value,
            endDate: endDate.value,
            reason: reason.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openGuestModal(editingGuest) {
    const formState = editingGuest
      ? { ...editingGuest, preferences: [...editingGuest.preferences] }
      : {
          fullName: '',
          documentType: 'DNI',
          documentNumber: '',
          nationality: 'Peruana',
          email: '',
          phone: '',
          company: '',
          segment: 'Vacacional',
          loyaltyTier: 'Bronze',
          loyaltyPoints: 100,
          preferences: [],
          privacyConsentISO27701: true,
          marketingOptIn: false,
          consentDate: TODAY,
          notes: '',
        };

    openModal({
      title: editingGuest ? `Editar Huésped · ${editingGuest.fullName}` : 'Registrar Nuevo Huésped',
      subtitle: 'Control de privacidad y minimización de datos personales del huésped.',
      size: 'lg',
      renderBody: (close) => {
        const form = cloneModal('modal-huesped');
        const fullName = getRef(form, 'fullName');
        const documentType = getRef(form, 'documentType');
        const documentNumber = getRef(form, 'documentNumber');
        const nationality = getRef(form, 'nationality');
        const email = getRef(form, 'email');
        const phone = getRef(form, 'phone');
        const segment = getRef(form, 'segment');
        const company = getRef(form, 'company');
        const preferences = getRef(form, 'preferences');
        const privacy = getRef(form, 'privacyConsentISO27701');
        const optIn = getRef(form, 'marketingOptIn');

        fullName.value = formState.fullName;
        documentType.value = formState.documentType;
        documentNumber.value = formState.documentNumber;
        nationality.value = formState.nationality;
        email.value = formState.email;
        phone.value = formState.phone;
        segment.value = formState.segment;
        company.value = formState.company || '';
        preferences.value = formState.preferences.join(', ');
        privacy.checked = Boolean(formState.privacyConsentISO27701);
        optIn.checked = Boolean(formState.marketingOptIn);

        setText(form, 'submit-btn', editingGuest ? 'Actualizar huésped' : 'Registrar huésped');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!fullName.value.trim()) return;
          erpStore.upsertGuest({
            ...formState,
            fullName: fullName.value,
            documentType: documentType.value,
            documentNumber: documentNumber.value,
            nationality: nationality.value,
            email: email.value,
            phone: phone.value,
            segment: segment.value,
            company: company.value,
            preferences: preferences.value.split(',').map((s) => s.trim()).filter(Boolean),
            privacyConsentISO27701: privacy.checked,
            marketingOptIn: optIn.checked,
          });
          close();
        });
        return form;
      },
    });
  }

  function openWaitlistModal() {
    openModal({
      title: 'Nuevo Registro en Sobreventa / Lista de Espera',
      renderBody: (close) => {
        const form = cloneModal('modal-espera');
        const guestName = getRef(form, 'guestName');
        const contact = getRef(form, 'contact');
        const roomType = getRef(form, 'roomType');
        const conflictType = getRef(form, 'conflictType');
        const checkInDate = getRef(form, 'checkInDate');
        const checkOutDate = getRef(form, 'checkOutDate');

        roomType.value = 'Suite Ocean';
        checkInDate.value = TODAY;
        checkOutDate.value = '2026-11-23';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guestName.value.trim()) return;
          erpStore.createWaitlistEntry({
            guestName: guestName.value,
            contact: contact.value,
            roomType: roomType.value,
            conflictType: conflictType.value,
            checkInDate: checkInDate.value,
            checkOutDate: checkOutDate.value,
          });
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
    const canViewFullPII = erpStore.canViewFullPII;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M1_TABS.filter((t) => erpStore.canViewTab('m1', t.id));
    const defaultTab = erpStore.getDefaultTab('m1') || visibleTabs[0]?.id || 'resumen';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m1', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m1', activeTab);

    const kpiData = {
      occupied: state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length,
      total: state.rooms.length,
      arrivalsToday: state.reservations.filter((r) => r.checkInDate === TODAY && r.status === 'Confirmada').length,
      departuresToday: state.reservations.filter((r) => r.checkOutDate === TODAY && r.status === 'Check-in').length,
      readyToCheckIn: state.rooms.filter((r) => r.commercialStatus === 'Disponible' && (r.housekeepingStatus === 'Inspeccionada' || r.housekeepingStatus === 'Limpia')).length,
      waitlistPending: state.waitlist.filter((w) => w.status === 'Pendiente').length,
    };

    const guestById = new Map(state.guests.map((g) => [g.id, g]));
    const roomById = new Map(state.rooms.map((r) => [r.id, r]));
    const folioByResId = new Map(state.folios.map((f) => [f.reservationId, f]));

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `M01 · ${M1_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        scopeSummary: currentPermissions?.scopeSummary,
        onBack: () => navigateToView('/reservas', defaultTab, true),
      });
    } else if (activeTab === 'resumen') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.resumen);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Ocupación Actual', value: `${Math.round((kpiData.occupied / Math.max(1, kpiData.total)) * 100)}%`, meta: `${kpiData.occupied} / ${kpiData.total} ocupadas`, tone: 'teal', onClick: () => navigateToView('/reservas', 'ocupacion') }),
        StatTile({ label: 'Llegadas Previstas Hoy', value: kpiData.arrivalsToday, meta: 'Reservas listas para Check-in', onClick: () => navigateToView('/reservas', 'checkin') }),
        StatTile({ label: 'Salidas Previstas Hoy', value: kpiData.departuresToday, meta: 'Validación de folio (Flujo F)', onClick: () => navigateToView('/reservas', 'checkout') }),
        StatTile({ label: 'Habs. Listas / Lista Espera', value: `${kpiData.readyToCheckIn} / ${kpiData.waitlistPending}`, meta: 'Sincronizado con Housekeeping', tone: kpiData.waitlistPending > 0 ? 'warning' : 'success', onClick: () => navigateToView('/reservas', 'disponibilidad') })
      );
      mountRef(
        tabBody,
        'arrivals-list',
        state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente').slice(0, 4).map((r) => {
          const g = guestById.get(r.guestId);
          const rm = roomById.get(r.roomId);
          const hkReady = rm && (rm.housekeepingStatus === 'Inspeccionada' || rm.housekeepingStatus === 'Limpia');
          const row = clone('fila-resumen-simple');
          setText(row, 'title', `${r.code} · ${g?.fullName || ''}`);
          setText(row, 'subtitle', `Hab. ${rm?.number || '—'} (${rm?.housekeepingStatus || ''}) · ${r.checkInDate} → ${r.checkOutDate}`);
          mountRef(
            row,
            'right',
            canEditCurrentTab
              ? h('button', { type: 'button', className: `btn btn-xs ${hkReady ? 'btn-teal' : 'btn-outline'}`, onClick: () => navigateToView('/reservas', 'checkin') }, hkReady ? 'Procesar Check-in' : 'Revisar Hab.')
              : StatusText({ label: rm?.housekeepingStatus || '—', variant: hkReady ? 'success' : 'warning' })
          );
          return row;
        })
      );
      mountRef(
        tabBody,
        'noshow-list',
        state.reservations.filter((r) => r.status === 'Confirmada').map((r) => {
          const g = guestById.get(r.guestId);
          const risk = r.noShowRisk || 12;
          const row = clone('fila-resumen-simple');
          setText(row, 'title', `${r.code} · ${g?.fullName || ''}`);
          setText(row, 'subtitle', `Canal: ${r.channel} · ${formatCurrency(r.totalAmount)}`);
          mountRef(row, 'right', StatusText({ label: `Riesgo ${risk}%`, variant: risk >= 25 ? 'danger' : risk >= 15 ? 'warning' : 'success' }));
          return row;
        })
      );
      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm1-reservas',
          moduleName: 'Módulo 01 - Reservas y Recepción',
          title: 'Asistente IA de Revenue & Recepción',
          description: 'Análisis de tarifa dinámica, riesgo de no-show y optimización de asignaciones.',
          suggestedPrompts: [
            '¿Qué ajustes de tarifa dinámica recomiendas según la ocupación actual por tipo de habitación?',
            'Evalúa las reservas con mayor riesgo de no-show y sugiere acciones preventivas.',
            'Analiza conflictos en lista de espera y qué habitaciones podrían liberarse.',
          ],
          contextData: {
            kpi: kpiData,
            tarifas: state.ratePlans.map((r) => ({ tipo: r.roomType, precio: r.price, temporada: r.season })),
            reservas: state.reservations.map((r) => ({ code: r.code, status: r.status, channel: r.channel, noShowRisk: r.noShowRisk })),
            waitlist: state.waitlist,
          },
        })
      );
    } else if (activeTab === 'reservas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reservas);
      tabBody = view;
      const tableWrap = getRef(tabBody, 'table-wrap');

      const renderReservasRows = () => {
        const q = m1Ui.search.trim().toLowerCase();
        const filtered = state.reservations.filter((r) => {
          const g = guestById.get(r.guestId);
          const rm = roomById.get(r.roomId);
          const matchStatus = m1Ui.statusFilter === 'Todas' || r.status === m1Ui.statusFilter;
          const matchSearch =
            !q ||
            r.code.toLowerCase().includes(q) ||
            (g?.fullName || '').toLowerCase().includes(q) ||
            (rm?.number || '').includes(q);
          return matchStatus && matchSearch;
        });

        if (filtered.length === 0) {
          mount(tableWrap, EmptyState({ iconName: 'calendar', title: 'Sin reservas coincidentes', description: 'Prueba otro filtro de estado o búsqueda.' }));
          return;
        }
        const tbl = clone('tabla-reservas');
        mountRef(
          tbl,
          'tbody',
          filtered.map((r) => {
            const g = guestById.get(r.guestId);
            const rm = roomById.get(r.roomId);
            const tr = clone('fila-reserva');
            setText(tr, 'code', r.code);
            setText(tr, 'guest', g?.fullName || '—');
            setText(tr, 'pax', `${r.adults} ad. ${r.children > 0 ? `+ ${r.children} niñ.` : ''}`);
            setText(tr, 'room', rm ? `${rm.number} (${rm.type})` : '—');
            setText(tr, 'stay', `${r.checkInDate} → ${r.checkOutDate} (${r.nights}n)`);
            setText(tr, 'channel', r.channel);
            setText(tr, 'total', formatCurrency(r.totalAmount));
            mountRef(tr, 'status', StatusText({ label: r.status, variant: getStatusVariant(r.status) }));

            const histBtn = getRef(tr, 'history-btn');
            if (histBtn) {
              mount(histBtn, icon('history', 'w-3'));
              histBtn.addEventListener('click', () => openHistoryModal(r));
            }
            if (canEditCurrentTab && (r.status === 'Confirmada' || r.status === 'Pendiente')) {
              setVisible(tr, 'cancel-btn', true);
              getRef(tr, 'cancel-btn')?.addEventListener('click', () => erpStore.updateReservationStatus(r.id, 'Cancelada', 'Cancelada desde Recepción'));
            }
            if (canEditCurrentTab && r.status === 'Confirmada') {
              setVisible(tr, 'noshow-btn', true);
              getRef(tr, 'noshow-btn')?.addEventListener('click', () => erpStore.updateReservationStatus(r.id, 'No-Show', 'Marcada No-Show'));
            }
            return tr;
          })
        );
        mount(tableWrap, tbl);
      };

      mountRef(tabBody, 'search-slot', SearchInput({ value: m1Ui.search, placeholder: 'Buscar por código, huésped o habitación...', onChange: (v) => { m1Ui.search = v; renderReservasRows(); } }));
      tabBody.querySelectorAll('[data-status]').forEach((btn) => {
        if (btn.dataset.status === m1Ui.statusFilter) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
          m1Ui.statusFilter = btn.dataset.status;
          renderContent();
        });
      });
      renderReservasRows();
    } else if (activeTab === 'checkin') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.checkin);
      tabBody = view;
      mountRef(tabBody, 'info-icon', icon('info', 'w-4 shrink-0'));
      const pending = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');
      if (pending.length === 0) {
        mountRef(tabBody, 'content', EmptyState({ iconName: 'logIn', title: 'Sin ingresos pendientes', description: 'Todas las reservas confirmadas ya realizaron check-in.' }));
      } else {
        const readyOptions = state.rooms.filter((opt) => opt.commercialStatus === 'Disponible' && (opt.housekeepingStatus === 'Inspeccionada' || opt.housekeepingStatus === 'Limpia'));
        mountRef(
          tabBody,
          'content',
          h(
            'div',
            { className: 'grid-2' },
            pending.map((r) => {
              const g = guestById.get(r.guestId);
              const selectedRoomId = m1Ui.checkInRoomOverride[r.id] || r.roomId;
              const rm = roomById.get(selectedRoomId);
              const ready = rm && (rm.housekeepingStatus === 'Inspeccionada' || rm.housekeepingStatus === 'Limpia');
              const card = clone('card-checkin');
              setText(card, 'code-channel', `${r.code} · ${r.channel}`);
              setText(card, 'guest', g?.fullName || '—');
              setText(card, 'meta', `${g?.documentType || ''}: ${maskDocument(g?.documentNumber || '', canViewFullPII)} · ${r.nights} noches (${formatCurrency(r.totalAmount)})`);
              mountRef(card, 'hk-status', StatusText({ label: rm ? `Hab. ${rm.number}: ${rm.housekeepingStatus}` : 'Sin hab.', variant: ready ? 'success' : 'danger' }));

              if (!ready) {
                setVisible(card, 'blocked-alert', true);
                mountRef(card, 'warn-icon', icon('alertTriangle', 'w-4 shrink-0'));
                setText(card, 'blocked-text', `Check-in bloqueado en Hab. ${rm?.number}: estado físico "${rm?.housekeepingStatus}". Reasigne una habitación inspeccionada o apruebe inspección en Módulo 02.`);
              }
              if (canEditCurrentTab) {
                setVisible(card, 'actions-row', true);
                const sel = getRef(card, 'room-select');
                mount(
                  sel,
                  h('option', { value: r.roomId, selected: selectedRoomId === r.roomId }, `Asignada: Hab. ${roomById.get(r.roomId)?.number} (${roomById.get(r.roomId)?.housekeepingStatus})`),
                  readyOptions.filter((o) => o.id !== r.roomId).map((o) => h('option', { value: o.id, selected: selectedRoomId === o.id }, `Reasignar → Hab. ${o.number} (${o.type} · ${o.housekeepingStatus})`))
                );
                sel.addEventListener('change', (e) => {
                  m1Ui.checkInRoomOverride[r.id] = e.target.value;
                  renderContent();
                });
                mountRef(card, 'checkin-icon', icon('logIn', 'w-3.5'));
                getRef(card, 'checkin-btn')?.addEventListener('click', () => erpStore.performCheckIn(r.id, m1Ui.checkInRoomOverride[r.id]));
              }
              return card;
            })
          )
        );
      }
    } else if (activeTab === 'checkout') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.checkout);
      tabBody = view;
      mountRef(tabBody, 'info-icon', icon('info', 'w-4 shrink-0'));
      const activeStays = state.reservations.filter((r) => r.status === 'Check-in');
      if (activeStays.length === 0) {
        mountRef(tabBody, 'content', EmptyState({ iconName: 'logOut', title: 'Sin estadías activas para salida', description: 'No hay habitaciones ocupadas con check-in vigente.' }));
      } else {
        mountRef(
          tabBody,
          'content',
          h(
            'div',
            { className: 'grid-2' },
            activeStays.map((r) => {
              const g = guestById.get(r.guestId);
              const rm = roomById.get(r.roomId);
              const folio = folioByResId.get(r.id);
              const hasBalance = folio && folio.balance > 0.01;
              const card = clone('card-checkout');
              setText(card, 'room-code', `Hab. ${rm?.number || '—'} · ${r.code}`);
              setText(card, 'guest', g?.fullName || '—');
              setText(card, 'date', `Salida programada: ${r.checkOutDate}`);
              mountRef(card, 'balance-status', StatusText({ label: hasBalance ? `Saldo: ${formatCurrency(folio.balance)}` : 'Folio Liquidado', variant: hasBalance ? 'warning' : 'success' }));

              if (folio) {
                setVisible(card, 'folio-box', true);
                setText(card, 'folio-code', folio.code);
                setText(card, 'folio-charges', formatCurrency(folio.totalCharges));
                setText(card, 'folio-payments', formatCurrency(folio.totalPayments));
              }
              if (canEditCurrentTab) {
                setVisible(card, 'actions-row', true);
                if (hasBalance) {
                  setVisible(card, 'cxc-btn', true);
                  getRef(card, 'cxc-btn')?.addEventListener('click', () => erpStore.performCheckOut(r.id, true));
                }
                mountRef(card, 'checkout-icon', icon('logOut', 'w-3.5'));
                getRef(card, 'checkout-btn')?.addEventListener('click', () => erpStore.performCheckOut(r.id, false));
              }
              return card;
            })
          )
        );
      }
    } else if (activeTab === 'habitaciones') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.habitaciones);
      tabBody = view;
      tabBody.querySelectorAll('[data-floor]').forEach((btn) => {
        if (btn.dataset.floor === m1Ui.roomFloorFilter) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
          m1Ui.roomFloorFilter = btn.dataset.floor;
          renderContent();
        });
      });
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-room-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-room-btn')?.addEventListener('click', () => openRoomModal(null));
      }
      const filteredRooms = state.rooms.filter((rm) => m1Ui.roomFloorFilter === 'Todos' || String(rm.floor) === m1Ui.roomFloorFilter);
      mountRef(
        tabBody,
        'grid',
        filteredRooms.map((rm) => {
          const card = clone('card-habitacion');
          setText(card, 'number', `Hab. ${rm.number}`);
          if (canEditCurrentTab) {
            setVisible(card, 'edit-btn', true);
            const editBtn = getRef(card, 'edit-btn');
            mount(editBtn, icon('edit', 'w-3'));
            editBtn.addEventListener('click', () => openRoomModal(rm));
          }
          setText(card, 'meta', `${rm.type} · Piso ${rm.floor} · Cap. ${rm.capacity}`);
          setText(card, 'rate', `${formatCurrency(rm.baseRate)} / noche`);
          mountRef(card, 'commercial-status', StatusText({ label: rm.commercialStatus, variant: getStatusVariant(rm.commercialStatus) }));
          mountRef(card, 'hk-status', StatusText({ label: rm.housekeepingStatus, variant: getStatusVariant(rm.housekeepingStatus) }));
          return card;
        })
      );
    } else if (activeTab === 'tarifas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.tarifas);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'ai-rate-banner', true);
        mountRef(tabBody, 'sparkles-icon', icon('sparkles', 'w-4 text-teal'));
        getRef(tabBody, 'apply-dynamic-btn')?.addEventListener('click', () => erpStore.applyDynamicRate('Suite Ocean', 790, 'Alta demanda fin de semana (+10%)'));
        setVisible(tabBody, 'new-rate-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-rate-btn')?.addEventListener('click', () => openRateModal(null));
      }
      mountRef(
        tabBody,
        'tbody',
        state.ratePlans.map((rp) => {
          const tr = clone('fila-tarifa');
          setText(tr, 'name', rp.name);
          setText(tr, 'room-type', rp.roomType);
          setText(tr, 'season', rp.season);
          setText(tr, 'dates', `${rp.startDate} → ${rp.endDate}`);
          setText(tr, 'price', formatCurrency(rp.price));
          mountRef(tr, 'status', StatusText({ label: rp.active ? 'Vigente' : 'Inactiva', variant: rp.active ? 'success' : 'neutral' }));
          mountRef(
            tr,
            'action',
            canEditCurrentTab ? h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openRateModal(rp) }, 'Editar') : h('span', { className: 'text-11 text-slate-400' }, 'Solo lectura')
          );
          return tr;
        })
      );
    } else if (activeTab === 'lista_espera') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.lista_espera);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-waitlist-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-waitlist-btn')?.addEventListener('click', openWaitlistModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.waitlist.map((w) => {
          const tr = clone('fila-espera');
          setText(tr, 'guest', w.guestName);
          setText(tr, 'contact', w.contact);
          setText(tr, 'room-type', w.roomType);
          setText(tr, 'dates', `${w.checkInDate} → ${w.checkOutDate}`);
          mountRef(tr, 'conflict', StatusText({ label: w.conflictType, variant: w.conflictType === 'Sobreventa' ? 'danger' : 'warning' }));
          mountRef(tr, 'status', StatusText({ label: w.status, variant: w.status === 'Asignada' ? 'success' : w.status === 'Cancelada' ? 'neutral' : 'warning' }));
          mountRef(
            tr,
            'resolution',
            w.status === 'Pendiente' && canEditCurrentTab
              ? h('div', { className: 'row-wrap justify-end' },
                  h('button', { type: 'button', className: 'btn btn-teal btn-xs', onClick: () => erpStore.resolveWaitlistEntry(w.id, 'Asignada', 'Asignada por liberación de inventario') }, 'Asignar'),
                  h('button', { type: 'button', className: 'btn btn-outline-muted btn-xs', onClick: () => erpStore.resolveWaitlistEntry(w.id, 'Cancelada', 'Desistimiento del cliente') }, 'Descartar')
                )
              : h('span', { className: 'text-11 text-slate-500' }, w.authorizedBy || w.status)
          );
          return tr;
        })
      );
    } else if (activeTab === 'disponibilidad') {
      const days = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
      const { root: view } = loadViewTemplate(VIEW_HTML.disponibilidad);
      tabBody = view;
      const headRow = getRef(tabBody, 'head-row');
      days.forEach((d) => headRow?.appendChild(h('th', { className: 'text-center font-mono' }, d.slice(5))));
      mountRef(
        tabBody,
        'tbody',
        state.rooms.map((rm) =>
          h('tr', null,
            h('td', { className: 'font-semibold text-navy' }, `Hab. ${rm.number}`, h('div', { className: 'text-11 text-slate-500' }, rm.type)),
            days.map((d) => {
              if (rm.housekeepingStatus === 'Fuera de servicio') {
                return h('td', { className: 'text-center calendar-cell-blocked font-mono text-11' }, 'BLOQ M2');
              }
              const res = state.reservations.find((r) => r.roomId === rm.id && !['Cancelada', 'No-Show', 'Check-out'].includes(r.status) && d >= r.checkInDate && d < r.checkOutDate);
              if (res) {
                const g = guestById.get(res.guestId);
                return h('td', { className: 'text-center calendar-cell-occupied text-11', title: `${res.code} · ${g?.fullName || ''}` }, res.code);
              }
              return h('td', { className: 'text-center calendar-cell-free text-11' }, 'Libre');
            })
          )
        )
      );
    } else if (activeTab === 'ocupacion') {
      const types = ['Individual', 'Doble Superior', 'Matrimonial Deluxe', 'Suite Junior', 'Suite Ocean'];
      const byType = types.map((t) => {
        const subset = state.rooms.filter((r) => r.type === t);
        return {
          type: t.replace('Matrimonial ', 'Mat. ').replace('Doble ', 'Dob. '),
          fullType: t,
          ocupadas: subset.filter((r) => r.commercialStatus === 'Ocupada').length,
          disponibles: subset.filter((r) => r.commercialStatus === 'Disponible' && r.housekeepingStatus !== 'Fuera de servicio').length,
          bloqueadas: subset.filter((r) => r.housekeepingStatus === 'Fuera de servicio').length,
        };
      });

      const { root: view } = loadViewTemplate(VIEW_HTML.ocupacion);
      tabBody = view;
      mountRef(
        tabBody,
        'type-filter',
        ['Todos', ...types].map((t) =>
          h('button', {
            type: 'button',
            className: `segmented-btn${m1Ui.occupancyTypeFilter === t ? ' is-active' : ''}`,
            onClick: () => {
              m1Ui.occupancyTypeFilter = t;
              renderContent();
            },
          }, t === 'Todos' ? 'Todos' : t.split(' ')[0])
        )
      );
      mountRef(
        tabBody,
        'chart-slot',
        renderStackedBarChart({
          data: m1Ui.occupancyTypeFilter === 'Todos' ? byType : byType.filter((b) => b.fullType === m1Ui.occupancyTypeFilter),
          labelKey: 'type',
          series: [
            { key: 'ocupadas', name: 'Ocupadas', color: '#0B1F3A' },
            { key: 'disponibles', name: 'Disponibles', color: '#0D9488' },
            { key: 'bloqueadas', name: 'Bloqueadas M2', color: '#DC2626' },
          ],
          height: 250,
        })
      );
    } else if (activeTab === 'huespedes') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.huespedes);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-guest-btn', true);
        mountRef(tabBody, 'plus-icon', icon('userPlus', 'w-3.5'));
        getRef(tabBody, 'new-guest-btn')?.addEventListener('click', () => openGuestModal(null));
      }

      const renderGuestsTable = () => {
        const q = m1Ui.search.trim().toLowerCase();
        const filtered = state.guests.filter((g) => !q || g.fullName.toLowerCase().includes(q) || g.segment.toLowerCase().includes(q));
        mountRef(
          tabBody,
          'tbody',
          filtered.map((g) => {
            const tr = clone('fila-huesped');
            setText(tr, 'name', g.fullName);
            setText(tr, 'nationality', g.nationality);
            setText(tr, 'doc', `${g.documentType}: ${maskDocument(g.documentNumber, canViewFullPII)}`);
            setText(tr, 'email', maskEmail(g.email, canViewFullPII));
            setText(tr, 'phone', maskPhone(g.phone, canViewFullPII));
            setText(tr, 'segment', g.segment);
            setText(tr, 'loyalty', `${g.loyaltyTier} · ${g.loyaltyPoints} pts`);
            setText(tr, 'stays', String(g.totalStays));
            mountRef(
              tr,
              'action',
              canEditCurrentTab ? h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openGuestModal(g) }, 'Editar') : h('span', { className: 'text-11 text-slate-400' }, 'Lectura')
            );
            return tr;
          })
        );
      };

      mountRef(tabBody, 'search-slot', SearchInput({ value: m1Ui.search, placeholder: 'Buscar huésped por nombre o segmento...', onChange: (v) => { m1Ui.search = v; renderGuestsTable(); } }));
      renderGuestsTable();
    }

    const activeMeta = M1_TABS.find((t) => t.id === activeTab) || M1_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'MÓDULO 01 · RESERVAS Y RECEPCIÓN',
        title: activeMeta.label,
        subtitle: activeMeta.subtitle,
        actions: canEditCurrentTab
          ? h('div', { className: 'row-wrap' },
              erpStore.canEditTab('m1', 'huespedes')
                ? h('button', { type: 'button', className: 'btn btn-outline', onClick: () => openGuestModal(null) }, icon('userPlus', 'w-4'), h('span', null, 'Nuevo Huésped'))
                : null,
              erpStore.canEditTab('m1', 'reservas')
                ? h('button', { type: 'button', className: 'btn btn-primary', onClick: openReservationModal }, icon('plus', 'w-4'), h('span', null, 'Nueva Reserva'))
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
