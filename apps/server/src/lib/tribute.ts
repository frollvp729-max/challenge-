import crypto from "node:crypto";

/**
 * Вебхуки Tribute: https://wiki.tribute.tg/for-content-creators/api-documentation/webhooks
 * Тело подписано HMAC-SHA256 API-ключом, подпись в заголовке trbt-signature.
 */
export function verifyTributeSignature(rawBody: string, signature: string | undefined, apiKey: string): boolean {
  if (!signature || !apiKey) return false;
  const mac = crypto.createHmac("sha256", apiKey).update(rawBody).digest();
  const candidates = [mac.toString("hex"), mac.toString("base64")];
  const sig = signature.trim();
  return candidates.some(
    (c) => c.length === sig.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(sig)),
  );
}

export interface TributeEvent {
  name: string;
  created_at?: string;
  sent_at?: string;
  payload: Record<string, any>;
}

export interface TributeSubscriptionPayload {
  subscription_name: string;
  subscription_id: number;
  period_id?: number;
  period?: string;
  type?: string;
  price?: number;
  amount?: number;
  currency?: string;
  telegram_user_id: number;
  telegram_username?: string;
  expires_at: string;
  cancel_reason?: string;
}

export interface TributeDigitalProductPayload {
  product_id: number;
  product_name: string;
  amount?: number;
  currency?: string;
  purchase_id: number;
  transaction_id?: number;
  telegram_user_id?: number;
  telegram_username?: string;
}
