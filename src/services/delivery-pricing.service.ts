import { MapsRouteService } from './maps-route.service';

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
    const route = await this.mapsRouteService.getRouteSummary({
      originLat: input.storeLatitude,
      originLng: input.storeLongitude,
      destLat: input.deliveryLatitude,
      destLng: input.deliveryLongitude,
      preferTwoWheeler: true,
    });

    if (route.distanceMeters <= 0) {
      throw new Error('Nao foi possivel calcular distancia real da rota');
    }

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
}
