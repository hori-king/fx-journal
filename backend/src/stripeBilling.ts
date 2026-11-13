import { createHmac, timingSafeEqual } from "node:crypto";

type JsonObject = Record<string, unknown>;
type CheckoutReservation = { allowed: boolean; stripe_customer_id: string | null };
type PortalSubscription = {
  plan: "free" | "pro";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  pro_ends_at: string | null;
};

export class StripeBillingError extends Error {
  constructor(message: string, readonly statusCode = 503) {
    super(message);
    this.name = "StripeBillingError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStripeErrorText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b(?:cus|pm|acct|sub|cs|pi|in)_[A-Za-z0-9]+\b/g, "[redacted-id]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-number]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, maxLength);
  return safe || undefined;
}

function stripeErrorLogDetails(payload: unknown, response: Response) {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : undefined;
  return {
    status: response.status,
    requestId: safeStripeErrorText(response.headers.get("request-id"), 100),
    type: safeStripeErrorText(error?.type, 64),
    code: safeStripeErrorText(error?.code, 100),
    param: safeStripeErrorText(error?.param, 160),
    message: safeStripeErrorText(error?.message, 500),
  };
}

export function validateCheckoutReturnUrls(
  frontendOrigin: string,
  successUrl: string,
  cancelUrl: string,
  isProduction: boolean,
): void {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(frontendOrigin).origin;
  } catch {
    console.error("Stripe checkout return URL configuration is invalid", { field: "FRONTEND_ORIGIN" });
    throw new StripeBillingError("FRONTEND_ORIGINのURL形式が正しくありません。");
  }

  let success: URL;
  try {
    success = new URL(successUrl);
  } catch {
    console.error("Stripe checkout return URL configuration is invalid", { field: "STRIPE_SUCCESS_URL" });
    throw new StripeBillingError("STRIPE_SUCCESS_URLのURL形式が正しくありません。");
  }

  let cancel: URL;
  try {
    cancel = new URL(cancelUrl);
  } catch {
    console.error("Stripe checkout return URL configuration is invalid", { field: "STRIPE_CANCEL_URL" });
    throw new StripeBillingError("STRIPE_CANCEL_URLのURL形式が正しくありません。");
  }

  if (success.origin !== expectedOrigin || cancel.origin !== expectedOrigin) {
    // Origins are public host/protocol values. Never log URL paths or query values.
    console.error("Stripe checkout return URL origin mismatch", {
      frontendOrigin: expectedOrigin,
      successOrigin: success.origin,
      cancelOrigin: cancel.origin,
    });
    throw new StripeBillingError("STRIPE_SUCCESS_URLとSTRIPE_CANCEL_URLのoriginはFRONTEND_ORIGINと一致させてください。");
  }

  if (isProduction && (success.protocol !== "https:" || cancel.protocol !== "https:")) {
    console.error("Stripe checkout return URL must use HTTPS in production", {
      successProtocol: success.protocol,
      cancelProtocol: cancel.protocol,
    });
    throw new StripeBillingError("本番環境の決済後URLはHTTPSにしてください。");
  }
}

function stripeConfiguration() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;
  const frontendOrigin = process.env.FRONTEND_ORIGIN;

  if (!secretKey?.startsWith("sk_test_") || !priceId || !webhookSecret?.startsWith("whsec_") || !successUrl || !cancelUrl) {
    throw new StripeBillingError("Stripe Test Modeの設定が不足しています。");
  }
  if (!frontendOrigin) throw new StripeBillingError("決済画面の戻り先が設定されていません。");

  validateCheckoutReturnUrls(frontendOrigin, successUrl, cancelUrl, process.env.NODE_ENV === "production");
  return { secretKey, priceId, webhookSecret, successUrl, cancelUrl };
}

function stripeApiBase(): string {
  return "https://api.stripe.com/v1";
}

// Pin REST payloads to the current API. Configure the Dashboard webhook endpoint
// to this same version so invoice and subscription snapshots match this parser.
const STRIPE_API_VERSION = "2026-09-30.endive";

async function stripeRequest<T>(path: string, method: "GET" | "POST", params?: URLSearchParams, idempotencyKey?: string): Promise<T> {
  const { secretKey } = stripeConfiguration();
  const isGet = method === "GET";
  const url = new URL(`${stripeApiBase()}${path}`);
  if (isGet && params) url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(isGet ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(!isGet && params ? { body: params } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StripeBillingError("Stripeへ接続できませんでした。時間をおいて再度お試しください。");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Stripe API request failed", {
      method,
      path,
      ...stripeErrorLogDetails(payload, response),
    });
    throw new StripeBillingError("Stripe決済を開始できませんでした。設定を確認してください。", response.status >= 500 ? 503 : 400);
  }
  return payload as T;
}

function stripeRpc<T>(name: string, body: JsonObject, fetcher: typeof fetch = fetch): Promise<T> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Stripe billing RPC configuration is missing", { functionName: name });
    throw new StripeBillingError("契約情報を更新できません。管理者へお問い合わせください。");
  }
  return fetcher(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).then(async (response) => {
    if (!response.ok) {
      let code: string | undefined;
      try {
        const value: unknown = await response.json();
        if (isObject(value) && typeof value.code === "string") code = value.code.slice(0, 32);
      } catch { /* statusだけ記録する */ }
      console.error("Stripe billing RPC failed", { functionName: name, status: response.status, code });
      throw new StripeBillingError("契約情報を更新できません。時間をおいて再度お試しください。");
    }
    return response.json() as Promise<T>;
  }).catch((error: unknown) => {
    if (error instanceof StripeBillingError) throw error;
    console.error("Stripe billing RPC transport failed", { functionName: name });
    throw new StripeBillingError("契約情報を更新できません。時間をおいて再度お試しください。");
  });
}

function isCheckoutReservation(value: unknown): value is CheckoutReservation {
  const row = Array.isArray(value) ? value[0] : value;
  return isObject(row) && typeof row.allowed === "boolean"
    && (row.stripe_customer_id === null || typeof row.stripe_customer_id === "string");
}

function formValue(form: URLSearchParams, key: string, value: string | number | boolean) {
  form.set(key, String(value));
}

export function validateProPrice(price: unknown): boolean {
  if (!isObject(price) || price.active !== true || price.livemode !== false || price.type !== "recurring"
      || price.currency !== "jpy" || price.unit_amount !== 580 || price.tax_behavior !== "inclusive") return false;
  return isObject(price.recurring)
    && price.recurring.interval === "month"
    && price.recurring.interval_count === 1
    && (price.recurring.trial_period_days === null || price.recurring.trial_period_days === undefined);
}

function isPortalSubscription(value: unknown): value is PortalSubscription {
  return isObject(value)
    && (value.plan === "free" || value.plan === "pro")
    && (value.stripe_customer_id === null || typeof value.stripe_customer_id === "string")
    && (value.stripe_subscription_id === null || typeof value.stripe_subscription_id === "string")
    && (value.pro_ends_at === null || typeof value.pro_ends_at === "string");
}

function portalConfigurationId(): string {
  const value = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  if (!value || !/^bpc_[A-Za-z0-9]+$/.test(value)) {
    throw new StripeBillingError("解約画面のStripe設定が不足しています。管理者へお問い合わせください。");
  }
  return value;
}

async function loadPortalSubscription(userId: string): Promise<PortalSubscription> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Stripe portal subscription lookup configuration is missing");
    throw new StripeBillingError("契約情報を確認できません。管理者へお問い合わせください。");
  }

  const query = new URLSearchParams({
    select: "plan,stripe_customer_id,stripe_subscription_id,pro_ends_at",
    user_id: `eq.${userId}`,
    limit: "2",
  });
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/subscriptions?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StripeBillingError("契約情報を確認できません。時間をおいて再度お試しください。");
  }
  if (!response.ok) {
    console.error("Stripe portal subscription lookup failed", { status: response.status });
    throw new StripeBillingError("契約情報を確認できません。時間をおいて再度お試しください。");
  }
  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1 || !isPortalSubscription(rows[0])) {
    throw new StripeBillingError("契約情報を確認できませんでした。再読み込みしてください。", 409);
  }
  return rows[0];
}

function portalReturnUrl(frontendOrigin: string): string {
  let origin: URL;
  try {
    origin = new URL(frontendOrigin);
  } catch {
    throw new StripeBillingError("契約管理画面の戻り先が設定されていません。");
  }
  if (origin.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new StripeBillingError("本番環境の契約管理画面はHTTPSにしてください。");
  }
  // プラン画面はReactの画面状態であり、独立したVercelパスではないため、実在するSPAエントリへ戻す。
  return new URL("/?portal=return", origin.origin).toString();
}

export async function createProCustomerPortalSession(userId: string): Promise<string> {
  const config = stripeConfiguration();
  const configurationId = portalConfigurationId();
  const subscriptionRow = await loadPortalSubscription(userId);
  const currentPeriodEnd = subscriptionRow.pro_ends_at ? Date.parse(subscriptionRow.pro_ends_at) : NaN;
  if (subscriptionRow.plan !== "pro" || !subscriptionRow.stripe_customer_id || !subscriptionRow.stripe_subscription_id
      || !Number.isFinite(currentPeriodEnd) || currentPeriodEnd <= Date.now()) {
    throw new StripeBillingError("有効なPro契約が見つかりません。契約状態を再読み込みしてください。", 409);
  }

  const [customer, subscription, portalConfiguration] = await Promise.all([
    stripeRequest<unknown>(`/customers/${encodeURIComponent(subscriptionRow.stripe_customer_id)}`, "GET"),
    retrieveSubscription(subscriptionRow.stripe_subscription_id),
    stripeRequest<unknown>(`/billing_portal/configurations/${encodeURIComponent(configurationId)}`, "GET"),
  ]);
  if (!isObject(customer) || customer.deleted === true || customer.id !== subscriptionRow.stripe_customer_id
      || !isObject(customer.metadata) || customer.metadata.supabase_user_id !== userId) {
    throw new StripeBillingError("Stripe顧客とログインユーザーの紐付けを確認できませんでした。", 409);
  }
  if (!isExpectedSubscription(subscription, subscriptionRow.stripe_customer_id, userId, config.priceId)
      || subscription.id !== subscriptionRow.stripe_subscription_id || subscription.status !== "active"
      || (subscriptionPeriodEnd(subscription) ? Date.parse(subscriptionPeriodEnd(subscription)!) : 0) <= Date.now()) {
    throw new StripeBillingError("有効なStripe契約を確認できませんでした。契約状態を再読み込みしてください。", 409);
  }
  const features = isObject(portalConfiguration) && isObject(portalConfiguration.features)
    ? portalConfiguration.features : null;
  const cancellation = features && isObject(features.subscription_cancel) ? features.subscription_cancel : null;
  if (!isObject(portalConfiguration) || portalConfiguration.id !== configurationId
      || portalConfiguration.active !== true || portalConfiguration.livemode !== false
      || !cancellation || cancellation.enabled !== true || cancellation.mode !== "at_period_end") {
    console.error("Stripe portal configuration is inactive or allows unsupported cancellation", {
      configurationId: maskedStripeId(configurationId),
    });
    throw new StripeBillingError("Stripe Customer Portalが期間終了時の解約設定になっていません。管理者へお問い合わせください。");
  }

  const sessionForm = new URLSearchParams();
  formValue(sessionForm, "customer", subscriptionRow.stripe_customer_id);
  formValue(sessionForm, "configuration", configurationId);
  formValue(sessionForm, "return_url", portalReturnUrl(process.env.FRONTEND_ORIGIN ?? ""));
  const session = await stripeRequest<unknown>("/billing_portal/sessions", "POST", sessionForm);
  if (!isObject(session) || typeof session.url !== "string" || !session.url.startsWith("https://billing.stripe.com/")) {
    throw new StripeBillingError("Stripe契約管理画面のURLを取得できませんでした。");
  }
  return session.url;
}

export function stripeEventCanActivatePro(eventType: string): boolean {
  return eventType === "invoice.paid";
}

export async function createProCheckout(userId: string, email?: string): Promise<string> {
  const config = stripeConfiguration();
  const price = await stripeRequest<unknown>(`/prices/${encodeURIComponent(config.priceId)}`, "GET");
  if (!validateProPrice(price)) {
    console.error("Stripe Pro price configuration is invalid", { priceId: config.priceId });
    throw new StripeBillingError("月額580円（税込）のPro価格がStripe側に正しく設定されていません。");
  }

  const lockUntil = new Date(Date.now() + 35 * 60_000).toISOString();
  const reservation = await stripeRpc<unknown>("reserve_pro_checkout", { p_user_id: userId, p_lock_until: lockUntil });
  if (!isCheckoutReservation(reservation)) throw new StripeBillingError("契約状態を確認できませんでした。");
  const row = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!row.allowed) throw new StripeBillingError("すでにPro契約中、または決済処理中です。契約状態を再読み込みしてください。", 409);

  try {
    let customerId = row.stripe_customer_id;
    if (!customerId) {
      const customerForm = new URLSearchParams();
      if (email) formValue(customerForm, "email", email);
      formValue(customerForm, "metadata[supabase_user_id]", userId);
      const customer = await stripeRequest<unknown>("/customers", "POST", customerForm, `supabase-customer-${userId}`);
      if (!isObject(customer) || typeof customer.id !== "string" || !isObject(customer.metadata) || customer.metadata.supabase_user_id !== userId) {
        throw new StripeBillingError("Stripe顧客を安全に紐付けられませんでした。");
      }
      customerId = customer.id;
      const linked = await stripeRpc<unknown>("set_pro_checkout_customer", { p_user_id: userId, p_customer_id: customerId });
      if (linked !== true) throw new StripeBillingError("Stripe顧客を契約情報へ保存できませんでした。");
    } else {
      const existingCustomer = await stripeRequest<unknown>(`/customers/${encodeURIComponent(customerId)}`, "GET");
      if (!isObject(existingCustomer) || existingCustomer.deleted === true || !isObject(existingCustomer.metadata)
          || existingCustomer.metadata.supabase_user_id !== userId) {
        throw new StripeBillingError("保存済みStripe顧客とログインユーザーの紐付けを確認できませんでした。");
      }
    }

    const subscriptions = await stripeRequest<unknown>(
      "/subscriptions",
      "GET",
      new URLSearchParams({ customer: customerId, status: "all", limit: "100" }),
    );
    if (!isObject(subscriptions) || !Array.isArray(subscriptions.data) || subscriptions.has_more === true) {
      throw new StripeBillingError("Stripeの既存契約状態を確認できませんでした。");
    }
    const blockingStatuses = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);
    if (subscriptions.data.some((item) => isObject(item) && typeof item.status === "string" && blockingStatuses.has(item.status))) {
      throw new StripeBillingError("Stripeに未終了のPro契約があります。重複契約を防ぐためCheckoutを停止しました。", 409);
    }

    const success = new URL(config.successUrl);
    success.searchParams.set("checkout", "success");
    const cancel = new URL(config.cancelUrl);
    cancel.searchParams.set("checkout", "cancel");
    const sessionForm = new URLSearchParams();
    formValue(sessionForm, "mode", "subscription");
    formValue(sessionForm, "customer", customerId);
    formValue(sessionForm, "client_reference_id", userId);
    formValue(sessionForm, "line_items[0][price]", config.priceId);
    formValue(sessionForm, "line_items[0][quantity]", 1);
    formValue(sessionForm, "success_url", success.toString());
    formValue(sessionForm, "cancel_url", cancel.toString());
    formValue(sessionForm, "expires_at", Math.floor((Date.now() + 31 * 60_000) / 1000));
    formValue(sessionForm, "metadata[supabase_user_id]", userId);
    formValue(sessionForm, "subscription_data[metadata][supabase_user_id]", userId);
    const session = await stripeRequest<unknown>("/checkout/sessions", "POST", sessionForm);
    if (!isObject(session) || typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
      throw new StripeBillingError("Stripe Checkout URLを取得できませんでした。");
    }
    return session.url;
  } catch (error) {
    await stripeRpc("release_pro_checkout", { p_user_id: userId }).catch(() => undefined);
    throw error;
  }
}

export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader || !secret.startsWith("whsec_")) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  return isObject(value) && typeof value.id === "string" ? value.id : null;
}

function unixIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

function maskedStripeId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 5)}…${value.slice(-3)}`;
}

function billingDiagnostic(message: string, fields: Record<string, unknown>): void {
  console.info(message, fields);
}

function subscriptionPriceId(subscription: JsonObject): string | null {
  const items = subscription.items;
  if (!isObject(items) || !Array.isArray(items.data) || items.data.length !== 1 || !isObject(items.data[0])) return null;
  return stripeId(items.data[0].price);
}

function subscriptionPeriodEnd(subscription: JsonObject): string | null {
  const items = subscription.items;
  if (!isObject(items) || !Array.isArray(items.data) || items.data.length !== 1 || !isObject(items.data[0])) return null;
  return unixIso(items.data[0].current_period_end);
}

function isExpectedSubscription(subscription: unknown, customerId: string, userId: string, priceId: string): subscription is JsonObject {
  return isObject(subscription)
    && stripeId(subscription.customer) === customerId
    && isObject(subscription.metadata)
    && subscription.metadata.supabase_user_id === userId
    && subscriptionPriceId(subscription) === priceId;
}

type StripeWebhookEvent = { id: string; type: string; created: number; data: { object: unknown } };

function webhookEvent(value: unknown): value is StripeWebhookEvent {
  return isObject(value) && typeof value.id === "string" && typeof value.type === "string"
    && typeof value.created === "number" && isObject(value.data) && "object" in value.data;
}

async function retrieveSubscription(subscriptionId: string): Promise<unknown> {
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, "GET");
}

async function retrieveInvoice(invoiceId: string): Promise<unknown> {
  return stripeRequest(`/invoices/${encodeURIComponent(invoiceId)}`, "GET");
}

async function cancelStripeSubscription(subscriptionId: string, eventId: string): Promise<void> {
  const { secretKey } = stripeConfiguration();
  let cancelError: unknown;
  try {
    const response = await fetch(`${stripeApiBase()}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_API_VERSION },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    const payload: unknown = await response.json().catch(() => null);
    if (isObject(payload) && payload.status === "canceled") return;
    cancelError = { status: response.status };
  } catch {
    cancelError = "transport";
  }

  // Webhook再送や通信切断でDELETE結果が不明な場合、Stripeの現在状態を読み直して冪等に扱う。
  try {
    const current = await retrieveSubscription(subscriptionId);
    if (isObject(current) && (current.status === "canceled" || current.status === "incomplete_expired")) return;
  } catch {
    // 下の共通エラーにまとめ、StripeにWebhook再送を依頼する。
  }
  console.error("Stripe cancellation after invoice failure failed", { eventId, errorKind: cancelError === "transport" ? "transport" : "api" });
  throw new StripeBillingError("失敗したStripe契約を停止できませんでした。");
}

export async function processStripeWebhook(event: StripeWebhookEvent): Promise<void> {
  if (![
    "invoice.paid", "invoice.payment_failed",
    "customer.subscription.updated", "customer.subscription.deleted",
  ].includes(event.type)) {
    billingDiagnostic("Stripe billing event skipped", { eventType: event.type, reason: "unsupported_event_type" });
    return;
  }

  const config = stripeConfiguration();
  const object = event.data.object;
  if (!isObject(object)) throw new StripeBillingError("Stripeイベントの形式が正しくありません。");

  let customerId: string | null;
  let subscriptionId: string | null;
  let userId: string | null;
  let priceId: string | null;
  let status: string | null;
  let paidAt: string | null;
  let periodEnd: string | null;
  let autoRenew: boolean | null;
  let cancelAtPeriodEnd: boolean | null;
  let invoiceId: string | null = null;
  let priceIdMatches: boolean | null;

  if (event.type.startsWith("invoice.")) {
    invoiceId = typeof object.id === "string" ? object.id : null;
    subscriptionId = stripeId(object.subscription)
      ?? (isObject(object.parent) && isObject(object.parent.subscription_details)
        ? stripeId(object.parent.subscription_details.subscription)
        : null);
    customerId = stripeId(object.customer);
    const invoiceFields = {
      eventType: event.type,
      invoiceId: maskedStripeId(invoiceId),
      customerId: maskedStripeId(customerId),
      subscriptionId: maskedStripeId(subscriptionId),
      paidOutOfBand: typeof object.paid_out_of_band === "boolean" ? object.paid_out_of_band : "missing",
      invoicePaid: object.status === "paid",
      invoiceStatus: typeof object.status === "string" ? object.status : null,
      currency: typeof object.currency === "string" ? object.currency : null,
      amountPaid: typeof object.amount_paid === "number" ? object.amount_paid : null,
    };
    billingDiagnostic("Stripe invoice event received", invoiceFields);
    if (!invoiceId || !subscriptionId || !customerId) {
      billingDiagnostic("Stripe billing event skipped", { ...invoiceFields, reason: "invoice_identity_fields_missing", userIdResolved: false });
      throw new StripeBillingError("Stripe請求書に契約情報がありません。");
    }
    if (event.type === "invoice.payment_failed") {
      const currentInvoice = await retrieveInvoice(invoiceId);
      if (!isObject(currentInvoice) || stripeId(currentInvoice.customer) !== customerId) {
        throw new StripeBillingError("Stripe請求状態を確認できませんでした。");
      }
      // 自動再試行との競合などで、古い失敗通知より先に同じ請求が成功していれば解約しない。
      if (currentInvoice.status === "paid") {
        billingDiagnostic("Stripe billing event skipped", { eventType: event.type, invoiceId: maskedStripeId(invoiceId), reason: "invoice_already_paid" });
        return;
      }
    }
    // invoice.paid also fires for manually marked invoices. Only Stripe-collected
    // payments may activate Pro in this application.
    if (stripeEventCanActivatePro(event.type) && object.paid_out_of_band === true) {
      billingDiagnostic("Stripe billing event skipped", {
        ...invoiceFields,
        userIdResolved: false,
        priceIdMatches: null,
        reason: "invoice_paid_out_of_band",
      });
      return;
    }
    const subscription = await retrieveSubscription(subscriptionId);
    if (!isObject(subscription) || !isObject(subscription.metadata) || typeof subscription.metadata.supabase_user_id !== "string") {
      billingDiagnostic("Stripe invoice user mapping failed", {
        ...invoiceFields,
        userIdResolved: false,
        priceIdMatches: null,
        reason: "subscription_user_metadata_missing",
      });
      throw new StripeBillingError("Stripe契約のユーザー紐付けを確認できませんでした。");
    }
    userId = subscription.metadata.supabase_user_id;
    priceIdMatches = subscriptionPriceId(subscription) === config.priceId;
    const customerMatches = stripeId(subscription.customer) === customerId;
    billingDiagnostic("Stripe invoice identity resolved", {
      ...invoiceFields,
      userIdResolved: true,
      customerMatches,
      priceIdMatches,
    });
    if (!isExpectedSubscription(subscription, customerId, userId, config.priceId)) {
      billingDiagnostic("Stripe billing event skipped", {
        ...invoiceFields,
        userIdResolved: true,
        priceIdMatches,
        reason: !priceIdMatches ? "pro_price_id_mismatch" : "subscription_customer_or_user_mapping_mismatch",
      });
      throw new StripeBillingError("Stripe契約内容がPro価格と一致しません。");
    }
    priceId = config.priceId;
    status = typeof subscription.status === "string" ? subscription.status : null;
    periodEnd = subscriptionPeriodEnd(subscription);
    cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
    autoRenew = !cancelAtPeriodEnd && subscription.status === "active";
    paidAt = null;
    if (stripeEventCanActivatePro(event.type)) {
      const paymentValid = object.currency === "jpy" && object.amount_paid === 580 && object.status === "paid"
        && (object.billing_reason === "subscription_create" || object.billing_reason === "subscription_cycle");
      billingDiagnostic("Stripe invoice payment validation", {
        ...invoiceFields,
        userIdResolved: true,
        priceIdMatches,
        amountValid: object.amount_paid === 580,
        currencyValid: object.currency === "jpy",
        billingReason: typeof object.billing_reason === "string" ? object.billing_reason : null,
        paymentValid,
      });
      if (!paymentValid) {
        billingDiagnostic("Stripe billing event skipped", { ...invoiceFields, userIdResolved: true, priceIdMatches, reason: "invoice_payment_validation_failed" });
        throw new StripeBillingError("決済金額がPro料金と一致しないため、Proを有効化できません。");
      }
      const transitions = object.status_transitions;
      paidAt = isObject(transitions) ? unixIso(transitions.paid_at) : null;
      if (!paidAt || status !== "active") {
        billingDiagnostic("Stripe billing event skipped", { ...invoiceFields, userIdResolved: true, priceIdMatches, subscriptionStatus: status, reason: "paid_timestamp_missing_or_subscription_inactive" });
        throw new StripeBillingError("決済完了状態を確認できませんでした。");
      }
    } else {
      if (status !== "canceled" && status !== "incomplete_expired") await cancelStripeSubscription(subscriptionId, event.id);
    }
  } else {
    subscriptionId = typeof object.id === "string" ? object.id : null;
    customerId = stripeId(object.customer);
    if (!subscriptionId || !customerId || !isObject(object.metadata) || typeof object.metadata.supabase_user_id !== "string") {
      throw new StripeBillingError("Stripe契約イベントのユーザー紐付けがありません。");
    }
    // Webhookのdata.objectはイベント発生時点のスナップショットなので、
    // Portal操作後に古いupdatedイベントが遅れて届いても現状態で同期する。
    const subscriptionState = event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted"
      ? await retrieveSubscription(subscriptionId)
      : object;
    if (!isObject(subscriptionState)) throw new StripeBillingError("Stripe契約状態を確認できませんでした。");
    userId = object.metadata.supabase_user_id;
    priceIdMatches = subscriptionPriceId(subscriptionState) === config.priceId;
    if (!isExpectedSubscription(subscriptionState, customerId, userId, config.priceId)
        || subscriptionState.id !== subscriptionId) {
      billingDiagnostic("Stripe billing event skipped", {
        eventType: event.type,
        customerId: maskedStripeId(customerId),
        subscriptionId: maskedStripeId(subscriptionId),
        userIdResolved: true,
        priceIdMatches,
        reason: !priceIdMatches ? "pro_price_id_mismatch" : "subscription_customer_or_user_mapping_mismatch",
      });
      throw new StripeBillingError("Stripe契約内容がPro価格と一致しません。");
    }
    priceId = config.priceId;
    status = typeof subscriptionState.status === "string" ? subscriptionState.status : null;
    periodEnd = subscriptionPeriodEnd(subscriptionState);
    cancelAtPeriodEnd = subscriptionState.cancel_at_period_end === true;
    autoRenew = !cancelAtPeriodEnd && status === "active";
    paidAt = null;
  }

  const rpcContext = {
    eventType: event.type,
    invoiceId: maskedStripeId(invoiceId),
    customerId: maskedStripeId(customerId),
    subscriptionId: maskedStripeId(subscriptionId),
    userIdResolved: Boolean(userId),
    priceIdMatches,
  };
  billingDiagnostic("Stripe Pro update RPC called", rpcContext);
  let rpcResult: unknown;
  try {
    rpcResult = await stripeRpc<unknown>("apply_stripe_billing_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_user_id: userId,
      p_price_id: priceId,
      p_subscription_status: status,
      p_paid_at: paidAt,
      p_period_end: periodEnd,
      p_auto_renew: autoRenew,
      p_cancel_at_period_end: cancelAtPeriodEnd,
      p_event_created_at: unixIso(event.created),
    });
  } catch (error) {
    billingDiagnostic("Stripe Pro update RPC failed", { ...rpcContext, errorName: error instanceof Error ? error.name : "unknown" });
    throw error;
  }
  const rpcOutcome = typeof rpcResult === "string" && (rpcResult === "duplicate" || rpcResult === "stale" || rpcResult === "applied" || /^applied:\d+$/.test(rpcResult))
    ? rpcResult
    : "unexpected_response";
  const rowsMatch = typeof rpcResult === "string" ? /^applied:(\d+)$/.exec(rpcResult) : null;
  billingDiagnostic("Stripe Pro update RPC succeeded", {
    ...rpcContext,
    rpcOutcome,
    databaseUpdatedRows: rowsMatch ? Number(rowsMatch[1]) : null,
  });
}

export async function handleStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<void> {
  const { webhookSecret } = stripeConfiguration();
  const verified = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  console.info("Stripe webhook signature verification", { result: verified ? "success" : "failure" });
  if (!verified) {
    throw new StripeBillingError("Stripe Webhookの署名を検証できませんでした。", 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new StripeBillingError("Stripe WebhookのJSON形式が正しくありません。", 400);
  }
  if (!webhookEvent(payload)) throw new StripeBillingError("Stripe Webhookイベントの形式が正しくありません。", 400);
  await processStripeWebhook(payload);
}
