import { decodePolyline } from '../utils/polyline';

const ROUTES_V2_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const LEGACY_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const OSRM_DEFAULT_BASE = 'https://router.project-osrm.org';

/**
 * Chave só no servidor (Render): sem restrição de app Android → Directions/Routes funcionam.
 * Configure no Render: GOOGLE_MAPS_SERVER_KEY ou GOOGLE_DIRECTIONS_API_KEY
 */
export class MapsRouteService {
  private getGoogleKey(): string | null {
    const k =
      process.env.GOOGLE_MAPS_SERVER_KEY ||
      process.env.GOOGLE_DIRECTIONS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY;
    return k && k.trim().length > 0 ? k.trim() : null;
  }

  async getRoutePointsLatLng(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ lat: number; lng: number }[]> {
    const key = this.getGoogleKey();
    if (key) {
      const v2 = await this.tryRoutesV2(key, originLat, originLng, destLat, destLng);
      if (v2.length >= 2) return v2;

      const legacy = await this.tryLegacyDirections(key, originLat, originLng, destLat, destLng);
      if (legacy.length >= 2) return legacy;
    } else {
      console.warn(
        '[MapsRouteService] Sem chave Google no servidor; usando OSRM como fallback.'
      );
    }

    const osrm = await this.tryOsrm(originLat, originLng, destLat, destLng);
    if (osrm.length >= 2) return osrm;

    return [];
  }

  private osrmBase(): string {
    const b = process.env.OSRM_BASE_URL || OSRM_DEFAULT_BASE;
    return b.replace(/\/$/, '');
  }

  /** OSRM (OpenStreetMap): geometria por ruas, sem chave. */
  private async tryOsrm(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ lat: number; lng: number }[]> {
    try {
      const path = `${originLng},${originLat};${destLng},${destLat}`;
      const url = `${this.osrmBase()}/route/v1/driving/${path}?overview=full&geometries=geojson`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        console.warn(`[MapsRouteService] OSRM HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as {
        routes?: Array<{ geometry?: { coordinates?: number[][] } }>;
      };
      const coords = data.routes?.[0]?.geometry?.coordinates;
      if (!coords || coords.length < 2) return [];
      return coords.map((c) => ({ lat: c[1], lng: c[0] }));
    } catch (e) {
      console.warn('[MapsRouteService] OSRM exception:', e);
      return [];
    }
  }

  private async tryRoutesV2(
    key: string,
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ lat: number; lng: number }[]> {
    for (const travelMode of ['TWO_WHEELER', 'DRIVE'] as const) {
      try {
        const body = JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: originLat, longitude: originLng },
            },
          },
          destination: {
            location: {
              latLng: { latitude: destLat, longitude: destLng },
            },
          },
          travelMode,
          polylineQuality: 'HIGH_QUALITY',
          polylineEncoding: 'ENCODED_POLYLINE',
        });

        const res = await fetch(ROUTES_V2_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask':
              'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
          },
          body,
        });

        if (!res.ok) {
          const t = await res.text();
          console.warn(`[MapsRouteService] Routes v2 ${travelMode} HTTP ${res.status}: ${t.slice(0, 400)}`);
          continue;
        }

        const data = (await res.json()) as {
          error?: unknown;
          routes?: Array<{ polyline?: { encodedPolyline?: string } }>;
        };
        if (data.error) {
          console.warn(`[MapsRouteService] Routes v2 ${travelMode} error:`, data.error);
          continue;
        }
        const enc = data.routes?.[0]?.polyline?.encodedPolyline;
        if (!enc) continue;
        const pts = decodePolyline(enc);
        if (pts.length >= 2) return pts;
      } catch (e) {
        console.warn(`[MapsRouteService] Routes v2 ${travelMode} exception:`, e);
      }
    }
    return [];
  }

  private async tryLegacyDirections(
    key: string,
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number
  ): Promise<{ lat: number; lng: number }[]> {
    try {
      const u = new URL(LEGACY_DIRECTIONS_URL);
      u.searchParams.set('origin', `${originLat},${originLng}`);
      u.searchParams.set('destination', `${destLat},${destLng}`);
      u.searchParams.set('mode', 'driving');
      u.searchParams.set('key', key);

      const res = await fetch(u.toString());
      if (!res.ok) {
        console.warn(`[MapsRouteService] Legacy Directions HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as {
        status?: string;
        routes?: Array<{ overview_polyline?: { points?: string }; legs?: unknown[] }>;
      };
      if (data.status !== 'OK' || !data.routes?.length) return [];

      const route = data.routes[0];
      const overview = route.overview_polyline?.points;
      if (overview) {
        const pts = decodePolyline(overview);
        if (pts.length >= 2) return pts;
      }
      return this.pointsFromLegSteps(route);
    } catch (e) {
      console.warn('[MapsRouteService] Legacy Directions exception:', e);
      return [];
    }
  }

  private pointsFromLegSteps(route: {
    legs?: Array<{ steps?: Array<{ polyline?: { points?: string } }> }>;
  }): { lat: number; lng: number }[] {
    const legs = route.legs;
    if (!legs?.length) return [];

    const all: { lat: number; lng: number }[] = [];
    for (const leg of legs) {
      const steps = leg.steps;
      if (!steps) continue;
      for (const step of steps) {
        const enc = step.polyline?.points;
        if (!enc) continue;
        const segment = decodePolyline(enc);
        if (segment.length === 0) continue;
        if (all.length === 0) {
          all.push(...segment);
          continue;
        }
        const first = segment[0];
        const last = all[all.length - 1];
        if (first.lat === last.lat && first.lng === last.lng) {
          all.push(...segment.slice(1));
        } else {
          all.push(...segment);
        }
      }
    }
    return all;
  }
}
