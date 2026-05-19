import { incrementOpsMetric } from '../utils/ops-metrics';

const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const GOOGLE_PLACES_DETAILS_URL =
  'https://maps.googleapis.com/maps/api/place/details/json';
const OSM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';

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
  private readonly userAgent =
    process.env.NOMINATIM_USER_AGENT || 'giro-certo-api/1.0 (support@girocerto.app)';

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
    const term = input.trim();
    if (term.length < 3) return [];

    const key = this.getGoogleKey();
    if (key) {
      try {
        const google = await this.autocompleteWithGoogle(term, sessionToken, key);
        if (google.length > 0) return google;
      } catch (err) {
        console.warn('[Places] Google autocomplete falhou; tentando fallback', err);
      }
    }

    return this.autocompleteWithGeocoders(term);
  }

  private async autocompleteWithGoogle(
    term: string,
    sessionToken: string | undefined,
    key: string
  ): Promise<PlaceAutocompleteResult[]> {
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
    if (!placeId || placeId.trim().length === 0) throw new Error('placeId obrigatorio');

    if (placeId.startsWith('osm:')) {
      return this.placeDetailsFromOsmToken(placeId);
    }
    if (placeId.startsWith('coords:')) {
      return this.placeDetailsFromCoordsToken(placeId);
    }

    const key = this.getGoogleKey();
    if (!key) {
      throw new Error(
        'Selecione um endereço da lista de sugestões (busca alternativa ativa sem Google Places).'
      );
    }

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
      await incrementOpsMetric(
        'geocoding_failures_total',
        1,
        `place_details_${data.status ?? 'UNKNOWN'}`
      );
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

  private async autocompleteWithGeocoders(term: string): Promise<PlaceAutocompleteResult[]> {
    try {
      const osm = await this.autocompleteWithOsm(term);
      if (osm.length > 0) return osm;
    } catch (err) {
      console.warn('[Places] OSM autocomplete falhou; tentando Photon', err);
    }
    try {
      return await this.autocompleteWithPhoton(term);
    } catch (err) {
      console.warn('[Places] Photon autocomplete falhou', err);
      throw new Error(
        'Não foi possível buscar endereços agora. Tente incluir bairro e cidade, ou use "Usar endereço da loja".'
      );
    }
  }

  private async autocompleteWithOsm(input: string): Promise<PlaceAutocompleteResult[]> {
    const url = new URL(OSM_SEARCH_URL);
    url.searchParams.set('q', input);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('addressdetails', '1');

    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
    });
    if (!res.ok) {
      await incrementOpsMetric('geocoding_failures_total', 1, 'osm_autocomplete_http');
      throw new Error(`OSM HTTP ${res.status}`);
    }
    const rows = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      name?: string;
    }>;
    return this.mapRowsToPredictions(rows);
  }

  private async autocompleteWithPhoton(input: string): Promise<PlaceAutocompleteResult[]> {
    const url = new URL(PHOTON_SEARCH_URL);
    url.searchParams.set('q', input);
    url.searchParams.set('limit', '6');
    url.searchParams.set('lang', 'pt');

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      await incrementOpsMetric('geocoding_failures_total', 1, 'photon_autocomplete_http');
      throw new Error(`Photon HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          name?: string;
          street?: string;
          housenumber?: string;
          city?: string;
          state?: string;
          country?: string;
        };
      }>;
    };

    const rows =
      data.features?.map((f) => {
        const coords = f.geometry?.coordinates;
        const p = f.properties ?? {};
        const line1 = [p.street, p.housenumber].filter(Boolean).join(', ') || p.name || '';
        const line2 = [p.city, p.state, p.country].filter(Boolean).join(', ');
        const display = [line1, line2].filter((s) => s && s.length > 0).join(' - ') || line2;
        return {
          display_name: display,
          lat: coords ? String(coords[1]) : undefined,
          lon: coords ? String(coords[0]) : undefined,
          name: p.name ?? line1,
        };
      }) ?? [];

    return this.mapRowsToPredictions(rows);
  }

  private mapRowsToPredictions(
    rows: Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      name?: string;
    }>
  ): PlaceAutocompleteResult[] {
    return rows
      .filter((r) => r.display_name && r.lat && r.lon)
      .map((r) => {
        const description = r.display_name!;
        const parts = description.split(',');
        const mainText = (r.name || parts[0] || description).trim();
        const secondaryText = parts.slice(1).join(',').trim();
        const placeId = `osm:${r.lat},${r.lon}|${encodeURIComponent(description)}`;
        return {
          placeId,
          description,
          mainText,
          secondaryText,
        };
      });
  }

  private placeDetailsFromOsmToken(token: string): PlaceDetailsResult {
    return this.coordsTokenToDetails(token, 'osm:');
  }

  private placeDetailsFromCoordsToken(token: string): PlaceDetailsResult {
    return this.coordsTokenToDetails(token, 'coords:');
  }

  private coordsTokenToDetails(token: string, prefix: string): PlaceDetailsResult {
    const raw = token.slice(prefix.length);
    const [coordPart, encodedAddress] = raw.split('|');
    const [latText, lngText] = coordPart.split(',');
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Endereco selecionado invalido; escolha outro da lista.');
    }
    const formattedAddress = encodedAddress
      ? decodeURIComponent(encodedAddress)
      : 'Endereco selecionado';
    return {
      placeId: token,
      formattedAddress,
      latitude: lat,
      longitude: lng,
    };
  }
}
