import { getStripeSync } from './stripeClient';
import crypto from 'crypto';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }

  static verifyShopifyWebhook(rawBody: string, hmacHeader: string, secret: string): boolean {
    const hash = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    return hash === hmacHeader;
  }

  static normalizeShopifyEvent(topic: string, payload: any): {
    eventType: string;
    customerEmail?: string;
    customerPhone?: string;
    customerName?: string;
    orderNumber?: string;
    totalPrice?: string;
    cartUrl?: string;
  } {
    const eventType = topic.replace(/\//g, '_');

    if (topic === 'checkouts/create' || topic === 'checkouts/update') {
      return {
        eventType,
        customerEmail: payload.email || undefined,
        customerPhone: payload.phone || payload.billing_address?.phone || undefined,
        customerName: [
          payload.billing_address?.first_name || payload.shipping_address?.first_name,
          payload.billing_address?.last_name || payload.shipping_address?.last_name,
        ].filter(Boolean).join(' ') || undefined,
        totalPrice: payload.total_price || undefined,
        cartUrl: payload.abandoned_checkout_url || undefined,
      };
    }

    if (topic === 'orders/create' || topic === 'orders/fulfilled') {
      return {
        eventType,
        customerEmail: payload.email || payload.customer?.email || undefined,
        customerPhone: payload.phone || payload.billing_address?.phone || payload.customer?.phone || undefined,
        customerName: [
          payload.customer?.first_name || payload.billing_address?.first_name,
          payload.customer?.last_name || payload.billing_address?.last_name,
        ].filter(Boolean).join(' ') || undefined,
        orderNumber: payload.order_number?.toString() || payload.name || undefined,
        totalPrice: payload.total_price || undefined,
      };
    }

    return { eventType };
  }
}
