-- Script de migração inicial do banco de dados
-- Execute este script no PostgreSQL antes de iniciar a aplicação

-- Enums
CREATE TYPE "SubscriptionType" AS ENUM ('standard', 'premium');
CREATE TYPE "PilotProfile" AS ENUM ('FIM_DE_SEMANA', 'URBANO', 'TRABALHO', 'PISTA');
CREATE TYPE "MaintenanceCategory" AS ENUM ('OLEO', 'PNEUS', 'TRAVOES', 'FILTROS', 'TRANSMISSAO');
CREATE TYPE "MaintenanceStatus" AS ENUM ('OK', 'ATENCAO', 'CRITICO');
CREATE TYPE "PartnerType" AS ENUM ('STORE', 'MECHANIC');
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'accepted', 'inProgress', 'completed', 'cancelled');
CREATE TYPE "DeliveryPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE "TransactionType" AS ENUM ('COMMISSION', 'WITHDRAWAL', 'BONUS', 'REFUND');
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'completed', 'failed', 'cancelled');

-- Tabela User
CREATE TABLE "User" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  age INTEGER NOT NULL,
  "photoUrl" TEXT,
  "pilotProfile" "PilotProfile" DEFAULT 'URBANO',
  "isSubscriber" BOOLEAN DEFAULT false,
  "subscriptionType" "SubscriptionType" DEFAULT 'standard',
  "subscriptionExpiresAt" TIMESTAMP,
  "loyaltyPoints" INTEGER DEFAULT 0,
  "currentLat" DOUBLE PRECISION,
  "currentLng" DOUBLE PRECISION,
  "lastLocationUpdate" TIMESTAMP,
  "isOnline" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "User_email_idx" ON "User"(email);
CREATE INDEX "User_subscriber_online_idx" ON "User"("isSubscriber", "isOnline");
CREATE INDEX "User_location_idx" ON "User"("currentLat", "currentLng");

-- Tabela Bike
CREATE TABLE "Bike" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  brand TEXT NOT NULL,
  plate TEXT UNIQUE NOT NULL,
  "currentKm" INTEGER DEFAULT 0,
  "oilType" TEXT NOT NULL,
  "frontTirePressure" DOUBLE PRECISION NOT NULL,
  "rearTirePressure" DOUBLE PRECISION NOT NULL,
  "photoUrl" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Bike_userId_idx" ON "Bike"("userId");
CREATE INDEX "Bike_plate_idx" ON "Bike"(plate);

-- Tabela MaintenanceLog
CREATE TABLE "MaintenanceLog" (
  id TEXT PRIMARY KEY,
  "bikeId" TEXT NOT NULL REFERENCES "Bike"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "partName" TEXT NOT NULL,
  category "MaintenanceCategory" NOT NULL,
  "lastChangeKm" INTEGER NOT NULL,
  "recommendedChangeKm" INTEGER NOT NULL,
  "currentKm" INTEGER NOT NULL,
  "wearPercentage" DOUBLE PRECISION NOT NULL,
  status "MaintenanceStatus" NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "MaintenanceLog_bikeId_idx" ON "MaintenanceLog"("bikeId");
CREATE INDEX "MaintenanceLog_userId_idx" ON "MaintenanceLog"("userId");
CREATE INDEX "MaintenanceLog_status_idx" ON "MaintenanceLog"(status);
CREATE INDEX "MaintenanceLog_category_idx" ON "MaintenanceLog"(category);

-- Tabela Partner
CREATE TABLE "Partner" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type "PartnerType" NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  phone TEXT,
  email TEXT,
  rating DOUBLE PRECISION DEFAULT 0.0,
  "reviewCount" INTEGER DEFAULT 0,
  "isTrusted" BOOLEAN DEFAULT false,
  specialties TEXT[] DEFAULT '{}',
  "photoUrl" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Partner_type_trusted_idx" ON "Partner"(type, "isTrusted");
CREATE INDEX "Partner_location_idx" ON "Partner"(latitude, longitude);

-- Tabela DeliveryOrder
CREATE TABLE "DeliveryOrder" (
  id TEXT PRIMARY KEY,
  "storeId" TEXT NOT NULL REFERENCES "Partner"(id),
  "storeName" TEXT NOT NULL,
  "storeAddress" TEXT NOT NULL,
  "storeLatitude" DOUBLE PRECISION NOT NULL,
  "storeLongitude" DOUBLE PRECISION NOT NULL,
  "deliveryAddress" TEXT NOT NULL,
  "deliveryLatitude" DOUBLE PRECISION NOT NULL,
  "deliveryLongitude" DOUBLE PRECISION NOT NULL,
  "recipientName" TEXT,
  "recipientPhone" TEXT,
  notes TEXT,
  value DOUBLE PRECISION NOT NULL,
  "deliveryFee" DOUBLE PRECISION NOT NULL,
  "appCommission" DOUBLE PRECISION NOT NULL,
  status "DeliveryStatus" DEFAULT 'pending',
  priority "DeliveryPriority" DEFAULT 'normal',
  "riderId" TEXT REFERENCES "User"(id),
  "riderName" TEXT,
  distance DOUBLE PRECISION,
  "estimatedTime" INTEGER,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "acceptedAt" TIMESTAMP,
  "inProgressAt" TIMESTAMP,
  "completedAt" TIMESTAMP,
  "cancelledAt" TIMESTAMP
);

CREATE INDEX "DeliveryOrder_storeId_idx" ON "DeliveryOrder"("storeId");
CREATE INDEX "DeliveryOrder_riderId_idx" ON "DeliveryOrder"("riderId");
CREATE INDEX "DeliveryOrder_status_idx" ON "DeliveryOrder"(status);
CREATE INDEX "DeliveryOrder_createdAt_idx" ON "DeliveryOrder"("createdAt");
CREATE INDEX "DeliveryOrder_store_location_idx" ON "DeliveryOrder"("storeLatitude", "storeLongitude");
CREATE INDEX "DeliveryOrder_delivery_location_idx" ON "DeliveryOrder"("deliveryLatitude", "deliveryLongitude");

-- Tabela DeliveryTracking
CREATE TABLE "DeliveryTracking" (
  id TEXT PRIMARY KEY,
  "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "DeliveryTracking_orderId_idx" ON "DeliveryTracking"("deliveryOrderId");
CREATE INDEX "DeliveryTracking_timestamp_idx" ON "DeliveryTracking"(timestamp);

-- Tabela Wallet
CREATE TABLE "Wallet" (
  id TEXT PRIMARY KEY,
  "userId" TEXT UNIQUE NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  balance DOUBLE PRECISION DEFAULT 0.0,
  "totalEarned" DOUBLE PRECISION DEFAULT 0.0,
  "totalWithdrawn" DOUBLE PRECISION DEFAULT 0.0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- Tabela WalletTransaction
CREATE TABLE "WalletTransaction" (
  id TEXT PRIMARY KEY,
  "walletId" TEXT NOT NULL REFERENCES "Wallet"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type "TransactionType" NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  description TEXT,
  status "TransactionStatus" DEFAULT 'pending',
  "deliveryOrderId" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "completedAt" TIMESTAMP
);

CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");
CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");
CREATE INDEX "WalletTransaction_type_idx" ON "WalletTransaction"(type);
CREATE INDEX "WalletTransaction_status_idx" ON "WalletTransaction"(status);
CREATE INDEX "WalletTransaction_createdAt_idx" ON "WalletTransaction"("createdAt");

-- Tabela Post
CREATE TABLE "Post" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  images TEXT[] DEFAULT '{}',
  "likesCount" INTEGER DEFAULT 0,
  "commentsCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Post_userId_idx" ON "Post"("userId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- Tabela PostLike
CREATE TABLE "PostLike" (
  id TEXT PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("postId", "userId")
);

CREATE INDEX "PostLike_postId_idx" ON "PostLike"("postId");
CREATE INDEX "PostLike_userId_idx" ON "PostLike"("userId");

-- Tabela Comment
CREATE TABLE "Comment" (
  id TEXT PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Comment_postId_idx" ON "Comment"("postId");
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");

-- Tabela Rating
CREATE TABLE "Rating" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,
  "partnerId" TEXT REFERENCES "Partner"(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Rating_userId_idx" ON "Rating"("userId");
CREATE INDEX "Rating_deliveryOrderId_idx" ON "Rating"("deliveryOrderId");
CREATE INDEX "Rating_partnerId_idx" ON "Rating"("partnerId");
