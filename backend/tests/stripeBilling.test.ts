import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createProCheckout, handleStripeWebhook, stripeEventCanActivatePro, validateCheckoutReturnUrls, validateProPrice, verifyStripeSignature } from "../src/stripeBilling.js";

const monthlyPrice = {
  active: true,
  livemode: false,
  type: "recurring",
  currency: "jpy",
  unit_amount: 580,
  tax_behavior: "inclusive",
  recurring: { interval: "month", interval_count: 1, trial_period_days: null },
};

test("Checkout accepts the configured Vercel production origin, path and query parameters", () => {
  assert.doesNotThrow(() => validateCheckoutReturnUrls(
    "https://fx-journal-phi.vercel.app",
    "https://fx-journal-phi.vercel.app/plan?checkout=success",
    "https://fx-journal-phi.vercel.app/plan?checkout=cancel",
    true,
  ));
  assert.doesNotThrow(() => validateCheckoutReturnUrls(
    "https://fx-journal-phi.vercel.app/",
    "https://fx-journal-phi.vercel.app/plan/?checkout=success",
    "https://fx-journal-phi.vercel.app/plan/?checkout=cancel",
    true,
  ));
});

test("Checkout return URL validation reports malformed, mismatched and insecure production URLs", () => {
  assert.throws(
    () => validateCheckoutReturnUrls("https://fx-journal-phi.vercel.app", "not a URL", "https://fx-journal-phi.vercel.app/plan", true),
    /STRIPE_SUCCESS_URL/,
  );
  assert.throws(
    () => validateCheckoutReturnUrls("https://fx-journal-phi.vercel.app", "https://other.vercel.app/plan?checkout=success", "https://fx-journal-phi.vercel.app/plan?checkout=cancel", true),
    /origin.*FRONTEND_ORIGIN/,
  );
  assert.throws(
    () => validateCheckoutReturnUrls("http://localhost:5173", "http://localhost:5173/plan", "http://localhost:5173/plan", true),
    /HTTPS/,
  );
});

test("Pro price accepts only active tax-inclusive JPY 580 monthly Price", () => {
  assert.equal(validateProPrice(monthlyPrice), true);
  assert.equal(validateProPrice({ ...monthlyPrice, unit_amount: 5800 }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, tax_behavior: "exclusive" }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, currency: "usd" }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, recurring: { interval: "year", interval_count: 1 } }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, livemode: true }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, recurring: { interval: "month", interval_count: 1, trial_period_days: 7 } }), false);
  assert.equal(validateProPrice({ ...monthlyPrice, active: false }), false);
});

test("only invoice.paid can activate Pro", () => {
  assert.equal(stripeEventCanActivatePro("invoice.paid"), true);
  assert.equal(stripeEventCanActivatePro("invoice.payment_succeeded"), false);
  assert.equal(stripeEventCanActivatePro("checkout.session.completed"), false);
  assert.equal(stripeEventCanActivatePro("invoice.payment_failed"), false);
  assert.equal(stripeEventCanActivatePro("customer.subscription.updated"), false);
});

test("Stripe webhook signature uses the complete whsec secret and checks raw payload and timestamp", () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_test", type: "invoice.paid" }));
  const secret = "whsec_test_secret";
  const now = Math.floor(Date.now() / 1000);
  const signedPayload = `${now}.${body.toString("utf8")}`;
  const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const header = `t=${now},v1=${signature}`;

  assert.equal(verifyStripeSignature(body, header, secret, now), true);
  assert.equal(verifyStripeSignature(Buffer.from(`${body.toString("utf8")} `), header, secret, now), false);
  assert.equal(verifyStripeSignature(body, header, "whsec_wrong_secret", now), false);
  assert.equal(verifyStripeSignature(body, header, secret, now + 301), false);
  assert.equal(verifyStripeSignature(body, "v1=not-a-signature", secret, now), false);
});

test("Stripe webhook logs verification failure without exposing secret or signature", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalConsoleInfo = console.info;
  const logCalls: unknown[][] = [];
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    console.info = originalConsoleInfo;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_private_test_secret";
  process.env.STRIPE_SUCCESS_URL = "https://fx-journal-phi.vercel.app/plan";
  process.env.STRIPE_CANCEL_URL = "https://fx-journal-phi.vercel.app/plan";
  process.env.FRONTEND_ORIGIN = "https://fx-journal-phi.vercel.app";
  console.info = (...args: unknown[]) => { logCalls.push(args); };

  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    handleStripeWebhook(Buffer.from("{}"), `t=${now},v1=${"0".repeat(64)}`),
    /署名を検証できませんでした/,
  );
  assert.deepEqual(logCalls, [["Stripe webhook signature verification", { result: "failure" }]]);
  assert.equal(JSON.stringify(logCalls).includes("private_test_secret"), false);
  assert.equal(JSON.stringify(logCalls).includes("0".repeat(64)), false);
});

test("paid invoice webhook sends verified payment time and account mapping to the atomic DB RPC", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = originalFetch;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_secret";
  process.env.STRIPE_SUCCESS_URL = "http://localhost:5173/";
  process.env.STRIPE_CANCEL_URL = "http://localhost:5173/";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret";

  const now = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_pro_1",
    customer: "cus_test_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { supabase_user_id: "user-uuid-1" },
    items: { data: [{ price: { id: "price_pro_test" }, current_period_end: now + 86_400 }] },
  };
  let rpcBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.stripe.com/v1/subscriptions/sub_pro_1")) return Response.json(subscription);
    if (url.endsWith("/rpc/apply_stripe_billing_event")) {
      rpcBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json("applied");
    }
    throw new Error(`Unexpected request ${url}`);
  };

  const event = {
    id: "evt_invoice_paid_1",
    type: "invoice.paid",
    created: now,
    data: { object: {
      id: "in_test_1",
      customer: "cus_test_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_pro_1" } },
      status: "paid",
      amount_paid: 580,
      currency: "jpy",
      paid_out_of_band: false,
      billing_reason: "subscription_create",
      status_transitions: { paid_at: now - 10 },
    } },
  };
  const body = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", "whsec_unit_secret").update(`${now}.${body.toString("utf8")}`).digest("hex");
  await handleStripeWebhook(body, `t=${now},v1=${signature}`);

  assert.deepEqual(rpcBody, {
    p_event_id: "evt_invoice_paid_1",
    p_event_type: "invoice.paid",
    p_customer_id: "cus_test_1",
    p_subscription_id: "sub_pro_1",
    p_user_id: "user-uuid-1",
    p_price_id: "price_pro_test",
    p_subscription_status: "active",
    p_paid_at: new Date((now - 10) * 1000).toISOString(),
    p_period_end: new Date((now + 86_400) * 1000).toISOString(),
    p_auto_renew: true,
    p_cancel_at_period_end: false,
    p_event_created_at: new Date(now * 1000).toISOString(),
  });
});

test("Checkout uses only the backend Price and does not create a client-selected plan or amount", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = originalFetch;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_server_configured";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_secret";
  process.env.STRIPE_SUCCESS_URL = "http://localhost:5173/";
  process.env.STRIPE_CANCEL_URL = "http://localhost:5173/";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret";

  const observed = new Map<string, URLSearchParams>();
  const calledRPCs: string[] = [];
  const stripeVersions: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.stripe.com") {
      const headers = new Headers(init?.headers);
      stripeVersions.push(headers.get("Stripe-Version") ?? "");
    }
    if (url.pathname === "/v1/prices/price_server_configured") return Response.json(monthlyPrice);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1) ?? "";
      calledRPCs.push(name);
      if (name === "reserve_pro_checkout") return Response.json([{ allowed: true, stripe_customer_id: null }]);
      if (name === "set_pro_checkout_customer") return Response.json(true);
      if (name === "release_pro_checkout") return Response.json(true);
      throw new Error(`Unexpected RPC ${name}`);
    }
    if (url.pathname === "/v1/customers" && init?.method === "POST") {
      observed.set("customer", new URLSearchParams(String(init.body)));
      return Response.json({ id: "cus_created", metadata: { supabase_user_id: "auth-user-1" } });
    }
    if (url.pathname === "/v1/subscriptions") return Response.json({ data: [], has_more: false });
    if (url.pathname === "/v1/checkout/sessions") {
      observed.set("checkout", new URLSearchParams(String(init?.body)));
      return Response.json({ url: "https://checkout.stripe.com/c/pay/session_test" });
    }
    throw new Error(`Unexpected Stripe request ${url.pathname}`);
  };

  const checkoutUrl = await createProCheckout("auth-user-1", "private@example.com");
  assert.equal(checkoutUrl, "https://checkout.stripe.com/c/pay/session_test");
  const checkout = observed.get("checkout");
  const customer = observed.get("customer");
  assert.ok(checkout);
  assert.ok(customer);
  assert.equal(checkout.get("mode"), "subscription");
  assert.equal(checkout.get("line_items[0][price]"), "price_server_configured");
  assert.equal(checkout.get("line_items[0][quantity]"), "1");
  assert.equal(checkout.has("payment_method_types[0]"), false);
  assert.equal(checkout.get("customer"), "cus_created");
  assert.equal(checkout.has("customer_email"), false);
  assert.equal(checkout.get("success_url"), "http://localhost:5173/?checkout=success");
  assert.equal(checkout.get("cancel_url"), "http://localhost:5173/?checkout=cancel");
  assert.equal(checkout.get("client_reference_id"), "auth-user-1");
  assert.equal(checkout.get("metadata[supabase_user_id]"), "auth-user-1");
  assert.equal(checkout.get("subscription_data[metadata][supabase_user_id]"), "auth-user-1");
  assert.ok(Number(checkout.get("expires_at")) > Math.floor(Date.now() / 1000));
  assert.equal(checkout.has("amount"), false);
  assert.equal(checkout.has("plan"), false);
  assert.equal(customer.get("email"), "private@example.com");
  assert.deepEqual(calledRPCs, ["reserve_pro_checkout", "set_pro_checkout_customer"]);
  assert.ok(stripeVersions.length > 0 && stripeVersions.every((version) => version === "2026-09-30.endive"));
});

test("Checkout API errors log only sanitized Stripe diagnostic fields and request ID", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const logCalls: unknown[][] = [];
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_server_configured";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_secret";
  process.env.STRIPE_SUCCESS_URL = "https://fx-journal-phi.vercel.app/plan?checkout=success";
  process.env.STRIPE_CANCEL_URL = "https://fx-journal-phi.vercel.app/plan?checkout=cancel";
  process.env.FRONTEND_ORIGIN = "https://fx-journal-phi.vercel.app";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  console.error = (...args: unknown[]) => { logCalls.push(args); };

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/prices/price_server_configured") return Response.json(monthlyPrice);
    if (url.pathname === "/rest/v1/rpc/reserve_pro_checkout") {
      return Response.json([{ allowed: true, stripe_customer_id: "cus_existing" }]);
    }
    if (url.pathname === "/v1/customers/cus_existing") {
      return Response.json({ id: "cus_existing", metadata: { supabase_user_id: "auth-user-1" } });
    }
    if (url.pathname === "/v1/subscriptions") return Response.json({ data: [], has_more: false });
    if (url.pathname === "/v1/checkout/sessions" && init?.method === "POST") {
      return Response.json({ error: {
        type: "invalid_request_error",
        code: "url_invalid",
        param: "success_url",
        message: "Invalid URL for customer@example.com cus_123 and card 4242 4242 4242 4242",
      } }, { status: 400, headers: { "request-id": "req_checkout_test_123" } });
    }
    if (url.pathname === "/rest/v1/rpc/release_pro_checkout") return Response.json(true);
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  await assert.rejects(createProCheckout("auth-user-1"), /Stripe決済を開始できませんでした/);
  const details = logCalls.find(([message]) => message === "Stripe API request failed")?.[1];
  assert.deepEqual(details, {
    method: "POST",
    path: "/checkout/sessions",
    status: 400,
    requestId: "req_checkout_test_123",
    type: "invalid_request_error",
    code: "url_invalid",
    param: "success_url",
    message: "Invalid URL for [redacted-email] [redacted-id] and card [redacted-number]",
  });
  assert.equal(JSON.stringify(logCalls).includes("customer@example.com"), false);
  assert.equal(JSON.stringify(logCalls).includes("4242 4242 4242 4242"), false);
  assert.equal(JSON.stringify(logCalls).includes("service-role-secret"), false);
  assert.equal(JSON.stringify(logCalls).includes("sk_test_unit"), false);
});

test("invoice.paid marked out of band does not grant Pro", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = originalFetch;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_secret";
  process.env.STRIPE_SUCCESS_URL = "http://localhost:5173/";
  process.env.STRIPE_CANCEL_URL = "http://localhost:5173/";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  globalThis.fetch = async () => { throw new Error("out-of-band invoice must not call Stripe or Supabase"); };

  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: "evt_invoice_oob", type: "invoice.paid", created: now,
    data: { object: { id: "in_oob", customer: "cus_test_1", subscription: "sub_test_1", paid_out_of_band: true } },
  };
  const body = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", "whsec_unit_secret").update(`${now}.${body.toString("utf8")}`).digest("hex");
  await handleStripeWebhook(body, `t=${now},v1=${signature}`);
});

test("failed renewal cancels Stripe immediately before recording the Free transition", async (t) => {
  const names = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "FRONTEND_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = originalFetch;
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_secret";
  process.env.STRIPE_SUCCESS_URL = "http://localhost:5173/";
  process.env.STRIPE_CANCEL_URL = "http://localhost:5173/";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret";

  const order: string[] = [];
  let rpcBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/invoices/in_failed") return Response.json({ id: "in_failed", customer: "cus_test_1", status: "open" });
    if (url.pathname === "/v1/subscriptions/sub_failed" && init?.method === "GET") {
      return Response.json({
        id: "sub_failed", customer: "cus_test_1", status: "past_due", cancel_at_period_end: false,
        metadata: { supabase_user_id: "user-uuid-1" },
        items: { data: [{ price: { id: "price_pro_test" }, current_period_end: 1_800_086_400 }] },
      });
    }
    if (url.pathname === "/v1/subscriptions/sub_failed" && init?.method === "DELETE") {
      order.push("cancel");
      return Response.json({ id: "sub_failed", status: "canceled" });
    }
    if (url.pathname.endsWith("/rpc/apply_stripe_billing_event")) {
      order.push("free-transition");
      rpcBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json("applied");
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: "evt_failed_1", type: "invoice.payment_failed", created: now,
    data: { object: { id: "in_failed", customer: "cus_test_1", subscription: "sub_failed" } },
  };
  const body = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", "whsec_unit_secret").update(`${now}.${body.toString("utf8")}`).digest("hex");
  await handleStripeWebhook(body, `t=${now},v1=${signature}`);

  assert.deepEqual(order, ["cancel", "free-transition"]);
  assert.equal(rpcBody?.p_event_type, "invoice.payment_failed");
  assert.equal(rpcBody?.p_subscription_id, "sub_failed");
});
