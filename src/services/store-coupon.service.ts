import { query, queryOne, execute } from '../lib/db';
import { generateId } from '../utils/id';
import {
  StoreCoupon,
  CreateStoreCouponDto,
  UpdateStoreCouponDto,
  CouponDiscountType,
} from '../types';

/**
 * Cupons de desconto da loja virtual. CRUD escopado por partnerId.
 * A validação/cálculo no checkout é sempre server-side (nunca confiar no cliente).
 */
export class StoreCouponService {
  private normalizeCode(code: string): string {
    return (code ?? '').trim().toUpperCase();
  }

  private validateType(type: any): CouponDiscountType {
    if (type !== 'percent' && type !== 'fixed') {
      throw new Error('Tipo de desconto inválido (use percent ou fixed)');
    }
    return type;
  }

  async list(partnerId: string): Promise<StoreCoupon[]> {
    return query<StoreCoupon>(
      `SELECT * FROM "StoreCoupon" WHERE "partnerId" = $1 ORDER BY "createdAt" DESC`,
      [partnerId]
    );
  }

  async create(partnerId: string, dto: CreateStoreCouponDto): Promise<StoreCoupon> {
    const code = this.normalizeCode(dto.code);
    if (!code) throw new Error('Código do cupom é obrigatório');
    const type = this.validateType(dto.discountType);
    const value = Number(dto.discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('Valor do desconto inválido');
    }
    if (type === 'percent' && value > 100) {
      throw new Error('Desconto percentual não pode passar de 100%');
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM "StoreCoupon" WHERE "partnerId" = $1 AND upper(code) = upper($2)`,
      [partnerId, code]
    );
    if (existing) throw new Error('Já existe um cupom com esse código');

    const id = generateId();
    const row = await queryOne<StoreCoupon>(
      `INSERT INTO "StoreCoupon"
        (id, "partnerId", code, "discountType", "discountValue",
         "minSubtotal", "maxUses", active, "expiresAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        id,
        partnerId,
        code,
        type,
        value,
        dto.minSubtotal != null ? Number(dto.minSubtotal) : 0,
        dto.maxUses != null ? Number(dto.maxUses) : null,
        dto.active ?? true,
        dto.expiresAt ?? null,
      ]
    );
    return row!;
  }

  async update(
    partnerId: string,
    id: string,
    dto: UpdateStoreCouponDto
  ): Promise<StoreCoupon> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.code !== undefined) {
      const code = this.normalizeCode(dto.code);
      if (!code) throw new Error('Código do cupom é obrigatório');
      const clash = await queryOne<{ id: string }>(
        `SELECT id FROM "StoreCoupon"
         WHERE "partnerId" = $1 AND upper(code) = upper($2) AND id <> $3`,
        [partnerId, code, id]
      );
      if (clash) throw new Error('Já existe um cupom com esse código');
      sets.push(`code = $${idx++}`);
      vals.push(code);
    }
    if (dto.discountType !== undefined) {
      sets.push(`"discountType" = $${idx++}`);
      vals.push(this.validateType(dto.discountType));
    }
    if (dto.discountValue !== undefined) {
      const value = Number(dto.discountValue);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Valor do desconto inválido');
      sets.push(`"discountValue" = $${idx++}`);
      vals.push(value);
    }
    if (dto.minSubtotal !== undefined) {
      sets.push(`"minSubtotal" = $${idx++}`);
      vals.push(Number(dto.minSubtotal) || 0);
    }
    if (dto.maxUses !== undefined) {
      sets.push(`"maxUses" = $${idx++}`);
      vals.push(dto.maxUses != null ? Number(dto.maxUses) : null);
    }
    if (dto.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(!!dto.active);
    }
    if (dto.expiresAt !== undefined) {
      sets.push(`"expiresAt" = $${idx++}`);
      vals.push(dto.expiresAt ?? null);
    }

    if (sets.length === 0) {
      const current = await queryOne<StoreCoupon>(
        `SELECT * FROM "StoreCoupon" WHERE id = $1 AND "partnerId" = $2`,
        [id, partnerId]
      );
      if (!current) throw new Error('Cupom não encontrado');
      return current;
    }

    sets.push(`"updatedAt" = NOW()`);
    vals.push(id);
    vals.push(partnerId);
    const row = await queryOne<StoreCoupon>(
      `UPDATE "StoreCoupon" SET ${sets.join(', ')}
       WHERE id = $${idx++} AND "partnerId" = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Cupom não encontrado');
    return row;
  }

  async remove(partnerId: string, id: string): Promise<void> {
    const affected = await execute(
      `DELETE FROM "StoreCoupon" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (affected === 0) throw new Error('Cupom não encontrado');
  }

  /**
   * Valida um cupom para uma loja e calcula o desconto sobre o subtotal.
   * Lança erro com mensagem amigável quando inválido.
   */
  async validateAndCompute(
    partnerId: string,
    code: string,
    subtotal: number
  ): Promise<{ coupon: StoreCoupon; discount: number }> {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new Error('Cupom inválido');

    const coupon = await queryOne<StoreCoupon>(
      `SELECT * FROM "StoreCoupon"
       WHERE "partnerId" = $1 AND upper(code) = upper($2)`,
      [partnerId, normalized]
    );
    if (!coupon) throw new Error('Cupom não encontrado');
    if (!coupon.active) throw new Error('Cupom inativo');
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      throw new Error('Cupom expirado');
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw new Error('Cupom esgotado');
    }
    if (subtotal < Number(coupon.minSubtotal || 0)) {
      throw new Error(
        `Cupom exige subtotal mínimo de R$ ${Number(coupon.minSubtotal).toFixed(2)}`
      );
    }

    let discount =
      coupon.discountType === 'percent'
        ? (subtotal * Number(coupon.discountValue)) / 100
        : Number(coupon.discountValue);
    // Nunca descontar mais que o subtotal.
    discount = Math.min(discount, subtotal);
    discount = Number(discount.toFixed(2));

    return { coupon, discount };
  }

  /** Incrementa o uso do cupom (chamado quando o pagamento é confirmado). */
  async incrementUsage(couponId: string): Promise<void> {
    await execute(
      `UPDATE "StoreCoupon" SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW() WHERE id = $1`,
      [couponId]
    );
  }
}
