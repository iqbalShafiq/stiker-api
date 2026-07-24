import type { BillingProduct, PurchaseType } from '@prisma/client';
import { prisma } from '../../prisma/client';
import type { BillingProductDto, PurchaseTypeSlug } from '../../types/billing';

function toPurchaseTypeSlug(type: PurchaseType): PurchaseTypeSlug {
  switch (type) {
    case 'CONSUMABLE_TOKEN_PACK':
      return 'consumable_token_pack';
    case 'SUBSCRIPTION':
      return 'subscription';
    case 'NON_CONSUMABLE':
      return 'non_consumable';
    default:
      return 'consumable_token_pack';
  }
}

function toDto(product: BillingProduct): BillingProductDto {
  return {
    code: product.code,
    type: toPurchaseTypeSlug(product.type),
    name: product.name,
    description: product.description,
    tokenAmount: product.tokenAmount,
    tierCode: product.tierCode,
    dailyPointLimit: product.dailyPointLimit,
    googlePlayProductId: product.googlePlayProductId,
    appleProductId: product.appleProductId,
    sortOrder: product.sortOrder,
  };
}

export class BillingCatalogService {
  async listActiveProducts(): Promise<BillingProductDto[]> {
    const products = await prisma.billingProduct.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return products.map(toDto);
  }

  async getByCode(code: string): Promise<BillingProduct | null> {
    return prisma.billingProduct.findFirst({
      where: { code, isActive: true },
    });
  }

  async getByGooglePlayProductId(productId: string): Promise<BillingProduct | null> {
    return prisma.billingProduct.findFirst({
      where: { googlePlayProductId: productId, isActive: true },
    });
  }

  async getByAppleProductId(productId: string): Promise<BillingProduct | null> {
    return prisma.billingProduct.findFirst({
      where: { appleProductId: productId, isActive: true },
    });
  }
}

export const billingCatalogService = new BillingCatalogService();
