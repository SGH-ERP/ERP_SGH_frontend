import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  authenticateUser,
  destroySession,
  ensureAuthDatabase,
  extractTokenFromRequest,
  getAllRolePermissions,
  getDatabaseStats,
  getSessionContext,
  isValidRoleId,
  listPublicDirectory,
  updateServerRolePermissions,
} from './server/auth-rbac.ts';
import type { RoleId, RolePermissions, UserAccount } from './server/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = 'gemini-4-hydrogen';

interface AuthedRequest extends Request {
  auth?: {
    token: string;
    user: UserAccount;
    permissions: RolePermissions;
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractTokenFromRequest(req.headers as Record<string, string | string[] | undefined>);
  const ctx = getSessionContext(token);
  if (!ctx || !token) {
    return res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión nuevamente.' });
  }
  req.auth = { token, ...ctx };
  return next();
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isSecureRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  return req.secure || proto === 'https';
}

function buildSessionCookie(req: Request, token: string, maxAgeSeconds: number): string {
  const secure = isSecureRequest(req);
  const parts = [
    `sgh_erp_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function verifyMutationCsrf(req: Request, res: Response, next: NextFunction) {
  // Bearer-token requests are not automatically attached by browsers, so they are CSRF-safe.
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return next();
  }
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith === 'SGH-ERP') {
    return next();
  }
  const origin = req.headers['origin'];
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers['host'];
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        return next();
      }
    } catch {
      // invalid origin
    }
  }
  return res.status(403).json({ error: 'Solicitud rechazada por verificación de origen.' });
}

async function startServer() {
  ensureAuthDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Health & mode inspection endpoint
  app.get('/api/health', (_req, res) => {
    const dbStats = getDatabaseStats();
    res.json({
      status: 'ok',
      authMode: process.env.VITE_SUPABASE_URL ? 'supabase_ready' : 'sqlite_local_backend',
      database: 'SQLite (data/sgh_erp.db)',
      usersCount: dbStats.usersCount,
      rolesCount: dbStats.rolesCount,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================
  // AUTHENTICATION & SERVER-SIDE RBAC ENDPOINTS
  // ============================================================
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Ingresa correo electrónico y contraseña.' });
    }
    const result = authenticateUser(email, password);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }

    res.setHeader('Set-Cookie', buildSessionCookie(req, result.token, 60 * 60 * 12));

    return res.json({
      token: result.token,
      user: result.user,
      permissions: result.permissions,
      allRolePermissions: result.user.role === 'admin' || result.user.role === 'auditor' ? getAllRolePermissions() : undefined,
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const { user, permissions } = req.auth!;
    return res.json({
      user,
      permissions,
      allRolePermissions: user.role === 'admin' || user.role === 'auditor' ? getAllRolePermissions() : undefined,
    });
  });

  app.post('/api/auth/logout', verifyMutationCsrf, (req, res) => {
    const token = extractTokenFromRequest(req.headers as Record<string, string | string[] | undefined>);
    destroySession(token);
    res.setHeader('Set-Cookie', buildSessionCookie(req, '', 0));
    return res.json({ ok: true });
  });

  // Authorized user directory & RBAC matrix (admin/auditor only — never exposes passwords)
  app.get('/api/auth/users', requireAuth, (req: AuthedRequest, res) => {
    const role = req.auth!.user.role;
    if (role !== 'admin' && role !== 'auditor') {
      return res.status(403).json({ error: 'Acceso denegado. Solo Administrador o Auditor pueden consultar el directorio de usuarios.' });
    }
    return res.json({
      users: listPublicDirectory(),
      permissions: getAllRolePermissions(),
    });
  });

  app.put('/api/auth/permissions/:role', verifyMutationCsrf, requireAuth, (req: AuthedRequest, res) => {
    if (!req.auth!.permissions.canManageRoles) {
      return res.status(403).json({ error: 'Acceso denegado. Solo el Administrador del sistema puede modificar permisos RBAC.' });
    }
    const rawRole = String(req.params.role ?? '');
    if (!isValidRoleId(rawRole)) {
      return res.status(400).json({ error: 'Rol no válido.' });
    }
    const body = req.body as Partial<RolePermissions> | null;
    if (
      !body ||
      !Array.isArray(body.view) ||
      !Array.isArray(body.edit) ||
      typeof body.canViewFullPII !== 'boolean' ||
      typeof body.canApproveFinancials !== 'boolean' ||
      typeof body.canManageRoles !== 'boolean' ||
      typeof body.scopeSummary !== 'string'
    ) {
      return res.status(400).json({ error: 'Estructura de permisos RBAC no válida.' });
    }
    const updated = updateServerRolePermissions(rawRole, body as RolePermissions);
    return res.json({ permissions: updated });
  });

  // ============================================================
  // SERVER-SIDE GEMINI AI ENDPOINTS (PROTECTED BY RBAC SESSION)
  // ============================================================
  app.post('/api/ai/analyze', requireAuth, async (req: AuthedRequest, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'La clave de Gemini API no está configurada en el servidor. Configúrala en Settings > Secrets.',
      });
    }

    const { moduleId, task, contextData, userPrompt } = req.body as {
      moduleId?: string;
      task?: string;
      contextData?: unknown;
      userPrompt?: string;
    };

    try {
      const systemInstruction = [
        'Eres el motor analítico de Inteligencia Artificial de SGH-ERP (Sistema de Gestión Hotelera Integral, Hotel Azure Coast).',
        `Usuario autenticado: ${req.auth!.user.name} (${req.auth!.user.roleLabel}). Respeta estrictamente su alcance RBAC.`,
        'Responde siempre en español profesional, conciso, accionable y fundamentado exclusivamente en los datos del ERP entregados.',
        'Recuerda el principio de supervisión humana: tus sugerencias son recomendaciones explicables que requieren confirmación del usuario.',
        'Estructura tu respuesta en puntos claros con cifras exactas y pasos recomendados.',
      ].join(' ');

      const prompt = [
        `Módulo: ${moduleId ?? 'General'}`,
        `Tarea analítica: ${task ?? 'Resumen ejecutivo'}`,
        userPrompt ? `Consulta específica: ${userPrompt}` : '',
        `Datos operativos actuales (JSON): ${JSON.stringify(contextData ?? {})}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        analysis: response.text ?? 'No se generó respuesta.',
        model: MODEL_ID,
        generatedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al consultar el servicio de IA.';
      console.error('[SGH-ERP AI Error]', message);
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/ai/chat', requireAuth, async (req: AuthedRequest, res) => {
    const perms = req.auth!.permissions;
    if (!perms.view.includes('m5') || !perms.allowedTabs.m5?.includes('ia')) {
      return res.status(403).json({ error: 'Tu perfil no tiene autorización para utilizar el asistente conversacional CRM.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'La clave de Gemini API no está configurada en el servidor. Configúrala en Settings > Secrets.',
      });
    }

    const { messages, hotelContext } = req.body as {
      messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
      hotelContext?: unknown;
    };

    try {
      const historyText = (messages ?? [])
        .map((m) => `${m.role === 'user' ? 'Operador/Huésped' : 'Asistente SGH-ERP'}: ${m.text}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `Contexto actual del hotel:\n${JSON.stringify(hotelContext ?? {})}\n\nConversación:\n${historyText}\n\nResponde de forma amable, precisa y breve en español:`,
        config: {
          systemInstruction:
            'Eres el Asistente Conversacional de Atención al Huésped y CRM de Hotel Azure Coast (SGH-ERP). Ayudas a redactar respuestas a huéspedes, clasificar reclamos, sugerir compensaciones y consultar políticas del hotel respetando la privacidad de datos.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        reply: response.text ?? 'Sin respuesta.',
        generatedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error en asistente conversacional.';
      console.error('[SGH-ERP Chat Error]', message);
      return res.status(502).json({ error: message });
    }
  });

  const distPath = path.resolve(__dirname, 'dist');
  const indexPath = path.join(distPath, 'index.html');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(indexPath));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (!fs.existsSync(indexPath)) {
      console.warn(`[SGH-ERP] Advertencia: no se encontró ${indexPath}. Ejecuta "npm run build" antes de iniciar en producción.`);
    }
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(indexPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SGH-ERP server running on http://0.0.0.0:${PORT} (mode=${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[SGH-ERP] Fatal startup error:', err);
  process.exit(1);
});
