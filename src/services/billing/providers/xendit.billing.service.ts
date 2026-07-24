import { config } from '../../../config';
import { AppError, ValidationError } from '../../../errors';
import { billingCatalogService } from '../billing-catalog.service';
import { entitlementService } from '../entitlement.service';
import { purchaseService } from '../purchase.service';
import { prisma } from '../../../prisma/client';
import { logger } from '../../../utils/logger';

interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  status: string;
  invoice_url: string;
}

/**
 * Optional Xendit checkout for non-store builds only (web, private APK, B2B).
 * Disabled unless XENDIT_ENABLED=true.
 */
export class XenditBillingService {
  isEnabled(): boolean {
    return config.billing.xendit.enabled && Boolean(config.billing.xendit.secretKey);
  }

  private getProductPriceIdr(productCode: string): number {
    const price = config.billing.xendit.productPricesIdr[productCode];
    if (!price || price <= 0) {
      throw new ValidationError(`Xendit price is not configured for product ${productCode}`);
    }
    return price;
  }

  private async createInvoice(params: {
    externalId: string;
    amount: number;
    description: string;
  }): Promise<XenditInvoiceResponse> {
    const secretKey = config.billing.xendit.secretKey;
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const response = await fetch('https://api.xendit.co/v2/invoices', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        external_id: params.externalId,
        amount: params.amount,
        description: params.description,
        currency: 'IDR',
        invoice_duration: 86400,
        success_redirect_url: `${config.appUrl}/billing/xendit/success`,
        failure_redirect_url: `${config.appUrl}/billing/xendit/failure`,
      }),
    });

    const body = (await response.json()) as XenditInvoiceResponse & { message?: string };
    if (!response.ok) {
      logger.error({ status: response.status, body }, 'Xendit invoice creation failed');
      throw new AppError('Failed to create Xendit checkout', 502, 'EXTERNAL_SERVICE_ERROR');
    }
    if (!body.invoice_url || !body.id) {
      throw new AppError('Invalid Xendit invoice response', 502, 'EXTERNAL_SERVICE_ERROR');
    }
    return body;
  }

  async createCheckout(userId: string, productCode: string): Promise<{ orderId: string; checkoutUrl: string }> {
    if (!this.isEnabled()) {
      throw new AppError('Xendit billing is not enabled', 404, 'NOT_FOUND');
    }

    const product = await billingCatalogService.getByCode(productCode);
    if (!product) {
      throw new ValidationError('Unknown or unsupported Xendit product');
    }

    const amount = this.getProductPriceIdr(product.code);
    const purchase = await purchaseService.createPending({
      userId,
      provider: 'XENDIT',
      product,
      idempotencyKey: `xendit:checkout:${userId}:${product.code}:${Date.now()}`,
      providerProductId: product.xenditProductCode ?? product.code,
      providerStatus: 'PENDING',
    });

    const invoice = await this.createInvoice({
      externalId: purchase.id,
      amount,
      description: product.name,
    });

    await prisma.purchase.update({
      where: { id: purchase.id },
      data: {
        providerOrderId: invoice.id,
        providerStatus: invoice.status,
        providerPayload: invoice as unknown as object,
      },
    });

    return { orderId: purchase.id, checkoutUrl: invoice.invoice_url };
  }

  async handleWebhook(eventId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const externalId = String(payload.external_id ?? '');
    const invoiceStatus = String(payload.status ?? '').toUpperCase();
    const invoiceId = String(payload.id ?? '');

    let purchase =
      externalId.length > 0
        ? await prisma.purchase.findUnique({ where: { id: externalId } })
        : null;

    if (!purchase && invoiceId) {
      purchase = await prisma.purchase.findFirst({
        where: { providerOrderId: invoiceId, provider: 'XENDIT' },
      });
    }

    if (!purchase) {
      logger.warn({ eventId, externalId, invoiceId }, 'Xendit webhook purchase not found');
      return;
    }

    const alreadyProcessed = purchase.status === 'FULFILLED';
    if (alreadyProcessed) {
      return;
    }

    if (!['PAID', 'SETTLED'].includes(invoiceStatus)) {
      await purchaseService.updateStatus(purchase.id, purchase.status, {
        providerStatus: invoiceStatus,
        providerPayload: payload,
      });
      return;
    }

    const product = await billingCatalogService.getByCode(purchase.productCode);
    if (!product) {
      return;
    }

    await purchaseService.updateStatus(purchase.id, 'VERIFIED', {
      verifiedAt: new Date(),
      providerStatus: invoiceStatus,
      providerPayload: payload,
    });

    if (product.type === 'CONSUMABLE_TOKEN_PACK') {
      await entitlementService.fulfillConsumableTokenPack({
        userId: purchase.userId,
        purchase,
        product,
        source: 'xendit_payment',
      });
    } else if (product.type === 'SUBSCRIPTION') {
      await entitlementService.fulfillSubscription({
        userId: purchase.userId,
        purchase,
        product,
        provider: 'XENDIT',
        source: 'xendit_payment',
      });
    }
  }
}

export const xenditBillingService = new XenditBillingService();
