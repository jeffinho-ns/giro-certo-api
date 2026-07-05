/**
 * Cliente HTTP Asaas API v3 (cobranças + clientes).
 * Documentação: https://docs.asaas.com/
 */

export type AsaasBillingType = 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'DEBIT_CARD';

export interface AsaasCustomerCreateBody {
  name: string;
  email?: string;
  cpfCnpj?: string;
  mobilePhone?: string;
  phone?: string;
}

export interface AsaasPaymentCreateBody {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
}

function getBaseUrl(): string {
  const explicit = process.env.ASAAS_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const sandbox =
    process.env.ASAAS_ENV === 'sandbox' ||
    process.env.NODE_ENV !== 'production';
  return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

function getApiKey(): string {
  const key = process.env.ASAAS_API_KEY?.trim();
  if (!key) {
    throw new Error('ASAAS_API_KEY não configurada');
  }
  return key;
}

function userAgent(): string {
  return process.env.ASAAS_USER_AGENT?.trim() || 'GiroCerto/1.0';
}

async function asaasRequest<T>(
  method: string,
  path: string,
  body?: object
): Promise<T> {
  const base = getBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': userAgent(),
    access_token: getApiKey(),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' &&
      data !== null &&
      Array.isArray((data as any).errors) &&
      (data as any).errors[0]?.description
        ? String((data as any).errors[0].description)
        : `Asaas HTTP ${res.status}: ${text?.slice(0, 400)}`;
    throw new Error(errMsg);
  }

  return data as T;
}

export async function asaasCreateCustomer(
  body: AsaasCustomerCreateBody
): Promise<{ id: string } & Record<string, unknown>> {
  return asaasRequest('POST', '/customers', body);
}

export async function asaasCreatePayment(
  body: AsaasPaymentCreateBody
): Promise<{
  id: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  status?: string;
  value?: number;
} & Record<string, unknown>> {
  return asaasRequest('POST', '/payments', body);
}

export async function asaasGetPayment(
  paymentId: string
): Promise<Record<string, unknown>> {
  return asaasRequest('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

/** QR dinâmico PIX da cobrança (após `billingType: PIX`). */
export async function asaasGetPixQrCode(
  paymentId: string
): Promise<Record<string, unknown>> {
  return asaasRequest(
    'GET',
    `/payments/${encodeURIComponent(paymentId)}/pixQrCode`
  );
}

/** Repasse para conta externa (PIX/TED). Ver documentação Asaas `/transfers`. */
export async function asaasCreateOutboundTransfer(body: {
  value: number;
  bankAccount?: Record<string, unknown>;
  pixAddressKey?: string;
  pixAddressKeyType?: string;
  description?: string;
  externalReference?: string;
  scheduleDate?: string;
  operationType?: 'PIX' | 'TED';
}): Promise<Record<string, unknown>> {
  if (!body.bankAccount && !body.pixAddressKey) {
    throw new Error('Repasse Asaas exige bankAccount ou pixAddressKey');
  }
  return asaasRequest('POST', '/transfers', body);
}

/** Estado de uma transferência PIX/TED (reconciliação). */
export async function asaasGetTransfer(
  transferId: string
): Promise<Record<string, unknown>> {
  return asaasRequest(
    'GET',
    `/transfers/${encodeURIComponent(transferId)}`
  );
}

/** Estorno total ou parcial de cobrança recebida (PIX/cartão). */
export async function asaasRefundPayment(
  paymentId: string,
  opts: { value?: number; description?: string } = {}
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (opts.value != null && Number.isFinite(opts.value) && opts.value > 0) {
    body.value = opts.value;
  }
  if (opts.description?.trim()) {
    body.description = opts.description.trim().slice(0, 500);
  }
  return asaasRequest(
    'POST',
    `/payments/${encodeURIComponent(paymentId)}/refund`,
    Object.keys(body).length > 0 ? body : undefined
  );
}

export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY?.trim());
}
