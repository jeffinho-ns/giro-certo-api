import { DeliveryStatus, DeliveryPriority, SubscriptionType } from '@prisma/client';

export interface AuthRequest extends Express.Request {
  userId?: string;
  user?: any;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  age: number;
  pilotProfile?: string;
  photoUrl?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface CreateDeliveryOrderDto {
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeLatitude: number;
  storeLongitude: number;
  deliveryAddress: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  recipientName?: string;
  recipientPhone?: string;
  notes?: string;
  value: number;
  deliveryFee: number;
  priority?: DeliveryPriority;
}

export interface UpdateDeliveryStatusDto {
  status: DeliveryStatus;
  riderId?: string;
  riderName?: string;
}

export interface CreateBikeDto {
  userId: string;
  model: string;
  brand: string;
  plate: string;
  currentKm: number;
  oilType: string;
  frontTirePressure: number;
  rearTirePressure: number;
  photoUrl?: string;
}

export interface CreateMaintenanceLogDto {
  bikeId: string;
  userId: string;
  partName: string;
  category: string;
  lastChangeKm: number;
  recommendedChangeKm: number;
  currentKm: number;
  wearPercentage: number;
  status: string;
}

export interface UpdateUserLocationDto {
  latitude: number;
  longitude: number;
  isOnline?: boolean;
}

export interface MatchingCriteria {
  latitude: number;
  longitude: number;
  radius?: number; // em km, padrão 5km
}
