// Enums
export enum SubscriptionType {
  standard = 'standard',
  premium = 'premium',
}

export enum PilotProfile {
  FIM_DE_SEMANA = 'FIM_DE_SEMANA',
  URBANO = 'URBANO',
  TRABALHO = 'TRABALHO',
  PISTA = 'PISTA',
}

export enum MaintenanceCategory {
  OLEO = 'OLEO',
  PNEUS = 'PNEUS',
  TRAVOES = 'TRAVOES',
  FILTROS = 'FILTROS',
  TRANSMISSAO = 'TRANSMISSAO',
}

export enum MaintenanceStatus {
  OK = 'OK',
  ATENCAO = 'ATENCAO',
  CRITICO = 'CRITICO',
}

export enum PartnerType {
  STORE = 'STORE',
  MECHANIC = 'MECHANIC',
}

export enum DeliveryStatus {
  pending = 'pending',
  accepted = 'accepted',
  inProgress = 'inProgress',
  completed = 'completed',
  cancelled = 'cancelled',
}

export enum DeliveryPriority {
  low = 'low',
  normal = 'normal',
  high = 'high',
  urgent = 'urgent',
}

export enum TransactionType {
  COMMISSION = 'COMMISSION',
  WITHDRAWAL = 'WITHDRAWAL',
  BONUS = 'BONUS',
  REFUND = 'REFUND',
}

export enum TransactionStatus {
  pending = 'pending',
  completed = 'completed',
  failed = 'failed',
  cancelled = 'cancelled',
}

// Interfaces de Request
export interface AuthRequest extends Express.Request {
  userId?: string;
  user?: any;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  age: number;
  pilotProfile?: PilotProfile;
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
  category: MaintenanceCategory;
  lastChangeKm: number;
  recommendedChangeKm: number;
  currentKm: number;
  wearPercentage: number;
  status: MaintenanceStatus;
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

// Interfaces de modelos do banco
export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  age: number;
  photoUrl: string | null;
  pilotProfile: PilotProfile;
  isSubscriber: boolean;
  subscriptionType: SubscriptionType;
  subscriptionExpiresAt: Date | null;
  loyaltyPoints: number;
  currentLat: number | null;
  currentLng: number | null;
  lastLocationUpdate: Date | null;
  isOnline: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Bike {
  id: string;
  userId: string;
  model: string;
  brand: string;
  plate: string;
  currentKm: number;
  oilType: string;
  frontTirePressure: number;
  rearTirePressure: number;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaintenanceLog {
  id: string;
  bikeId: string;
  userId: string;
  partName: string;
  category: MaintenanceCategory;
  lastChangeKm: number;
  recommendedChangeKm: number;
  currentKm: number;
  wearPercentage: number;
  status: MaintenanceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  email: string | null;
  rating: number;
  reviewCount: number;
  isTrusted: boolean;
  specialties: string[];
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryOrder {
  id: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeLatitude: number;
  storeLongitude: number;
  deliveryAddress: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  recipientName: string | null;
  recipientPhone: string | null;
  notes: string | null;
  value: number;
  deliveryFee: number;
  appCommission: number;
  status: DeliveryStatus;
  priority: DeliveryPriority;
  riderId: string | null;
  riderName: string | null;
  distance: number | null;
  estimatedTime: number | null;
  createdAt: Date;
  acceptedAt: Date | null;
  inProgressAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  totalEarned: number;
  totalWithdrawn: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Post {
  id: string;
  userId: string;
  content: string;
  images: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: Date;
  updatedAt: Date;
}
