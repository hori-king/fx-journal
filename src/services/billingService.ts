import { supabase } from "../lib/supabaseClient";

const apiBaseUrl = import.meta.env.VITE_AI_API_URL?.replace(/\/+$/, "")
  || (import.meta.env.DEV ? "http://localhost:3001" : "");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createProCustomerPortalSession(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("ログイン状態を確認してください。");
  if (!apiBaseUrl) throw new Error("契約管理サービスのURLが設定されていません。");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/billing/portal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    throw new Error("Stripe契約管理画面へ接続できません。時間をおいて再度お試しください。");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isObject(body) && typeof body.error === "string" ? body.error : null;
    throw new Error(message ?? "Stripe契約管理画面を開始できませんでした。");
  }
  if (!isObject(body) || typeof body.url !== "string") throw new Error("契約管理画面URLを取得できませんでした。");
  const portalUrl = new URL(body.url);
  if (portalUrl.protocol !== "https:" || portalUrl.hostname !== "billing.stripe.com") {
    throw new Error("安全でない契約管理画面URLを受け取りました。");
  }
  return portalUrl.toString();
}
