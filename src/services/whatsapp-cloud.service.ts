/**
 * Meta WhatsApp Cloud API — envio de mensagens e verificação de webhook.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const DEFAULT_API_VERSION = 'v21.0';

export function isWhatsAppCloudConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim() &&
      process.env.WHATSAPP_VERIFY_TOKEN?.trim()
  );
}

function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION;
}

function accessToken(): string {
  const t = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim();
  if (!t) {
    throw new Error('WHATSAPP_CLOUD_ACCESS_TOKEN não configurado');
  }
  return t;
}

/** Envia mensagem de texto para o cliente (número só dígitos, com DDI 55). */
export async function whatsappSendTextMessage(params: {
  phoneNumberId: string;
  toWaId: string;
  body: string;
}): Promise<void> {
  const token = accessToken();
  const to = params.toWaId.replace(/\D/g, '');
  if (to.length < 10) {
    throw new Error('Destinatário WhatsApp inválido');
  }

  const url = `https://graph.facebook.com/${apiVersion()}/${params.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body: params.body.slice(0, 4096) },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send falhou (${res.status}): ${errText.slice(0, 500)}`);
  }
}

export function verifyWhatsAppWebhookToken(mode: string, token: string): boolean {
  if (mode !== 'subscribe') return false;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  return Boolean(expected && token === expected);
}

export type InboundWhatsAppText = {
  phoneNumberId: string;
  fromWaId: string;
  messageId: string;
  textBody: string;
};

/** Extrai mensagens de texto do payload do webhook Meta. */
export function extractInboundTextMessages(
  body: unknown
): InboundWhatsAppText[] {
  const out: InboundWhatsAppText[] = [];
  if (!body || typeof body !== 'object') return out;

  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value) continue;

      const metadata = value.metadata as { phone_number_id?: string } | undefined;
      const phoneNumberId = metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const messages = value.messages;
      if (!Array.isArray(messages)) continue;

      for (const msg of messages) {
        const m = msg as {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        };
        if (m.type !== 'text' || !m.text?.body || !m.from || !m.id) continue;
        out.push({
          phoneNumberId,
          fromWaId: m.from,
          messageId: m.id,
          textBody: m.text.body,
        });
      }
    }
  }

  return out;
}
