import { incrementOpsMetric } from '../utils/ops-metrics';

const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const GOOGLE_PLACES_DETAILS_URL =
  'https://maps.googleapis.com/maps/api/place/details/json';

export interface PlaceAutocompleteResult {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetailsResult {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export class GooglePlacesService {
  private getGoogleKey(): string | null {
    const k =
      process.env.GOOGLE_MAPS_SERVER_KEY ||
      process.env.GOOGLE_DIRECTIONS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY;
    return k && k.trim().length > 0 ? k.trim() : null;
  }

  async autocomplete(
    input: string,
    sessionToken?: string
  ): Promise<PlaceAutocompleteResult[]> {
    const key = this.getGoogleKey();
    if (!key) throw new Error('GOOGLE_MAPS_SERVER_KEY nao configurada');

    const term = input.trim();
    if (term.length < 3) return [];

    const url = new URL(GOOGLE_PLACES_AUTOCOMPLETE_URL);
    url.searchParams.set('input', term);
    url.searchParams.set('key', key);
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('components', 'country:br');
    if (sessionToken && sessionToken.trim().length > 0) {
      url.searchParams.set('sessiontoken', sessionToken.trim());
    }

    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const txt = await res.text();
      await incrementOpsMetric('geocoding_failures_total', 1, 'autocomplete_http');
      throw new Error(`Places autocomplete HTTP ${res.status}: ${txt.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      status?: string;
      predictions?: Array<{
        place_id?: string;
        description?: string;
        structured_formatting?: {
          main_text?: string;
          secondary_text?: string;
        };
      }>;
    };

    if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
      await incrementOpsMetric('geocoding_failures_total', 1, `autocomplete_${data.status}`);
      throw new Error(`Places autocomplete status ${data.status}`);
    }
    return (data.predictions ?? [])
      .filter((p) => p.place_id && p.description)
      .map((p) => ({
        placeId: p.place_id!,
        description: p.description!,
        mainText: p.structured_formatting?.main_text ?? p.description!,
        secondaryText: p.structured_formatting?.secondary_text ?? '',
      }));
  }

  async placeDetails(placeId: string, sessionToken?: string): Promise<PlaceDetailsResult> {
    const key = this.getGoogleKey();
    if (!key) throw new Error('GOOGLE_MAPS_SERVER_KEY nao configurada');
    if (!placeId || placeId.trim().length === 0) throw new Error('placeId obrigatorio');

    const url = new URL(GOOGLE_PLACES_DETAILS_URL);
    url.searchParams.set('place_id', placeId.trim());
    url.searchParams.set('key', key);
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('fields', 'place_id,formatted_address,geometry');
    if (sessionToken && sessionToken.trim().length > 0) {
      url.searchParams.set('sessiontoken', sessionToken.trim());
    }

    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const txt = await res.text();
      await incrementOpsMetric('geocoding_failures_total', 1, 'place_details_http');
      throw new Error(`Places details HTTP ${res.status}: ${txt.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      status?: string;
      result?: {
        place_id?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      };
    };
    if (data.status !== 'OK' || !data.result) {
      await incrementOpsMetric('geocoding_failures_total', 1, `place_details_${data.status ?? 'UNKNOWN'}`);
      throw new Error(`Places details status ${data.status ?? 'UNKNOWN'}`);
    }
    const lat = data.result.geometry?.location?.lat;
    const lng = data.result.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await incrementOpsMetric('geocoding_failures_total', 1, 'place_details_invalid_coords');
      throw new Error('Place sem coordenadas validas');
    }
    return {
      placeId: data.result.place_id ?? placeId.trim(),
      formattedAddress: data.result.formatted_address ?? '',
      latitude: lat!,
      longitude: lng!,
    };
  }
}
