import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { normalizeCoordinatesForBrazilRouting } from '../utils/geo-coordinates';
import { MapsRouteService } from '../services/maps-route.service';
import { GooglePlacesService } from '../services/google-places.service';

type OfflineRegion = {
  id: string;
  name: string;
  state: string;
  version: string;
  estimatedSizeMb: number;
  downloadUrl: string | null;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
};

export class MapsController {
  private readonly mapsRouteService = new MapsRouteService();
  private readonly googlePlacesService = new GooglePlacesService();

  /**
   * GET /api/maps/directions?originLat=&originLng=&destLat=&destLng=
   * Retorna pontos da rota seguindo vias (Google via servidor).
   */
  async directions(req: AuthRequest, res: Response): Promise<void> {
    const olatRaw = parseFloat(String(req.query.originLat ?? ''));
    const olngRaw = parseFloat(String(req.query.originLng ?? ''));
    const dlatRaw = parseFloat(String(req.query.destLat ?? ''));
    const dlngRaw = parseFloat(String(req.query.destLng ?? ''));

    const latOk = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
    const lngOk = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;
    if (!latOk(olatRaw) || !lngOk(olngRaw) || !latOk(dlatRaw) || !lngOk(dlngRaw)) {
      res.status(400).json({
        error: 'Coordenadas invalidas',
        code: 'INVALID_COORDINATES',
        hint: 'Use graus decimais WGS84. No Brasil, longitude costuma ser negativa (ex.: -46.63).',
      });
      return;
    }

    const n = normalizeCoordinatesForBrazilRouting(olatRaw, olngRaw, dlatRaw, dlngRaw);
    if (n.corrected) {
      console.warn('[MapsController] Coordenadas corrigidas antes da rota (sinais Brasil):', {
        antes: { olat: olatRaw, olng: olngRaw, dlat: dlatRaw, dlng: dlngRaw },
        depois: { olat: n.originLat, olng: n.originLng, dlat: n.destLat, dlng: n.destLng },
      });
    }

    if (!latOk(n.originLat) || !lngOk(n.originLng) || !latOk(n.destLat) || !lngOk(n.destLng)) {
      res.status(400).json({
        error: 'Coordenadas invalidas apos normalizacao',
        code: 'INVALID_COORDINATES_AFTER_NORMALIZE',
      });
      return;
    }

    try {
      const points = await this.mapsRouteService.getRoutePointsLatLng(
        n.originLat,
        n.originLng,
        n.destLat,
        n.destLng
      );
      if (points.length < 2) {
        res.status(500).json({
          error: 'Nao foi possivel calcular a rota no momento',
          followsRoads: false,
          code: 'ROUTE_UPSTREAM_FAILED',
          hint: 'Verifique GOOGLE_MAPS_SERVER_KEY no Render, cobranca e APIs Routes + Directions; fallback OSRM pode estar indisponivel.',
        });
        return;
      }
      res.json({ followsRoads: true, points, source: 'giro-api' });
    } catch (e) {
      console.error('[MapsController] directions (nao fatal para o processo):', e);
      res.status(500).json({
        error: 'Falha interna ao calcular a rota',
        followsRoads: false,
        code: 'ROUTE_INTERNAL_ERROR',
      });
    }
  }

  async autocomplete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const input = String(req.query.input ?? '').trim();
      const sessionToken = String(req.query.sessionToken ?? '').trim() || undefined;
      if (input.length < 3) {
        res.json({ predictions: [] });
        return;
      }
      const predictions = await this.googlePlacesService.autocomplete(input, sessionToken);
      res.json({ predictions });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? 'Falha no autocomplete' });
    }
  }

  async placeDetails(req: AuthRequest, res: Response): Promise<void> {
    try {
      const placeId = String(req.query.placeId ?? '').trim();
      const sessionToken = String(req.query.sessionToken ?? '').trim() || undefined;
      if (!placeId) {
        res.status(400).json({ error: 'placeId obrigatorio' });
        return;
      }
      const place = await this.googlePlacesService.placeDetails(placeId, sessionToken);
      res.json({ place });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? 'Falha no place-details' });
    }
  }

  async offlineRegions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const configured = process.env.OFFLINE_MAP_REGIONS_JSON;
      if (configured) {
        const parsed = JSON.parse(configured) as OfflineRegion[];
        res.json({ regions: parsed, source: 'env' });
        return;
      }

      const regions: OfflineRegion[] = [
        {
          id: 'sp-capital',
          name: 'Sao Paulo (Capital)',
          state: 'SP',
          version: '2026.04',
          estimatedSizeMb: 280,
          downloadUrl: process.env.OFFLINE_MAP_SP_CAPITAL_URL ?? null,
          bounds: { north: -23.356, south: -23.815, east: -46.365, west: -46.826 },
        },
        {
          id: 'campinas-regiao',
          name: 'Campinas e Regiao',
          state: 'SP',
          version: '2026.04',
          estimatedSizeMb: 210,
          downloadUrl: process.env.OFFLINE_MAP_CAMPINAS_URL ?? null,
          bounds: { north: -22.65, south: -23.15, east: -46.7, west: -47.4 },
        },
        {
          id: 'rio-capital',
          name: 'Rio de Janeiro (Capital)',
          state: 'RJ',
          version: '2026.04',
          estimatedSizeMb: 240,
          downloadUrl: process.env.OFFLINE_MAP_RIO_CAPITAL_URL ?? null,
          bounds: { north: -22.74, south: -23.15, east: -43.1, west: -43.8 },
        },
      ];
      res.json({ regions, source: 'default' });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? 'Falha ao listar regioes offline' });
    }
  }
}
