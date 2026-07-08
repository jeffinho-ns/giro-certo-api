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
  awaiting_dispatch = 'awaiting_dispatch',
  pending = 'pending',
  accepted = 'accepted',
  arrivedAtStore = 'arrivedAtStore',
  inTransit = 'inTransit',
  arrivedAtDestination = 'arrivedAtDestination',
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

export enum DeliveryRegistrationStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ImageEntityType {
  USER = 'user',
  BIKE = 'bike',
  PARTNER = 'partner',
  POST = 'post',
  PROMOTION = 'promotion',
  STORY = 'story',
}

export enum UserRole {
  USER = 'USER',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
}

export enum UserType {
  CASUAL = 'CASUAL',
  DIARIO = 'DIARIO',
  RACING = 'RACING',
  DELIVERY = 'DELIVERY',
  LOJISTA = 'LOJISTA',
}

// ============================================
// Loja Virtual — status do pedido de compra (StoreOrder)
// awaiting_payment -> paid -> accepted_by_store -> dispatched -> in_delivery -> completed
// (+ cancelled / rejected)
// ============================================
export enum StoreOrderStatus {
  awaiting_payment = 'awaiting_payment',
  paid = 'paid',
  accepted_by_store = 'accepted_by_store',
  dispatched = 'dispatched',
  in_delivery = 'in_delivery',
  completed = 'completed',
  cancelled = 'cancelled',
  rejected = 'rejected',
}

// Interfaces de Request
// Nota: Certifique-se de ter o @types/express instalado para estender o Request
export interface AuthRequest {
  userId?: string;
  user?: any;
  actAsPartnerId?: string;
  adminActAs?: boolean;
}

export type StoreManagementMode = 'self' | 'giro_managed';

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
  /** CPF/CNPJ do pagador (somente dígitos) — exigido pelo Asaas na cobrança. */
  recipientCpf?: string;
  notes?: string;
  value: number;
  deliveryFee: number;
  priority?: DeliveryPriority;
}

export interface WhatsAppOrderWebhookDto {
  rawText: string;
  storeId?: string;
  value?: number;
  priority?: DeliveryPriority;
}

export interface UpdateDeliveryStatusDto {
  status: DeliveryStatus;
  riderId?: string;
  riderName?: string;
  pickupCode?: string;
  deliveryPin?: string;
  idempotencyKey?: string;
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
  nickname?: string;
  ridingStyle?: string;
  accessories?: string[];
  nextUpgrade?: string;
  preferredColor?: string;
  galleryUrls?: string[];
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
  /** Quando true, emissões WebSocket para a torre usam intervalo curto (navegação ativa). */
  navigationActive?: boolean;
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
  coverUrl?: string | null;
  pilotProfile: PilotProfile;
  userType?: UserType | null;
  role: UserRole;
  partnerId: string | null; // ID do parceiro vinculado (para lojistas)
  isSubscriber: boolean;
  subscriptionType: SubscriptionType;
  subscriptionExpiresAt: Date | null;
  loyaltyPoints: number;
  hasVerifiedDocuments: boolean;
  verificationBadge: boolean;
  maintenanceBlockOverride: boolean;
  /** Admin: inadimplência / suspenso de corridas */
  deliveryRiderBlocked?: boolean;
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
  nickname: string | null;
  ridingStyle: string | null;
  accessories: string[];
  nextUpgrade: string | null;
  preferredColor: string | null;
  galleryUrls: string[];
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
  /** Identificador público na URL da vitrine (/loja/<slug>). */
  slug?: string | null;
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
  // Personalização da vitrine pública (loja virtual)
  storeCoverUrl?: string | null; // Imagem de capa (hero) da vitrine
  storeThemeColor?: string | null; // Cor de destaque (hex) da vitrine
  storeDescription?: string | null; // Descrição curta exibida na vitrine
  /** self = lojista gerencia; giro_managed = marketing bloqueado para lojista */
  storeManagementMode?: StoreManagementMode;
  createdAt: Date;
  updatedAt: Date;
  /** prepaid | postpaid_pix | authorize_capture — política de cobrança ao cliente (Asaas). */
  delivery_payment_collection_mode?: string | null;
  delivery_settlement_frequency?: string | null;
  payout_bank_account_json?: Record<string, unknown> | null;
  linked_users?: Array<{ id: string; name: string; email: string | null }>;
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
  recipientCpf: string | null;
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
  arrivedAtStoreAt: Date | null;
  inTransitAt: Date | null;
  inProgressAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** Pedido de compra de origem (loja virtual), quando aplicável. */
  storeOrderId?: string | null;
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

export interface Story {
  id: string;
  userId: string;
  mediaUrl: string;
  caption?: string | null;
  likeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatConversation {
  id: string;
  participant1Id: string;
  participant2Id: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostReport {
  id: string;
  postId: string;
  reporterId: string;
  reason: string;
  status: 'pending' | 'reviewed' | 'resolved';
  createdAt: Date;
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
  /** Obrigatória quando email for informado para criar login do lojista. */
  password?: string;
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
  storeManagementMode?: StoreManagementMode;
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

// ============================================
// Tipos para DeliveryRegistration
// ============================================

export interface DeliveryRegistration {
  id: string;
  userId: string;
  status: DeliveryRegistrationStatus;
  /** MOTORCYCLE (padrão) ou BICYCLE */
  vehicleType?: VehicleType;
  cpfCnh: string;
  selfieWithDocUrl: string | null;
  motoWithPlateUrl: string | null;
  platePlateCloseupUrl: string | null;
  cnhPhotoUrl: string | null;
  crlvPhotoUrl: string | null;
  plateLicense: string;
  currentKilometers: number;
  lastOilChangeDate: Date | null;
  lastOilChangeKm: number | null;
  emergencyPhone: string | null;
  consentImages: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  adminNotes: string | null;
  equipments?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeliveryRegistrationDto {
  documentId: string;
  /** Padrão: moto. Bicicleta: enviar BICYCLE. */
  vehicleType?: VehicleType;
  plateLicense: string;
  currentKilometers: number;
  lastOilChangeDate?: Date;
  lastOilChangeKm?: number;
  emergencyPhone?: string;
  consentImages: boolean;
  // Imagens em base64
  selfieWithDocBase64?: string;
  motoWithPlateBase64?: string;
  platePlateCloseupBase64?: string;
  cnhPhotoBase64?: string;
  crlvPhotoBase64?: string;
  // Ou como buffer (para processamento interno)
  selfieWithDocData?: Buffer;
  motoWithPlateData?: Buffer;
  platePlateCloseupData?: Buffer;
  cnhPhotoData?: Buffer;
  crlvPhotoData?: Buffer;
  /** Chips selecionados (mochila, etc.) */
  equipments?: string[];
  bikeOptionalReceiptBase64?: string;
}

export interface UpdateDeliveryRegistrationStatusDto {
  status: DeliveryRegistrationStatus;
  approvedBy?: string;
  rejectionReason?: string;
  adminNotes?: string;
}

// ============================================
// Tipos para Loja Virtual (catálogo, pedido, itens)
// Fonte de verdade: PLANO_LOJA_VIRTUAL.md (Seção 6)
// ============================================

// --- Modelos de banco ---

export interface ProductCategory {
  id: string;
  partnerId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  partnerId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  basePrice: number;
  photoUrl: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  // Relacionamentos (populados via JOIN/montagem)
  optionGroups?: ProductOptionGroup[];
}

export interface ProductOptionGroup {
  id: string;
  productId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  // Relacionamentos
  options?: ProductOption[];
}

export interface ProductOption {
  id: string;
  optionGroupId: string;
  name: string;
  priceDelta: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreBanner {
  id: string;
  partnerId: string;
  imageUrl: string;
  title: string | null;
  linkUrl: string | null;
  discount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreCustomer {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Snapshot de uma variação escolhida (gravado no item do pedido). */
export interface SelectedOptionSnapshot {
  groupName: string;
  optionName: string;
  priceDelta: number;
}

export interface StoreOrder {
  id: string;
  partnerId: string;
  customerId: string | null;
  // Snapshot do cliente
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerCpf: string | null;
  customerLatitude: number | null;
  customerLongitude: number | null;
  notes: string | null;
  // Valores (recalculados no servidor)
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  // Ciclo de vida
  status: StoreOrderStatus;
  paymentId: string | null;
  deliveryOrderId: string | null;
  trackingToken: string;
  // Pagamento (Asaas)
  asaasPaymentId: string | null;
  asaasCustomerId: string | null;
  invoiceUrl: string | null;
  billingType: string | null;
  lastWebhookEvent: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  acceptedAt: Date | null;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  // Relacionamentos
  items?: StoreOrderItem[];
}

export interface StoreOrderItem {
  id: string;
  storeOrderId: string;
  productId: string | null;
  // Snapshot do item
  name: string;
  unitPrice: number;
  quantity: number;
  selectedOptions: SelectedOptionSnapshot[];
  lineTotal: number;
  notes: string | null;
  createdAt: Date;
}

// --- DTOs: catálogo (área do lojista) ---

export interface CreateProductCategoryDto {
  name: string;
  sortOrder?: number;
  active?: boolean;
}

export interface UpdateProductCategoryDto {
  name?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface CreateProductOptionDto {
  name: string;
  priceDelta?: number;
  active?: boolean;
  sortOrder?: number;
}

export interface CreateProductOptionGroupDto {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  sortOrder?: number;
  options?: CreateProductOptionDto[];
}

export interface CreateProductDto {
  categoryId?: string | null;
  name: string;
  description?: string;
  basePrice: number;
  photoUrl?: string;
  active?: boolean;
  sortOrder?: number;
  optionGroups?: CreateProductOptionGroupDto[];
}

export interface UpdateProductDto {
  categoryId?: string | null;
  name?: string;
  description?: string;
  basePrice?: number;
  photoUrl?: string;
  active?: boolean;
  sortOrder?: number;
}

export interface StoreReview {
  id: string;
  partnerId: string;
  storeOrderId: string | null;
  rating: number;
  comment: string | null;
  customerName: string | null;
  createdAt: Date;
}

export type CouponDiscountType = 'percent' | 'fixed';

export interface StoreCoupon {
  id: string;
  partnerId: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minSubtotal: number;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStoreCouponDto {
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minSubtotal?: number;
  maxUses?: number | null;
  active?: boolean;
  expiresAt?: Date | null;
}

export interface UpdateStoreCouponDto {
  code?: string;
  discountType?: CouponDiscountType;
  discountValue?: number;
  minSubtotal?: number;
  maxUses?: number | null;
  active?: boolean;
  expiresAt?: Date | null;
}

export interface CreateStoreBannerDto {
  imageUrl: string;
  title?: string;
  linkUrl?: string;
  discount?: number;
  startsAt?: Date;
  endsAt?: Date;
  active?: boolean;
  sortOrder?: number;
}

export interface UpdateStoreBannerDto {
  imageUrl?: string;
  title?: string;
  linkUrl?: string;
  discount?: number;
  startsAt?: Date;
  endsAt?: Date;
  active?: boolean;
  sortOrder?: number;
}

// --- DTOs: pedido (área pública) ---

/** Item enviado pelo cliente no checkout. Apenas referências; o servidor recalcula preços. */
export interface CreateStoreOrderItemDto {
  productId: string;
  quantity: number;
  /** IDs das opções escolhidas (validadas e precificadas no servidor). */
  selectedOptionIds?: string[];
  notes?: string;
}

export interface CreateStoreOrderDto {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  /** CPF/CNPJ do pagador (somente dígitos ou formatado) — exigido pelo Asaas no checkout. */
  customerCpf?: string;
  customerLatitude?: number;
  customerLongitude?: number;
  notes?: string;
  /** Código de cupom (validado e precificado no servidor). */
  couponCode?: string;
  items: CreateStoreOrderItemDto[];
}