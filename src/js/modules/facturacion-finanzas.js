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
import modalesHtml from '../../html/modules/finanzas/modales.html?raw';
import resumenHtml from '../../html/modules/finanzas/resumen.html?raw';
import foliosHtml from '../../html/modules/finanzas/folios.html?raw';
import facturacionHtml from '../../html/modules/finanzas/facturacion.html?raw';
import pagosHtml from '../../html/modules/finanzas/pagos.html?raw';
import cxcHtml from '../../html/modules/finanzas/cxc.html?raw';
import cajaHtml from '../../html/modules/finanzas/caja.html?raw';
import gastosHtml from '../../html/modules/finanzas/gastos.html?raw';
import costosHtml from '../../html/modules/finanzas/costos.html?raw';
import reportesHtml from '../../html/modules/finanzas/reportes.html?raw';
import sunatHtml from '../../html/modules/finanzas/sunat.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
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
import { renderAreaComparisonChart, renderGroupedBarChart } from '../components/charts.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  resumen: resumenHtml,
  folios: foliosHtml,
  facturacion: facturacionHtml,
  pagos: pagosHtml,
  cxc: cxcHtml,
  caja: cajaHtml,
  gastos: gastosHtml,
  costos: costosHtml,
  reportes: reportesHtml,
  sunat: sunatHtml,
};

const M4_TABS = [
  { id: 'resumen', label: 'Resumen Financiero', subtitle: 'Estado de cargos en folios, cobranza efectiva, CxC corporativas y asistente IA financiero.' },
  { id: 'folios', label: 'Cuentas de Huéspedes (Folios)', subtitle: 'Detalle consolidado de cargos de alojamiento (M1), consumos POS (M3) y cargos manuales.' },
  { id: 'facturacion', label: 'Facturación Interna', subtitle: 'Emisión, consulta, impresión y anulación de boletas y facturas internas.' },
  { id: 'pagos', label: 'Pagos y Cobranzas', subtitle: 'Liquidación de folios con múltiples medios de pago e ingreso directo a caja (Flujo F).' },
  { id: 'cxc', label: 'Cuentas por Cobrar (CxC)', subtitle: 'Seguimiento de créditos corporativos y saldos trasladados en check-out.' },
  { id: 'caja', label: 'Control de Caja y Turnos', subtitle: 'Apertura de fondo fijo, ingresos/egresos manuales y arqueo de cierre.' },
  { id: 'gastos', label: 'Gastos Operativos', subtitle: 'Egresos registrados manualmente e imputaciones desde Compras (M3) y Mantenimiento (M2).' },
  { id: 'costos', label: 'Centro de Costos', subtitle: 'Comparativa presupuestaria vs. gasto ejecutado por área hotelera.' },
  { id: 'reportes', label: 'Reportes Financieros', subtitle: 'Evolución semestral y proyección de cierre de ingresos vs. gastos.' },
  { id: 'sunat', label: 'Facturación Electrónica SUNAT', subtitle: 'Previsualizador estructural de comprobantes en formato XML UBL 2.1.' },
];

const m4Ui = {
  search: '',
  selectedFolioId: '',
  sunatXmlPreviewId: '',
  payMethod: 'Tarjeta Crédito',
  payRef: '',
  payAmount: '',
  cashMoveType: 'Ingreso',
  cashMoveMethod: 'Efectivo',
  cashMoveConcept: '',
  cashMoveAmount: '',
  countedClose: '',
};

export function renderFinanzasModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Liquidado', 'Emitida', 'Emitida (Interna)', 'Cobrada', 'Pagado', 'Abierta', 'Cerrado'].includes(status)) return 'success';
    if (['Abierto', 'Vigente', 'Pendiente', 'Cerrada'].includes(status)) return 'warning';
    if (['Vencida', 'Anulada'].includes(status)) return 'danger';
    return 'info';
  }

  function openManualChargeModal(folio) {
    openModal({
      title: `Agregar Cargo Manual · ${folio.code}`,
      subtitle: `${folio.guestName} · Hab. ${folio.roomNumber}`,
      renderBody: (close) => {
        const form = cloneModal('modal-cargo-manual');
        const descIn = getRef(form, 'description');
        const catSel = getRef(form, 'category');
        const amtIn = getRef(form, 'amount');
        amtIn.value = '45';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.addManualFolioCharge(folio.id, descIn.value.trim(), catSel.value, Number(amtIn.value));
          close();
        });
        return form;
      },
    });
  }

  function openIssueInvoiceModal() {
    const state = erpStore.state;
    const defaultFolio = state.folios[0];
    openModal({
      title: 'Emitir Comprobante Electrónico',
      subtitle: 'Calcula subtotal e IGV (18%) automáticamente según los cargos vinculados.',
      renderBody: (close) => {
        const form = cloneModal('modal-comprobante');
        const typeSel = getRef(form, 'type');
        const folioSel = getRef(form, 'folio');
        const nameIn = getRef(form, 'customer-name');
        const docIn = getRef(form, 'customer-doc');
        const descIn = getRef(form, 'description');
        const amtIn = getRef(form, 'amount');

        mount(
          folioSel,
          state.folios.map((f) => h('option', { value: f.id }, `${f.code} · ${f.guestName} (${formatCurrency(f.totalCharges)})`))
        );
        if (defaultFolio) folioSel.value = defaultFolio.id;
        nameIn.value = defaultFolio?.guestName || '';
        docIn.value = '44891230';
        descIn.value = `Servicios de hospedaje y consumos (${defaultFolio?.code || 'FOL'})`;
        amtIn.value = String(defaultFolio?.totalCharges || 380);

        folioSel.addEventListener('change', () => {
          const f = state.folios.find((x) => x.id === folioSel.value);
          if (f) {
            nameIn.value = f.guestName;
            amtIn.value = String(f.totalCharges);
            descIn.value = `Servicios de hospedaje y consumos (${f.code})`;
          }
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.issueInvoice({
            type: typeSel.value,
            folioId: folioSel.value || undefined,
            customerName: nameIn.value.trim(),
            customerDoc: docIn.value.trim(),
            items: [{ description: descIn.value.trim(), amount: Number(amtIn.value) }],
          });
          close();
        });
        return form;
      },
    });
  }

  function openPreviewInvoiceModal(inv) {
    openModal({
      title: `${inv.type} ${inv.series}-${inv.number}`,
      subtitle: `${inv.issuedAt} · Estado: ${inv.status}`,
      renderBody: (close) => {
        const box = cloneModal('modal-vista-comprobante');
        setText(box, 'buyer', `Adquiriente: ${inv.customerName} (${inv.customerDoc})`);
        setText(box, 'sunat-status', inv.sunatStatus);
        mountRef(
          box,
          'items-tbody',
          inv.items.map((it) => {
            const row = cloneModal('fila-item-comprobante');
            setText(row, 'desc', it.description);
            setText(row, 'amount', formatCurrency(it.amount));
            return row;
          })
        );
        setText(box, 'subtotal', formatCurrency(inv.subtotal));
        setText(box, 'igv', formatCurrency(inv.igv));
        setText(box, 'total', formatCurrency(inv.total));
        mountRef(box, 'print-icon', icon('printer', 'w-3.5'));
        getRef(box, 'print-btn')?.addEventListener('click', () => window.print());
        getRef(box, 'close-btn')?.addEventListener('click', close);
        return box;
      },
    });
  }

  function openExpenseModal() {
    openModal({
      title: 'Registrar Gasto Operativo',
      renderBody: (close) => {
        const form = cloneModal('modal-gasto');
        const catSel = getRef(form, 'category');
        const ccSel = getRef(form, 'cost-center');
        const supIn = getRef(form, 'supplier');
        const docIn = getRef(form, 'doc-ref');
        const amtIn = getRef(form, 'amount');
        const statusSel = getRef(form, 'status');
        const descIn = getRef(form, 'description');

        catSel.value = 'Servicios Básicos';
        ccSel.value = 'Administración';
        docIn.value = 'F002-00412';
        amtIn.value = '350';
        statusSel.value = 'Pagado';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!supIn.value.trim() || !descIn.value.trim()) return;
          erpStore.addOperatingExpense({
            date: TODAY,
            category: catSel.value,
            costCenter: ccSel.value,
            supplier: supIn.value.trim(),
            description: descIn.value.trim(),
            amount: Number(amtIn.value),
            status: statusSel.value,
            documentRef: docIn.value.trim(),
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
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M4_TABS.filter((t) => erpStore.canViewTab('m4', t.id));

    const defaultTab = erpStore.getDefaultTab('m4') || 'resumen';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m4', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m4', activeTab);

    if (!m4Ui.selectedFolioId && state.folios.length > 0) m4Ui.selectedFolioId = state.folios[0].id;
    const selectedFolio = state.folios.find((f) => f.id === m4Ui.selectedFolioId) || state.folios[0];
    const activeCashShift = state.cashShifts.find((c) => c.status === 'Abierta');

    const totalBilled = state.folios.reduce((s, f) => s + f.totalCharges, 0);
    const totalCollected = state.folios.reduce((s, f) => s + f.totalPayments, 0);
    const totalPending = state.folios.reduce((s, f) => s + f.balance, 0) + state.receivables.reduce((s, r) => s + r.pendingAmount, 0);
    const totalExpenses = state.expenses.reduce((s, e) => s + e.amount, 0);

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `M04 · ${M4_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        scopeSummary: currentPermissions?.scopeSummary,
        onBack: () => navigateToView('/finanzas', defaultTab, true),
      });
    } else if (activeTab === 'resumen') {
      const { root: view } = loadViewTemplate(VIEW_HTML.resumen);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Total Cargos en Folios', value: formatCurrency(totalBilled), meta: `${state.folios.length} cuentas activas/cerradas`, tone: 'teal', onClick: () => navigateToView('/finanzas', 'folios') }),
        StatTile({ label: 'Cobranza Efectiva', value: formatCurrency(totalCollected), meta: 'Ingresos liquidados en caja/bancos', tone: 'success', onClick: () => navigateToView('/finanzas', 'pagos') }),
        StatTile({ label: 'Saldo por Cobrar Total', value: formatCurrency(totalPending), meta: 'Folios abiertos + CxC corporativa', tone: totalPending > 0 ? 'warning' : 'default', onClick: () => navigateToView('/finanzas', 'cxc') }),
        StatTile({ label: 'Gastos Operativos', value: formatCurrency(totalExpenses), meta: `Margen neto est. ${formatCurrency(totalBilled - totalExpenses)}`, onClick: () => navigateToView('/finanzas', 'gastos') })
      );
      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm4-finanzas',
          moduleName: 'Módulo 04 - Facturación y Finanzas',
          title: 'Asistente IA Financiero y Detección de Anomalías',
          description: 'Analiza flujo de caja, riesgo de morosidad en CxC, desviaciones de gastos y proyección tributaria.',
          suggestedPrompts: [
            'Analiza el flujo de ingresos vs gastos actuales e identifica posibles anomalías de costos.',
            'Evalúa la cartera de Cuentas por Cobrar y prioriza gestiones de cobranza.',
            'Resume el estado de la caja del turno actual y los saldos abiertos en folios antes de check-out.',
          ],
          contextData: {
            totalCargosFolios: totalBilled,
            totalCobrado: totalCollected,
            saldoPendienteTotal: totalPending,
            totalGastos: totalExpenses,
            cxc: state.receivables,
            cajaActiva: activeCashShift,
          },
        })
      );
    } else if (activeTab === 'folios') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.folios);
      tabBody = view;

      const renderFolioList = () => {
        const q = m4Ui.search.trim().toLowerCase();
        const filtered = state.folios.filter((f) => !q || f.code.toLowerCase().includes(q) || f.guestName.toLowerCase().includes(q) || f.roomNumber.includes(q));
        mountRef(
          tabBody,
          'folios-list',
          filtered.map((f) => {
            const btn = clone('item-folio-lista');
            if (selectedFolio?.id === f.id) btn.classList.add('bg-teal-soft');
            setText(btn, 'code-room', `${f.code} · Hab. ${f.roomNumber}`);
            mountRef(btn, 'status', StatusText({ label: f.status, variant: getStatusVariant(f.status) }));
            setText(btn, 'guest', f.guestName);
            setText(btn, 'total', `Total: ${formatCurrency(f.totalCharges)}`);
            const balEl = getRef(btn, 'balance');
            balEl.textContent = `Saldo: ${formatCurrency(f.balance)}`;
            balEl.classList.add(f.balance > 0 ? 'text-danger' : 'text-success');
            btn.addEventListener('click', () => {
              m4Ui.selectedFolioId = f.id;
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
          value: m4Ui.search,
          placeholder: 'Buscar folio, huésped o hab...',
          focusId: 'm4-folios-search',
          onChange: (v) => {
            m4Ui.search = v;
            renderFolioList();
          },
        })
      );
      renderFolioList();

      if (selectedFolio) {
        const detail = clone('detalle-folio');
        setText(detail, 'code-room', `${selectedFolio.code} · Hab. ${selectedFolio.roomNumber}`);
        setText(detail, 'guest', selectedFolio.guestName);
        setText(detail, 'opened-at', `Abierto: ${selectedFolio.openedAt}`);

        setVisible(detail, 'charge-btn', canEditCurrentTab);
        if (canEditCurrentTab) {
          mountRef(detail, 'charge-icon', icon('plus', 'w-3.5'));
          getRef(detail, 'charge-btn').addEventListener('click', () => openManualChargeModal(selectedFolio));
        }

        const showCollect = erpStore.canEditTab('m4', 'pagos') && selectedFolio.balance > 0;
        setVisible(detail, 'collect-btn', showCollect);
        if (showCollect) {
          getRef(detail, 'collect-btn').addEventListener('click', () => navigateToView('/finanzas', 'pagos'));
        }

        mountRef(
          detail,
          'kpis',
          StatTile({ label: 'Total Cargos', value: formatCurrency(selectedFolio.totalCharges) }),
          StatTile({ label: 'Total Pagos', value: formatCurrency(selectedFolio.totalPayments), tone: 'success' }),
          StatTile({ label: 'Saldo Pendiente', value: formatCurrency(selectedFolio.balance), tone: selectedFolio.balance > 0 ? 'danger' : 'teal' })
        );

        mountRef(
          detail,
          'charges-tbody',
          selectedFolio.charges.map((c) => {
            const row = clone('fila-cargo-folio');
            setText(row, 'date', c.date);
            setText(row, 'source', c.sourceModule);
            setText(row, 'desc', c.description);
            if (c.referenceCode) {
              setVisible(row, 'ref-code', true);
              setText(row, 'ref-code', `(${c.referenceCode})`);
            }
            setText(row, 'amount', formatCurrency(c.amount));
            return row;
          })
        );
        mountRef(tabBody, 'detail-slot', detail);
      } else {
        mountRef(
          tabBody,
          'detail-slot',
          EmptyState({ iconName: 'receipt', title: 'Selecciona un folio', description: 'Elige una cuenta de huésped para ver el detalle.' })
        );
      }
    } else if (activeTab === 'facturacion') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.facturacion);
      tabBody = view;
      setVisible(tabBody, 'issue-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'issue-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'issue-btn').addEventListener('click', openIssueInvoiceModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.invoices.map((inv) => {
          const row = clone('fila-comprobante');
          setText(row, 'series-num', `${inv.series}-${inv.number}`);
          setText(row, 'type', inv.type);
          setText(row, 'customer-name', inv.customerName);
          setText(row, 'customer-doc', inv.customerDoc);
          setText(row, 'total', formatCurrency(inv.total));
          mountRef(row, 'status', StatusText({ label: inv.status, variant: getStatusVariant(inv.status) }));
          getRef(row, 'preview-btn').addEventListener('click', () => openPreviewInvoiceModal(inv));

          const showVoid = canEditCurrentTab && inv.status !== 'Anulada';
          setVisible(row, 'void-btn', showVoid);
          if (showVoid) {
            getRef(row, 'void-btn').addEventListener('click', () => erpStore.voidInvoice(inv.id));
          }
          return row;
        })
      );
    } else if (activeTab === 'pagos') {
      const openPaymentFolios = state.folios.filter((f) => f.balance > 0.01);
      if (!m4Ui.payAmount && selectedFolio) m4Ui.payAmount = String(selectedFolio.balance || '');

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.pagos);
      tabBody = view;
      mountRef(tabBody, 'pay-icon', icon('creditCard', 'w-4 text-teal'));

      const folioSel = getRef(tabBody, 'folio-select');
      mount(
        folioSel,
        state.folios.map((f) =>
          h('option', { value: f.id, selected: selectedFolio?.id === f.id }, `${f.code} · Hab. ${f.roomNumber} · ${f.guestName} (Saldo: ${formatCurrency(f.balance)})`)
        )
      );
      if (selectedFolio) folioSel.value = selectedFolio.id;
      folioSel.addEventListener('change', (e) => {
        m4Ui.selectedFolioId = e.target.value;
        const found = state.folios.find((x) => x.id === e.target.value);
        if (found) m4Ui.payAmount = String(found.balance);
        renderContent();
      });

      const methodSel = getRef(tabBody, 'method-select');
      methodSel.value = m4Ui.payMethod;
      methodSel.addEventListener('change', (e) => {
        m4Ui.payMethod = e.target.value;
      });

      const amtIn = getRef(tabBody, 'amount-input');
      amtIn.value = m4Ui.payAmount || String(selectedFolio?.balance || 0);
      amtIn.addEventListener('input', (e) => {
        m4Ui.payAmount = e.target.value;
      });

      const refIn = getRef(tabBody, 'ref-input');
      refIn.value = m4Ui.payRef;
      refIn.addEventListener('input', (e) => {
        m4Ui.payRef = e.target.value;
      });

      setVisible(tabBody, 'confirm-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'confirm-icon', icon('check', 'w-4'));
        getRef(tabBody, 'confirm-btn').addEventListener('click', () => {
          const amt = Number(m4Ui.payAmount || selectedFolio?.balance || 0);
          if (!selectedFolio || amt <= 0) return;
          erpStore.registerFolioPayment(selectedFolio.id, amt, m4Ui.payMethod, m4Ui.payRef);
          m4Ui.payRef = '';
          m4Ui.payAmount = '';
        });
      }

      setText(tabBody, 'pending-title', `Folios con Saldo Pendiente (${openPaymentFolios.length})`);
      mountRef(
        tabBody,
        'pending-list',
        openPaymentFolios.length === 0
          ? clone('pagos-todos-liquidados')
          : openPaymentFolios.map((f) => {
              const row = clone('fila-folio-pendiente');
              setText(row, 'title', `${f.code} · ${f.guestName}`);
              setText(row, 'room', `Hab. ${f.roomNumber}`);
              setText(row, 'balance', formatCurrency(f.balance));
              return row;
            })
      );
    } else if (activeTab === 'cxc') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.cxc);
      tabBody = view;
      mountRef(
        tabBody,
        'tbody',
        state.receivables.map((ar) => {
          const row = clone('fila-cxc');
          setText(row, 'client', ar.clientName);
          setText(row, 'note', ar.followUpNote || '');
          setText(row, 'doc', ar.documentRef);
          setText(row, 'due', ar.dueDate);
          setText(row, 'pending', formatCurrency(ar.pendingAmount));
          mountRef(row, 'status', StatusText({ label: ar.status, variant: getStatusVariant(ar.status) }));

          const canPay = ar.pendingAmount > 0 && canEditCurrentTab;
          setVisible(row, 'pay-btn', canPay);
          setVisible(row, 'done-label', !canPay);
          if (canPay) {
            getRef(row, 'pay-btn').addEventListener('click', () =>
              erpStore.registerReceivablePayment(ar.id, ar.pendingAmount, 'Liquidación total registrada')
            );
          } else {
            setText(row, 'done-label', ar.status);
          }
          return row;
        })
      );
    } else if (activeTab === 'caja') {
      const { root: cajaWrapper, clone } = loadViewTemplate(VIEW_HTML.caja);
      tabBody = cajaWrapper;

      if (!activeCashShift) {
        const closedView = clone('vista-caja-cerrada');
        setVisible(closedView, 'open-shift-btn', canEditCurrentTab);
        if (canEditCurrentTab) {
          getRef(closedView, 'open-shift-btn').addEventListener('click', () => erpStore.openCashShift(1500));
        }
        mount(tabBody, closedView);
      } else {
        const openView = clone('vista-caja-abierta');
        mountRef(
          openView,
          'kpis',
          StatTile({ label: 'Saldo Inicial', value: formatCurrency(activeCashShift.openingBalance) }),
          StatTile({ label: 'Ingresos Turno', value: formatCurrency(activeCashShift.totalInflows), tone: 'success' }),
          StatTile({ label: 'Egresos Turno', value: formatCurrency(activeCashShift.totalOutflows), tone: 'danger' }),
          StatTile({ label: 'Saldo Esperado', value: formatCurrency(activeCashShift.expectedBalance), tone: 'teal' })
        );

        setVisible(openView, 'controls-grid', canEditCurrentTab);
        if (canEditCurrentTab) {
          const typeSel = getRef(openView, 'move-type');
          const methodSel = getRef(openView, 'move-method');
          const conceptIn = getRef(openView, 'move-concept');
          const amtIn = getRef(openView, 'move-amount');
          const countedIn = getRef(openView, 'close-counted');

          typeSel.value = m4Ui.cashMoveType;
          methodSel.value = m4Ui.cashMoveMethod;
          conceptIn.value = m4Ui.cashMoveConcept;
          amtIn.value = m4Ui.cashMoveAmount;
          countedIn.placeholder = `Monto contado (esperado: ${activeCashShift.expectedBalance})`;
          countedIn.value = m4Ui.countedClose;

          typeSel.addEventListener('change', (e) => { m4Ui.cashMoveType = e.target.value; });
          methodSel.addEventListener('change', (e) => { m4Ui.cashMoveMethod = e.target.value; });
          conceptIn.addEventListener('input', (e) => { m4Ui.cashMoveConcept = e.target.value; });
          amtIn.addEventListener('input', (e) => { m4Ui.cashMoveAmount = e.target.value; });
          countedIn.addEventListener('input', (e) => { m4Ui.countedClose = e.target.value; });

          getRef(openView, 'add-move-btn').addEventListener('click', () => {
            const amt = Number(m4Ui.cashMoveAmount);
            if (!m4Ui.cashMoveConcept.trim() || amt <= 0) return;
            erpStore.addCashMovement(m4Ui.cashMoveType, m4Ui.cashMoveMethod, m4Ui.cashMoveConcept, amt);
            m4Ui.cashMoveConcept = '';
            m4Ui.cashMoveAmount = '';
          });

          getRef(openView, 'close-shift-btn').addEventListener('click', () => {
            erpStore.closeCashShift(Number(m4Ui.countedClose || activeCashShift.expectedBalance));
          });
        }

        setText(openView, 'movements-title', `Movimientos del Turno (${activeCashShift.cashier})`);
        mountRef(
          openView,
          'movements-list',
          activeCashShift.movements.map((mv) => {
            const row = clone('fila-movimiento-caja');
            setText(row, 'title', `${mv.type} · ${mv.concept}`);
            setText(row, 'meta', `${mv.time} · ${mv.method}`);
            const amtEl = getRef(row, 'amount');
            amtEl.textContent = `${mv.type === 'Ingreso' ? '+' : '-'}${formatCurrency(mv.amount)}`;
            amtEl.classList.add(mv.type === 'Ingreso' ? 'text-success' : 'text-danger');
            return row;
          })
        );
        mount(tabBody, openView);
      }
    } else if (activeTab === 'gastos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.gastos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openExpenseModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.expenses.map((ex) => {
          const row = clone('fila-gasto');
          setText(row, 'date', ex.date);
          setText(row, 'cost-center', ex.costCenter);
          setText(row, 'supplier', ex.supplier);
          setText(row, 'description', ex.description);
          setText(row, 'amount', formatCurrency(ex.amount));
          mountRef(row, 'status', StatusText({ label: ex.status, variant: getStatusVariant(ex.status) }));
          return row;
        })
      );
    } else if (activeTab === 'costos') {
      const costCenters = [
        { area: 'Alojamiento', presupuesto: 4200, ejecutado: 3150 },
        { area: 'Alimentos/POS', presupuesto: 3800, ejecutado: 2920 },
        { area: 'Mantenimiento', presupuesto: 2200, ejecutado: 1980 },
        { area: 'Administración', presupuesto: 3200, ejecutado: 2950 },
        { area: 'Comercial', presupuesto: 1600, ejecutado: 1120 },
      ];
      const { root: view } = loadViewTemplate(VIEW_HTML.costos);
      tabBody = view;
      setText(tabBody, 'title', 'Presupuesto vs. Gasto Ejecutado por Centro de Costos');
      setText(tabBody, 'subtitle', 'Comparativa de control presupuestario en PEN (S/)');
      mountRef(
        tabBody,
        'chart-slot',
        renderGroupedBarChart({
          data: costCenters,
          labelKey: 'area',
          series: [
            { key: 'presupuesto', name: 'Presupuesto', color: '#0B1F3A' },
            { key: 'ejecutado', name: 'Ejecutado', color: '#0D9488' },
          ],
          formatValue: (v) => formatCurrency(v),
          height: 260,
        })
      );
    } else if (activeTab === 'reportes') {
      const projectionSeries = [
        { month: 'Jul', ingresos: 84500, gastos: 42100 },
        { month: 'Ago', ingresos: 91200, gastos: 44300 },
        { month: 'Set', ingresos: 87400, gastos: 43800 },
        { month: 'Oct', ingresos: 95800, gastos: 46100 },
        { month: 'Nov (Est)', ingresos: 102400, gastos: 48200 },
        { month: 'Dic (Proy)', ingresos: 118900, gastos: 52500 },
      ];
      const { root: view } = loadViewTemplate(VIEW_HTML.reportes);
      tabBody = view;
      setText(tabBody, 'title', 'Evolución y Proyección de Ingresos vs. Gastos');
      setText(tabBody, 'subtitle', 'Tendencia semestral y estimación de cierre Q4');
      mountRef(
        tabBody,
        'chart-slot',
        renderAreaComparisonChart({
          data: projectionSeries,
          labelKey: 'month',
          series: [
            { key: 'ingresos', name: 'Ingresos', color: '#0D9488' },
            { key: 'gastos', name: 'Gastos', color: '#0B1F3A' },
          ],
          formatValue: (v) => formatCurrency(v),
          height: 260,
        })
      );
    } else if (activeTab === 'sunat') {
      const sunatTarget = state.invoices.find((i) => i.id === m4Ui.sunatXmlPreviewId) || state.invoices[0];
      const xmlPreview = sunatTarget
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>\n  <cbc:ID>${sunatTarget.series}-${sunatTarget.number}</cbc:ID>\n  <cbc:IssueDate>${sunatTarget.issuedAt.slice(0, 10)}</cbc:IssueDate>\n  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>\n  <cac:AccountingSupplierParty><cbc:CustomerAssignedAccountID>20601234561</cbc:CustomerAssignedAccountID></cac:AccountingSupplierParty>\n  <cac:AccountingCustomerParty><cbc:AdditionalAccountID>${sunatTarget.customerDoc}</cbc:AdditionalAccountID></cac:AccountingCustomerParty>\n  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">${sunatTarget.igv.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>\n  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="PEN">${sunatTarget.total.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>\n</Invoice>`
        : 'Sin comprobantes emitidos.';

      const { root: view } = loadViewTemplate(VIEW_HTML.sunat);
      tabBody = view;
      const invSel = getRef(tabBody, 'invoice-select');
      mount(
        invSel,
        state.invoices.map((i) => h('option', { value: i.id, selected: sunatTarget?.id === i.id }, `${i.series}-${i.number} (${i.customerName})`))
      );
      if (sunatTarget) invSel.value = sunatTarget.id;
      invSel.addEventListener('change', (e) => {
        m4Ui.sunatXmlPreviewId = e.target.value;
        renderContent();
      });
      setText(tabBody, 'xml-pre', xmlPreview);
    }

    const activeMeta = M4_TABS.find((t) => t.id === activeTab) || M4_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'MÓDULO 04 · FINANZAS Y FACTURACIÓN',
        title: activeMeta.label,
        subtitle: activeMeta.subtitle,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
