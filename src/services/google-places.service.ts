import { incrementOpsMetric } from '../utils/ops-metrics';

const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const GOOGLE_PLACES_DETAILS_URL =
  'https://maps.googleapis.com/maps/api/place/details/json';
const OSM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';

/** Centro SP — viés para entregas na capital. */
const SP_BIAS = { lat: -23.5505, lon: -46.6333 };

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
    if (this.looksLikeSaoPaulo(term)) {
      url.searchParams.set('location', `${SP_BIAS.lat},${SP_BIAS.lon}`);
      url.searchParams.set('radius', '50000');
    }
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

  /** Variantes: texto completo, sem acento, rua+número+cidade, etc. */
  private buildSearchVariants(term: string): string[] {
    const out: string[] = [];
    const add = (s: string) => {
      const t = s.trim();
      if (t.length >= 3 && !out.includes(t)) out.push(t);
    };

    add(term);
    const noAccent = term.normalize('NFD').replace(/\p{M}/gu, '');
    add(noAccent);

    const parts = term
      .split(/[,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      add(parts.slice(0, 2).join(', '));
      if (parts.length >= 3) {
        add(parts.slice(0, 3).join(', '));
      }
      const city = parts[parts.length - 1];
      add(`${parts[0]}, ${city}`);
      if (parts.length >= 3) {
        add(`${parts[0]}, ${parts[1]}, ${city}`);
      }
    }

    return out.slice(0, 6);
  }

  private looksLikeSaoPaulo(term: string): boolean {
    const n = term
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    return n.includes('sao paulo') || n.includes('sp');
  }

  private async autocompleteWithGeocoders(term: string): Promise<PlaceAutocompleteResult[]> {
    const variants = this.buildSearchVariants(term);
    const merged = new Map<string, PlaceAutocompleteResult>();

    const absorb = (rows: PlaceAutocompleteResult[]) => {
      for (const r of rows) {
        const key = `${r.placeId}|${r.description}`;
        if (!merged.has(key)) merged.set(key, r);
      }
    };

    for (const v of variants) {
      try {
        absorb(await this.autocompleteWithOsm(v));
        if (merged.size >= 8) break;
      } catch (err) {
        console.warn('[Places] OSM variant failed', v.slice(0, 40), err);
      }
    }

    if (merged.size < 1) {
      for (const v of variants) {
        try {
          absorb(await this.autocompleteWithPhoton(v));
          if (merged.size >= 8) break;
        } catch (err) {
          console.warn('[Places] Photon variant failed', v.slice(0, 40), err);
        }
      }
    }

    const list = [...merged.values()].slice(0, 8);
    if (list.length === 0) {
      throw new Error(
        'Não foi possível buscar endereços. Tente "Rua, número - bairro, São Paulo" ou use "Usar endereço da loja".'
      );
    }
    return list;
  }

  private async autocompleteWithOsm(input: string): Promise<PlaceAutocompleteResult[]> {
    const url = new URL(OSM_SEARCH_URL);
    url.searchParams.set('q', input);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '8');
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
    url.searchParams.set('limit', '8');
    // Não usar lang=pt — Photon responde HTTP 400 com esse parâmetro.

    if (this.looksLikeSaoPaulo(input)) {
      url.searchParams.set('lat', String(SP_BIAS.lat));
      url.searchParams.set('lon', String(SP_BIAS.lon));
    }

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
          district?: string;
          locality?: string;
        };
      }>;
    };

    const rows =
      data.features?.map((f) => {
        const coords = f.geometry?.coordinates;
        const p = f.properties ?? {};
        const streetLine = [p.street, p.housenumber].filter(Boolean).join(', ');
        const area = [p.district, p.locality, p.city].filter(Boolean).join(', ');
        const line1 = streetLine || p.name || '';
        const line2 = [area, p.state, p.country].filter(Boolean).join(', ');
        const display =
          [line1, line2].filter((s) => s && s.length > 0).join(' - ') ||
          p.name ||
          line2 ||
          'Endereço';
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
    const pipeIdx = raw.indexOf('|');
    const coordPart = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
    const encodedAddress = pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : '';
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
