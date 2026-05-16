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

export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY?.trim());
}
