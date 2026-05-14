export interface WhatsAppParsedOrder {
  recipientName: string;
  recipientPhone: string;
  fullAddress: string;
  confirmationRaw: string;
  confirmed: boolean;
}

const FIELD_PATTERNS = {
  name: /^\s*Nome\s*:\s*(.+)$/im,
  phone: /^\s*Telefone\s*:\s*(.+)$/im,
  address: /^\s*Endere[cç]o\s+completo\s*:\s*([\s\S]*?)(?=^\s*Confirma[cç][aã]o\s*:|$)/im,
  confirmation: /^\s*Confirma[cç][aã]o\s*:\s*(.+)$/im,
} as const;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error('Telefone invalido. Informe DDD e numero com pelo menos 10 digitos.');
  }
  return digits;
}

function parseConfirmation(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (['sim', 's', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['nao', 'não', 'n', 'no'].includes(normalized)) {
    return false;
  }
  throw new Error('Confirmacao invalida. Use Sim ou Nao.');
}

export class WhatsAppParser {
  static parse(rawText: string): WhatsAppParsedOrder {
    const text = rawText?.trim();
    if (!text) {
      throw new Error('rawText vazio. Cole o texto do WhatsApp.');
    }

    const nameMatch = text.match(FIELD_PATTERNS.name);
    const phoneMatch = text.match(FIELD_PATTERNS.phone);
    const addressMatch = text.match(FIELD_PATTERNS.address);
    const confirmationMatch = text.match(FIELD_PATTERNS.confirmation);

    if (!nameMatch?.[1]) {
      throw new Error('Campo obrigatorio ausente: Nome.');
    }
    if (!phoneMatch?.[1]) {
      throw new Error('Campo obrigatorio ausente: Telefone.');
    }
    if (!addressMatch?.[1]) {
      throw new Error('Campo obrigatorio ausente: Endereco completo.');
    }
    if (!confirmationMatch?.[1]) {
      throw new Error('Campo obrigatorio ausente: Confirmacao.');
    }

    const recipientName = normalizeWhitespace(nameMatch[1]);
    const recipientPhone = normalizePhone(phoneMatch[1]);
    const fullAddress = normalizeWhitespace(addressMatch[1]);
    const confirmationRaw = normalizeWhitespace(confirmationMatch[1]);
    const confirmed = parseConfirmation(confirmationRaw);

    return {
      recipientName,
      recipientPhone,
      fullAddress,
      confirmationRaw,
      confirmed,
    };
  }

  static deriveDeliveryProofPin(recipientPhone: string): string {
    const digits = recipientPhone.replace(/\D/g, '');
    if (digits.length < 4) {
      throw new Error('Telefone sem digitos suficientes para gerar o PIN de entrega.');
    }
    return digits.slice(-4);
  }
}
