import { MapsRouteService } from './maps-route.service';
import { calculateDistance } from '../utils/haversine';

export interface DeliveryQuoteInput {
  storeLatitude: number;
  storeLongitude: number;
  deliveryLatitude: number;
  deliveryLongitude: number;
  priority?: string;
  urgentBoost?: boolean;
}

export interface DeliveryQuoteResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number | null;
  deliveryFee: number;
  currency: 'BRL';
  routeSource: string;
  travelMode: string;
}

export class DeliveryPricingService {
  private readonly mapsRouteService = new MapsRouteService();

  async calculateQuote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult> {
    const route = await this.resolveBestRouteDistance(input);
    const distanceKm = route.distanceMeters / 1000;
    const baseFee = 5 + distanceKm * 2;
    const urgentBoost = input.priority === 'urgent' && input.urgentBoost === true;
    const fee = urgentBoost ? baseFee * 1.5 : baseFee;

    return {
      distanceMeters: route.distanceMeters,
      distanceKm: Number(distanceKm.toFixed(3)),
      durationSeconds: route.durationSeconds,
      deliveryFee: Number(fee.toFixed(2)),
      currency: 'BRL',
      routeSource: route.source,
      travelMode: route.travelMode,
    };
  }

  private async resolveBestRouteDistance(input: DeliveryQuoteInput): Promise<{
    distanceMeters: number;
    durationSeconds: number | null;
    source: string;
    travelMode: string;
  }> {
    try {
      const route = await this.mapsRouteService.getRouteSummary({
        originLat: input.storeLatitude,
        originLng: input.storeLongitude,
        destLat: input.deliveryLatitude,
        destLng: input.deliveryLongitude,
        preferTwoWheeler: true,
      });
      if (route.distanceMeters > 0) {
        return route;
      }
    } catch {
      // fallback abaixo
    }

    const points = await this.mapsRouteService.getRoutePointsLatLng(
      input.storeLatitude,
      input.storeLongitude,
      input.deliveryLatitude,
      input.deliveryLongitude
    );
    if (points.length >= 2) {
      let km = 0;
      for (let i = 1; i < points.length; i++) {
        km += calculateDistance(
          points[i - 1].lat,
          points[i - 1].lng,
          points[i].lat,
          points[i].lng
        );
      }
      if (km > 0) {
        return {
          distanceMeters: Math.round(km * 1000),
          durationSeconds: null,
          source: 'FALLBACK_ROUTE_POINTS',
          travelMode: 'DRIVE',
        };
      }
    }

    const haversineKm = calculateDistance(
      input.storeLatitude,
      input.storeLongitude,
      input.deliveryLatitude,
      input.deliveryLongitude
    );
    // Ajuste conservador para aproximar malha viaria quando nao houver rota.
    const adjustedKm = Math.max(0.8, haversineKm * 1.25);
    return {
      distanceMeters: Math.round(adjustedKm * 1000),
      durationSeconds: null,
      source: 'FALLBACK_HAVERSINE',
      travelMode: 'DRIVE',
    };
  }
}
