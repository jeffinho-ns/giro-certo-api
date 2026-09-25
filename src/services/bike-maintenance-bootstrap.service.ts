import { query, queryOne } from '../lib/db';
import { Bike, MaintenanceCategory, MaintenanceStatus, VehicleType } from '../types';
import { generateId } from '../utils/id';
import {
  normalizeMaintenanceCategory,
  toFiniteInt,
} from '../utils/maintenance-normalize';

/** IDs fictícios que o app Flutter ainda usa quando não há Bike na API. */
export const FAKE_BIKE_IDS = new Set([
  'delivery-registration-fallback',
  '1',
  'bike-1',
]);

type DeliveryRegLite = {
  id?: string;
  plateLicense: string | null;
  currentKilometers: number | null;
  lastOilChangeKm: number | null;
  vehicleType?: string | null;
};

type SeedItem = {
  partName: string;
  category: MaintenanceCategory;
  cycleKm: number;
  useOilBaseline: boolean;
};

type GaragePhotos = {
  photoUrl: string | null;
  vehiclePhotoUrl: string | null;
  platePhotoUrl: string | null;
  galleryUrls: string[];
};

const MOTORCYCLE_SEED: SeedItem[] = [
  { partName: 'Óleo do Motor', category: MaintenanceCategory.OLEO, cycleKm: 5000, useOilBaseline: true },
  { partName: 'Filtro de Óleo', category: MaintenanceCategory.FILTROS, cycleKm: 10000, useOilBaseline: true },
  { partName: 'Filtro de Ar', category: MaintenanceCategory.FILTROS, cycleKm: 15000, useOilBaseline: false },
  { partName: 'Pneus Dianteiro e Traseiro', category: MaintenanceCategory.PNEUS, cycleKm: 20000, useOilBaseline: false },
  { partName: 'Pastilhas de Travão', category: MaintenanceCategory.TRAVOES, cycleKm: 12000, useOilBaseline: false },
  { partName: 'Fluido de Travão', category: MaintenanceCategory.TRAVOES, cycleKm: 20000, useOilBaseline: false },
  { partName: 'Corrente e Coroa', category: MaintenanceCategory.TRANSMISSAO, cycleKm: 25000, useOilBaseline: false },
  { partName: 'Vela de Ignição', category: MaintenanceCategory.MOTOR, cycleKm: 15000, useOilBaseline: false },
  { partName: 'Fluido de Arrefecimento', category: MaintenanceCategory.MOTOR, cycleKm: 40000, useOilBaseline: false },
];

const BICYCLE_SEED: SeedItem[] = [
  { partName: 'Corrente', category: MaintenanceCategory.TRANSMISSAO, cycleKm: 2500, useOilBaseline: true },
  { partName: 'Pastilhas de Travão', category: MaintenanceCategory.TRAVOES, cycleKm: 1500, useOilBaseline: true },
  { partName: 'Pneus', category: MaintenanceCategory.PNEUS, cycleKm: 5000, useOilBaseline: false },
  { partName: 'Cabos e Conduítes', category: MaintenanceCategory.TRAVOES, cycleKm: 3000, useOilBaseline: false },
];

let motorEnumEnsured = false;
async function ensureMotorCategoryEnum(): Promise<void> {
  if (motorEnumEnsured) return;
  try {
    await query(
      `ALTER TYPE "MaintenanceCategory" ADD VALUE IF NOT EXISTS 'MOTOR'`
    );
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (
      !msg.includes('already exists') &&
      !msg.includes('duplicate') &&
      !msg.includes('já existe')
    ) {
      console.warn('[maintenance-bootstrap] MOTOR enum:', msg);
    }
  }
  motorEnumEnsured = true;
}

function nonEmptyUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function galleryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nonEmptyUrl(item))
    .filter((item): item is string => !!item);
}

function bikeHasCoverPhoto(bike: Bike): boolean {
  return !!(
    nonEmptyUrl(bike.vehiclePhotoUrl) ||
    nonEmptyUrl(bike.photoUrl) ||
    galleryList(bike.galleryUrls).length > 0
  );
}

function pickPreferredBike(bikes: Bike[]): Bike {
  return bikes.find((bike) => bikeHasCoverPhoto(bike)) || bikes[0];
}

function apiImageUrl(imageId: string): string {
  const base = (process.env.API_URL || 'https://giro-certo-api.onrender.com').replace(
    /\/$/,
    ''
  );
  return `${base}/api/images/${imageId}`;
}

async function latestDeliveryRegistration(userId: string): Promise<DeliveryRegLite | null> {
  try {
    return await queryOne<DeliveryRegLite>(
      `SELECT id, "plateLicense", "currentKilometers", "lastOilChangeKm", "vehicleType"
       FROM "DeliveryRegistration"
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    );
  } catch (error: any) {
    console.warn('[maintenance-bootstrap] delivery reg read:', error?.message || error);
    return null;
  }
}

async function listUserBikes(userId: string): Promise<Bike[]> {
  return query<Bike>(
    `SELECT * FROM "Bike"
     WHERE "userId" = $1
     ORDER BY
       CASE
         WHEN COALESCE(NULLIF(TRIM("vehiclePhotoUrl"), ''), NULLIF(TRIM("photoUrl"), '')) IS NOT NULL
           THEN 0
         WHEN COALESCE(array_length("galleryUrls", 1), 0) > 0 THEN 0
         ELSE 1
       END,
       "updatedAt" DESC,
       "createdAt" DESC`,
    [userId]
  );
}

/**
 * Materializa BYTEA do cadastro delivery numa linha Image (idempotente por filename).
 */
async function ensureImageFromBuffer(opts: {
  entityType: string;
  entityId: string;
  filename: string;
  buffer: Buffer;
  mimetype?: string;
}): Promise<string | null> {
  try {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM "Image"
       WHERE "entityType" = $1 AND "entityId" = $2 AND filename = $3
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [opts.entityType, opts.entityId, opts.filename]
    );
    if (existing?.id) return apiImageUrl(existing.id);

    const imageId = generateId();
    const mimetype = opts.mimetype || 'image/jpeg';
    await query(
      `INSERT INTO "Image" (
        id, "entityType", "entityId", filename, mimetype, size,
        data, "isPrimary", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        imageId,
        opts.entityType,
        opts.entityId,
        opts.filename,
        mimetype,
        opts.buffer.length,
        opts.buffer,
        true,
      ]
    );
    return apiImageUrl(imageId);
  } catch (error: any) {
    console.warn(
      '[maintenance-bootstrap] ensureImageFromBuffer:',
      error?.message || error
    );
    return null;
  }
}

/**
 * Recupera URLs da capa a partir do cadastro delivery (foto da moto / placa).
 * Fonte: BYTEA do DeliveryRegistration — a mesma imagem enviada no onboarding.
 */
async function photosFromDeliveryRegistration(
  userId: string
): Promise<GaragePhotos> {
  const empty: GaragePhotos = {
    photoUrl: null,
    vehiclePhotoUrl: null,
    platePhotoUrl: null,
    galleryUrls: [],
  };

  try {
    const row = await queryOne<{
      id: string;
      motoWithPlateData: Buffer | null;
      platePlateCloseupData: Buffer | null;
    }>(
      `SELECT id, "motoWithPlateData", "platePlateCloseupData"
       FROM "DeliveryRegistration"
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    );
    if (!row) return empty;

    let vehiclePhotoUrl: string | null = null;
    let platePhotoUrl: string | null = null;

    if (row.motoWithPlateData && Buffer.isBuffer(row.motoWithPlateData) && row.motoWithPlateData.length > 0) {
      vehiclePhotoUrl = await ensureImageFromBuffer({
        entityType: 'user',
        entityId: userId,
        filename: `garage-cover-${row.id}.jpg`,
        buffer: row.motoWithPlateData,
      });
    }

    if (
      row.platePlateCloseupData &&
      Buffer.isBuffer(row.platePlateCloseupData) &&
      row.platePlateCloseupData.length > 0
    ) {
      platePhotoUrl = await ensureImageFromBuffer({
        entityType: 'user',
        entityId: userId,
        filename: `garage-plate-${row.id}.jpg`,
        buffer: row.platePlateCloseupData,
      });
    }

    // Fallback: imagem USER já enviada no onboarding via /images/upload/user/:id
    // (quando Firebase/local guardou na tabela Image mas a Bike nasceu sem URL).
    if (!vehiclePhotoUrl) {
      const uploaded = await queryOne<{ id: string }>(
        `SELECT id FROM "Image"
         WHERE "entityType" = 'user' AND "entityId" = $1
           AND (filename ILIKE '%moto%' OR filename ILIKE '%bike%' OR filename ILIKE '%garage%'
                OR filename ILIKE '%.jpg' OR filename ILIKE '%.jpeg' OR filename ILIKE '%.png'
                OR filename ILIKE '%.webp')
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [userId]
      );
      if (uploaded?.id) vehiclePhotoUrl = apiImageUrl(uploaded.id);
    }

    const galleryUrls = [vehiclePhotoUrl, platePhotoUrl].filter(
      (u): u is string => !!u
    );

    return {
      photoUrl: vehiclePhotoUrl,
      vehiclePhotoUrl,
      platePhotoUrl,
      galleryUrls,
    };
  } catch (error: any) {
    console.warn(
      '[maintenance-bootstrap] photosFromDeliveryRegistration:',
      error?.message || error
    );
    return empty;
  }
}

function photosFromDonorBike(donor: Bike): GaragePhotos {
  const vehiclePhotoUrl =
    nonEmptyUrl(donor.vehiclePhotoUrl) || nonEmptyUrl(donor.photoUrl);
  const photoUrl = nonEmptyUrl(donor.photoUrl) || vehiclePhotoUrl;
  const platePhotoUrl = nonEmptyUrl(donor.platePhotoUrl);
  const galleryUrls = galleryList(donor.galleryUrls);
  if (vehiclePhotoUrl && !galleryUrls.includes(vehiclePhotoUrl)) {
    galleryUrls.unshift(vehiclePhotoUrl);
  }
  return { photoUrl, vehiclePhotoUrl, platePhotoUrl, galleryUrls };
}

/**
 * Se a bike ficou sem capa (bootstrap antigo), copia de outra bike do user
 * ou rematerializa a partir do DeliveryRegistration.
 */
async function hydrateBikePhotos(
  bike: Bike,
  userId: string,
  siblings: Bike[] = []
): Promise<Bike> {
  if (bikeHasCoverPhoto(bike)) return bike;

  const donor = siblings.find(
    (candidate) => candidate.id !== bike.id && bikeHasCoverPhoto(candidate)
  );
  let photos: GaragePhotos = donor
    ? photosFromDonorBike(donor)
    : {
        photoUrl: null,
        vehiclePhotoUrl: null,
        platePhotoUrl: null,
        galleryUrls: [],
      };

  if (!photos.vehiclePhotoUrl && !photos.photoUrl) {
    photos = await photosFromDeliveryRegistration(userId);
  }

  if (!photos.vehiclePhotoUrl && !photos.photoUrl && photos.galleryUrls.length === 0) {
    return bike;
  }

  try {
    const currentGallery = galleryList(bike.galleryUrls);
    const mergedGallery = Array.from(
      new Set([...photos.galleryUrls, ...currentGallery])
    );
    await query(
      `UPDATE "Bike" SET
         "photoUrl" = COALESCE(NULLIF(TRIM("photoUrl"), ''), $1),
         "vehiclePhotoUrl" = COALESCE(NULLIF(TRIM("vehiclePhotoUrl"), ''), $2),
         "platePhotoUrl" = COALESCE(NULLIF(TRIM("platePhotoUrl"), ''), $3),
         "galleryUrls" = CASE
           WHEN COALESCE(array_length("galleryUrls", 1), 0) > 0 THEN "galleryUrls"
           ELSE $4::text[]
         END,
         "updatedAt" = NOW()
       WHERE id = $5`,
      [
        photos.photoUrl,
        photos.vehiclePhotoUrl,
        photos.platePhotoUrl,
        mergedGallery,
        bike.id,
      ]
    );
    const refreshed = await queryOne<Bike>(
      'SELECT * FROM "Bike" WHERE id = $1',
      [bike.id]
    );
    return refreshed || bike;
  } catch (error: any) {
    console.warn('[maintenance-bootstrap] hydrateBikePhotos:', error?.message || error);
    return bike;
  }
}

/**
 * Cria logs iniciais para o app calcular desgaste a partir do km informado
 * no cadastro (não a partir de 0). Idempotente: só corre se a bike não tiver logs.
 */
export async function seedBaselineMaintenanceLogs(
  bike: Bike,
  opts: { lastOilChangeKm?: number | null } = {}
): Promise<number> {
  await ensureMotorCategoryEnum();

  const existing = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM "MaintenanceLog" WHERE "bikeId" = $1`,
    [bike.id]
  );
  if (Number(existing?.count || 0) > 0) return 0;

  const currentKm = toFiniteInt(bike.currentKm);
  const oilBaselineRaw = opts.lastOilChangeKm;
  const oilBaseline =
    oilBaselineRaw == null
      ? currentKm
      : Math.min(currentKm, Math.max(0, toFiniteInt(oilBaselineRaw)));

  const isBike = String(bike.vehicleType || '').toUpperCase() === VehicleType.BICYCLE;
  const items = isBike ? BICYCLE_SEED : MOTORCYCLE_SEED;

  let inserted = 0;
  for (const item of items) {
    const category =
      normalizeMaintenanceCategory(item.category) || item.category;
    const lastChangeKm = item.useOilBaseline ? oilBaseline : currentKm;
    const used = Math.max(0, currentKm - lastChangeKm);
    const wear = item.cycleKm <= 0 ? 0 : Math.min(1, used / item.cycleKm);
    const status =
      wear >= 0.85
        ? MaintenanceStatus.CRITICO
        : wear >= 0.6
          ? MaintenanceStatus.ATENCAO
          : MaintenanceStatus.OK;

    await query(
      `INSERT INTO "MaintenanceLog" (
        id, "bikeId", "userId", "partName", category, "lastChangeKm",
        "recommendedChangeKm", "currentKm", "wearPercentage", status,
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        generateId(),
        bike.id,
        bike.userId,
        item.partName,
        category,
        lastChangeKm,
        item.cycleKm,
        currentKm,
        wear,
        status,
      ]
    );
    inserted += 1;
  }
  return inserted;
}

/**
 * Garante uma Bike real para o utilizador (cria a partir do cadastro delivery se preciso)
 * e faz seed dos logs de manutenção baseline.
 * Também restaura foto de capa se o bootstrap anterior criou Bike sem imagens.
 */
export async function ensureUserBike(userId: string): Promise<Bike | null> {
  const existing = await listUserBikes(userId);
  const reg = await latestDeliveryRegistration(userId);

  if (existing.length > 0) {
    let bike = pickPreferredBike(existing);
    bike = await hydrateBikePhotos(bike, userId, existing);
    await seedBaselineMaintenanceLogs(bike, {
      lastOilChangeKm: reg?.lastOilChangeKm,
    });
    return bike;
  }

  if (!reg) return null;

  const vehicleType =
    String(reg.vehicleType || VehicleType.MOTORCYCLE).toUpperCase() ===
    VehicleType.BICYCLE
      ? VehicleType.BICYCLE
      : VehicleType.MOTORCYCLE;
  const currentKm = toFiniteInt(reg.currentKilometers);
  const plateRaw = String(reg.plateLicense || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  const photos = await photosFromDeliveryRegistration(userId);

  // Antes de inserir: se já existir Bike com esta placa do mesmo user, reutiliza.
  if (plateRaw && plateRaw !== '-') {
    const ownedByPlate = await queryOne<Bike>(
      `SELECT * FROM "Bike"
       WHERE "userId" = $1
         AND UPPER(REPLACE(COALESCE(plate, ''), ' ', '')) = $2
       ORDER BY "updatedAt" DESC
       LIMIT 1`,
      [userId, plateRaw]
    );
    if (ownedByPlate) {
      const hydrated = await hydrateBikePhotos(ownedByPlate, userId, []);
      await seedBaselineMaintenanceLogs(hydrated, {
        lastOilChangeKm: reg.lastOilChangeKm,
      });
      return hydrated;
    }
  }

  const uniqueSuffix = `${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-6)}${Date.now()
    .toString(36)
    .slice(-4)}`.toUpperCase();
  // plate é UNIQUE global — se a placa já estiver noutro user, usamos variante única.
  let plate =
    plateRaw && plateRaw !== '-'
      ? plateRaw
      : `TMP${uniqueSuffix}`.slice(0, 20);

  const insertBike = async (plateValue: string): Promise<Bike | null> => {
    const bikeId = generateId();
    await query(
      `INSERT INTO "Bike" (
        id, "userId", model, brand, "vehicleType", plate, "currentKm",
        "oilType", "frontTirePressure", "rearTirePressure",
        "photoUrl", "vehiclePhotoUrl", "platePhotoUrl",
        accessories, "galleryUrls",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      [
        bikeId,
        userId,
        vehicleType === VehicleType.BICYCLE ? 'Delivery Bike' : 'Delivery',
        vehicleType === VehicleType.BICYCLE ? 'Bicicleta' : 'Moto',
        vehicleType,
        plateValue,
        currentKm,
        vehicleType === VehicleType.BICYCLE ? null : '10W-40',
        vehicleType === VehicleType.BICYCLE ? null : 2.5,
        vehicleType === VehicleType.BICYCLE ? null : 2.8,
        photos.photoUrl,
        photos.vehiclePhotoUrl,
        photos.platePhotoUrl,
        [],
        photos.galleryUrls,
      ]
    );
    return queryOne<Bike>('SELECT * FROM "Bike" WHERE id = $1', [bikeId]);
  };

  let bike: Bike | null = null;
  try {
    bike = await insertBike(plate);
  } catch (error: any) {
    const msg = String(error?.message || '');
    const isPlateConflict =
      msg.includes('Bike_plate') ||
      msg.includes('duplicate key') ||
      error?.code === '23505';

    if (!isPlateConflict) {
      console.error('[maintenance-bootstrap] create bike failed:', msg);
      throw error;
    }

    // Placa já existe: se for do mesmo user, reutiliza; senão cria com placa única.
    const byPlate = await queryOne<Bike>(
      `SELECT * FROM "Bike"
       WHERE UPPER(REPLACE(COALESCE(plate, ''), ' ', '')) = $1
       LIMIT 1`,
      [plateRaw && plateRaw !== '-' ? plateRaw : plate]
    );
    if (byPlate && String(byPlate.userId) === String(userId)) {
      const hydrated = await hydrateBikePhotos(byPlate, userId, []);
      await seedBaselineMaintenanceLogs(hydrated, {
        lastOilChangeKm: reg.lastOilChangeKm,
      });
      return hydrated;
    }

    const fallbackPlate = `${(plateRaw || 'MOTO').slice(0, 8)}-${uniqueSuffix}`.slice(
      0,
      20
    );
    try {
      bike = await insertBike(fallbackPlate);
      console.warn(
        `[maintenance-bootstrap] placa "${plate}" em uso; criada variante "${fallbackPlate}" para user ${userId}`
      );
    } catch (retryError: any) {
      // Último recurso: placa totalmente aleatória.
      const randomPlate = `GC${uniqueSuffix}${Math.floor(Math.random() * 90 + 10)}`.slice(
        0,
        20
      );
      bike = await insertBike(randomPlate);
      console.warn(
        `[maintenance-bootstrap] retry com placa aleatória "${randomPlate}" para user ${userId}`
      );
    }
  }

  if (!bike) return null;

  bike = await hydrateBikePhotos(bike, userId, []);
  await seedBaselineMaintenanceLogs(bike, {
    lastOilChangeKm: reg.lastOilChangeKm,
  });
  return bike;
}

export async function resolveBikeForMaintenance(
  userId: string,
  requestedBikeId: string | undefined
): Promise<Bike | null> {
  const rawId = String(requestedBikeId || '').trim();
  const isFake = !rawId || FAKE_BIKE_IDS.has(rawId);

  if (!isFake) {
    const bike = await queryOne<Bike>('SELECT * FROM "Bike" WHERE id = $1', [rawId]);
    if (bike && String(bike.userId) === String(userId)) {
      const reg = await latestDeliveryRegistration(userId);
      const siblings = await listUserBikes(userId);
      const hydrated = await hydrateBikePhotos(bike, userId, siblings);
      await seedBaselineMaintenanceLogs(hydrated, {
        lastOilChangeKm: reg?.lastOilChangeKm,
      });
      return hydrated;
    }
  }

  return ensureUserBike(userId);
}
