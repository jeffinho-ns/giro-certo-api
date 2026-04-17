import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MapsRouteService } from '../services/maps-route.service';

export class MapsController {
  private readonly mapsRouteService = new MapsRouteService();

  /**
   * GET /api/maps/directions?originLat=&originLng=&destLat=&destLng=
   * Retorna pontos da rota seguindo vias (Google via servidor).
   */
  async directions(req: AuthRequest, res: Response): Promise<void> {
    const olat = parseFloat(String(req.query.originLat ?? ''));
    const olng = parseFloat(String(req.query.originLng ?? ''));
    const dlat = parseFloat(String(req.query.destLat ?? ''));
    const dlng = parseFloat(String(req.query.destLng ?? ''));

    const latOk = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
    const lngOk = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;
    if (!latOk(olat) || !lngOk(olng) || !latOk(dlat) || !lngOk(dlng)) {
      res.status(400).json({ error: 'Coordenadas invalidas' });
      return;
    }

    try {
      const points = await this.mapsRouteService.getRoutePointsLatLng(olat, olng, dlat, dlng);
      if (points.length < 2) {
        res.status(502).json({
          error: 'Rota indisponivel',
          followsRoads: false,
          hint: 'Configure GOOGLE_MAPS_SERVER_KEY no Render e ative Routes API + Directions API.',
        });
        return;
      }
      res.json({ followsRoads: true, points, source: 'giro-api' });
    } catch (e) {
      console.error('[MapsController] directions:', e);
      res.status(502).json({ error: 'Falha ao calcular rota' });
    }
  }
}
