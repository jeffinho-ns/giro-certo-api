/**
 * Calcula a distância entre dois pontos geográficos usando a fórmula de Haversine
 * @param lat1 Latitude do primeiro ponto
 * @param lng1 Longitude do primeiro ponto
 * @param lat2 Latitude do segundo ponto
 * @param lng2 Longitude do segundo ponto
 * @returns Distância em quilômetros
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Raio da Terra em km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Encontra usuários próximos a um ponto geográfico
 * @param latitude Latitude do ponto central
 * @param longitude Longitude do ponto central
 * @param radius Raio de busca em km
 * @returns Lista de usuários dentro do raio
 */
export function findNearbyUsers(
  users: Array<{ currentLat: number | null; currentLng: number | null }>,
  latitude: number,
  longitude: number,
  radius: number = 5
): Array<{ user: any; distance: number }> {
  const nearby: Array<{ user: any; distance: number }> = [];

  for (const user of users) {
    if (user.currentLat && user.currentLng) {
      const distance = calculateDistance(
        latitude,
        longitude,
        user.currentLat,
        user.currentLng
      );

      if (distance <= radius) {
        nearby.push({ user, distance });
      }
    }
  }

  return nearby.sort((a, b) => a.distance - b.distance);
}
