import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { normalizeCoordinatesForBrazilRouting } from '../utils/geo-coordinates';
import { MapsRouteService } from '../services/maps-route.service';

export class MapsController {
  private readonly mapsRouteService = new MapsRouteService();

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
}
