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
import modalesHtml from '../../html/modules/servicios/modales.html?raw';
import resumenHtml from '../../html/modules/servicios/resumen.html?raw';
import posHtml from '../../html/modules/servicios/pos.html?raw';
import restauranteHtml from '../../html/modules/servicios/restaurante.html?raw';
import roomServiceHtml from '../../html/modules/servicios/room-service.html?raw';
import minibarHtml from '../../html/modules/servicios/minibar.html?raw';
import serviciosCompHtml from '../../html/modules/servicios/servicios-complementarios.html?raw';
import productosHtml from '../../html/modules/servicios/productos.html?raw';
import inventarioHtml from '../../html/modules/servicios/inventario.html?raw';
import proveedoresHtml from '../../html/modules/servicios/proveedores.html?raw';
import recetasHtml from '../../html/modules/servicios/recetas.html?raw';
import consumoHtml from '../../html/modules/servicios/consumo.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
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
  pos: posHtml,
  restaurante: restauranteHtml,
  room_service: roomServiceHtml,
  minibar: minibarHtml,
  servicios_comp: serviciosCompHtml,
  productos: productosHtml,
  inventario: inventarioHtml,
  proveedores: proveedoresHtml,
  recetas: recetasHtml,
  consumo: consumoHtml,
};

const M3_TABS = [
  { id: 'resumen', label: 'Resumen Servicios & Almacén', subtitle: 'Ventas POS consolidadas, comandas activas, alertas de stock e IA logística.' },
  { id: 'pos', label: 'Punto de Venta (POS)', subtitle: 'Terminal táctil de comandas con cargo automático a Folio de habitación (Flujo C).' },
  { id: 'restaurante', label: 'Restaurante y Bar', subtitle: 'Plano de mesas en tiempo real y despacho de comandas a cocina/bar.' },
  { id: 'room_service', label: 'Room Service', subtitle: 'Control de pedidos a habitación sincronizados con Finanzas (M4).' },
  { id: 'minibar', label: 'Minibar', subtitle: 'Reposición y cargos de consumos en minibar de habitaciones.' },
  { id: 'servicios_comp', label: 'Servicios Complementarios', subtitle: 'Tarifario oficial de Spa, Lavandería, Traslados, Tours y Eventos.' },
  { id: 'productos', label: 'Catálogo de Productos', subtitle: 'Gestión de carta POS, precios de venta, costos y existencias.' },
  { id: 'inventario', label: 'Inventario y Almacén (Kardex)', subtitle: 'Atención de requisiciones internas (Flujo D), lotes y movimientos Kardex.' },
  { id: 'proveedores', label: 'Proveedores y Compras', subtitle: 'Directorio homologado, órdenes de compra e integración financiera (M4).' },
  { id: 'recetas', label: 'Recetas y Escandallos', subtitle: 'Estandarización de ingredientes, costo por plato y margen operativo.' },
  { id: 'consumo', label: 'Control de Consumo y Mermas', subtitle: 'Proyección de quiebres de stock y valorización por área.' },
];

const m3Ui = {
  search: '',
  posCategory: 'Todos',
  posOrigin: 'Restaurante',
  posTable: 'M-01',
  posPaymentMode: 'Cargo a Habitación',
  posFolioId: '',
  cart: [],
};

export function renderServiciosPOSModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Entregado', 'Libre', 'Disponible', 'Óptimo', 'Recibida', 'Despachada', 'Activo'].includes(status)) return 'success';
    if (['En preparación', 'En cocina', 'Pendiente', 'Ocupada', 'Solicitada', 'Aprobada', 'Por vencer'].includes(status)) return 'warning';
    if (['Stock Crítico', 'Agotado', 'Reservada'].includes(status)) return 'danger';
    return 'info';
  }

  function addToCart(prod) {
    const existing = m3Ui.cart.find((c) => c.productId === prod.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      m3Ui.cart.push({
        productId: prod.id,
        name: prod.name,
        quantity: 1,
        unitPrice: prod.price,
      });
    }
    renderContent();
  }

  function updateCartQty(productId, delta) {
    m3Ui.cart = m3Ui.cart
      .map((c) => (c.productId === productId ? { ...c, quantity: c.quantity + delta } : c))
      .filter((c) => c.quantity > 0);
    renderContent();
  }

  function openProductModal(editing) {
    const initial = editing
      ? { ...editing }
      : { code: 'PRD-NEW', name: '', category: 'Alimentos', price: 32, cost: 11, stock: 25, active: true };
    openModal({
      title: editing ? `Editar Producto ${editing.code}` : 'Nuevo Producto en Catálogo',
      renderBody: (close) => {
        const form = cloneModal('modal-producto');
        const codeIn = getRef(form, 'code');
        const nameIn = getRef(form, 'name');
        const catSel = getRef(form, 'category');
        const priceIn = getRef(form, 'price');
        const costIn = getRef(form, 'cost');
        const stockIn = getRef(form, 'stock');

        codeIn.value = initial.code;
        nameIn.value = initial.name;
        catSel.value = initial.category;
        priceIn.value = String(initial.price);
        costIn.value = String(initial.cost);
        stockIn.value = String(initial.stock);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertProduct({
            ...initial,
            code: codeIn.value.trim(),
            name: nameIn.value.trim(),
            category: catSel.value,
            price: Number(priceIn.value),
            cost: Number(costIn.value),
            stock: Number(stockIn.value),
          });
          close();
        });
        return form;
      },
    });
  }

  function openServiceModal(editing) {
    const initial = editing
      ? { ...editing }
      : { name: '', area: 'Spa', durationOrUnit: '60 min', price: 180, active: true };
    openModal({
      title: editing ? `Editar Servicio · ${editing.name}` : 'Nuevo Servicio Complementario',
      renderBody: (close) => {
        const form = cloneModal('modal-servicio');
        const nameIn = getRef(form, 'name');
        const areaSel = getRef(form, 'area');
        const durIn = getRef(form, 'duration');
        const priceIn = getRef(form, 'price');

        nameIn.value = initial.name;
        areaSel.value = initial.area;
        durIn.value = initial.durationOrUnit;
        priceIn.value = String(initial.price);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertService({
            ...initial,
            name: nameIn.value.trim(),
            area: areaSel.value,
            durationOrUnit: durIn.value.trim(),
            price: Number(priceIn.value),
          });
          close();
        });
        return form;
      },
    });
  }

  function openInventoryMoveModal(item) {
    openModal({
      title: `Movimiento Kardex · ${item.name}`,
      subtitle: `Stock actual: ${item.stock} ${item.unit}`,
      renderBody: (close) => {
        const form = cloneModal('modal-kardex');
        const typeSel = getRef(form, 'type');
        const qtyIn = getRef(form, 'qty');
        const refIn = getRef(form, 'ref');

        setText(form, 'qty-label', `Cantidad (${item.unit})`);
        qtyIn.value = '10';
        refIn.value = 'Ajuste manual Almacén';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.adjustInventory(item.id, typeSel.value, Number(qtyIn.value), refIn.value);
          close();
        });
        return form;
      },
    });
  }

  function openInventoryCreateModal() {
    openModal({
      title: 'Registrar Nuevo Insumo en Almacén',
      renderBody: (close) => {
        const form = cloneModal('modal-insumo');
        const skuIn = getRef(form, 'sku');
        const nameIn = getRef(form, 'name');
        const catSel = getRef(form, 'category');
        const unitIn = getRef(form, 'unit');
        const stockIn = getRef(form, 'stock');
        const minIn = getRef(form, 'min-stock');
        const costIn = getRef(form, 'unit-cost');
        const locIn = getRef(form, 'location');

        skuIn.value = 'ALM-NEW';
        unitIn.value = 'Unidades';
        stockIn.value = '20';
        minIn.value = '10';
        costIn.value = '15';
        locIn.value = 'Almacén Central';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertInventoryItem({
            sku: skuIn.value.trim(),
            name: nameIn.value.trim(),
            category: catSel.value,
            unit: unitIn.value.trim(),
            stock: Number(stockIn.value),
            minStock: Number(minIn.value),
            unitCost: Number(costIn.value),
            location: locIn.value.trim(),
            expiryDate: '2027-06-30',
            batch: 'L-2611',
          });
          close();
        });
        return form;
      },
    });
  }

  function openSupplierModal() {
    openModal({
      title: 'Registrar Nuevo Proveedor',
      renderBody: (close) => {
        const form = cloneModal('modal-proveedor');
        const nameIn = getRef(form, 'name');
        const rucIn = getRef(form, 'ruc');
        const catIn = getRef(form, 'category');
        const contactIn = getRef(form, 'contact');
        const phoneIn = getRef(form, 'phone');
        const leadIn = getRef(form, 'lead-time');

        catIn.value = 'Alimentos y Bebidas';
        leadIn.value = '2';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertSupplier({
            name: nameIn.value.trim(),
            ruc: rucIn.value.trim(),
            category: catIn.value.trim(),
            contactName: contactIn.value.trim(),
            phone: phoneIn.value.trim(),
            leadTimeDays: Number(leadIn.value),
            active: true,
          });
          close();
        });
        return form;
      },
    });
  }

  function openPurchaseOrderModal(prelinkedReq) {
    const state = erpStore.state;
    const defaultItem = prelinkedReq
      ? state.inventory.find((i) => i.id === prelinkedReq.inventoryItemId) || state.inventory[0]
      : state.inventory[0];

    openModal({
      title: 'Nueva Orden de Compra a Proveedor',
      subtitle: prelinkedReq
        ? `Vinculada a Requisición ${prelinkedReq.code} (Flujo D)`
        : 'Al recepcionar incrementa stock y genera egreso en Finanzas (M4).',
      renderBody: (close) => {
        const form = cloneModal('modal-orden-compra');
        const supSel = getRef(form, 'supplier');
        const itemSel = getRef(form, 'item');
        const qtyIn = getRef(form, 'qty');
        const costIn = getRef(form, 'unit-cost');

        mount(supSel, state.suppliers.map((sup) => h('option', { value: sup.id }, `${sup.name} (${sup.category})`)));
        mount(
          itemSel,
          state.inventory.map((inv) =>
            h('option', { value: inv.id, selected: defaultItem?.id === inv.id }, `${inv.name} (Stock: ${inv.stock} ${inv.unit})`)
          )
        );
        if (defaultItem) itemSel.value = defaultItem.id;
        qtyIn.value = String(prelinkedReq ? prelinkedReq.quantity : Math.max(10, (defaultItem?.minStock || 10) * 2));
        costIn.value = String(defaultItem?.unitCost || 15);

        itemSel.addEventListener('change', () => {
          const inv = state.inventory.find((i) => i.id === itemSel.value);
          if (inv) costIn.value = String(inv.unitCost);
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const item = state.inventory.find((i) => i.id === itemSel.value);
          if (!item) return;
          erpStore.createPurchaseOrder({
            supplierId: supSel.value,
            linkedRequisitionId: prelinkedReq?.id,
            items: [{
              inventoryItemId: item.id,
              itemName: item.name,
              quantity: Number(qtyIn.value),
              unitCost: Number(costIn.value),
            }],
          });
          close();
        });
        return form;
      },
    });
  }

  function openRecipeModal() {
    const state = erpStore.state;
    openModal({
      title: 'Configurar Receta y Costeo Estándar',
      renderBody: (close) => {
        const form = cloneModal('modal-receta');
        const prodSel = getRef(form, 'product');
        const saleIn = getRef(form, 'sale-price');
        const ing1Sel = getRef(form, 'ing1');
        const ing1Qty = getRef(form, 'ing1-qty');
        const ing2Sel = getRef(form, 'ing2');
        const ing2Qty = getRef(form, 'ing2-qty');

        mount(prodSel, state.products.map((p) => h('option', { value: p.id }, `${p.name} (${formatCurrency(p.price)})`)));
        mount(ing1Sel, state.inventory.map((i) => h('option', { value: i.id }, `${i.name} (${i.unit})`)));
        mount(ing2Sel, state.inventory.map((i) => h('option', { value: i.id }, `${i.name} (${i.unit})`)));

        saleIn.value = String(state.products[0]?.price || 48);
        if (state.inventory[0]) ing1Sel.value = state.inventory[0].id;
        ing1Qty.value = '0.25';
        if (state.inventory[1]) ing2Sel.value = state.inventory[1].id;
        ing2Qty.value = '0.15';

        prodSel.addEventListener('change', () => {
          const p = state.products.find((x) => x.id === prodSel.value);
          if (p) saleIn.value = String(p.price);
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const prod = state.products.find((p) => p.id === prodSel.value);
          const i1 = state.inventory.find((i) => i.id === ing1Sel.value);
          const i2 = state.inventory.find((i) => i.id === ing2Sel.value);
          if (!prod || !i1) return;
          const ingredients = [{ inventoryItemId: i1.id, itemName: i1.name, quantity: Number(ing1Qty.value), unit: i1.unit, unitCost: i1.unitCost }];
          if (i2 && i2.id !== i1.id && Number(ing2Qty.value) > 0) {
            ingredients.push({ inventoryItemId: i2.id, itemName: i2.name, quantity: Number(ing2Qty.value), unit: i2.unit, unitCost: i2.unitCost });
          }
          const recipeCost = Number(ingredients.reduce((s, x) => s + x.quantity * x.unitCost, 0).toFixed(2));
          const sp = Number(saleIn.value);
          const marginPct = sp > 0 ? Math.round(((sp - recipeCost) / sp) * 100) : 0;
          erpStore.upsertRecipe({ productId: prod.id, productName: prod.name, salePrice: sp, recipeCost, marginPct, ingredients });
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
    const visibleTabs = M3_TABS.filter((t) => erpStore.canViewTab('m3', t.id));
    const defaultTab = erpStore.getDefaultTab('m3') || visibleTabs[0]?.id || 'resumen';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m3', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m3', activeTab);

    const openFolios = state.folios.filter((f) => f.status === 'Abierto');
    if (!m3Ui.posFolioId && openFolios.length > 0) m3Ui.posFolioId = openFolios[0].id;

    const totalPosSales = state.posOrders.reduce((s, o) => s + o.total, 0);
    const lowStockItems = state.inventory.filter((i) => i.stock <= i.minStock);
    const pendingReqs = state.supplyRequisitions.filter((r) => r.status === 'Solicitada');
    const activeKitchen = state.posOrders.filter((o) => o.status !== 'Entregado').length;

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `M03 · ${M3_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        scopeSummary: currentPermissions?.scopeSummary,
        onBack: () => navigateToView('/servicios', defaultTab, true),
      });
    } else if (activeTab === 'resumen') {
      const { root: view } = loadViewTemplate(VIEW_HTML.resumen);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Consumos POS Registrados', value: formatCurrency(totalPosSales), meta: `${state.posOrders.length} comandas · Cargos automáticos M4`, tone: 'teal', onClick: () => navigateToView('/servicios', 'pos') }),
        StatTile({ label: 'Pedidos Activos Cocina/Bar', value: activeKitchen, meta: 'Restaurante y Room Service', onClick: () => navigateToView('/servicios', 'restaurante') }),
        StatTile({ label: 'Insumos bajo Stock Mínimo', value: lowStockItems.length, meta: `${pendingReqs.length} requisiciones pendientes`, tone: lowStockItems.length > 0 ? 'warning' : 'success', onClick: () => navigateToView('/servicios', 'inventario') }),
        StatTile({ label: 'Órdenes de Compra', value: state.purchaseOrders.length, meta: `${state.purchaseOrders.filter((p) => p.status !== 'Recibida').length} por recepcionar`, onClick: () => navigateToView('/servicios', 'proveedores') })
      );
      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm3-pos-almacen',
          moduleName: 'Módulo 03 - Servicios, POS, Restaurante y Almacén',
          title: 'Asistente IA de Compras, Recetas y Reposición',
          description: 'Predicción de quiebres de stock, cálculo sugerido de compras y análisis de mermas.',
          suggestedPrompts: [
            'Analiza el inventario actual y sugiere cantidades óptimas de reposición urgente antes del fin de semana.',
            'Evalúa los márgenes de nuestras recetas y qué platos conviene impulsar en POS.',
            'Resume los requerimientos pendientes de Housekeeping (Flujo D) y si el almacén tiene stock suficiente.',
          ],
          contextData: {
            inventarioBajoMinimo: lowStockItems,
            requisicionesPendientes: pendingReqs,
            recetas: state.recipes,
            ordenesPOS: state.posOrders.slice(0, 6),
          },
        })
      );
    } else if (activeTab === 'pos') {
      const cartTotal = m3Ui.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
      const selectedFolio = openFolios.find((f) => f.id === m3Ui.posFolioId);
      const filteredProducts = state.products.filter(
        (p) => p.active && (m3Ui.posCategory === 'Todos' || p.category === m3Ui.posCategory)
      );

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.pos);
      tabBody = view;
      mountRef(tabBody, 'info-icon', icon('info', 'w-4 shrink-0'));
      mountRef(tabBody, 'cart-icon', icon('shoppingCart', 'w-4 text-teal'));

      const catGroup = getRef(tabBody, 'categories');
      catGroup.querySelectorAll('button[data-cat]').forEach((btn) => {
        const cat = btn.dataset.cat;
        btn.classList.toggle('is-active', m3Ui.posCategory === cat);
        btn.addEventListener('click', () => {
          m3Ui.posCategory = cat;
          renderContent();
        });
      });

      mountRef(
        tabBody,
        'products-grid',
        filteredProducts.map((p) => {
          const btn = clone('pos-producto-btn');
          btn.disabled = !canEditCurrentTab || p.stock <= 0;
          setText(btn, 'name', p.name);
          setText(btn, 'price', formatCurrency(p.price));
          setText(btn, 'meta', `${p.category} · Stock: ${p.stock}`);
          btn.addEventListener('click', () => addToCart(p));
          return btn;
        })
      );

      const originSel = getRef(tabBody, 'origin');
      const paySel = getRef(tabBody, 'payment-mode');
      originSel.value = m3Ui.posOrigin;
      paySel.value = m3Ui.posPaymentMode;
      originSel.addEventListener('change', (e) => {
        m3Ui.posOrigin = e.target.value;
        renderContent();
      });
      paySel.addEventListener('change', (e) => {
        m3Ui.posPaymentMode = e.target.value;
        renderContent();
      });

      setVisible(tabBody, 'table-wrap', m3Ui.posOrigin === 'Restaurante');
      const tableSel = getRef(tabBody, 'table-select');
      mount(
        tableSel,
        state.restaurantTables.map((t) => h('option', { value: t.code, selected: m3Ui.posTable === t.code }, `${t.code} (${t.status})`))
      );
      tableSel.value = m3Ui.posTable;
      tableSel.addEventListener('change', (e) => {
        m3Ui.posTable = e.target.value;
      });

      setVisible(tabBody, 'folio-wrap', m3Ui.posPaymentMode === 'Cargo a Habitación');
      const folioSel = getRef(tabBody, 'folio-select');
      mount(
        folioSel,
        openFolios.length === 0
          ? h('option', { value: '' }, 'Sin folios abiertos (Check-in requerido)')
          : openFolios.map((f) => h('option', { value: f.id, selected: m3Ui.posFolioId === f.id }, `Hab. ${f.roomNumber} · ${f.guestName} (${f.code})`))
      );
      if (m3Ui.posFolioId) folioSel.value = m3Ui.posFolioId;
      folioSel.addEventListener('change', (e) => {
        m3Ui.posFolioId = e.target.value;
        renderContent();
      });

      mountRef(
        tabBody,
        'cart-list',
        m3Ui.cart.length === 0
          ? clone('pos-carrito-vacio')
          : m3Ui.cart.map((c) => {
              const itemEl = clone('pos-carrito-item');
              setText(itemEl, 'name', c.name);
              setText(itemEl, 'unit-price', `${formatCurrency(c.unitPrice)} c/u`);
              setText(itemEl, 'qty', String(c.quantity));
              setText(itemEl, 'subtotal', formatCurrency(c.quantity * c.unitPrice));
              mountRef(itemEl, 'dec-btn', icon('minus', 'w-3'));
              mountRef(itemEl, 'inc-btn', icon('plus', 'w-3'));
              getRef(itemEl, 'dec-btn').addEventListener('click', () => updateCartQty(c.productId, -1));
              getRef(itemEl, 'inc-btn').addEventListener('click', () => updateCartQty(c.productId, 1));
              return itemEl;
            })
      );

      setText(tabBody, 'cart-total', formatCurrency(cartTotal));
      setVisible(tabBody, 'submit-btn', canEditCurrentTab);
      const submitBtn = getRef(tabBody, 'submit-btn');
      if (submitBtn && canEditCurrentTab) {
        submitBtn.disabled = m3Ui.cart.length === 0;
        mountRef(tabBody, 'submit-icon', icon('check', 'w-4'));
        setText(tabBody, 'submit-label', m3Ui.posPaymentMode === 'Cargo a Habitación' ? 'Confirmar y Cargar a Habitación' : 'Registrar Venta Directa');
        submitBtn.addEventListener('click', () => {
          const res = erpStore.createPOSOrder({
            origin: m3Ui.posOrigin,
            tableCode: m3Ui.posOrigin === 'Restaurante' ? m3Ui.posTable : undefined,
            folioId: m3Ui.posPaymentMode === 'Cargo a Habitación' ? selectedFolio?.id : undefined,
            roomNumber: m3Ui.posPaymentMode === 'Cargo a Habitación' ? selectedFolio?.roomNumber : undefined,
            guestName: m3Ui.posPaymentMode === 'Cargo a Habitación' ? selectedFolio?.guestName : 'Cliente Externo / Directo',
            paymentMode: m3Ui.posPaymentMode,
            items: m3Ui.cart,
          });
          if (res.ok) {
            m3Ui.cart = [];
            renderContent();
          }
        });
      }
    } else if (activeTab === 'restaurante') {
      const restOrders = state.posOrders.filter((o) => o.origin === 'Restaurante' || o.origin === 'Bar');
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.restaurante);
      tabBody = view;

      mountRef(
        tabBody,
        'tables-grid',
        state.restaurantTables.map((tb) => {
          const card = clone('card-mesa');
          setText(card, 'code-area', `${tb.code} · ${tb.area}`);
          mountRef(card, 'status', StatusText({ label: tb.status, variant: getStatusVariant(tb.status) }));
          setText(card, 'meta', `${tb.seats} comensales ${tb.currentGuests ? `· ${tb.currentGuests}` : ''}`);
          setVisible(card, 'status-select', canEditCurrentTab);
          if (canEditCurrentTab) {
            const sel = getRef(card, 'status-select');
            sel.value = tb.status;
            sel.addEventListener('change', (e) => erpStore.updateTableStatus(tb.id, e.target.value));
          }
          return card;
        })
      );

      mountRef(
        tabBody,
        'orders-list',
        restOrders.map((ord) => {
          const row = clone('fila-comanda-restaurante');
          setText(row, 'title', `${ord.code} · ${ord.tableCode || ord.origin} · ${ord.guestName}`);
          setText(row, 'items', ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', '));
          setText(row, 'total', formatCurrency(ord.total));
          mountRef(row, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
          const showAction = canEditCurrentTab && ord.status !== 'Entregado';
          setVisible(row, 'action-btn', showAction);
          if (showAction) {
            const btn = getRef(row, 'action-btn');
            btn.textContent = ord.status === 'En cocina' ? 'Preparar' : 'Entregar';
            btn.addEventListener('click', () =>
              erpStore.updatePOSOrderStatus(ord.id, ord.status === 'En cocina' ? 'En preparación' : 'Entregado')
            );
          }
          return row;
        })
      );
    } else if (activeTab === 'room_service' || activeTab === 'minibar') {
      const originFilter = activeTab === 'room_service' ? 'Room Service' : 'Minibar';
      const orders = state.posOrders.filter((o) => o.origin === originFilter);
      const { root: view, clone } = loadViewTemplate(VIEW_HTML[activeTab]);
      tabBody = view;
      setVisible(tabBody, 'new-pos-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        getRef(tabBody, 'new-pos-btn').addEventListener('click', () => {
          m3Ui.posOrigin = originFilter;
          navigateToView('/servicios', 'pos');
        });
      }

      if (orders.length === 0) {
        mountRef(
          tabBody,
          'body',
          h('div', { className: 'p-4' }, EmptyState({
            iconName: 'utensils',
            title: `Sin pedidos recientes de ${originFilter}`,
            description: 'Usa el Terminal POS para registrar consumos y cargarlos al folio del huésped.',
          }))
        );
      } else {
        mountRef(
          tabBody,
          'body',
          h(
            'div',
            { className: 'divide-list' },
            orders.map((ord) => {
              const row = clone('fila-pedido-origen');
              setText(row, 'title', `${ord.code} · Hab. ${ord.roomNumber || '—'} · ${ord.guestName}`);
              setText(row, 'items', ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', '));
              setText(row, 'total', formatCurrency(ord.total));
              mountRef(row, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
              const showDeliver = canEditCurrentTab && ord.status !== 'Entregado';
              setVisible(row, 'deliver-btn', showDeliver);
              if (showDeliver) {
                getRef(row, 'deliver-btn').addEventListener('click', () => erpStore.updatePOSOrderStatus(ord.id, 'Entregado'));
              }
              return row;
            })
          )
        );
      }
    } else if (activeTab === 'servicios_comp') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.servicios_comp);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openServiceModal(null));
      }
      mountRef(
        tabBody,
        'tbody',
        state.complementaryServices.map((srv) => {
          const row = clone('fila-servicio-comp');
          setText(row, 'name', srv.name);
          setText(row, 'area', srv.area);
          setText(row, 'duration', srv.durationOrUnit);
          setText(row, 'price', formatCurrency(srv.price));
          mountRef(row, 'status', StatusText({ label: srv.active ? 'Activo' : 'Inactivo', variant: srv.active ? 'success' : 'neutral' }));
          setVisible(row, 'edit-btn', canEditCurrentTab);
          if (canEditCurrentTab) {
            getRef(row, 'edit-btn').addEventListener('click', () => openServiceModal(srv));
          }
          return row;
        })
      );
    } else if (activeTab === 'productos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.productos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openProductModal(null));
      }
      mountRef(
        tabBody,
        'tbody',
        state.products.map((p) => {
          const row = clone('fila-producto');
          setText(row, 'code', p.code);
          setText(row, 'name', p.name);
          setText(row, 'category', p.category);
          setText(row, 'price', formatCurrency(p.price));
          setText(row, 'cost', formatCurrency(p.cost));
          setText(row, 'stock', String(p.stock));
          setVisible(row, 'edit-btn', canEditCurrentTab);
          if (canEditCurrentTab) {
            getRef(row, 'edit-btn').addEventListener('click', () => openProductModal(p));
          }
          return row;
        })
      );
    } else if (activeTab === 'inventario') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.inventario);
      tabBody = view;

      mountRef(
        tabBody,
        'req-list',
        state.supplyRequisitions.map((req) => {
          const row = clone('fila-requisicion');
          setText(row, 'title', `${req.code} · ${req.itemName} (${req.quantity} ${req.unit})`);
          setText(row, 'meta', `Área: ${req.requestedByArea} · ${req.notes || ''}`);
          mountRef(row, 'status', StatusText({ label: req.status, variant: getStatusVariant(req.status) }));

          const canDispatch = canEditCurrentTab && req.status === 'Solicitada';
          const canPurchase = canEditCurrentTab && (req.status === 'Solicitada' || req.status === 'Compra requerida');
          setVisible(row, 'dispatch-btn', canDispatch);
          setVisible(row, 'purchase-btn', canPurchase);
          if (canDispatch) {
            mountRef(row, 'dispatch-icon', icon('packageCheck', 'w-3'));
            getRef(row, 'dispatch-btn').addEventListener('click', () => erpStore.fulfillSupplyRequisition(req.id, 'despachar'));
          }
          if (canPurchase) {
            getRef(row, 'purchase-btn').addEventListener('click', () => openPurchaseOrderModal(req));
          }
          return row;
        })
      );

      const renderInvRows = () => {
        const q = m3Ui.search.trim().toLowerCase();
        const filtered = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
        mountRef(
          tabBody,
          'inv-tbody',
          filtered.map((item) => {
            const low = item.stock <= item.minStock;
            const row = clone('fila-inventario');
            setText(row, 'sku', item.sku);
            setText(row, 'name', item.name);
            setText(row, 'location', item.location);
            setText(row, 'category', item.category);
            setText(row, 'batch', `${item.batch || ''} ${item.expiryDate ? `· Vence ${item.expiryDate}` : ''}`);
            setText(row, 'stock', `${item.stock} ${item.unit}`);
            setText(row, 'min-stock', `${item.minStock}`);
            mountRef(row, 'status', StatusText({ label: low ? 'Stock Crítico' : 'Óptimo', variant: low ? 'danger' : 'success' }));
            setVisible(row, 'adjust-btn', canEditCurrentTab);
            if (canEditCurrentTab) {
              mountRef(row, 'adjust-icon', icon('arrowDownUp', 'w-3'));
              getRef(row, 'adjust-btn').addEventListener('click', () => openInventoryMoveModal(item));
            }
            return row;
          })
        );
      };

      mountRef(
        tabBody,
        'search-slot',
        SearchInput({
          value: m3Ui.search,
          placeholder: 'Buscar SKU o insumo...',
          focusId: 'm3-inv-search',
          onChange: (v) => {
            m3Ui.search = v;
            renderInvRows();
          },
        })
      );
      setVisible(tabBody, 'new-item-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-item-icon', icon('packagePlus', 'w-3.5'));
        getRef(tabBody, 'new-item-btn').addEventListener('click', openInventoryCreateModal);
      }
      renderInvRows();

      mountRef(
        tabBody,
        'kardex-list',
        state.inventoryMovements.slice(0, 6).map((mv) => {
          const row = clone('fila-kardex');
          setText(row, 'title', `${mv.type} · ${mv.itemName}`);
          setText(row, 'meta', `${mv.reference} · ${mv.registeredBy}`);
          const qtyEl = getRef(row, 'qty');
          qtyEl.textContent = `${mv.type === 'Salida' ? '-' : '+'}${mv.quantity}`;
          qtyEl.classList.add(mv.type === 'Salida' ? 'text-danger' : 'text-teal');
          setText(row, 'date', mv.date);
          return row;
        })
      );
    } else if (activeTab === 'proveedores') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.proveedores);
      tabBody = view;

      setVisible(tabBody, 'new-po-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-po-icon', icon('truck', 'w-3.5'));
        getRef(tabBody, 'new-po-btn').addEventListener('click', () => openPurchaseOrderModal(null));
      }

      mountRef(
        tabBody,
        'po-list',
        state.purchaseOrders.map((po) => {
          const row = clone('fila-orden-compra');
          setText(row, 'title', `${po.code} · ${po.supplierName}`);
          setText(row, 'items', po.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', '));
          setText(row, 'total', formatCurrency(po.total));
          mountRef(row, 'status', StatusText({ label: po.status, variant: getStatusVariant(po.status) }));
          const showReceive = canEditCurrentTab && po.status !== 'Recibida';
          setVisible(row, 'receive-btn', showReceive);
          if (showReceive) {
            getRef(row, 'receive-btn').addEventListener('click', () => erpStore.receivePurchaseOrder(po.id));
          }
          return row;
        })
      );

      setVisible(tabBody, 'new-sup-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-sup-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-sup-btn').addEventListener('click', openSupplierModal);
      }

      mountRef(
        tabBody,
        'sup-tbody',
        state.suppliers.map((sup) => {
          const row = clone('fila-proveedor');
          setText(row, 'name', sup.name);
          setText(row, 'ruc', sup.ruc);
          setText(row, 'category', sup.category);
          setText(row, 'contact', `${sup.contactName} · ${sup.phone}`);
          setText(row, 'lead-time', `${sup.leadTimeDays} días`);
          return row;
        })
      );
    } else if (activeTab === 'recetas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.recetas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('chefHat', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRecipeModal);
      }

      mountRef(
        tabBody,
        'recipes-list',
        state.recipes.map((rec) => {
          const row = clone('fila-receta');
          setText(row, 'name', rec.productName);
          setText(row, 'ingredients', rec.ingredients.map((i) => `${i.quantity} ${i.unit} ${i.itemName}`).join(' · '));
          setText(row, 'price-cost', `Venta: ${formatCurrency(rec.salePrice)} · Costo: ${formatCurrency(rec.recipeCost)}`);
          setText(row, 'margin', `Margen ${rec.marginPct}%`);
          return row;
        })
      );
    } else if (activeTab === 'consumo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.consumo);
      tabBody = view;
      mountRef(tabBody, 'sparkles-icon', icon('sparkles', 'w-4 text-teal'));
      setText(tabBody, 'ai-summary', `${lowStockItems.length} insumos presentan quiebre inminente frente a la ocupación del fin de semana.`);
      const showPurchase = canEditCurrentTab && lowStockItems.length > 0;
      setVisible(tabBody, 'purchase-btn', showPurchase);
      if (showPurchase) {
        getRef(tabBody, 'purchase-btn').addEventListener('click', () => navigateToView('/servicios', 'proveedores'));
      }

      mountRef(
        tabBody,
        'tbody',
        state.inventory.map((i) => {
          const ratio = i.stock / Math.max(1, i.minStock);
          const row = clone('fila-consumo');
          setText(row, 'name', i.name);
          setText(row, 'stock', `${i.stock} ${i.unit}`);
          setText(row, 'min-stock', `${i.minStock} ${i.unit}`);
          setText(row, 'value', formatCurrency(i.stock * i.unitCost));
          mountRef(
            row,
            'risk',
            StatusText({
              label: ratio <= 1 ? 'Alto (Reponer)' : ratio <= 1.5 ? 'Moderado' : 'Bajo',
              variant: ratio <= 1 ? 'danger' : ratio <= 1.5 ? 'warning' : 'success',
            })
          );
          return row;
        })
      );
    }

    const activeMeta = M3_TABS.find((t) => t.id === activeTab) || M3_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'MÓDULO 03 · SERVICIOS, POS Y ALMACÉN',
        title: activeMeta.label,
        subtitle: activeMeta.subtitle,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
