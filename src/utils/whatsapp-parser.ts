export interface WhatsAppParsedOrder {
  recipientName: string;
  recipientPhone: string;
  fullAddress: string;
  /** Valor do pedido (itens), em reais — vem da linha "Valor do item:" ou equivalente. */
  itemValue: number;
  confirmationRaw: string;
  confirmed: boolean;
}

const FIELD_PATTERNS = {
  name: /^\s*Nome\s*:\s*(.+)$/im,
  phone: /^\s*Telefone\s*:\s*(.+)$/im,
  // Para antes de valor/preço ou confirmacao, para nao englobar essas linhas no endereco.
  address:
    /^\s*Endere[cç]o\s+completo\s*:\s*([\s\S]*?)(?=^\s*(?:Valor(?:\s+do\s+(?:item|pedido))?|Pre[cç]o|Price)\s*:|^\s*Confirma[cç][aã]o\s*:|$)/im,
  valorItem:
    /^\s*(?:Valor(?:\s+do\s+(?:item|pedido))?|Pre[cç]o|Price)\s*:\s*(.+)$/im,
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

/** Interpreta valores em pt-BR (ex.: "45,90", "R$ 1.234,56", "12.50"). */
export function parseMoneyBr(raw: string): number {
  const s0 = raw?.replace(/R\$\s?/gi, '').replace(/\u00a0/g, ' ').trim() ?? '';
  const s = s0.replace(/\s/g, '');
  if (!s) return Number.NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma !== -1 && (lastDot === -1 || lastComma > lastDot)) {
    // Decimal com virgula (padrao BR): remove pontos de milhar, troca virgula.
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot !== -1 && (lastComma === -1 || lastDot > lastComma)) {
    const parts = s.split('.');
    const lastPart = parts[parts.length - 1] ?? '';
    if (parts.length > 2 || (parts.length === 2 && lastPart.length === 3 && /^\d{3}$/.test(lastPart))) {
      normalized = s.replace(/\./g, '');
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }
  const n = Number.parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
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
    const valorMatch = text.match(FIELD_PATTERNS.valorItem);
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

    let itemValue = Number.NaN;
    if (valorMatch?.[1]) {
      itemValue = parseMoneyBr(valorMatch[1]);
    }

    return {
      recipientName,
      recipientPhone,
      fullAddress,
      itemValue,
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
