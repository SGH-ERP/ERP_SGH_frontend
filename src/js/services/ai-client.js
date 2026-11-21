import { authHeaders } from './auth-client.js';

export async function requestModuleAIAnalysis(params) {
  const res = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo completar el análisis con Inteligencia Artificial.');
  }
  return data;
}

export async function sendCRMChatMessage(params) {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo contactar al asistente conversacional.');
  }
  return data;
}
