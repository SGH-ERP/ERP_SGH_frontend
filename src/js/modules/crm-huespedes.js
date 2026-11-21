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
import modalesHtml from '../../html/modules/crm/modales.html?raw';
import resumenHtml from '../../html/modules/crm/resumen.html?raw';
import perfil360Html from '../../html/modules/crm/perfil-360.html?raw';
import segmentacionHtml from '../../html/modules/crm/segmentacion.html?raw';
import fidelizacionHtml from '../../html/modules/crm/fidelizacion.html?raw';
import campanasHtml from '../../html/modules/crm/campanas.html?raw';
import reclamosHtml from '../../html/modules/crm/reclamos.html?raw';
import solicitudesHtml from '../../html/modules/crm/solicitudes.html?raw';
import encuestasHtml from '../../html/modules/crm/encuestas.html?raw';
import resenasHtml from '../../html/modules/crm/resenas.html?raw';
import portalIaHtml from '../../html/modules/crm/portal-ia.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { maskDocument, maskEmail, maskPhone } from '../data/rbac.js';
import { sendCRMChatMessage } from '../services/ai-client.js';
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

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  resumen: resumenHtml,
  perfil_360: perfil360Html,
  segmentacion: segmentacionHtml,
  fidelizacion: fidelizacionHtml,
  campanas: campanasHtml,
  reclamos: reclamosHtml,
  solicitudes: solicitudesHtml,
  encuestas: encuestasHtml,
  resenas: resenasHtml,
  portal_ia: portalIaHtml,
};

const M5_TABS = [
  { id: 'resumen', label: 'Resumen CRM y Experiencia', subtitle: 'KPIs de huéspedes registrados, reclamos activos, satisfacción NPS y asistente IA.' },
  { id: 'perfil_360', label: 'Perfil 360° de Huéspedes', subtitle: 'Historial consolidado de estadías, folios y preferencias del huésped.' },
  { id: 'segmentacion', label: 'Segmentación de Clientes', subtitle: 'Análisis por segmento de viaje, gasto acumulado y consentimiento comercial.' },
  { id: 'fidelizacion', label: 'Programa de Fidelización', subtitle: 'Niveles Ocean Rewards y canje directo de puntos por beneficios.' },
  { id: 'campanas', label: 'Campañas de Marketing', subtitle: 'Gestión y activación de envíos segmentados con filtro Opt-In.' },
  { id: 'reclamos', label: 'Reclamos e Incidencias', subtitle: 'Atención de reclamos con escalamiento automático a Mantenimiento M2 (Flujo E).' },
  { id: 'solicitudes', label: 'Solicitudes y Requerimientos', subtitle: 'Derivación directa hacia Recepción, Housekeeping, Mantenimiento o Restaurante.' },
  { id: 'encuestas', label: 'Encuestas de Satisfacción', subtitle: 'Registro y seguimiento de calificaciones globales, limpieza, servicio y NPS.' },
  { id: 'resenas', label: 'Reseñas y Reputación Online', subtitle: 'Monitoreo de opiniones en portales externos y publicación de respuestas oficiales.' },
  { id: 'portal_ia', label: 'Portal Huésped & Asistente IA', subtitle: 'Canal conversacional Gemini AI y autoservicio desde habitación.' },
];

const m5Ui = {
  search: '',
  selectedGuestId: '',
  reviewReplyDraft: {},
  portalGuestId: '',
  portalReqType: 'Amenities / Almohadas',
  portalReqDesc: '',
  chatInput: '',
  chatLoading: false,
  chatMessages: [
    {
      role: 'assistant',
      text: 'Bienvenido al Asistente IA de Atención al Huésped SGH-ERP. Puedo ayudarte con consultas sobre check-in, desayuno, servicios del spa, room service o registro de solicitudes.',
    },
  ],
};

export function renderCRMModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Resuelto', 'Atendida', 'Activa', 'Positivo', 'Excelente'].includes(status)) return 'success';
    if (['En seguimiento', 'Derivada', 'Pendiente', 'Programada', 'Pausada', 'Neutral', 'Media'].includes(status)) return 'warning';
    if (['Escalado a Mantenimiento', 'Abierto', 'Crítica', 'Alta', 'Muy Negativo', 'Negativo'].includes(status)) return 'danger';
    return 'info';
  }

  function openComplaintModal() {
    const state = erpStore.state;
    openModal({
      title: 'Registrar Reclamo de Huésped (Flujo E)',
      subtitle: 'Si afecta infraestructura o activas escalamiento, crea automáticamente una Incidencia en Módulo 02.',
      renderBody: (close) => {
        const form = cloneModal('modal-reclamo');
        const guestSel = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const catSel = getRef(form, 'category');
        const sevSel = getRef(form, 'severity');
        const descIn = getRef(form, 'description');
        const escChk = getRef(form, 'escalate');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        roomIn.value = '203';
        sevSel.value = 'Alta';
        escChk.checked = true;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.createComplaint({
            guestId: guestSel.value,
            roomNumber: roomIn.value.trim(),
            category: catSel.value,
            severity: sevSel.value,
            description: descIn.value.trim(),
            escalateToMaintenance: escChk.checked,
          });
          close();
        });
        return form;
      },
    });
  }

  function openRequestModal() {
    const state = erpStore.state;
    openModal({
      title: 'Nueva Solicitud de Huésped',
      subtitle: 'Deriva automáticamente la atención al área correspondiente (Recepción, Housekeeping, Mantenimiento o Restaurante).',
      renderBody: (close) => {
        const form = cloneModal('modal-solicitud');
        const guestSel = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const typeSel = getRef(form, 'type');
        const areaSel = getRef(form, 'target-area');
        const descIn = getRef(form, 'description');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        roomIn.value = '201';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.createGuestRequest({
            guestId: guestSel.value,
            roomNumber: roomIn.value.trim(),
            type: typeSel.value,
            targetArea: areaSel.value,
            description: descIn.value.trim(),
            source: 'Recepción / CRM',
          });
          close();
        });
        return form;
      },
    });
  }

  function openCampaignModal() {
    openModal({
      title: 'Nueva Campaña de Marketing (Opt-In)',
      subtitle: 'Solo se enviará a huéspedes con consentimiento comercial vigente.',
      renderBody: (close) => {
        const form = cloneModal('modal-campana');
        const nameIn = getRef(form, 'name');
        const segSel = getRef(form, 'segment');
        const chSel = getRef(form, 'channel');
        const subIn = getRef(form, 'subject');

        segSel.value = 'VIP';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.createCampaign({
            name: nameIn.value.trim(),
            segment: segSel.value,
            channel: chSel.value,
            subject: subIn.value.trim(),
            status: 'Activa',
          });
          close();
        });
        return form;
      },
    });
  }

  function openSurveyModal() {
    const state = erpStore.state;
    openModal({
      title: 'Registrar Encuesta de Satisfacción',
      renderBody: (close) => {
        const form = cloneModal('modal-encuesta');
        const guestSel = getRef(form, 'guest');
        const overallIn = getRef(form, 'overall');
        const cleanIn = getRef(form, 'cleanliness');
        const srvIn = getRef(form, 'service');
        const npsIn = getRef(form, 'nps');
        const comIn = getRef(form, 'comment');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        overallIn.value = '5';
        cleanIn.value = '5';
        srvIn.value = '5';
        npsIn.value = '9';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const g = state.guests.find((x) => x.id === guestSel.value);
          erpStore.addSurveyResponse({
            guestId: guestSel.value,
            guestName: g?.fullName || '',
            overallScore: Number(overallIn.value),
            cleanlinessScore: Number(cleanIn.value),
            serviceScore: Number(srvIn.value),
            npsRecommend: Number(npsIn.value),
            comment: comIn.value.trim(),
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
    const visibleTabs = M5_TABS.filter((t) => erpStore.canViewTab('m5', t.id));

    const defaultTab = erpStore.getDefaultTab('m5') || 'resumen';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m5', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m5', activeTab);

    if (!m5Ui.selectedGuestId && state.guests.length > 0) m5Ui.selectedGuestId = state.guests[0].id;
    if (!m5Ui.portalGuestId && state.guests.length > 0) m5Ui.portalGuestId = state.guests[0].id;
    const selectedGuest = state.guests.find((g) => g.id === m5Ui.selectedGuestId) || state.guests[0];

    const openComplaints = state.complaints.filter((c) => c.status !== 'Resuelto').length;
    const avgScore = state.surveys.length > 0
      ? (state.surveys.reduce((s, r) => s + r.overallScore, 0) / state.surveys.length).toFixed(1)
      : '4.6';
    const totalPoints = state.guests.reduce((s, g) => s + g.loyaltyPoints, 0);

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `M05 · ${M5_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        scopeSummary: currentPermissions?.scopeSummary,
        onBack: () => navigateToView('/crm', defaultTab, true),
      });
    } else if (activeTab === 'resumen') {
      const { root: view } = loadViewTemplate(VIEW_HTML.resumen);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Huéspedes Registrados', value: state.guests.length, meta: `${state.guests.filter((g) => g.marketingOptIn).length} con consentimiento comercial`, tone: 'teal', onClick: () => navigateToView('/crm', 'perfil_360') }),
        StatTile({ label: 'Reclamos Activos', value: openComplaints, meta: 'Integrados con Mant. M2 (Flujo E)', tone: openComplaints > 0 ? 'danger' : 'success', onClick: () => navigateToView('/crm', 'reclamos') }),
        StatTile({ label: 'Satisfacción Global', value: `${avgScore} / 5.0`, meta: `${state.surveys.length} encuestas · ${state.reviews.length} reseñas`, tone: 'success', onClick: () => navigateToView('/crm', 'encuestas') }),
        StatTile({ label: 'Puntos Fidelización', value: totalPoints.toLocaleString('es-PE'), meta: 'Programa Ocean Rewards', onClick: () => navigateToView('/crm', 'fidelizacion') })
      );
      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm5-crm',
          moduleName: 'Módulo 05 - CRM y Atención al Huésped',
          title: 'Asistente IA de Experiencia del Huésped y Retención',
          description: 'Análisis de sentimiento en reclamos/reseñas, diseño de campañas opt-in y detección de riesgo de fuga.',
          suggestedPrompts: [
            'Analiza el sentimiento de las reseñas y reclamos actuales y recomienda acciones de recuperación de servicio.',
            'Sugiere una campaña segmentada para huéspedes VIP y Corporativos respetando su consentimiento comercial.',
            'Identifica huéspedes frecuentes con potencial de upgrade de nivel de fidelización.',
          ],
          contextData: {
            reclamosAbiertos: state.complaints.filter((c) => c.status !== 'Resuelto'),
            encuestas: state.surveys,
            resenas: state.reviews,
            segmentos: state.guests.map((g) => ({ segment: g.segment, tier: g.loyaltyTier, spent: g.totalSpent })),
          },
        })
      );
    } else if (activeTab === 'perfil_360') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.perfil_360);
      tabBody = view;

      const renderGuestList = () => {
        const q = m5Ui.search.trim().toLowerCase();
        const filtered = state.guests.filter((g) => !q || g.fullName.toLowerCase().includes(q) || g.segment.toLowerCase().includes(q));
        mountRef(
          tabBody,
          'guests-list',
          filtered.map((g) => {
            const btn = clone('item-huesped-lista');
            if (selectedGuest?.id === g.id) btn.classList.add('bg-teal-soft');
            setText(btn, 'name', g.fullName);
            setText(btn, 'tier', g.loyaltyTier);
            setText(btn, 'meta', `${g.segment} · ${g.totalStays} estadías · ${formatCurrency(g.totalSpent)}`);
            btn.addEventListener('click', () => {
              m5Ui.selectedGuestId = g.id;
              renderContent();
            });
            return btn;
          })
        );
      };

      mountRef(
        tabBody,
        'search-slot',
        SearchInput({
          value: m5Ui.search,
          placeholder: 'Buscar huésped...',
          focusId: 'm5-guest-search',
          onChange: (v) => {
            m5Ui.search = v;
            renderGuestList();
          },
        })
      );
      renderGuestList();

      if (selectedGuest) {
        const gRes = state.reservations.filter((r) => r.guestId === selectedGuest.id);
        const gFolios = state.folios.filter((f) => f.guestId === selectedGuest.id);
        const gComplaints = state.complaints.filter((c) => c.guestId === selectedGuest.id);

        const detail = clone('detalle-huesped-360');
        setText(detail, 'segment-tier', `${selectedGuest.segment} · ${selectedGuest.loyaltyTier} (${selectedGuest.loyaltyPoints} pts)`);
        setText(detail, 'full-name', selectedGuest.fullName);
        setText(
          detail,
          'contact-pii',
          `${selectedGuest.documentType}: ${maskDocument(selectedGuest.documentNumber, canViewFullPII)} · ${maskEmail(selectedGuest.email, canViewFullPII)} · ${maskPhone(selectedGuest.phone, canViewFullPII)}`
        );
        mountRef(
          detail,
          'consent-status',
          StatusText({
            label: selectedGuest.privacyConsentISO27701 ? 'Privacidad OK' : 'Sin consentimiento',
            variant: selectedGuest.privacyConsentISO27701 ? 'success' : 'warning',
          })
        );

        mountRef(
          detail,
          'kpis',
          StatTile({ label: 'Estadías Totales', value: selectedGuest.totalStays }),
          StatTile({ label: 'Gasto Acumulado', value: formatCurrency(selectedGuest.totalSpent), tone: 'teal' }),
          StatTile({ label: 'Reclamos', value: gComplaints.length, tone: gComplaints.length > 0 ? 'warning' : 'success' })
        );

        setText(detail, 'preferences', selectedGuest.preferences.length > 0 ? selectedGuest.preferences.join(', ') : 'Sin preferencias registradas');
        setVisible(detail, 'notes', Boolean(selectedGuest.notes));
        if (selectedGuest.notes) setText(detail, 'notes', `Nota: ${selectedGuest.notes}`);

        setText(detail, 'res-title', `Reservas (${gRes.length})`);
        mountRef(
          detail,
          'res-list',
          gRes.map((r) => {
            const row = clone('item-huesped-reserva');
            setText(row, 'code', r.code);
            mountRef(row, 'status', StatusText({ label: r.status, variant: getStatusVariant(r.status) }));
            return row;
          })
        );

        setText(detail, 'folio-title', `Folios (${gFolios.length})`);
        mountRef(
          detail,
          'folio-list',
          gFolios.map((f) => {
            const row = clone('item-huesped-folio');
            setText(row, 'code', f.code);
            setText(row, 'total', formatCurrency(f.totalCharges));
            return row;
          })
        );

        mountRef(tabBody, 'detail-slot', detail);
      } else {
        mountRef(
          tabBody,
          'detail-slot',
          EmptyState({ iconName: 'users', title: 'Selecciona un huésped', description: 'Elige un perfil del listado izquierdo.' })
        );
      }
    } else if (activeTab === 'segmentacion') {
      const segments = ['VIP', 'Corporativo', 'Vacacional', 'Grupo', 'Larga Estadía'];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.segmentacion);
      tabBody = view;
      mountRef(
        tabBody,
        'grid',
        segments.map((seg) => {
          const members = state.guests.filter((g) => g.segment === seg);
          const totalSegSpent = members.reduce((s, g) => s + g.totalSpent, 0);
          const card = clone('card-segmento');
          setText(card, 'name', seg);
          setText(card, 'count', `${members.length} clientes`);
          setText(card, 'spent', formatCurrency(totalSegSpent));
          setText(card, 'optin', `${members.filter((m) => m.marketingOptIn).length} habilitados para campañas opt-in`);
          return card;
        })
      );
    } else if (activeTab === 'fidelizacion') {
      const rewards = [
        { label: 'Upgrade a Suite Ocean', points: 1200 },
        { label: 'Cena Degustación para 2', points: 850 },
        { label: 'Masaje Descontracturante Spa', points: 600 },
        { label: 'Late Check-out hasta 16:00', points: 400 },
      ];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.fidelizacion);
      tabBody = view;
      mountRef(
        tabBody,
        'grid',
        state.guests.map((g) => {
          const card = clone('card-fidelizacion');
          setText(card, 'name', g.fullName);
          setText(card, 'meta', `Nivel ${g.loyaltyTier} · ${g.totalStays} estadías`);
          mountRef(card, 'award-icon', icon('award', 'w-4'));
          setText(card, 'points', `${g.loyaltyPoints} pts`);
          setVisible(card, 'rewards-wrap', canEditCurrentTab);
          if (canEditCurrentTab) {
            mountRef(
              card,
              'rewards-wrap',
              rewards.map((rw) => {
                const btn = clone('btn-canje-puntos');
                btn.textContent = `${rw.label} (-${rw.points} pts)`;
                btn.disabled = g.loyaltyPoints < rw.points;
                btn.addEventListener('click', () => erpStore.redeemLoyaltyPoints(g.id, rw.points, rw.label));
                return btn;
              })
            );
          }
          return card;
        })
      );
    } else if (activeTab === 'campanas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.campanas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openCampaignModal);
      }
      mountRef(
        tabBody,
        'list',
        state.campaigns.map((cp) => {
          const row = clone('fila-campana');
          setText(row, 'title', `${cp.name} · ${cp.segment} (${cp.channel})`);
          setText(row, 'meta', `${cp.subject} · Enviados: ${cp.sentCount} · Apertura: ${cp.openRate}% · Conversiones: ${cp.conversionCount}`);
          mountRef(row, 'status', StatusText({ label: cp.status, variant: getStatusVariant(cp.status) }));
          setVisible(row, 'toggle-btn', canEditCurrentTab);
          if (canEditCurrentTab) {
            const btn = getRef(row, 'toggle-btn');
            btn.textContent = cp.status === 'Activa' ? 'Pausar' : 'Activar';
            btn.addEventListener('click', () => erpStore.toggleCampaignStatus(cp.id, cp.status === 'Activa' ? 'Pausada' : 'Activa'));
          }
          return row;
        })
      );
    } else if (activeTab === 'reclamos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reclamos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openComplaintModal);
      }
      mountRef(
        tabBody,
        'list',
        state.complaints.map((cmp) => {
          const row = clone('fila-reclamo');
          setText(row, 'title', `${cmp.code} · Hab. ${cmp.roomNumber || 'N/A'} · ${cmp.guestName}`);
          setText(row, 'description', cmp.description);
          mountRef(row, 'severity', StatusText({ label: cmp.severity, variant: getStatusVariant(cmp.severity) }));
          mountRef(row, 'status', StatusText({ label: cmp.status, variant: getStatusVariant(cmp.status) }));
          setText(row, 'meta', `${cmp.category} · Asignado: ${cmp.assignedTo} ${cmp.linkedIncidentId ? '· Flujo E conectado a M2' : ''}`);
          const canResolve = canEditCurrentTab && cmp.status !== 'Resuelto';
          setVisible(row, 'resolve-btn', canResolve);
          if (canResolve) {
            getRef(row, 'resolve-btn').addEventListener('click', () =>
              erpStore.updateComplaintStatus(cmp.id, 'Resuelto', 'Resuelto y confirmado con el huésped')
            );
          }
          return row;
        })
      );
    } else if (activeTab === 'solicitudes') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.solicitudes);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRequestModal);
      }
      mountRef(
        tabBody,
        'list',
        state.guestRequests.map((req) => {
          const row = clone('fila-solicitud');
          setText(row, 'title', `${req.code} · Hab. ${req.roomNumber} · ${req.guestName}`);
          setText(row, 'meta', `${req.type} → Área: ${req.targetArea} · ${req.description}`);
          mountRef(row, 'status', StatusText({ label: req.status, variant: getStatusVariant(req.status) }));
          const canAttend = canEditCurrentTab && req.status !== 'Atendida';
          setVisible(row, 'attend-btn', canAttend);
          if (canAttend) {
            getRef(row, 'attend-btn').addEventListener('click', () => erpStore.updateGuestRequestStatus(req.id, 'Atendida'));
          }
          return row;
        })
      );
    } else if (activeTab === 'encuestas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.encuestas);
      tabBody = view;
      setText(tabBody, 'avg-subtitle', `Promedio actual: ${avgScore} / 5.0`);
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openSurveyModal);
      }
      mountRef(
        tabBody,
        'list',
        state.surveys.map((srv) => {
          const row = clone('fila-encuesta');
          setText(row, 'title', `${srv.guestName} · ${srv.date}`);
          setText(row, 'comment', srv.comment || 'Sin comentario adicional');
          setText(row, 'score', `${srv.overallScore}/5 ★`);
          setText(row, 'nps', `NPS: ${srv.npsRecommend}`);
          return row;
        })
      );
    } else if (activeTab === 'resenas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.resenas);
      tabBody = view;
      mountRef(
        tabBody,
        'list',
        state.reviews.map((rev) => {
          const card = clone('card-resena');
          setText(card, 'author-channel', `${rev.author} · ${rev.channel} (${rev.date})`);
          setText(card, 'rating', `${rev.rating}/5 ★`);
          mountRef(card, 'sentiment', StatusText({ label: rev.sentiment, variant: getStatusVariant(rev.sentiment) }));
          setText(card, 'comment', rev.comment);

          const hasReply = Boolean(rev.hotelReply);
          setVisible(card, 'reply-box', hasReply);
          setVisible(card, 'reply-form', !hasReply && canEditCurrentTab);
          if (hasReply) {
            setText(card, 'reply-text', rev.hotelReply);
          } else if (canEditCurrentTab) {
            const replyIn = getRef(card, 'reply-input');
            replyIn.value = m5Ui.reviewReplyDraft[rev.id] || '';
            replyIn.addEventListener('input', (e) => {
              m5Ui.reviewReplyDraft[rev.id] = e.target.value;
            });
            getRef(card, 'reply-submit').addEventListener('click', () => {
              const txt = (m5Ui.reviewReplyDraft[rev.id] || '').trim();
              if (!txt) return;
              erpStore.replyToReview(rev.id, txt);
              delete m5Ui.reviewReplyDraft[rev.id];
            });
          }
          return card;
        })
      );
    } else if (activeTab === 'portal_ia') {
      const portalGuest = state.guests.find((g) => g.id === m5Ui.portalGuestId) || state.guests[0];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.portal_ia);
      tabBody = view;
      mountRef(tabBody, 'chat-icon', icon('messageSquare', 'w-4 text-teal'));
      mountRef(tabBody, 'send-icon', icon('send', 'w-3.5'));

      const chatBox = getRef(tabBody, 'chat-box');
      const chatInputEl = getRef(tabBody, 'chat-input');
      chatInputEl.value = m5Ui.chatInput;
      chatInputEl.addEventListener('input', (e) => {
        m5Ui.chatInput = e.target.value;
      });

      const renderChatHistory = () => {
        mount(
          chatBox,
          m5Ui.chatMessages.map((msg) => {
            const row = clone('chat-mensaje');
            if (msg.role === 'user') row.classList.add('is-user');
            const bubble = getRef(row, 'bubble');
            bubble.classList.add(msg.role === 'user' ? 'is-user' : 'is-assistant');
            bubble.textContent = msg.text;
            return row;
          })
        );
        chatBox.scrollTop = chatBox.scrollHeight;
      };
      renderChatHistory();

      const sendChat = async () => {
        const text = m5Ui.chatInput.trim();
        if (!text || m5Ui.chatLoading) return;
        m5Ui.chatMessages.push({ role: 'user', text });
        m5Ui.chatInput = '';
        chatInputEl.value = '';
        m5Ui.chatLoading = true;
        renderChatHistory();
        try {
          const reply = await sendCRMChatMessage({
            message: text,
            guestContext: portalGuest
              ? { nombre: portalGuest.fullName, nivel: portalGuest.loyaltyTier, preferencias: portalGuest.preferences }
              : undefined,
          });
          m5Ui.chatMessages.push({ role: 'assistant', text: reply.text || 'Consulta atendida.' });
        } catch (err) {
          m5Ui.chatMessages.push({
            role: 'assistant',
            text: err instanceof Error ? err.message : 'Error consultando asistente.',
          });
        } finally {
          m5Ui.chatLoading = false;
          renderChatHistory();
        }
      };

      getRef(tabBody, 'chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        sendChat();
      });

      const guestSel = getRef(tabBody, 'portal-guest');
      mount(
        guestSel,
        state.guests.map((g) => h('option', { value: g.id, selected: portalGuest?.id === g.id }, `${g.fullName} (${g.loyaltyTier})`))
      );
      if (portalGuest) guestSel.value = portalGuest.id;
      guestSel.addEventListener('change', (e) => {
        m5Ui.portalGuestId = e.target.value;
        renderContent();
      });

      setVisible(tabBody, 'points-box', Boolean(portalGuest));
      if (portalGuest) setText(tabBody, 'points-value', `${portalGuest.loyaltyPoints} pts`);

      const reqTypeSel = getRef(tabBody, 'portal-req-type');
      reqTypeSel.value = m5Ui.portalReqType;
      reqTypeSel.addEventListener('change', (e) => { m5Ui.portalReqType = e.target.value; });

      const reqDescIn = getRef(tabBody, 'portal-req-desc');
      reqDescIn.value = m5Ui.portalReqDesc;
      reqDescIn.addEventListener('input', (e) => { m5Ui.portalReqDesc = e.target.value; });

      setVisible(tabBody, 'portal-submit-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        getRef(tabBody, 'portal-submit-btn').addEventListener('click', () => {
          if (!portalGuest || !m5Ui.portalReqDesc.trim()) return;
          erpStore.createGuestRequest({
            guestId: portalGuest.id,
            roomNumber: '301',
            type: m5Ui.portalReqType,
            targetArea:
              m5Ui.portalReqType === 'Soporte Técnico'
                ? 'Mantenimiento'
                : m5Ui.portalReqType === 'Amenities / Almohadas'
                ? 'Housekeeping'
                : 'Recepción',
            description: m5Ui.portalReqDesc.trim(),
            source: 'Portal Huésped',
          });
          m5Ui.portalReqDesc = '';
          renderContent();
        });
      }
    }

    const activeMeta = M5_TABS.find((t) => t.id === activeTab) || M5_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'MÓDULO 05 · CRM Y EXPERIENCIA DEL HUÉSPED',
        title: activeMeta.label,
        subtitle: activeMeta.subtitle,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
