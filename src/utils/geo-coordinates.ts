/**
 * Corrige sinais comuns de erro para rotas no Brasil (ex.: longitude positiva ~46 em vez de -46).
 * Não substitui validação de faixa; apenas heurísticas seguras para SP/sudeste.
 */
export function normalizeCoordinatesForBrazilRouting(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  corrected: boolean;
} {
  const fixPair = (lat: number, lng: number): { lat: number; lng: number; changed: boolean } => {
    let la = lat;
    let ln = lng;
    let changed = false;

    // Latitude ao sul do equador no Brasil é negativa; +23 com longitude típica BR sugere sinal invertido
    if (la > 0 && la <= 30 && ln <= -25 && ln >= -75) {
      la = -la;
      changed = true;
    }
    // Longitude a oeste de Greenwich no Brasil é negativa; valor positivo 35–55 com lat sul típica
    // Longitude a oeste do meridiano de Greenwich no Brasil é negativa (ex.: SP ≈ -46,7)
    if (la <= -5 && la >= -35 && ln > 0 && ln <= 55) {
      ln = -ln;
      changed = true;
    }

    return { lat: la, lng: ln, changed };
  };

  const o = fixPair(originLat, originLng);
  const d = fixPair(destLat, destLng);
  return {
    originLat: o.lat,
    originLng: o.lng,
    destLat: d.lat,
    destLng: d.lng,
    corrected: o.changed || d.changed,
  };
}
