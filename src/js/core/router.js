const listeners = new Set();

const SLUG_TO_TAB = {
  'lista-espera': 'lista_espera',
  'estado-habitaciones': 'estado_habitaciones',
  'mant-correctivo': 'mant_correctivo',
  'mant-preventivo': 'mant_preventivo',
  'mant-predictivo': 'mant_predictivo',
  'room-service': 'room_service',
  'servicios-complementarios': 'servicios_comp',
  'servicios-comp': 'servicios_comp',
  'perfil-360': 'perfil_360',
  'portal-ia': 'portal_ia',
  'base-datos': 'supabase',
  supabase: 'supabase',
};

const TAB_TO_SLUG = {
  lista_espera: 'lista-espera',
  estado_habitaciones: 'estado-habitaciones',
  mant_correctivo: 'mant-correctivo',
  mant_preventivo: 'mant-preventivo',
  mant_predictivo: 'mant-predictivo',
  room_service: 'room-service',
  servicios_comp: 'servicios-complementarios',
  perfil_360: 'perfil-360',
  portal_ia: 'portal-ia',
  supabase: 'base-datos',
};

export function tabIdToSlug(tabId) {
  if (!tabId) return '';
  return TAB_TO_SLUG[tabId] || String(tabId).replace(/_/g, '-');
}

export function slugToTabId(slug) {
  if (!slug) return '';
  const clean = String(slug).trim().toLowerCase();
  return SLUG_TO_TAB[clean] || clean.replace(/-/g, '_');
}

export function getRoute() {
  const url = new URL(window.location.href);
  const rawPath = url.pathname || '/';
  const segments = rawPath.split('/').filter(Boolean);
  const basePath = segments.length > 0 ? `/${segments[0]}` : '/';
  const viewSlug = segments[1] || '';
  const queryTab = url.searchParams.get('tab') || '';
  const tab = viewSlug ? slugToTabId(viewSlug) : queryTab ? slugToTabId(queryTab) : '';

  return {
    pathname: rawPath,
    basePath,
    viewSlug,
    tab,
    search: url.search || '',
  };
}

export function navigate(to, options = {}) {
  const targetUrl = new URL(to, window.location.origin);
  const nextFull = `${targetUrl.pathname}${targetUrl.search}`;
  const currentFull = `${window.location.pathname}${window.location.search}`;
  if (nextFull === currentFull) return;

  if (options.replace) {
    window.history.replaceState({}, '', nextFull);
  } else {
    window.history.pushState({}, '', nextFull);
  }
  notify();
}

export function navigateToView(basePath, tabId, replace = false) {
  const cleanBase = basePath.startsWith('/') ? basePath : `/${basePath}`;
  const slug = tabIdToSlug(tabId);
  navigate(slug ? `${cleanBase}/${slug}` : cleanBase, { replace });
}

export function setQueryTab(tabId, replace = false) {
  const { basePath } = getRoute();
  navigateToView(basePath === '/' ? '' : basePath, tabId, replace);
}

export function subscribeRouter(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const route = getRoute();
  for (const fn of listeners) {
    fn(route);
  }
}

window.addEventListener('popstate', notify);
