const IFOOD_API = 'https://merchant-api.ifood.com.br';

type TokenCache = { accessToken: string; expiresAtMs: number };

let tokenCache: TokenCache | null = null;

export function ifoodCredentialsConfigured(): boolean {
  return Boolean(process.env.IFOOD_CLIENT_ID && process.env.IFOOD_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET não configurados.');
  }
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grantType: 'client_credentials',
    clientId,
    clientSecret,
  });
  const response = await fetch(`${IFOOD_API}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    accessToken?: string;
    expiresIn?: number;
    error?: { message?: string };
  };
  if (!response.ok || !payload.accessToken) {
    throw new Error(payload.error?.message || `iFood recusou o token (${response.status}).`);
  }
  const expiresIn = payload.expiresIn ?? 21600;
  tokenCache = {
    accessToken: payload.accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
  return payload.accessToken;
}

async function ifoodFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  return fetch(`${IFOOD_API}${path}`, { ...init, headers });
}

export async function fetchIfoodOrder(orderId: string): Promise<Record<string, unknown>> {
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}`);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Pedido iFood não encontrado (${response.status}).`);
  }
  return payload;
}

export async function confirmIfoodOrder(orderId: string): Promise<void> {
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}/confirm`, { method: 'POST' });
  if (response.ok || response.status === 202 || response.status === 409) return;
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(payload.error?.message || `Falha ao confirmar pedido iFood (${response.status}).`);
}

type IfoodCancellationReason = {
  cancelCodeId: string;
  description: string;
};

function ifoodCallSucceeded(status: number, payload: { error?: { message?: string }; message?: string }): boolean {
  if (status === 200 || status === 201 || status === 202 || status === 204 || status === 409) return true;
  const message = `${payload.error?.message || ''} ${payload.message || ''}`.toLowerCase();
  return message.includes('already') || message.includes('já') || message.includes('ja ');
}

/** Avisa o iFood que a loja despachou com entrega própria. */
export async function dispatchIfoodMerchantOrder(orderId: string): Promise<void> {
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveredBy: 'MERCHANT' }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  if (ifoodCallSucceeded(response.status, payload)) return;
  throw new Error(payload.error?.message || payload.message || `Falha ao despachar pedido iFood (${response.status}).`);
}

export async function listIfoodCancellationReasons(orderId: string): Promise<IfoodCancellationReason[]> {
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}/cancellationReasons`);
  const payload = (await response.json().catch(() => [])) as
    | IfoodCancellationReason[]
    | { error?: { message?: string } };
  if (!response.ok || !Array.isArray(payload)) return [];
  return payload.filter((reason) => reason?.cancelCodeId && reason?.description);
}

/** Cancela o pedido no iFood pela loja. Não chama motoboy. */
export async function cancelIfoodOrder(orderId: string): Promise<void> {
  const reasons = await listIfoodCancellationReasons(orderId);
  const reason = reasons.find((item) => item.cancelCodeId === '509') || reasons[0];
  const cancellationCode = reason?.cancelCodeId || '509';
  const description = reason?.description || 'Dificuldades internas do restaurante';
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}/requestCancellation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cancellationCode,
      reason: description,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  if (ifoodCallSucceeded(response.status, payload)) return;
  throw new Error(payload.error?.message || payload.message || `Falha ao cancelar pedido iFood (${response.status}).`);
}

/** Aceita um cancelamento pedido pelo cliente no iFood. */
export async function acceptIfoodCancellation(orderId: string): Promise<void> {
  const response = await ifoodFetch(`/order/v1.0/orders/${orderId}/acceptCancellation`, {
    method: 'POST',
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  if (ifoodCallSucceeded(response.status, payload)) return;
  throw new Error(
    payload.error?.message || payload.message || `Falha ao aceitar cancelamento iFood (${response.status}).`
  );
}

export type IfoodEvent = {
  id: string;
  code?: string;
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
};

export async function pollIfoodEvents(merchantIds: string[]): Promise<IfoodEvent[]> {
  if (merchantIds.length === 0) return [];
  const response = await ifoodFetch('/events/v1.0/events:polling', {
    headers: { 'x-polling-merchants': merchantIds.join(',') },
  });
  if (response.status === 204) return [];
  const payload = (await response.json().catch(() => [])) as IfoodEvent[] | { error?: { message?: string } };
  if (!response.ok) {
    const message =
      !Array.isArray(payload) && payload.error?.message
        ? payload.error.message
        : `Falha no polling iFood (${response.status}).`;
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
}

export async function acknowledgeIfoodEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const response = await ifoodFetch('/events/v1.0/events/acknowledgment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventIds.map((id) => ({ id }))),
  });
  if (!response.ok && response.status !== 202) {
    throw new Error(`Falha ao confirmar eventos iFood (${response.status}).`);
  }
}
