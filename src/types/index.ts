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

export enum VehicleType {
  MOTORCYCLE = 'MOTORCYCLE',
  BICYCLE = 'BICYCLE',
}

export enum DocumentType {
  RG = 'RG',
  CNH = 'CNH',
  PASSPORT = 'PASSPORT',
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum PartnerType {
  STORE = 'STORE',
  MECHANIC = 'MECHANIC',
}

export enum PaymentPlanType {
  MONTHLY_SUBSCRIPTION = 'MONTHLY_SUBSCRIPTION',
  PERCENTAGE_PER_ORDER = 'PERCENTAGE_PER_ORDER',
}

export enum PaymentStatus {
  ACTIVE = 'ACTIVE',
  WARNING = 'WARNING',
  OVERDUE = 'OVERDUE',
  SUSPENDED = 'SUSPENDED',
}

export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum DisputeType {
  DELIVERY_ISSUE = 'DELIVERY_ISSUE',
  PAYMENT_ISSUE = 'PAYMENT_ISSUE',
  RIDER_COMPLAINT = 'RIDER_COMPLAINT',
  STORE_COMPLAINT = 'STORE_COMPLAINT',
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

export enum ImageEntityType {
  USER = 'user',
  BIKE = 'bike',
  PARTNER = 'partner',
  POST = 'post',
  PROMOTION = 'promotion',
}

export enum UserRole {
  USER = 'USER',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
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
  vehicleType?: VehicleType;
  plate?: string; // Opcional para bicicletas
  currentKm: number;
  oilType?: string; // Opcional para bicicletas
  frontTirePressure?: number; // Opcional para bicicletas
  rearTirePressure?: number; // Opcional para bicicletas
  photoUrl?: string;
  vehiclePhotoUrl?: string;
  platePhotoUrl?: string; // Apenas para motos
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
  role: UserRole;
  isSubscriber: boolean;
  subscriptionType: SubscriptionType;
  subscriptionExpiresAt: Date | null;
  loyaltyPoints: number;
  hasVerifiedDocuments: boolean;
  verificationBadge: boolean;
  maintenanceBlockOverride: boolean;
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
  vehicleType: VehicleType;
  plate: string | null; // Nullable para bicicletas
  currentKm: number;
  oilType: string | null; // Nullable para bicicletas
  frontTirePressure: number | null; // Nullable para bicicletas
  rearTirePressure: number | null; // Nullable para bicicletas
  photoUrl: string | null;
  vehiclePhotoUrl: string | null;
  platePhotoUrl: string | null; // Apenas para motos
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
  // Dados Empresariais
  cnpj: string | null;
  companyName: string | null; // Razão Social
  tradingName: string | null; // Nome Fantasia
  stateRegistration: string | null; // Inscrição Estadual
  // Geolocalização Expandida
  maxServiceRadius: number | null; // Raio máximo de atendimento em km
  // Configurações Operacionais
  avgPreparationTime: number | null; // Tempo médio de preparo em minutos
  operatingHours: any | null; // JSON: {"monday": {"open": "08:00", "close": "22:00"}, ...}
  // Status
  isBlocked: boolean; // Bloqueado se inadimplente
  createdAt: Date;
  updatedAt: Date;
}

export interface PartnerPayment {
  id: string;
  partnerId: string;
  planType: PaymentPlanType;
  monthlyFee: number | null; // Valor da mensalidade (se MONTHLY_SUBSCRIPTION)
  percentageFee: number | null; // Percentual por corrida (se PERCENTAGE_PER_ORDER)
  status: PaymentStatus;
  dueDate: Date | null; // Data de vencimento
  lastPaymentDate: Date | null; // Último pagamento realizado
  paymentHistory: any; // JSON array: [{date, amount, status}]
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

export interface WalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  type: TransactionType;
  amount: number;
  description: string | null;
  status: TransactionStatus;
  deliveryOrderId: string | null;
  createdAt: Date;
  completedAt: Date | null;
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

export interface Image {
  id: string;
  entityType: ImageEntityType;
  entityId: string;
  filename: string;
  mimetype: string;
  size: number;
  data: Buffer;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourierDocument {
  id: string;
  userId: string;
  documentType: DocumentType;
  status: DocumentStatus;
  fileUrl: string | null;
  expirationDate: Date | null;
  verifiedAt: Date | null;
  verifiedBy: string | null; // ID do admin
  rejectionReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationSelfie {
  id: string;
  userId: string;
  fileUrl: string;
  status: DocumentStatus;
  verifiedAt: Date | null;
  verifiedBy: string | null; // ID do admin
  notes: string | null;
  createdAt: Date;
}

// DTOs para documentos
export interface CreateCourierDocumentDto {
  userId: string;
  documentType: DocumentType;
  fileUrl: string;
  expirationDate?: Date;
}

export interface UpdateDocumentStatusDto {
  status: DocumentStatus;
  verifiedBy?: string; // ID do admin
  rejectionReason?: string;
  notes?: string;
}

export interface CreateVerificationSelfieDto {
  userId: string;
  fileUrl: string;
}

export interface UpdateVerificationSelfieDto {
  status: DocumentStatus;
  verifiedBy?: string; // ID do admin
  notes?: string;
}

// DTOs para Partner
export interface CreatePartnerDto {
  name: string;
  type: PartnerType;
  address: string;
  latitude: number;
  longitude: number;
  phone?: string;
  email?: string;
  specialties?: string[];
  photoUrl?: string;
  // Dados Empresariais
  cnpj?: string;
  companyName?: string;
  tradingName?: string;
  stateRegistration?: string;
  // Configurações
  maxServiceRadius?: number;
  avgPreparationTime?: number;
  operatingHours?: any;
}

export interface UpdatePartnerDto {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  specialties?: string[];
  photoUrl?: string;
  cnpj?: string;
  companyName?: string;
  tradingName?: string;
  stateRegistration?: string;
  maxServiceRadius?: number;
  avgPreparationTime?: number;
  operatingHours?: any;
  isBlocked?: boolean;
}

export interface CreatePartnerPaymentDto {
  partnerId: string;
  planType: PaymentPlanType;
  monthlyFee?: number; // Obrigatório se planType = MONTHLY_SUBSCRIPTION
  percentageFee?: number; // Obrigatório se planType = PERCENTAGE_PER_ORDER
  dueDate?: Date;
}

export interface UpdatePartnerPaymentDto {
  planType?: PaymentPlanType;
  monthlyFee?: number;
  percentageFee?: number;
  status?: PaymentStatus;
  dueDate?: Date;
}

export interface RecordPaymentDto {
  amount: number;
  paymentDate: Date;
  description?: string;
}

export interface Dispute {
  id: string;
  deliveryOrderId: string | null;
  reportedBy: string;
  disputeType: DisputeType;
  status: DisputeStatus;
  description: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  locationLogs: any | null; // JSON array of GPS points
  createdAt: Date;
  updatedAt: Date;
  // Relacionamentos (populados via JOIN)
  deliveryOrder?: DeliveryOrder;
  reporter?: User;
  resolver?: User;
}

export interface CreateDisputeDto {
  deliveryOrderId?: string;
  disputeType: DisputeType;
  description: string;
  locationLogs?: any; // JSON array of GPS points
}

export interface ResolveDisputeDto {
  resolution: string;
  status?: DisputeStatus; // RESOLVED ou CLOSED
}
