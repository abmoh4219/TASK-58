-- Create enums
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "MembershipPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "CreditPackStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND');
CREATE TYPE "PriceBookStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REFUNDED');
CREATE TYPE "InvoiceLineType" AS ENUM ('MEMBERSHIP_PLAN', 'CREDIT_PACK', 'WALLET_TOP_UP', 'MANUAL', 'DISCOUNT');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHECK', 'MANUAL_CARD');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'VOIDED', 'REFUNDED');
CREATE TYPE "DiscountScope" AS ENUM ('INVOICE', 'INVOICE_LINE');
CREATE TYPE "DiscountValueType" AS ENUM ('PERCENT', 'FIXED');

-- Create tables
CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "username" VARCHAR(50) NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "emailHash" VARCHAR(128) NOT NULL,
  "emailCiphertext" TEXT,
  "emailIv" VARCHAR(64),
  "phoneHash" VARCHAR(128),
  "phoneCiphertext" TEXT,
  "phoneIv" VARCHAR(64),
  "passwordHash" VARCHAR(255),
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Role" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRole" (
  "userId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId")
);

CREATE TABLE "MembershipPlan" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "durationDays" INTEGER NOT NULL,
  "includedCredits" INTEGER NOT NULL DEFAULT 0,
  "status" "MembershipPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditPack" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "creditsAmount" INTEGER NOT NULL,
  "expiresInDays" INTEGER,
  "status" "CreditPackStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Wallet" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reservedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "labelCiphertext" TEXT,
  "labelIv" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletTransaction" (
  "id" UUID NOT NULL,
  "walletId" UUID NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "referenceType" VARCHAR(50),
  "referenceId" UUID,
  "memoCiphertext" TEXT,
  "memoIv" VARCHAR(64),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceBook" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "status" "PriceBookStatus" NOT NULL DEFAULT 'DRAFT',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "supersededById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceBookItem" (
  "id" UUID NOT NULL,
  "priceBookId" UUID NOT NULL,
  "sku" VARCHAR(80) NOT NULL,
  "label" VARCHAR(140) NOT NULL,
  "lineType" "InvoiceLineType" NOT NULL,
  "membershipPlanId" UUID,
  "creditPackId" UUID,
  "unitAmount" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "isTaxInclusive" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceBookItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
  "id" UUID NOT NULL,
  "invoiceNumber" VARCHAR(40) NOT NULL,
  "userId" UUID,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "priceBookCodeSnapshot" VARCHAR(50),
  "priceBookVersionSnapshot" INTEGER,
  "priceBookId" UUID,
  "subtotalAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discountAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balanceDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "issuedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "billingNameCiphertext" TEXT,
  "billingNameIv" VARCHAR(64),
  "billingAddressCiphertext" TEXT,
  "billingAddressIv" VARCHAR(64),
  "notesCiphertext" TEXT,
  "notesIv" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceLineItem" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "lineType" "InvoiceLineType" NOT NULL,
  "description" VARCHAR(255) NOT NULL,
  "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unitAmountSnapshot" DECIMAL(12,2) NOT NULL,
  "discountAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lineTotalSnapshot" DECIMAL(12,2) NOT NULL,
  "sourcePriceBookCode" VARCHAR(50),
  "sourcePriceBookVersion" INTEGER,
  "sourcePriceBookItemId" UUID,
  "sourceReferenceType" VARCHAR(50),
  "sourceReferenceId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "invoiceId" UUID,
  "walletTransactionId" UUID,
  "recordedByUserId" UUID,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "referenceNumber" VARCHAR(100),
  "checkNumberHash" VARCHAR(128),
  "cardBrandCiphertext" TEXT,
  "cardBrandIv" VARCHAR(64),
  "cardLast4Hash" VARCHAR(128),
  "cardAuthCodeCiphertext" TEXT,
  "cardAuthCodeIv" VARCHAR(64),
  "notesCiphertext" TEXT,
  "notesIv" VARCHAR(64),
  "receivedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountOverride" (
  "id" UUID NOT NULL,
  "invoiceId" UUID,
  "invoiceLineItemId" UUID,
  "scope" "DiscountScope" NOT NULL,
  "valueType" "DiscountValueType" NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "percentageValue" DECIMAL(5,2),
  "fixedAmount" DECIMAL(12,2),
  "currency" CHAR(3),
  "approvedByUserId" UUID,
  "createdByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscountOverride_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "MembershipPlan_code_key" ON "MembershipPlan"("code");
CREATE UNIQUE INDEX "CreditPack_code_key" ON "CreditPack"("code");
CREATE UNIQUE INDEX "Wallet_userId_currency_key" ON "Wallet"("userId", "currency");
CREATE UNIQUE INDEX "PriceBook_code_version_key" ON "PriceBook"("code", "version");
CREATE UNIQUE INDEX "PriceBookItem_priceBookId_sku_key" ON "PriceBookItem"("priceBookId", "sku");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE UNIQUE INDEX "InvoiceLineItem_invoiceId_lineNumber_key" ON "InvoiceLineItem"("invoiceId", "lineNumber");
CREATE UNIQUE INDEX "Payment_walletTransactionId_key" ON "Payment"("walletTransactionId");

-- Standard indexes
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "MembershipPlan_status_idx" ON "MembershipPlan"("status");
CREATE INDEX "CreditPack_status_idx" ON "CreditPack"("status");
CREATE INDEX "Wallet_status_idx" ON "Wallet"("status");
CREATE INDEX "WalletTransaction_walletId_occurredAt_idx" ON "WalletTransaction"("walletId", "occurredAt");
CREATE INDEX "WalletTransaction_referenceType_referenceId_idx" ON "WalletTransaction"("referenceType", "referenceId");
CREATE INDEX "PriceBook_status_validFrom_validTo_idx" ON "PriceBook"("status", "validFrom", "validTo");
CREATE INDEX "PriceBookItem_membershipPlanId_idx" ON "PriceBookItem"("membershipPlanId");
CREATE INDEX "PriceBookItem_creditPackId_idx" ON "PriceBookItem"("creditPackId");
CREATE INDEX "Invoice_userId_status_issuedAt_idx" ON "Invoice"("userId", "status", "issuedAt");
CREATE INDEX "Invoice_priceBookId_idx" ON "Invoice"("priceBookId");
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");
CREATE INDEX "InvoiceLineItem_sourceReferenceType_sourceReferenceId_idx" ON "InvoiceLineItem"("sourceReferenceType", "sourceReferenceId");
CREATE INDEX "Payment_invoiceId_status_idx" ON "Payment"("invoiceId", "status");
CREATE INDEX "Payment_method_receivedAt_idx" ON "Payment"("method", "receivedAt");
CREATE INDEX "DiscountOverride_scope_createdAt_idx" ON "DiscountOverride"("scope", "createdAt");
CREATE INDEX "DiscountOverride_invoiceId_idx" ON "DiscountOverride"("invoiceId");
CREATE INDEX "DiscountOverride_invoiceLineItemId_idx" ON "DiscountOverride"("invoiceLineItemId");

-- Foreign keys
ALTER TABLE "UserRole"
  ADD CONSTRAINT "UserRole_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserRole"
  ADD CONSTRAINT "UserRole_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceBook"
  ADD CONSTRAINT "PriceBook_supersededById_fkey"
  FOREIGN KEY ("supersededById") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceBookItem"
  ADD CONSTRAINT "PriceBookItem_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriceBookItem"
  ADD CONSTRAINT "PriceBookItem_membershipPlanId_fkey"
  FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceBookItem"
  ADD CONSTRAINT "PriceBookItem_creditPackId_fkey"
  FOREIGN KEY ("creditPackId") REFERENCES "CreditPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_sourcePriceBookItemId_fkey"
  FOREIGN KEY ("sourcePriceBookItemId") REFERENCES "PriceBookItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_walletTransactionId_fkey"
  FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_recordedByUserId_fkey"
  FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_invoiceLineItemId_fkey"
  FOREIGN KEY ("invoiceLineItemId") REFERENCES "InvoiceLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data integrity checks
ALTER TABLE "MembershipPlan"
  ADD CONSTRAINT "MembershipPlan_durationDays_check"
  CHECK ("durationDays" > 0);

ALTER TABLE "CreditPack"
  ADD CONSTRAINT "CreditPack_creditsAmount_check"
  CHECK ("creditsAmount" > 0);

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_balance_non_negative_check"
  CHECK ("availableBalance" >= 0 AND "reservedBalance" >= 0);

ALTER TABLE "PriceBook"
  ADD CONSTRAINT "PriceBook_valid_range_check"
  CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_non_negative_totals_check"
  CHECK (
    "subtotalAmountSnapshot" >= 0 AND
    "discountAmountSnapshot" >= 0 AND
    "taxAmountSnapshot" >= 0 AND
    "totalAmountSnapshot" >= 0 AND
    "amountPaid" >= 0 AND
    "balanceDue" >= 0
  );

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_snapshot_non_negative_check"
  CHECK (
    "quantity" > 0 AND
    "unitAmountSnapshot" >= 0 AND
    "discountAmountSnapshot" >= 0 AND
    "taxAmountSnapshot" >= 0
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_non_negative_check"
  CHECK ("amount" > 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_method_detail_check"
  CHECK (
    ("method" = 'CHECK' AND "checkNumberHash" IS NOT NULL)
    OR ("method" = 'MANUAL_CARD' AND "cardLast4Hash" IS NOT NULL)
    OR ("method" = 'CASH')
  );

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_target_exactly_one_check"
  CHECK (
    ("invoiceId" IS NOT NULL AND "invoiceLineItemId" IS NULL)
    OR ("invoiceId" IS NULL AND "invoiceLineItemId" IS NOT NULL)
  );

ALTER TABLE "DiscountOverride"
  ADD CONSTRAINT "DiscountOverride_value_type_check"
  CHECK (
    ("valueType" = 'PERCENT' AND "percentageValue" IS NOT NULL AND "fixedAmount" IS NULL)
    OR
    ("valueType" = 'FIXED' AND "fixedAmount" IS NOT NULL AND "percentageValue" IS NULL)
  );

-- Immutability for issued/paid invoices and their lines/discounts
CREATE OR REPLACE FUNCTION prevent_finalized_invoice_mutation()
RETURNS trigger AS $$
BEGIN
  IF (OLD."status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'Invoice % is immutable once no longer DRAFT', OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_immutable_update
BEFORE UPDATE ON "Invoice"
FOR EACH ROW
WHEN (OLD."status" <> 'DRAFT')
EXECUTE FUNCTION prevent_finalized_invoice_mutation();

CREATE TRIGGER trg_invoice_immutable_delete
BEFORE DELETE ON "Invoice"
FOR EACH ROW
WHEN (OLD."status" <> 'DRAFT')
EXECUTE FUNCTION prevent_finalized_invoice_mutation();

CREATE OR REPLACE FUNCTION enforce_invoice_children_mutable_only_in_draft()
RETURNS trigger AS $$
DECLARE
  target_invoice_id UUID;
  target_status "InvoiceStatus";
BEGIN
  target_invoice_id := COALESCE(NEW."invoiceId", OLD."invoiceId");

  IF target_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT "status" INTO target_status
  FROM "Invoice"
  WHERE "id" = target_invoice_id;

  IF target_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF target_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Invoice % is immutable; line/discount updates are blocked', target_invoice_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_lineitem_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLineItem"
FOR EACH ROW
EXECUTE FUNCTION enforce_invoice_children_mutable_only_in_draft();

CREATE TRIGGER trg_discount_override_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "DiscountOverride"
FOR EACH ROW
EXECUTE FUNCTION enforce_invoice_children_mutable_only_in_draft();
