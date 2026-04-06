import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transaction,
  enrollmentFindFirst,
  enrollmentCreate,
  planFindUnique,
  creditPackGrantCreate,
  invoiceCreate,
  invoiceFindUnique,
  invoiceUpdate,
  invoiceLineItemCreate,
  priceBookFindFirst,
  priceBookItemFindFirst,
  creditPackFindUnique,
  membershipEnrollmentFindUnique,
  membershipEnrollmentUpdate
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  enrollmentCreate: vi.fn(),
  planFindUnique: vi.fn(),
  creditPackGrantCreate: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceLineItemCreate: vi.fn(),
  priceBookFindFirst: vi.fn(),
  priceBookItemFindFirst: vi.fn(),
  creditPackFindUnique: vi.fn(),
  membershipEnrollmentFindUnique: vi.fn(),
  membershipEnrollmentUpdate: vi.fn()
}));

const { membershipPlanFindUnique } = vi.hoisted(() => ({
  membershipPlanFindUnique: vi.fn()
}));

vi.mock('../../backend/src/lib/prisma', () => ({
  prisma: {
    $transaction: transaction,
    priceBook: { findFirst: priceBookFindFirst },
    priceBookItem: { findFirst: priceBookItemFindFirst },
    creditPack: { findUnique: creditPackFindUnique },
    membershipPlan: { findUnique: membershipPlanFindUnique }
  }
}));

import {
  createMembershipEnrollment,
  purchaseCreditPack,
  renewMembership
} from '../../backend/src/modules/billing/billing.service';

const fakePriceBook = {
  id: 'pb-1',
  code: 'PB-2026',
  version: 1,
  name: 'Standard 2026',
  currency: 'USD',
  validFrom: new Date('2025-01-01'),
  validTo: null
};

const fakePriceItem = {
  id: 'pbi-1',
  sku: 'MEM-001',
  label: 'Standard Membership',
  unitAmount: 99.0,
  taxAmount: 8.79,
  isTaxInclusive: false
};

function setupPriceMocks() {
  priceBookFindFirst.mockResolvedValue(fakePriceBook);
  priceBookItemFindFirst.mockResolvedValue(fakePriceItem);
  membershipPlanFindUnique.mockResolvedValue({
    id: 'plan-1',
    code: 'MEM-STD',
    name: 'Standard Membership',
    status: 'ACTIVE',
    durationDays: 30,
    includedCredits: 10
  });
}

function setupTxMocks() {
  enrollmentFindFirst.mockResolvedValue(null);
  planFindUnique.mockResolvedValue({
    durationDays: 30,
    includedCredits: 10,
    status: 'ACTIVE'
  });
  invoiceFindUnique.mockResolvedValue(null);
  invoiceCreate.mockResolvedValue({
    id: 'inv-1',
    invoiceNumber: 'INV-20260101-ABC123',
    userId: 'user-1',
    status: 'DRAFT',
    totalAmountSnapshot: 107.79,
    balanceDue: 107.79,
    issuedAt: new Date(),
    dueAt: new Date(),
    createdAt: new Date()
  });
  invoiceLineItemCreate.mockResolvedValue({
    id: 'ili-1',
    lineNumber: 1
  });
  invoiceUpdate.mockResolvedValue({ id: 'inv-1' });
  enrollmentCreate.mockResolvedValue({
    id: 'enr-1',
    userId: 'user-1',
    membershipPlanId: 'plan-1',
    status: 'ACTIVE',
    startsAt: new Date(),
    endsAt: new Date(),
    autoRenew: false,
    nextBillingAt: null,
    lastChargedAt: new Date(),
    createdAt: new Date()
  });
}

describe('billing entitlement lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPriceMocks();

    transaction.mockImplementation(async (callback: any) =>
      callback({
        membershipEnrollment: {
          findFirst: enrollmentFindFirst,
          findUnique: membershipEnrollmentFindUnique,
          create: enrollmentCreate,
          update: membershipEnrollmentUpdate
        },
        membershipPlan: { findUnique: planFindUnique },
        creditPackGrant: { create: creditPackGrantCreate },
        invoice: {
          create: invoiceCreate,
          findUnique: invoiceFindUnique,
          update: invoiceUpdate
        },
        invoiceLineItem: { create: invoiceLineItemCreate },
        priceBook: { findFirst: priceBookFindFirst },
        priceBookItem: { findFirst: priceBookItemFindFirst }
      })
    );

    setupTxMocks();
  });

  describe('createMembershipEnrollment', () => {
    it('creates enrollment and invoice in the same transaction', async () => {
      const result = await createMembershipEnrollment({
        userId: 'user-1',
        membershipPlanId: 'plan-1'
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(enrollmentCreate).toHaveBeenCalledTimes(1);
      expect(invoiceCreate).toHaveBeenCalledTimes(1);
      expect(invoiceLineItemCreate).toHaveBeenCalledTimes(1);
      expect(invoiceUpdate).toHaveBeenCalledTimes(1);
      expect(result.enrollment).toBeDefined();
      expect(result.invoice).toBeDefined();
      expect(result.invoice.invoiceId).toBe('inv-1');
    });

    it('rolls back enrollment if invoice creation fails', async () => {
      invoiceCreate.mockRejectedValue(new Error('Invoice creation failed'));

      await expect(
        createMembershipEnrollment({
          userId: 'user-1',
          membershipPlanId: 'plan-1'
        })
      ).rejects.toThrow('Invoice creation failed');

      // Transaction rolled back - enrollment should not persist
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('purchaseCreditPack', () => {
    beforeEach(() => {
      creditPackFindUnique.mockResolvedValue({
        id: 'cp-1',
        name: 'Starter Pack',
        creditsAmount: 20,
        expiresInDays: 90,
        status: 'ACTIVE'
      });
      creditPackGrantCreate.mockResolvedValue({
        id: 'grant-1',
        userId: 'user-1',
        creditPackId: 'cp-1',
        creditsTotal: 20,
        creditsRemaining: 20,
        grantedAt: new Date(),
        expiresAt: new Date(),
        createdAt: new Date()
      });
    });

    it('creates grant and invoice in the same transaction', async () => {
      const result = await purchaseCreditPack({
        userId: 'user-1',
        creditPackId: 'cp-1'
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(creditPackGrantCreate).toHaveBeenCalledTimes(1);
      expect(invoiceCreate).toHaveBeenCalledTimes(1);
      expect(invoiceLineItemCreate).toHaveBeenCalledTimes(1);
      expect(result.grant).toBeDefined();
      expect(result.invoice).toBeDefined();
    });

    it('rolls back grant if invoice creation fails', async () => {
      invoiceCreate.mockRejectedValue(new Error('Invoice creation failed'));

      await expect(
        purchaseCreditPack({
          userId: 'user-1',
          creditPackId: 'cp-1'
        })
      ).rejects.toThrow('Invoice creation failed');

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('renewMembership', () => {
    beforeEach(() => {
      membershipEnrollmentFindUnique.mockResolvedValue({
        id: 'enr-1',
        userId: 'user-1',
        membershipPlanId: 'plan-1',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-01-31'),
        autoRenew: true
      });
      membershipEnrollmentUpdate.mockResolvedValue({
        id: 'enr-1',
        userId: 'user-1',
        membershipPlanId: 'plan-1',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-03-02'),
        nextBillingAt: new Date('2026-03-02'),
        lastChargedAt: new Date(),
        updatedAt: new Date()
      });
    });

    it('renews enrollment and creates invoice in the same transaction', async () => {
      const result = await renewMembership({
        enrollmentId: 'enr-1',
        actorUserId: 'user-1',
        actorRoles: ['MEMBER']
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(membershipEnrollmentUpdate).toHaveBeenCalledTimes(1);
      expect(invoiceCreate).toHaveBeenCalledTimes(1);
      expect(invoiceLineItemCreate).toHaveBeenCalledTimes(1);
      expect(result.enrollment).toBeDefined();
      expect(result.invoice).toBeDefined();
    });

    it('rolls back renewal if invoice creation fails', async () => {
      invoiceCreate.mockRejectedValue(new Error('Invoice creation failed'));

      await expect(
        renewMembership({
          enrollmentId: 'enr-1',
          actorUserId: 'user-1',
          actorRoles: ['MEMBER']
        })
      ).rejects.toThrow('Invoice creation failed');

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });
});
