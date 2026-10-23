import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createProCheckout, handleStripeWebhook, stripeEventCanActivatePro, validateProPrice, verifyStripeSignature } from "../src/stripeBilling.js";

const monthlyPrice = {
  active: true,
  livemode: false,
  type: "recurring",
  currency: "jpy",
  unit_amount: 580,
  tax_behavior: "inclusive",
  recurring: { interval: "month", interval_count: 1, trial_period_days: null },
};

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

test("only a paid subscription invoice event can activate Pro", () => {
  assert.equal(stripeEventCanActivatePro("invoice.payment_succeeded"), true);
  assert.equal(stripeEventCanActivatePro("invoice.paid"), false);
  assert.equal(stripeEventCanActivatePro("checkout.session.completed"), false);
  assert.equal(stripeEventCanActivatePro("invoice.payment_failed"), false);
  assert.equal(stripeEventCanActivatePro("customer.subscription.updated"), false);
});

test("Stripe webhook signature checks the raw payload, secret and timestamp tolerance", () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_test", type: "invoice.paid" }));
  const secret = "whsec_test_secret";
  const now = Math.floor(Date.now() / 1000);
  const signedPayload = `${now}.${body.toString("utf8")}`;
  const signature = createHmac("sha256", "test_secret").update(signedPayload).digest("hex");
  const header = `t=${now},v1=${signature}`;

  assert.equal(verifyStripeSignature(body, header, secret, now), true);
  assert.equal(verifyStripeSignature(Buffer.from(`${body.toString("utf8")} `), header, secret, now), false);
  assert.equal(verifyStripeSignature(body, header, "whsec_wrong_secret", now), false);
  assert.equal(verifyStripeSignature(body, header, secret, now + 301), false);
  assert.equal(verifyStripeSignature(body, "v1=not-a-signature", secret, now), false);
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
    type: "invoice.payment_succeeded",
    created: now,
    data: { object: {
      id: "in_test_1",
      customer: "cus_test_1",
      subscription: "sub_pro_1",
      status: "paid",
      amount_paid: 580,
      currency: "jpy",
      billing_reason: "subscription_create",
      status_transitions: { paid_at: now - 10 },
    } },
  };
  const body = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", "unit_secret").update(`${now}.${body.toString("utf8")}`).digest("hex");
  await handleStripeWebhook(body, `t=${now},v1=${signature}`);

  assert.deepEqual(rpcBody, {
    p_event_id: "evt_invoice_paid_1",
    p_event_type: "invoice.payment_succeeded",
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
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
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
  assert.equal(checkout.get("payment_method_types[0]"), "card");
  assert.equal(checkout.get("client_reference_id"), "auth-user-1");
  assert.equal(checkout.get("subscription_data[metadata][supabase_user_id]"), "auth-user-1");
  assert.equal(checkout.has("amount"), false);
  assert.equal(checkout.has("plan"), false);
  assert.equal(customer.get("email"), "private@example.com");
  assert.deepEqual(calledRPCs, ["reserve_pro_checkout", "set_pro_checkout_customer"]);
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
  const signature = createHmac("sha256", "unit_secret").update(`${now}.${body.toString("utf8")}`).digest("hex");
  await handleStripeWebhook(body, `t=${now},v1=${signature}`);

  assert.deepEqual(order, ["cancel", "free-transition"]);
  assert.equal(rpcBody?.p_event_type, "invoice.payment_failed");
  assert.equal(rpcBody?.p_subscription_id, "sub_failed");
});
