-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'ADMIN_TRAITEUR', 'EMPLOYE', 'LIVREUR', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('BASIQUE', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "TraiteurStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PriceEntryMode" AS ENUM ('HT', 'TTC');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'ar', 'en');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'SIGNUP', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DishUnit" AS ENUM ('PER_PERSON', 'PER_PIECE', 'PER_PLATTER', 'PER_KG');

-- CreateEnum
CREATE TYPE "PricingUnit" AS ENUM ('FLAT', 'PER_PERSON', 'PER_HOUR', 'PER_UNIT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('WEDDING', 'ENGAGEMENT', 'BIRTHDAY', 'AQIQA', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING', 'QUOTED', 'CONFIRMED', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LineItemType" AS ENUM ('DISH', 'PACKAGE', 'EXTRA_SERVICE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ORDER', 'QUOTE', 'INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL', 'REFUND');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('CHEF', 'COOK', 'WAITER', 'SUPERVISOR', 'DRIVER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'DECLINED', 'DONE');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('APP', 'WEB', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CLIENT', 'STAFF', 'BOT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Traiteur" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "logoUrl" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'BASIQUE',
    "status" "TraiteurStatus" NOT NULL DEFAULT 'TRIAL',
    "defaultLocale" "Locale" NOT NULL DEFAULT 'fr',
    "currency" CHAR(3) NOT NULL DEFAULT 'MAD',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Casablanca',
    "maxEventsPerDay" INTEGER,
    "isVatRegistered" BOOLEAN NOT NULL DEFAULT true,
    "defaultTaxRateBps" INTEGER NOT NULL DEFAULT 2000,
    "priceEntryMode" "PriceEntryMode" NOT NULL DEFAULT 'TTC',
    "legalName" TEXT,
    "ice" TEXT,
    "rcNumber" TEXT,
    "taxId" TEXT,
    "patenteNumber" TEXT,
    "cnssNumber" TEXT,
    "legalAddress" TEXT,
    "bankName" TEXT,
    "rib" TEXT,
    "invoiceFooter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Traiteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'fr',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "internalNotes" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAddress" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "traiteurId" UUID,
    "membershipId" UUID,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "usedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isTenantEditable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" UUID NOT NULL,
    "traiteurId" UUID,
    "role" "Role" NOT NULL,
    "permissionId" UUID NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedDate" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dish" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "categoryId" UUID,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "priceHt" INTEGER NOT NULL,
    "taxRateBps" INTEGER,
    "unit" "DishUnit" NOT NULL DEFAULT 'PER_PERSON',
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "allergens" TEXT[],
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "pricePerPersonHt" INTEGER NOT NULL,
    "taxRateBps" INTEGER,
    "minGuests" INTEGER NOT NULL DEFAULT 1,
    "maxGuests" INTEGER,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageDish" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "dishId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraService" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "priceHt" INTEGER NOT NULL,
    "taxRateBps" INTEGER,
    "pricingUnit" "PricingUnit" NOT NULL DEFAULT 'FLAT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "eventType" "EventType" NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "eventEndDate" TIMESTAMP(3),
    "guestCount" INTEGER NOT NULL,
    "venueName" TEXT,
    "venueAddress" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "internalNotes" TEXT,
    "totalHt" INTEGER NOT NULL DEFAULT 0,
    "totalTax" INTEGER NOT NULL DEFAULT 0,
    "totalTtc" INTEGER NOT NULL DEFAULT 0,
    "depositAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'MAD',
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "itemType" "LineItemType" NOT NULL,
    "dishId" UUID,
    "packageId" UUID,
    "extraServiceId" UUID,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHt" INTEGER NOT NULL,
    "discountHt" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL,
    "totalHt" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "totalTtc" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "totalHt" INTEGER NOT NULL DEFAULT 0,
    "totalTax" INTEGER NOT NULL DEFAULT 0,
    "totalTtc" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'MAD',
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "itemType" "LineItemType" NOT NULL,
    "dishId" UUID,
    "packageId" UUID,
    "extraServiceId" UUID,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHt" INTEGER NOT NULL,
    "discountHt" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL,
    "totalHt" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "totalTtc" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "originalInvoiceId" UUID,
    "reason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" CHAR(3) NOT NULL DEFAULT 'MAD',
    "totalHt" INTEGER NOT NULL,
    "totalTax" INTEGER NOT NULL,
    "totalTtc" INTEGER NOT NULL,
    "sellerSnapshot" JSONB NOT NULL,
    "buyerSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "itemType" "LineItemType" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHt" INTEGER NOT NULL,
    "discountHt" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL,
    "totalHt" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "totalTtc" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MAD',
    "type" "PaymentType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "recordedById" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "staffRole" "StaffRole" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "clientId" UUID,
    "orderId" UUID,
    "channel" "ConversationChannel" NOT NULL,
    "externalId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "isBotActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderMembershipId" UUID,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "externalId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "traiteurId" UUID,
    "actorUserId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Traiteur_slug_key" ON "Traiteur"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_traiteurId_role_idx" ON "Membership"("traiteurId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_traiteurId_key" ON "Membership"("userId", "traiteurId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_traiteurId_key" ON "Membership"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "ClientAddress_traiteurId_membershipId_idx" ON "ClientAddress"("traiteurId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "OtpCode_phone_purpose_createdAt_idx" ON "OtpCode"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_traiteurId_role_permissionId_key" ON "RolePermission"("traiteurId", "role", "permissionId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_traiteurId_key_key" ON "FeatureFlag"("traiteurId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedDate_traiteurId_date_key" ON "BlockedDate"("traiteurId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_traiteurId_type_year_key" ON "DocumentSequence"("traiteurId", "type", "year");

-- CreateIndex
CREATE INDEX "Category_traiteurId_sortOrder_idx" ON "Category"("traiteurId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_traiteurId_slug_key" ON "Category"("traiteurId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_traiteurId_key" ON "Category"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "Dish_traiteurId_categoryId_idx" ON "Dish"("traiteurId", "categoryId");

-- CreateIndex
CREATE INDEX "Dish_traiteurId_isAvailable_idx" ON "Dish"("traiteurId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "Dish_traiteurId_slug_key" ON "Dish"("traiteurId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Dish_id_traiteurId_key" ON "Dish"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "Package_traiteurId_isActive_idx" ON "Package"("traiteurId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Package_traiteurId_slug_key" ON "Package"("traiteurId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Package_id_traiteurId_key" ON "Package"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "PackageDish_traiteurId_idx" ON "PackageDish"("traiteurId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageDish_packageId_dishId_key" ON "PackageDish"("packageId", "dishId");

-- CreateIndex
CREATE INDEX "ExtraService_traiteurId_isActive_idx" ON "ExtraService"("traiteurId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraService_id_traiteurId_key" ON "ExtraService"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "Order_traiteurId_status_idx" ON "Order"("traiteurId", "status");

-- CreateIndex
CREATE INDEX "Order_traiteurId_eventDate_idx" ON "Order"("traiteurId", "eventDate");

-- CreateIndex
CREATE INDEX "Order_traiteurId_clientId_idx" ON "Order"("traiteurId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_traiteurId_reference_key" ON "Order"("traiteurId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_traiteurId_key" ON "Order"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "OrderItem_traiteurId_orderId_idx" ON "OrderItem"("traiteurId", "orderId");

-- CreateIndex
CREATE INDEX "Quote_traiteurId_status_idx" ON "Quote"("traiteurId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_traiteurId_reference_key" ON "Quote"("traiteurId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orderId_version_key" ON "Quote"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_id_traiteurId_key" ON "Quote"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "QuoteLine_traiteurId_quoteId_idx" ON "QuoteLine"("traiteurId", "quoteId");

-- CreateIndex
CREATE INDEX "Invoice_traiteurId_orderId_idx" ON "Invoice"("traiteurId", "orderId");

-- CreateIndex
CREATE INDEX "Invoice_traiteurId_issuedAt_idx" ON "Invoice"("traiteurId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_traiteurId_number_key" ON "Invoice"("traiteurId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_traiteurId_type_year_sequenceNumber_key" ON "Invoice"("traiteurId", "type", "year", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_traiteurId_key" ON "Invoice"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "InvoiceLine_traiteurId_invoiceId_idx" ON "InvoiceLine"("traiteurId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_traiteurId_orderId_idx" ON "Payment"("traiteurId", "orderId");

-- CreateIndex
CREATE INDEX "Payment_traiteurId_status_idx" ON "Payment"("traiteurId", "status");

-- CreateIndex
CREATE INDEX "StaffAssignment_traiteurId_membershipId_startAt_idx" ON "StaffAssignment"("traiteurId", "membershipId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_orderId_membershipId_staffRole_key" ON "StaffAssignment"("orderId", "membershipId", "staffRole");

-- CreateIndex
CREATE INDEX "Conversation_traiteurId_status_lastMessageAt_idx" ON "Conversation"("traiteurId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_traiteurId_channel_externalId_key" ON "Conversation"("traiteurId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_traiteurId_key" ON "Conversation"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "Message_traiteurId_conversationId_createdAt_idx" ON "Message"("traiteurId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_traiteurId_isPublished_idx" ON "Review"("traiteurId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_traiteurId_key" ON "Review"("orderId", "traiteurId");

-- CreateIndex
CREATE INDEX "AuditLog_traiteurId_createdAt_idx" ON "AuditLog"("traiteurId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_membershipId_traiteurId_fkey" FOREIGN KEY ("membershipId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedDate" ADD CONSTRAINT "BlockedDate_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_categoryId_traiteurId_fkey" FOREIGN KEY ("categoryId", "traiteurId") REFERENCES "Category"("id", "traiteurId") ON DELETE SET NULL ("categoryId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageDish" ADD CONSTRAINT "PackageDish_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageDish" ADD CONSTRAINT "PackageDish_packageId_traiteurId_fkey" FOREIGN KEY ("packageId", "traiteurId") REFERENCES "Package"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageDish" ADD CONSTRAINT "PackageDish_dishId_traiteurId_fkey" FOREIGN KEY ("dishId", "traiteurId") REFERENCES "Dish"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraService" ADD CONSTRAINT "ExtraService_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_traiteurId_fkey" FOREIGN KEY ("clientId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_dishId_traiteurId_fkey" FOREIGN KEY ("dishId", "traiteurId") REFERENCES "Dish"("id", "traiteurId") ON DELETE SET NULL ("dishId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_packageId_traiteurId_fkey" FOREIGN KEY ("packageId", "traiteurId") REFERENCES "Package"("id", "traiteurId") ON DELETE SET NULL ("packageId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_extraServiceId_traiteurId_fkey" FOREIGN KEY ("extraServiceId", "traiteurId") REFERENCES "ExtraService"("id", "traiteurId") ON DELETE SET NULL ("extraServiceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_traiteurId_fkey" FOREIGN KEY ("quoteId", "traiteurId") REFERENCES "Quote"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_dishId_traiteurId_fkey" FOREIGN KEY ("dishId", "traiteurId") REFERENCES "Dish"("id", "traiteurId") ON DELETE SET NULL ("dishId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_packageId_traiteurId_fkey" FOREIGN KEY ("packageId", "traiteurId") REFERENCES "Package"("id", "traiteurId") ON DELETE SET NULL ("packageId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_extraServiceId_traiteurId_fkey" FOREIGN KEY ("extraServiceId", "traiteurId") REFERENCES "ExtraService"("id", "traiteurId") ON DELETE SET NULL ("extraServiceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalInvoiceId_traiteurId_fkey" FOREIGN KEY ("originalInvoiceId", "traiteurId") REFERENCES "Invoice"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_traiteurId_fkey" FOREIGN KEY ("invoiceId", "traiteurId") REFERENCES "Invoice"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_traiteurId_fkey" FOREIGN KEY ("recordedById", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE SET NULL ("recordedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_membershipId_traiteurId_fkey" FOREIGN KEY ("membershipId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clientId_traiteurId_fkey" FOREIGN KEY ("clientId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE SET NULL ("clientId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE SET NULL ("orderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_traiteurId_fkey" FOREIGN KEY ("conversationId", "traiteurId") REFERENCES "Conversation"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderMembershipId_traiteurId_fkey" FOREIGN KEY ("senderMembershipId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE SET NULL ("senderMembershipId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_clientId_traiteurId_fkey" FOREIGN KEY ("clientId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- SQL ajouté manuellement (non exprimable dans le schéma Prisma).
-- Prisma ne gère ni les CHECK ni les triggers : il ne cherchera pas à les supprimer.
-- Les clés « ON DELETE SET NULL ("colonne") » et l'index NULLS NOT DISTINCT
-- ont été réécrits plus haut dans ce fichier.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Identité & accès ───
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_role_not_super_admin_check"
  CHECK ("role" <> 'SUPER_ADMIN');

ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_attempts_check"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

-- ─── Traiteur ───
ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_defaultTaxRateBps_check"
  CHECK ("defaultTaxRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_maxEventsPerDay_check"
  CHECK ("maxEventsPerDay" IS NULL OR "maxEventsPerDay" > 0);

ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_values_check"
  CHECK ("lastValue" >= 0 AND "year" BETWEEN 2000 AND 9999);

-- ─── Catalogue : prix positifs, taux valides ───
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_prices_check"
  CHECK ("priceHt" >= 0 AND ("taxRateBps" IS NULL OR "taxRateBps" BETWEEN 0 AND 10000) AND "minQuantity" > 0);
ALTER TABLE "Package" ADD CONSTRAINT "Package_prices_check"
  CHECK ("pricePerPersonHt" >= 0 AND ("taxRateBps" IS NULL OR "taxRateBps" BETWEEN 0 AND 10000)
         AND "minGuests" > 0 AND ("maxGuests" IS NULL OR "maxGuests" >= "minGuests"));
ALTER TABLE "ExtraService" ADD CONSTRAINT "ExtraService_prices_check"
  CHECK ("priceHt" >= 0 AND ("taxRateBps" IS NULL OR "taxRateBps" BETWEEN 0 AND 10000));
ALTER TABLE "PackageDish" ADD CONSTRAINT "PackageDish_quantity_check" CHECK ("quantity" > 0);

-- ─── Commandes ───
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_check"
  CHECK ("guestCount" > 0 AND "depositAmount" >= 0 AND "totalTtc" = "totalHt" + "totalTax");

-- Cohérence arithmétique des lignes (calculs : packages/shared/src/money)
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_check"
  CHECK ("quantity" > 0 AND "taxRateBps" BETWEEN 0 AND 10000
         AND "totalHt" = "unitPriceHt"::bigint * "quantity" - "discountHt"
         AND "totalTtc" = "totalHt" + "taxAmount");
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_amounts_check"
  CHECK ("quantity" > 0 AND "taxRateBps" BETWEEN 0 AND 10000
         AND "totalHt" = "unitPriceHt"::bigint * "quantity" - "discountHt"
         AND "totalTtc" = "totalHt" + "taxAmount");
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amounts_check"
  CHECK ("quantity" > 0 AND "taxRateBps" BETWEEN 0 AND 10000
         AND "totalHt" = "unitPriceHt"::bigint * "quantity" - "discountHt"
         AND "totalTtc" = "totalHt" + "taxAmount");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_check"
  CHECK ("version" > 0 AND "totalTtc" = "totalHt" + "totalTax");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);

ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

-- ─── Factures & avoirs ───
-- Facture : montants positifs, pas de référence. Avoir : montants négatifs, référence obligatoire.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_type_amounts_check"
  CHECK (
    "totalTtc" = "totalHt" + "totalTax" AND "sequenceNumber" > 0 AND (
      ("type" = 'INVOICE' AND "originalInvoiceId" IS NULL AND "totalTtc" >= 0) OR
      ("type" = 'CREDIT_NOTE' AND "originalInvoiceId" IS NOT NULL AND "totalTtc" <= 0)
    )
  );

-- Immuabilité : une facture émise ne peut être ni modifiée (sauf pdfUrl) ni supprimée.
CREATE FUNCTION invoice_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facture % immuable : suppression interdite', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'pdfUrl' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'pdfUrl' - 'updatedAt') THEN
    RAISE EXCEPTION 'Facture % immuable : toute correction passe par un avoir', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_immutable"
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_prevent_mutation();

CREATE FUNCTION invoice_line_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ligne de facture % immuable', OLD."id" USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "InvoiceLine_immutable"
  BEFORE UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_prevent_mutation();

-- Vérification différée (en fin de transaction) : au moins une ligne, totaux = somme des lignes,
-- un avoir référence une facture (pas un autre avoir). Comme les totaux ne peuvent plus être
-- modifiés après coup, ajouter une ligne à une facture existante est aussi impossible.
CREATE FUNCTION invoice_check_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  invoice   record;
  sums      record;
BEGIN
  IF TG_TABLE_NAME = 'Invoice' THEN
    target_id := NEW."id";
  ELSE
    target_id := NEW."invoiceId";
  END IF;

  SELECT "type", "totalHt", "totalTax", "totalTtc", "originalInvoiceId"
    INTO invoice FROM "Invoice" WHERE "id" = target_id;

  SELECT COUNT(*) AS line_count,
         COALESCE(SUM("totalHt"), 0) AS ht,
         COALESCE(SUM("taxAmount"), 0) AS tax,
         COALESCE(SUM("totalTtc"), 0) AS ttc
    INTO sums FROM "InvoiceLine" WHERE "invoiceId" = target_id;

  IF sums.line_count = 0 THEN
    RAISE EXCEPTION 'Facture % sans ligne', target_id USING ERRCODE = 'check_violation';
  END IF;
  IF invoice."totalHt" <> sums.ht OR invoice."totalTax" <> sums.tax OR invoice."totalTtc" <> sums.ttc THEN
    RAISE EXCEPTION 'Facture % : totaux incohérents avec les lignes', target_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF invoice."type" = 'CREDIT_NOTE' AND NOT EXISTS (
    SELECT 1 FROM "Invoice" WHERE "id" = invoice."originalInvoiceId" AND "type" = 'INVOICE'
  ) THEN
    RAISE EXCEPTION 'Avoir % : la référence doit être une facture', target_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Invoice_consistency"
  AFTER INSERT ON "Invoice" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_check_consistency();

CREATE CONSTRAINT TRIGGER "InvoiceLine_consistency"
  AFTER INSERT ON "InvoiceLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_check_consistency();
