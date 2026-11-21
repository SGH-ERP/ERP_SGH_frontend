let inMemorySessionToken = null;

export function getSessionToken() {
  return inMemorySessionToken;
}

export function setSessionToken(token) {
  inMemorySessionToken = token;
}

export function clearSessionToken() {
  inMemorySessionToken = null;
}

export function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiLogin(email, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SGH-ERP',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok || !body.user || !body.permissions) {
      return { ok: false, error: body.error || 'No se pudo iniciar sesión. Verifica tus credenciales.' };
    }
    if (body.token) {
      setSessionToken(body.token);
    }
    return {
      ok: true,
      data: {
        user: body.user,
        permissions: body.permissions,
        allRolePermissions: body.allRolePermissions,
      },
    };
  } catch {
    return { ok: false, error: 'Error de conexión con el servidor de autenticación.' };
  }
}

export async function apiGetMe() {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { ...authHeaders() },
      credentials: 'include',
    });
    if (!res.ok) {
      clearSessionToken();
      return null;
    }
    const body = await res.json();
    if (!body.user || !body.permissions) {
      clearSessionToken();
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

export async function apiLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
      },
      credentials: 'include',
    });
  } catch {
    // best-effort logout
  } finally {
    clearSessionToken();
  }
}

export async function apiGetDirectory() {
  try {
    const res = await fetch('/api/auth/users', {
      method: 'GET',
      headers: { ...authHeaders() },
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiUpdateRolePermissions(role, next) {
  try {
    const res = await fetch(`/api/auth/permissions/${encodeURIComponent(role)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(next),
    });
    const body = await res.json();
    if (!res.ok || !body.permissions) {
      return { ok: false, error: body.error || 'No se pudieron guardar los permisos.' };
    }
    return { ok: true, permissions: body.permissions };
  } catch {
    return { ok: false, error: 'Error de red al actualizar permisos RBAC.' };
  }
}
