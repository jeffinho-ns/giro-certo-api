import { DeliveryPricingService, DeliveryQuoteInput } from './delivery-pricing.service';

export type StoreDeliveryFeeMode = 'fixed' | 'distance_capped' | 'distance';

export interface StoreDeliveryFeeConfig {
  mode: StoreDeliveryFeeMode;
  maxFee: number | null;
  fixedFee: number | null;
}

export interface StoreDeliveryFeeQuote {
  deliveryFee: number;
  /** Cotação bruta por distância (antes do teto), quando aplicável */
  quotedFee: number | null;
  distanceKm: number | null;
  mode: StoreDeliveryFeeMode;
  maxFee: number | null;
  fixedFee: number | null;
  currency: 'BRL';
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseStoreDeliveryFeeConfig(
  partner: Record<string, unknown>
): StoreDeliveryFeeConfig {
  const rawMode = String(partner.store_delivery_fee_mode ?? 'distance_capped');
  const mode: StoreDeliveryFeeMode =
    rawMode === 'fixed' || rawMode === 'distance' || rawMode === 'distance_capped'
      ? rawMode
      : 'distance_capped';

  const maxRaw = partner.store_delivery_fee_max;
  const fixedRaw = partner.store_delivery_fee_fixed;

  const maxFee =
    maxRaw != null && Number.isFinite(Number(maxRaw)) ? roundMoney(Number(maxRaw)) : null;
  const fixedFee =
    fixedRaw != null && Number.isFinite(Number(fixedRaw))
      ? roundMoney(Number(fixedRaw))
      : null;

  return { mode, maxFee, fixedFee };
}

export function validateStoreDeliveryFeeConfig(config: StoreDeliveryFeeConfig): void {
  if (config.mode === 'fixed') {
    if (config.fixedFee == null || config.fixedFee < 0) {
      throw new Error('Informe o valor fixo do frete (R$ 0 ou mais)');
    }
    if (config.maxFee != null && config.fixedFee > config.maxFee) {
      throw new Error('O frete fixo não pode ser maior que o teto máximo');
    }
    return;
  }

  if (config.mode === 'distance_capped') {
    if (config.maxFee == null || config.maxFee <= 0) {
      throw new Error('Informe o valor máximo do frete (ex.: R$ 9,00)');
    }
    if (config.fixedFee != null && config.fixedFee > config.maxFee) {
      throw new Error('O frete fixo não pode ser maior que o teto máximo');
    }
    return;
  }

  // distance — sem campos obrigatórios
  if (config.maxFee != null && config.maxFee < 0) {
    throw new Error('Teto máximo de frete inválido');
  }
}

export function storeDeliveryFeePolicyLabel(config: StoreDeliveryFeeConfig): string {
  if (config.mode === 'fixed' && config.fixedFee != null) {
    return `Frete fixo: R$ ${config.fixedFee.toFixed(2)}`;
  }
  if (config.mode === 'distance_capped' && config.maxFee != null) {
    return `Frete até R$ ${config.maxFee.toFixed(2)} (conforme distância)`;
  }
  return 'Frete calculado pela distância';
}

export class StoreDeliveryFeeService {
  private readonly pricing = new DeliveryPricingService();

  async quote(
    config: StoreDeliveryFeeConfig,
    input: DeliveryQuoteInput
  ): Promise<StoreDeliveryFeeQuote> {
    validateStoreDeliveryFeeConfig(config);

    if (config.mode === 'fixed') {
      const deliveryFee = roundMoney(config.fixedFee ?? 0);
      return {
        deliveryFee,
        quotedFee: null,
        distanceKm: null,
        mode: config.mode,
        maxFee: config.maxFee,
        fixedFee: config.fixedFee,
        currency: 'BRL',
      };
    }

    const raw = await this.pricing.calculateQuote(input);
    let deliveryFee = raw.deliveryFee;

    if (config.mode === 'distance_capped' && config.maxFee != null) {
      deliveryFee = roundMoney(Math.min(deliveryFee, config.maxFee));
    }

    return {
      deliveryFee,
      quotedFee: raw.deliveryFee,
      distanceKm: raw.distanceKm,
      mode: config.mode,
      maxFee: config.maxFee,
      fixedFee: config.fixedFee,
      currency: 'BRL',
    };
  }
}
