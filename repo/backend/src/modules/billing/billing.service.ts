import { createHash } from 'node:crypto';

import {
  CreditPackStatus,
  DiscountScope,
  DiscountValueType,
  InvoiceLineType,
  InvoiceStatus,
  MembershipEnrollmentStatus,
  MembershipPlanStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PriceBookStatus,
  WalletStatus,
  WalletTransactionType
} from '../../../prisma/generated';
import { getConfig } from '../../lib/config';
import { encryptOptionalField } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';
import { isAdminRole } from '../auth/roles';

type ResolvePriceBookInput = {
  asOf?: string;
  currency?: string;
};

type CreateMembershipEnrollmentInput = {
  userId: string;
  membershipPlanId: string;
  startsAt?: string;
  autoRenew?: boolean;
  asOf?: string;
};

type RenewMembershipInput = {
  enrollmentId: string;
  actorUserId: string;
  actorRoles: string[];
  asOf?: string;
};

type PurchaseCreditPackInput = {
  userId: string;
  creditPackId: string;
  asOf?: string;
};

type ConsumeCreditsInput = {
  userId: string;
  amount: number;
  reason?: string;
};

type WalletAdjustInput = {
  userId: string;
  amount: number;
  currency?: string;
  reason?: string;
};

function toDateOrNow(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthError('Invalid asOf/start date', 400);
  }

  return parsed;
}

function toCurrency(value: string | undefined): string {
  const normalized = (value ?? 'USD').trim().toUpperCase();
  if (normalized.length !== 3) {
    throw new AuthError('currency must be ISO-4217 3-letter code', 400);
  }

  return normalized;
}

function ensurePositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AuthError(`${name} must be a positive integer`, 400);
  }
}

function ensureNonZeroAmount(value: number, name: string): void {
  if (!Number.isFinite(value) || value === 0) {
    throw new AuthError(`${name} must be non-zero`, 400);
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAdmin(roles: string[]): boolean {
  return isAdminRole(roles);
}

async function resolveEffectivePriceBook(asOf: Date, currency: string) {
  const priceBook = await prisma.priceBook.findFirst({
    where: {
      status: PriceBookStatus.PUBLISHED,
      currency,
      validFrom: {
        lte: asOf
      },
      OR: [
        {
          validTo: null
        },
        {
          validTo: {
            gt: asOf
          }
        }
      ]
    },
    orderBy: [{ validFrom: 'desc' }, { version: 'desc' }],
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      currency: true,
      validFrom: true,
      validTo: true
    }
  });

  if (!priceBook) {
    throw new AuthError('No effective price book found for requested datetime/currency', 404);
  }

  return priceBook;
}

async function resolveMembershipPriceItem(membershipPlanId: string, asOf: Date, currency: string) {
  const priceBook = await resolveEffectivePriceBook(asOf, currency);

  const priceItem = await prisma.priceBookItem.findFirst({
    where: {
      priceBookId: priceBook.id,
      membershipPlanId
    },
    select: {
      id: true,
      sku: true,
      label: true,
      unitAmount: true,
      taxAmount: true,
      isTaxInclusive: true
    }
  });

  if (!priceItem) {
    throw new AuthError('No membership price item found in effective price book', 404);
  }

  return {
    priceBook,
    priceItem
  };
}

async function resolveCreditPackPriceItem(creditPackId: string, asOf: Date, currency: string) {
  const priceBook = await resolveEffectivePriceBook(asOf, currency);

  const priceItem = await prisma.priceBookItem.findFirst({
    where: {
      priceBookId: priceBook.id,
      creditPackId
    },
    select: {
      id: true,
      sku: true,
      label: true,
      unitAmount: true,
      taxAmount: true,
      isTaxInclusive: true
    }
  });

  if (!priceItem) {
    throw new AuthError('No credit-pack price item found in effective price book', 404);
  }

  return {
    priceBook,
    priceItem
  };
}

async function getOrCreateWallet(client: typeof prisma | Prisma.TransactionClient, userId: string, currency: string) {
  const existing = await client.wallet.findUnique({
    where: {
      userId_currency: {
        userId,
        currency
      }
    },
    select: {
      id: true,
      userId: true,
      currency: true,
      status: true,
      availableBalance: true,
      reservedBalance: true,
      updatedAt: true
    }
  });

  if (existing) {
    return existing;
  }

  return client.wallet.create({
    data: {
      userId,
      currency,
      status: WalletStatus.ACTIVE,
      availableBalance: 0,
      reservedBalance: 0
    },
    select: {
      id: true,
      userId: true,
      currency: true,
      status: true,
      availableBalance: true,
      reservedBalance: true,
      updatedAt: true
    }
  });
}

export async function getEffectivePriceBook(input: ResolvePriceBookInput) {
  const asOf = toDateOrNow(input.asOf);
  const currency = toCurrency(input.currency);
  return resolveEffectivePriceBook(asOf, currency);
}

export async function resolveMembershipPrice(input: { membershipPlanId: string; asOf?: string; currency?: string }) {
  const asOf = toDateOrNow(input.asOf);
  const currency = toCurrency(input.currency);

  const plan = await prisma.membershipPlan.findUnique({
    where: {
      id: input.membershipPlanId
    },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      durationDays: true,
      includedCredits: true
    }
  });

  if (!plan || plan.status !== MembershipPlanStatus.ACTIVE) {
    throw new AuthError('Membership plan is not active/available', 404);
  }

  const pricing = await resolveMembershipPriceItem(input.membershipPlanId, asOf, currency);

  return {
    asOf,
    membershipPlan: plan,
    priceBook: pricing.priceBook,
    priceItem: {
      ...pricing.priceItem,
      unitAmount: Number(pricing.priceItem.unitAmount),
      taxAmount: Number(pricing.priceItem.taxAmount)
    }
  };
}

export async function createMembershipEnrollment(input: CreateMembershipEnrollmentInput) {
  const startsAt = toDateOrNow(input.startsAt);
  const asOf = toDateOrNow(input.asOf);

  const pricing = await resolveMembershipPrice({
    membershipPlanId: input.membershipPlanId,
    asOf: asOf.toISOString(),
    currency: 'USD'
  });

  return prisma.$transaction(async (tx) => {
    const activeEnrollment = await tx.membershipEnrollment.findFirst({
      where: {
        userId: input.userId,
        status: {
          in: [MembershipEnrollmentStatus.ACTIVE, MembershipEnrollmentStatus.PAUSED]
        },
        endsAt: {
          gt: startsAt
        }
      },
      select: {
        id: true,
        membershipPlanId: true,
        endsAt: true
      }
    });

    if (activeEnrollment) {
      throw new AuthError('User already has an active membership enrollment overlapping this period', 409);
    }

    const plan = await tx.membershipPlan.findUnique({
      where: { id: input.membershipPlanId },
      select: {
        durationDays: true,
        includedCredits: true
      }
    });

    if (!plan) {
      throw new AuthError('Membership plan not found', 404);
    }

    const endsAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const enrollment = await tx.membershipEnrollment.create({
      data: {
        userId: input.userId,
        membershipPlanId: input.membershipPlanId,
        priceBookId: pricing.priceBook.id,
        priceBookItemId: pricing.priceItem.id,
        status: MembershipEnrollmentStatus.ACTIVE,
        startsAt,
        endsAt,
        autoRenew: Boolean(input.autoRenew),
        nextBillingAt: input.autoRenew ? endsAt : null,
        lastChargedAt: startsAt
      },
      select: {
        id: true,
        userId: true,
        membershipPlanId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        autoRenew: true,
        nextBillingAt: true,
        lastChargedAt: true,
        createdAt: true
      }
    });

    const invoice = await issueEntitlementInvoiceTx(tx, {
      userId: input.userId,
      asOf: startsAt,
      currency: 'USD',
      lineType: InvoiceLineType.MEMBERSHIP_PLAN,
      description: `Membership enrollment: plan ${input.membershipPlanId}`,
      unitAmount: Number(pricing.priceItem.unitAmount),
      sourcePriceBookItemId: pricing.priceItem.id,
      sourceReferenceType: 'membership_plan',
      sourceReferenceId: input.membershipPlanId,
      priceBook: pricing.priceBook
    });

    return {
      enrollment,
      invoice,
      chargeSnapshot: {
        priceBookCode: pricing.priceBook.code,
        priceBookVersion: pricing.priceBook.version,
        unitAmount: Number(pricing.priceItem.unitAmount),
        taxAmount: Number(pricing.priceItem.taxAmount),
        currency: pricing.priceBook.currency,
        chargedAt: startsAt
      }
    };
  });
}

export async function renewMembership(input: RenewMembershipInput) {
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.membershipEnrollment.findUnique({
      where: { id: input.enrollmentId },
      select: {
        id: true,
        userId: true,
        membershipPlanId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        autoRenew: true
      }
    });

    if (!enrollment) {
      throw new AuthError('Membership enrollment not found', 404);
    }

    const canRenew = enrollment.userId === input.actorUserId || isAdmin(input.actorRoles);
    if (!canRenew) {
      throw new AuthError('Not allowed to renew this membership', 403);
    }

    if (enrollment.status !== MembershipEnrollmentStatus.ACTIVE) {
      throw new AuthError('Only active memberships can be renewed', 409);
    }

    const plan = await tx.membershipPlan.findUnique({
      where: { id: enrollment.membershipPlanId },
      select: {
        durationDays: true,
        includedCredits: true,
        status: true
      }
    });

    if (!plan || plan.status !== MembershipPlanStatus.ACTIVE) {
      throw new AuthError('Membership plan not active', 409);
    }

    const asOf = toDateOrNow(input.asOf);
    const pricing = await resolveMembershipPriceItem(enrollment.membershipPlanId, asOf, 'USD');

    const extensionStart = enrollment.endsAt;
    const extensionEnd = new Date(extensionStart.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const updated = await tx.membershipEnrollment.update({
      where: {
        id: enrollment.id
      },
      data: {
        endsAt: extensionEnd,
        nextBillingAt: enrollment.autoRenew ? extensionEnd : null,
        lastChargedAt: asOf,
        priceBookId: pricing.priceBook.id,
        priceBookItemId: pricing.priceItem.id
      },
      select: {
        id: true,
        userId: true,
        membershipPlanId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        nextBillingAt: true,
        lastChargedAt: true,
        updatedAt: true
      }
    });

    const invoice = await issueEntitlementInvoiceTx(tx, {
      userId: enrollment.userId,
      asOf,
      currency: 'USD',
      lineType: InvoiceLineType.MEMBERSHIP_PLAN,
      description: `Membership renewal: plan ${enrollment.membershipPlanId}`,
      unitAmount: Number(pricing.priceItem.unitAmount),
      sourcePriceBookItemId: pricing.priceItem.id,
      sourceReferenceType: 'membership_plan',
      sourceReferenceId: enrollment.membershipPlanId,
      priceBook: pricing.priceBook
    });

    return {
      enrollment: updated,
      invoice,
      renewalSnapshot: {
        priceBookCode: pricing.priceBook.code,
        priceBookVersion: pricing.priceBook.version,
        unitAmount: Number(pricing.priceItem.unitAmount),
        taxAmount: Number(pricing.priceItem.taxAmount),
        currency: pricing.priceBook.currency,
        chargedAt: asOf
      }
    };
  });
}

export async function resolveCreditPackPrice(input: { creditPackId: string; asOf?: string; currency?: string }) {
  const asOf = toDateOrNow(input.asOf);
  const currency = toCurrency(input.currency);

  const pack = await prisma.creditPack.findUnique({
    where: {
      id: input.creditPackId
    },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      creditsAmount: true,
      expiresInDays: true
    }
  });

  if (!pack || pack.status !== CreditPackStatus.ACTIVE) {
    throw new AuthError('Credit pack is not active/available', 404);
  }

  const pricing = await resolveCreditPackPriceItem(input.creditPackId, asOf, currency);

  return {
    asOf,
    creditPack: pack,
    priceBook: pricing.priceBook,
    priceItem: {
      ...pricing.priceItem,
      unitAmount: Number(pricing.priceItem.unitAmount),
      taxAmount: Number(pricing.priceItem.taxAmount)
    }
  };
}

export async function purchaseCreditPack(input: PurchaseCreditPackInput) {
  const asOf = toDateOrNow(input.asOf);

  const resolved = await resolveCreditPackPrice({
    creditPackId: input.creditPackId,
    asOf: asOf.toISOString(),
    currency: 'USD'
  });

  const expiresAt =
    resolved.creditPack.expiresInDays && resolved.creditPack.expiresInDays > 0
      ? new Date(asOf.getTime() + resolved.creditPack.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  return prisma.$transaction(async (tx) => {
    const grant = await tx.creditPackGrant.create({
      data: {
        userId: input.userId,
        creditPackId: input.creditPackId,
        priceBookId: resolved.priceBook.id,
        priceBookItemId: resolved.priceItem.id,
        creditsTotal: resolved.creditPack.creditsAmount,
        creditsRemaining: resolved.creditPack.creditsAmount,
        grantedAt: asOf,
        expiresAt
      },
      select: {
        id: true,
        userId: true,
        creditPackId: true,
        creditsTotal: true,
        creditsRemaining: true,
        grantedAt: true,
        expiresAt: true,
        createdAt: true
      }
    });

    const invoice = await issueEntitlementInvoiceTx(tx, {
      userId: input.userId,
      asOf,
      currency: 'USD',
      lineType: InvoiceLineType.CREDIT_PACK,
      description: `Credit pack purchase: ${resolved.creditPack.name}`,
      unitAmount: Number(resolved.priceItem.unitAmount),
      sourcePriceBookItemId: resolved.priceItem.id,
      sourceReferenceType: 'credit_pack',
      sourceReferenceId: input.creditPackId,
      priceBook: resolved.priceBook
    });

    return {
      grant,
      invoice,
      chargeSnapshot: {
        priceBookCode: resolved.priceBook.code,
        priceBookVersion: resolved.priceBook.version,
        unitAmount: Number(resolved.priceItem.unitAmount),
        taxAmount: Number(resolved.priceItem.taxAmount),
        currency: resolved.priceBook.currency,
        chargedAt: asOf
      }
    };
  });
}

export async function getCreditBalance(input: { userId: string; asOf?: string }) {
  const asOf = toDateOrNow(input.asOf);

  const grants = await prisma.creditPackGrant.findMany({
    where: {
      userId: input.userId,
      creditsRemaining: {
        gt: 0
      },
      OR: [
        {
          expiresAt: null
        },
        {
          expiresAt: {
            gt: asOf
          }
        }
      ]
    },
    orderBy: [{ expiresAt: 'asc' }, { grantedAt: 'asc' }],
    select: {
      id: true,
      creditsRemaining: true,
      expiresAt: true,
      creditPack: {
        select: {
          code: true,
          name: true
        }
      }
    }
  });

  const totalCredits = grants.reduce((sum, grant) => sum + grant.creditsRemaining, 0);

  return {
    asOf,
    totalCredits,
    grants
  };
}

export async function consumeCredits(input: ConsumeCreditsInput) {
  ensurePositiveInt(input.amount, 'amount');

  return prisma.$transaction(async (tx) => {
    const asOf = new Date();
    const grants = await tx.creditPackGrant.findMany({
      where: {
        userId: input.userId,
        creditsRemaining: {
          gt: 0
        },
        OR: [
          {
            expiresAt: null
          },
          {
            expiresAt: {
              gt: asOf
            }
          }
        ]
      },
      orderBy: [{ expiresAt: 'asc' }, { grantedAt: 'asc' }],
      select: {
        id: true,
        creditsRemaining: true
      }
    });

    let remainingToConsume = input.amount;
    const consumedFrom: Array<{ grantId: string; amount: number }> = [];

    for (const grant of grants) {
      if (remainingToConsume <= 0) {
        break;
      }

      const consume = Math.min(grant.creditsRemaining, remainingToConsume);
      if (consume > 0) {
        await tx.creditPackGrant.update({
          where: { id: grant.id },
          data: {
            creditsRemaining: grant.creditsRemaining - consume
          }
        });

        consumedFrom.push({
          grantId: grant.id,
          amount: consume
        });

        remainingToConsume -= consume;
      }
    }

    if (remainingToConsume > 0) {
      throw new AuthError('Insufficient credits', 409);
    }

    return {
      userId: input.userId,
      consumed: input.amount,
      reason: input.reason ?? null,
      consumedFrom,
      consumedAt: asOf
    };
  });
}

export async function getWalletBalance(input: { userId: string; currency?: string }) {
  const currency = toCurrency(input.currency);
  const wallet = await getOrCreateWallet(prisma, input.userId, currency);

  return {
    ...wallet,
    availableBalance: Number(wallet.availableBalance),
    reservedBalance: Number(wallet.reservedBalance)
  };
}

export async function creditWallet(input: WalletAdjustInput) {
  ensureNonZeroAmount(input.amount, 'amount');
  if (input.amount < 0) {
    throw new AuthError('amount must be positive for credit operation', 400);
  }

  const amount = roundMoney(input.amount);
  const currency = toCurrency(input.currency);

  return prisma.$transaction(async (tx) => {
    const wallet = await getOrCreateWallet(tx, input.userId, currency);
    const nextBalance = roundMoney(Number(wallet.availableBalance) + amount);

    const updated = await tx.wallet.update({
      where: {
        userId_currency: {
          userId: input.userId,
          currency
        }
      },
      data: {
        availableBalance: nextBalance
      },
      select: {
        id: true,
        userId: true,
        currency: true,
        availableBalance: true,
        reservedBalance: true,
        updatedAt: true
      }
    });

    const memo = encryptOptionalField(input.reason);

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: updated.id,
        type: WalletTransactionType.CREDIT,
        amount,
        currency,
        memoCiphertext: memo.ciphertext,
        memoIv: memo.iv,
        referenceType: 'wallet_top_up'
      },
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        occurredAt: true
      }
    });

    return {
      wallet: {
        ...updated,
        availableBalance: Number(updated.availableBalance),
        reservedBalance: Number(updated.reservedBalance)
      },
      transaction: {
        ...transaction,
        amount: Number(transaction.amount)
      }
    };
  });
}

export async function debitWallet(input: WalletAdjustInput) {
  ensureNonZeroAmount(input.amount, 'amount');
  if (input.amount < 0) {
    throw new AuthError('amount must be positive for debit operation', 400);
  }

  const amount = roundMoney(input.amount);
  const currency = toCurrency(input.currency);

  return prisma.$transaction(async (tx) => {
    const wallet = await getOrCreateWallet(tx, input.userId, currency);
    const currentBalance = Number(wallet.availableBalance);
    if (currentBalance < amount) {
      throw new AuthError('Insufficient wallet balance', 409);
    }

    const nextBalance = roundMoney(currentBalance - amount);

    const updated = await tx.wallet.update({
      where: {
        userId_currency: {
          userId: input.userId,
          currency
        }
      },
      data: {
        availableBalance: nextBalance
      },
      select: {
        id: true,
        userId: true,
        currency: true,
        availableBalance: true,
        reservedBalance: true,
        updatedAt: true
      }
    });

    const memo = encryptOptionalField(input.reason);

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: updated.id,
        type: WalletTransactionType.DEBIT,
        amount,
        currency,
        memoCiphertext: memo.ciphertext,
        memoIv: memo.iv,
        referenceType: 'wallet_debit'
      },
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        occurredAt: true
      }
    });

    return {
      wallet: {
        ...updated,
        availableBalance: Number(updated.availableBalance),
        reservedBalance: Number(updated.reservedBalance)
      },
      transaction: {
        ...transaction,
        amount: Number(transaction.amount)
      }
    };
  });
}

type IssueInvoiceLineInput =
  | {
      type: 'MEMBERSHIP_PLAN';
      membershipPlanId: string;
      quantity?: number;
    }
  | {
      type: 'CREDIT_PACK';
      creditPackId: string;
      quantity?: number;
    };

type IssueInvoiceInput = {
  actorUserId: string;
  actorRoles: string[];
  customerUserId?: string;
  asOf?: string;
  currency?: string;
  dueAt?: string;
  discountPercent?: number;
  discountReason?: string;
  lines: IssueInvoiceLineInput[];
};

type ManualPaymentInput = {
  actorUserId: string;
  actorRoles: string[];
  invoiceId: string;
  method: 'CASH' | 'CHECK' | 'MANUAL_CARD';
  amount: number;
  referenceNumber?: string;
  checkNumber?: string;
  cardLast4?: string;
  cardBrand?: string;
  cardAuthCode?: string;
  notes?: string;
  receivedAt?: string;
};

function taxRate(): number {
  const raw = String(getConfig().SALES_TAX_RATE);
  if (!raw) {
    return 0.08875;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0.08875;
  }

  return value;
}

function defaultInvoiceDueDays(): number {
  const raw = String(getConfig().INVOICE_DUE_DAYS);
  if (!raw) {
    return 14;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 14;
  }

  return Math.floor(value);
}

function validateDiscountPolicy(discountPercent: number, actorRoles: string[], reason: string | undefined): void {
  if (discountPercent < 0) {
    throw new AuthError('discountPercent cannot be negative', 400);
  }

  if (discountPercent > 100) {
    throw new AuthError('discountPercent cannot exceed 100', 400);
  }

  if (discountPercent === 0) {
    return;
  }

  if (!reason || reason.trim().length < 5) {
    throw new AuthError('discountReason is required for discounts', 400);
  }

  if (discountPercent > 30 && !isAdmin(actorRoles)) {
    throw new AuthError('Discounts above 30% require administrator override', 403);
  }

  if (discountPercent > 30 && (!reason || reason.trim().length < 10)) {
    throw new AuthError('Administrator override discounts above 30% require a detailed reason', 400);
  }
}

function validateIssueInvoiceInput(input: IssueInvoiceInput): {
  customerUserId: string;
  asOf: Date;
  currency: string;
  dueAt: Date;
  discountPercent: number;
  discountReason?: string;
  lines: IssueInvoiceLineInput[];
} {
  if (!input.lines || input.lines.length === 0) {
    throw new AuthError('Invoice must include at least one line item', 400);
  }

  const customerUserId = input.customerUserId ?? input.actorUserId;
  if (customerUserId !== input.actorUserId && !isAdmin(input.actorRoles)) {
    throw new AuthError('Only administrators can issue invoices for other users', 403);
  }

  const asOf = toDateOrNow(input.asOf);
  const currency = toCurrency(input.currency);
  const dueAt = input.dueAt
    ? toDateOrNow(input.dueAt)
    : new Date(asOf.getTime() + defaultInvoiceDueDays() * 24 * 60 * 60 * 1000);
  if (dueAt <= asOf) {
    throw new AuthError('dueAt must be after invoice asOf/issue datetime', 400);
  }
  const discountPercent = input.discountPercent ?? 0;

  validateDiscountPolicy(discountPercent, input.actorRoles, input.discountReason);

  return {
    customerUserId,
    asOf,
    currency,
    dueAt,
    discountPercent,
    discountReason: input.discountReason?.trim(),
    lines: input.lines
  };
}

function allocateDiscount(totalSubtotal: number, lineSubtotal: number, discountTotal: number): number {
  if (discountTotal <= 0 || totalSubtotal <= 0 || lineSubtotal <= 0) {
    return 0;
  }

  const ratio = lineSubtotal / totalSubtotal;
  return roundMoney(discountTotal * ratio);
}

function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INV-${y}${m}${d}-${suffix}`;
}

type EntitlementInvoiceInput = {
  userId: string;
  asOf: Date;
  currency: string;
  lineType: InvoiceLineType;
  description: string;
  unitAmount: number;
  sourcePriceBookItemId: string;
  sourceReferenceType: string;
  sourceReferenceId: string;
  priceBook: {
    id: string;
    code: string;
    version: number;
    currency: string;
  };
};

async function issueEntitlementInvoiceTx(
  tx: Prisma.TransactionClient,
  input: EntitlementInvoiceInput
) {
  const rate = taxRate();
  const subtotal = roundMoney(input.unitAmount);
  const tax = roundMoney(subtotal * rate);
  const total = roundMoney(subtotal + tax);
  const dueAt = new Date(input.asOf.getTime() + defaultInvoiceDueDays() * 24 * 60 * 60 * 1000);

  let invoiceNumber = generateInvoiceNumber();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await tx.invoice.findUnique({
      where: { invoiceNumber },
      select: { id: true }
    });

    if (!existing) {
      break;
    }

    invoiceNumber = generateInvoiceNumber();
  }

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      userId: input.userId,
      status: InvoiceStatus.DRAFT,
      currency: input.currency,
      priceBookId: input.priceBook.id,
      priceBookCodeSnapshot: input.priceBook.code,
      priceBookVersionSnapshot: input.priceBook.version,
      subtotalAmountSnapshot: subtotal,
      discountAmountSnapshot: 0,
      taxAmountSnapshot: tax,
      totalAmountSnapshot: total,
      amountPaid: 0,
      balanceDue: total,
      issuedAt: input.asOf,
      dueAt
    },
    select: {
      id: true,
      invoiceNumber: true,
      userId: true,
      status: true,
      totalAmountSnapshot: true,
      balanceDue: true,
      issuedAt: true,
      dueAt: true,
      createdAt: true
    }
  });

  await tx.invoiceLineItem.create({
    data: {
      invoiceId: invoice.id,
      lineNumber: 1,
      lineType: input.lineType,
      description: input.description,
      quantity: 1,
      unitAmountSnapshot: subtotal,
      discountAmountSnapshot: 0,
      taxAmountSnapshot: tax,
      lineTotalSnapshot: total,
      sourcePriceBookCode: input.priceBook.code,
      sourcePriceBookVersion: input.priceBook.version,
      sourcePriceBookItemId: input.sourcePriceBookItemId,
      sourceReferenceType: input.sourceReferenceType,
      sourceReferenceId: input.sourceReferenceId
    }
  });

  await tx.invoice.update({
    where: { id: invoice.id },
    data: { status: InvoiceStatus.ISSUED }
  });

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    totalAmount: Number(invoice.totalAmountSnapshot),
    balanceDue: Number(invoice.balanceDue),
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt
  };
}

export async function issueInvoice(input: IssueInvoiceInput) {
  const validated = validateIssueInvoiceInput(input);

  return prisma.$transaction(async (tx) => {
    const effectiveBook = await resolveEffectivePriceBook(validated.asOf, validated.currency);

    const resolvedLines: Array<{
      lineType: InvoiceLineType;
      description: string;
      quantity: number;
      unitAmount: number;
      sourcePriceBookItemId: string;
      sourceReferenceType: string;
      sourceReferenceId: string;
    }> = [];

    for (const line of validated.lines) {
      const quantity = line.quantity ?? 1;
      ensurePositiveInt(quantity, 'line quantity');

      if (line.type === 'MEMBERSHIP_PLAN') {
        const plan = await tx.membershipPlan.findUnique({
          where: { id: line.membershipPlanId },
          select: { id: true, name: true, status: true }
        });

        if (!plan || plan.status !== MembershipPlanStatus.ACTIVE) {
          throw new AuthError('Membership plan line references inactive or missing plan', 404);
        }

        const item = await tx.priceBookItem.findFirst({
          where: {
            priceBookId: effectiveBook.id,
            membershipPlanId: line.membershipPlanId
          },
          select: {
            id: true,
            label: true,
            unitAmount: true
          }
        });

        if (!item) {
          throw new AuthError('No effective price-book item for membership plan', 404);
        }

        resolvedLines.push({
          lineType: InvoiceLineType.MEMBERSHIP_PLAN,
          description: item.label || plan.name,
          quantity,
          unitAmount: Number(item.unitAmount),
          sourcePriceBookItemId: item.id,
          sourceReferenceType: 'membership_plan',
          sourceReferenceId: line.membershipPlanId
        });
      }

      if (line.type === 'CREDIT_PACK') {
        const pack = await tx.creditPack.findUnique({
          where: { id: line.creditPackId },
          select: { id: true, name: true, status: true }
        });

        if (!pack || pack.status !== CreditPackStatus.ACTIVE) {
          throw new AuthError('Credit-pack line references inactive or missing pack', 404);
        }

        const item = await tx.priceBookItem.findFirst({
          where: {
            priceBookId: effectiveBook.id,
            creditPackId: line.creditPackId
          },
          select: {
            id: true,
            label: true,
            unitAmount: true
          }
        });

        if (!item) {
          throw new AuthError('No effective price-book item for credit pack', 404);
        }

        resolvedLines.push({
          lineType: InvoiceLineType.CREDIT_PACK,
          description: item.label || pack.name,
          quantity,
          unitAmount: Number(item.unitAmount),
          sourcePriceBookItemId: item.id,
          sourceReferenceType: 'credit_pack',
          sourceReferenceId: line.creditPackId
        });
      }
    }

    const subtotal = roundMoney(
      resolvedLines.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0)
    );

    const discountAmount = roundMoney((subtotal * validated.discountPercent) / 100);
    const taxableBase = Math.max(roundMoney(subtotal - discountAmount), 0);
    const taxAmount = roundMoney(taxableBase * taxRate());
    const totalAmount = roundMoney(taxableBase + taxAmount);

    let invoiceNumber = generateInvoiceNumber();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await tx.invoice.findUnique({
        where: { invoiceNumber },
        select: { id: true }
      });

      if (!existing) {
        break;
      }

      invoiceNumber = generateInvoiceNumber();
    }

    const invoiceNotes =
      validated.discountPercent > 30
        ? encryptOptionalField(`ADMIN_OVERRIDE_DISCOUNT:${validated.discountReason ?? ''}`)
        : encryptOptionalField(null);

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        userId: validated.customerUserId,
        status: InvoiceStatus.DRAFT,
        currency: validated.currency,
        priceBookId: effectiveBook.id,
        priceBookCodeSnapshot: effectiveBook.code,
        priceBookVersionSnapshot: effectiveBook.version,
        subtotalAmountSnapshot: subtotal,
        discountAmountSnapshot: discountAmount,
        taxAmountSnapshot: taxAmount,
        totalAmountSnapshot: totalAmount,
        amountPaid: 0,
        balanceDue: totalAmount,
        issuedAt: validated.asOf,
        dueAt: validated.dueAt,
        notesCiphertext: invoiceNotes.ciphertext,
        notesIv: invoiceNotes.iv
      },
      select: {
        id: true,
        invoiceNumber: true,
        userId: true,
        status: true,
        currency: true,
        priceBookCodeSnapshot: true,
        priceBookVersionSnapshot: true,
        subtotalAmountSnapshot: true,
        discountAmountSnapshot: true,
        taxAmountSnapshot: true,
        totalAmountSnapshot: true,
        balanceDue: true,
        issuedAt: true,
        dueAt: true,
        createdAt: true
      }
    });

    let distributedDiscount = 0;
    const lineItems = [] as Array<{
      id: string;
      lineNumber: number;
      lineType: InvoiceLineType;
      description: string;
      quantity: number;
      unitAmountSnapshot: number;
      discountAmountSnapshot: number;
      taxAmountSnapshot: number;
      lineTotalSnapshot: number;
    }>;

    for (let index = 0; index < resolvedLines.length; index += 1) {
      const line = resolvedLines[index];
      const lineSubtotal = roundMoney(line.unitAmount * line.quantity);

      const discountForLine =
        index === resolvedLines.length - 1
          ? roundMoney(discountAmount - distributedDiscount)
          : allocateDiscount(subtotal, lineSubtotal, discountAmount);
      distributedDiscount = roundMoney(distributedDiscount + discountForLine);

      const taxableLine = Math.max(roundMoney(lineSubtotal - discountForLine), 0);
      const lineTax = roundMoney(taxableLine * taxRate());
      const lineTotal = roundMoney(taxableLine + lineTax);

      const createdLine = await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          lineNumber: index + 1,
          lineType: line.lineType,
          description: line.description,
          quantity: line.quantity,
          unitAmountSnapshot: line.unitAmount,
          discountAmountSnapshot: discountForLine,
          taxAmountSnapshot: lineTax,
          lineTotalSnapshot: lineTotal,
          sourcePriceBookCode: effectiveBook.code,
          sourcePriceBookVersion: effectiveBook.version,
          sourcePriceBookItemId: line.sourcePriceBookItemId,
          sourceReferenceType: line.sourceReferenceType,
          sourceReferenceId: line.sourceReferenceId
        },
        select: {
          id: true,
          lineNumber: true,
          lineType: true,
          description: true,
          quantity: true,
          unitAmountSnapshot: true,
          discountAmountSnapshot: true,
          taxAmountSnapshot: true,
          lineTotalSnapshot: true
        }
      });

      lineItems.push({
        ...createdLine,
        quantity: Number(createdLine.quantity),
        unitAmountSnapshot: Number(createdLine.unitAmountSnapshot),
        discountAmountSnapshot: Number(createdLine.discountAmountSnapshot),
        taxAmountSnapshot: Number(createdLine.taxAmountSnapshot),
        lineTotalSnapshot: Number(createdLine.lineTotalSnapshot)
      });
    }

    if (validated.discountPercent > 0) {
      await tx.discountOverride.create({
        data: {
          invoiceId: invoice.id,
          scope: DiscountScope.INVOICE,
          valueType: DiscountValueType.PERCENT,
          label: validated.discountPercent > 30 ? 'Admin Override Discount' : 'Invoice Discount',
          reason: validated.discountReason ?? 'Discount applied',
          percentageValue: validated.discountPercent,
          fixedAmount: null,
          currency: validated.currency,
          createdByUserId: input.actorUserId,
          approvedByUserId: validated.discountPercent > 30 ? input.actorUserId : null,
          approvedAt: validated.discountPercent > 30 ? validated.asOf : null
        }
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: InvoiceStatus.ISSUED
      }
    });

    return {
      invoice: {
        ...invoice,
        subtotalAmountSnapshot: Number(invoice.subtotalAmountSnapshot),
        discountAmountSnapshot: Number(invoice.discountAmountSnapshot),
        taxAmountSnapshot: Number(invoice.taxAmountSnapshot),
        totalAmountSnapshot: Number(invoice.totalAmountSnapshot),
        balanceDue: Number(invoice.balanceDue)
      },
      lineItems,
      correctionPolicy: 'Invoices are immutable after issuance. Corrections require issuing a new invoice document with reference notes.',
      taxRate: taxRate()
    };
  });
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function computeInvoiceOutstanding(
  tx: Prisma.TransactionClient | typeof prisma,
  invoiceId: string
): Promise<{
  invoiceId: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  dueAt: Date | null;
  isOverdue: boolean;
}> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      totalAmountSnapshot: true,
      dueAt: true
    }
  });

  if (!invoice) {
    throw new AuthError('Invoice not found', 404);
  }

  const payments = await tx.payment.aggregate({
    where: {
      invoiceId,
      status: PaymentStatus.COMPLETED
    },
    _sum: {
      amount: true
    }
  });

  const totalAmount = Number(invoice.totalAmountSnapshot);
  const paidAmount = Number(payments._sum.amount ?? 0);
  const outstandingAmount = Math.max(roundMoney(totalAmount - paidAmount), 0);
  const now = new Date();
  const isOverdue = Boolean(invoice.dueAt && outstandingAmount > 0 && invoice.dueAt < now);

  return {
    invoiceId,
    totalAmount,
    paidAmount,
    outstandingAmount,
    dueAt: invoice.dueAt,
    isOverdue
  };
}

function toPaymentMethod(value: ManualPaymentInput['method']): PaymentMethod {
  if (value === 'CASH') {
    return PaymentMethod.CASH;
  }
  if (value === 'CHECK') {
    return PaymentMethod.CHECK;
  }
  return PaymentMethod.MANUAL_CARD;
}

export async function recordManualPayment(input: ManualPaymentInput) {
  ensureNonZeroAmount(input.amount, 'amount');
  if (input.amount < 0) {
    throw new AuthError('amount must be positive', 400);
  }

  const paymentAmount = roundMoney(input.amount);
  const receivedAt = toDateOrNow(input.receivedAt);
  const method = toPaymentMethod(input.method);

  if (method === PaymentMethod.CHECK && (!input.checkNumber || input.checkNumber.trim().length === 0)) {
    throw new AuthError('checkNumber is required for CHECK payments', 400);
  }

  if (method === PaymentMethod.MANUAL_CARD && (!input.cardLast4 || input.cardLast4.trim().length !== 4)) {
    throw new AuthError('cardLast4 (4 digits) is required for MANUAL_CARD payments', 400);
  }

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: {
        id: input.invoiceId
      },
      select: {
        id: true,
        userId: true,
        status: true,
        currency: true
      }
    });

    if (!invoice) {
      throw new AuthError('Invoice not found', 404);
    }

    const canApply = isAdmin(input.actorRoles) || invoice.userId === input.actorUserId;
    if (!canApply) {
      throw new AuthError('Not allowed to apply payment on this invoice', 403);
    }

    if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.REFUNDED) {
      throw new AuthError('Cannot apply payment to void/refunded invoice', 409);
    }

    const outstanding = await computeInvoiceOutstanding(tx, input.invoiceId);
    if (outstanding.outstandingAmount <= 0) {
      throw new AuthError('Invoice has no outstanding balance', 409);
    }

    if (paymentAmount > outstanding.outstandingAmount) {
      throw new AuthError('Payment amount exceeds outstanding balance', 409);
    }

    const cardBrand = encryptOptionalField(input.cardBrand);
    const cardAuthCode = encryptOptionalField(input.cardAuthCode);
    const notes = encryptOptionalField(input.notes);

    const payment = await tx.payment.create({
      data: {
        invoiceId: input.invoiceId,
        recordedByUserId: input.actorUserId,
        method,
        status: PaymentStatus.COMPLETED,
        amount: paymentAmount,
        currency: invoice.currency,
        referenceNumber: input.referenceNumber ?? null,
        checkNumberHash: input.checkNumber ? hashValue(input.checkNumber.trim()) : null,
        cardLast4Hash: input.cardLast4 ? hashValue(input.cardLast4.trim()) : null,
        cardBrandCiphertext: cardBrand.ciphertext,
        cardBrandIv: cardBrand.iv,
        cardAuthCodeCiphertext: cardAuthCode.ciphertext,
        cardAuthCodeIv: cardAuthCode.iv,
        notesCiphertext: notes.ciphertext,
        notesIv: notes.iv,
        receivedAt,
        settledAt: receivedAt
      },
      select: {
        id: true,
        invoiceId: true,
        method: true,
        status: true,
        amount: true,
        currency: true,
        referenceNumber: true,
        receivedAt: true,
        settledAt: true,
        createdAt: true
      }
    });

    const after = await computeInvoiceOutstanding(tx, input.invoiceId);

    return {
      payment: {
        ...payment,
        amount: Number(payment.amount)
      },
      outstanding: after,
      immutableInvoiceNote:
        'Payment is recorded as a new row. Issued invoice totals/lines are not modified.'
    };
  });
}

export async function getInvoiceOutstanding(invoiceId: string, actorUserId: string, actorRoles: string[]) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      userId: true,
      invoiceNumber: true,
      issuedAt: true,
      dueAt: true,
      currency: true,
      status: true
    }
  });

  if (!invoice) {
    throw new AuthError('Invoice not found', 404);
  }

  const allowed = invoice.userId === actorUserId || isAdmin(actorRoles);
  if (!allowed) {
    throw new AuthError('Not allowed to view this invoice balance', 403);
  }

  const outstanding = await computeInvoiceOutstanding(prisma, invoiceId);

  return {
    ...invoice,
    outstanding
  };
}

export async function getAccountReceivables(input: {
  actorUserId: string;
  actorRoles: string[];
  userId?: string;
}) {
  const targetUserId = input.userId ?? input.actorUserId;
  if (targetUserId !== input.actorUserId && !isAdmin(input.actorRoles)) {
    throw new AuthError('Not allowed to view receivables for this account', 403);
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      userId: targetUserId,
      status: {
        in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID]
      }
    },
    orderBy: [{ issuedAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      invoiceNumber: true,
      issuedAt: true,
      dueAt: true,
      currency: true,
      totalAmountSnapshot: true
    }
  });

  const rows = [] as Array<{
    invoiceId: string;
    invoiceNumber: string;
    issuedAt: Date | null;
    dueAt: Date | null;
    currency: string;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    isOverdue: boolean;
  }>;

  let totalOutstanding = 0;

  for (const invoice of invoices) {
    const outstanding = await computeInvoiceOutstanding(prisma, invoice.id);
    totalOutstanding = roundMoney(totalOutstanding + outstanding.outstandingAmount);

    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      currency: invoice.currency,
      totalAmount: Number(invoice.totalAmountSnapshot),
      paidAmount: outstanding.paidAmount,
      outstandingAmount: outstanding.outstandingAmount,
      isOverdue: outstanding.isOverdue
    });
  }

  return {
    userId: targetUserId,
    totalOutstanding,
    invoices: rows
  };
}

export async function getInvoice(invoiceId: string, actorUserId: string, actorRoles: string[]) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      userId: true,
      status: true,
      currency: true,
      priceBookCodeSnapshot: true,
      priceBookVersionSnapshot: true,
      subtotalAmountSnapshot: true,
      discountAmountSnapshot: true,
      taxAmountSnapshot: true,
      totalAmountSnapshot: true,
      amountPaid: true,
      balanceDue: true,
      issuedAt: true,
      dueAt: true,
      createdAt: true,
      lineItems: {
        orderBy: {
          lineNumber: 'asc'
        },
        select: {
          id: true,
          lineNumber: true,
          lineType: true,
          description: true,
          quantity: true,
          unitAmountSnapshot: true,
          discountAmountSnapshot: true,
          taxAmountSnapshot: true,
          lineTotalSnapshot: true,
          sourcePriceBookCode: true,
          sourcePriceBookVersion: true
        }
      },
      discountOverrides: {
        select: {
          id: true,
          scope: true,
          valueType: true,
          label: true,
          reason: true,
          percentageValue: true,
          fixedAmount: true,
          approvedByUserId: true,
          approvedAt: true,
          createdAt: true
        }
      }
    }
  });

  if (!invoice) {
    throw new AuthError('Invoice not found', 404);
  }

  const allowed = invoice.userId === actorUserId || isAdmin(actorRoles);
  if (!allowed) {
    throw new AuthError('Not allowed to view this invoice', 403);
  }

  const outstanding = await computeInvoiceOutstanding(prisma, invoiceId);

  return {
    ...invoice,
    subtotalAmountSnapshot: Number(invoice.subtotalAmountSnapshot),
    discountAmountSnapshot: Number(invoice.discountAmountSnapshot),
    taxAmountSnapshot: Number(invoice.taxAmountSnapshot),
    totalAmountSnapshot: Number(invoice.totalAmountSnapshot),
    amountPaid: Number(invoice.amountPaid),
    balanceDue: Number(invoice.balanceDue),
    lineItems: invoice.lineItems.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
      unitAmountSnapshot: Number(line.unitAmountSnapshot),
      discountAmountSnapshot: Number(line.discountAmountSnapshot),
      taxAmountSnapshot: Number(line.taxAmountSnapshot),
      lineTotalSnapshot: Number(line.lineTotalSnapshot)
    })),
    discountOverrides: invoice.discountOverrides.map((discount) => ({
      ...discount,
      percentageValue:
        discount.percentageValue === null ? null : Number(discount.percentageValue),
      fixedAmount: discount.fixedAmount === null ? null : Number(discount.fixedAmount)
    })),
    outstanding,
    immutable: invoice.status !== InvoiceStatus.DRAFT,
    correctionPolicy: 'Existing invoices are never edited. Use a new corrective invoice document for adjustments.'
  };
}
