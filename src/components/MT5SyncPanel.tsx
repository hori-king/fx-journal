import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

type SyncSummary = { fetched: number; imported: number; existing: number; skipped: number; errors: number };
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("ログイン状態を確認できません。再度ログインしてください。");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || "MT5連携に失敗しました。");
  return payload;
}

export default function MT5SyncPanel() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  async function issueToken() {
    setBusy(true); setMessage(""); setToken("");
    try {
      const result = await request<{ token: string }>("/api/mt5/link", { method: "POST" });
      setToken(result.token);
      setMessage("連携キーを発行しました。MT5 EAへ設定してください。この画面を閉じると再表示できません。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "連携キーを発行できませんでした。"); }
    finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true); setSummary(null); setMessage("同期要求を送信しています…");
    try {
      const { requestId } = await request<{ requestId: string }>("/api/mt5/sync-requests", { method: "POST" });
      setMessage("MT5のEAからの応答を待っています。MT5を起動し、EAを稼働させてください。");
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const state = await request<{ status: string; summary: SyncSummary | null; error: string | null }>(`/api/mt5/sync-requests/${encodeURIComponent(requestId)}`);
        if (state.status === "completed") {
          setSummary(state.summary);
          setMessage("同期が完了しました。");
          window.dispatchEvent(new Event("fx-journal-trades-updated"));
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "MT5の取引取り込みに失敗しました。");
      }
      setMessage("まだ応答がありません。MT5 EAが動作中か確認してください。同期要求は有効なままです。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "同期に失敗しました。"); }
    finally { setBusy(false); }
  }

  return <section className="mt5-sync-panel" aria-label="MT5連携">
    <div><p className="trade-search-subtitle">MT5 INTEGRATION</p><h3>MT5取引履歴</h3><p>MT5でEAを起動してから同期してください。取り込んだ取引の手法は未設定になります。</p></div>
    <div className="mt5-sync-actions">
      <button type="button" onClick={issueToken} disabled={busy}>連携キーを発行・再発行</button>
      <button type="button" onClick={sync} disabled={busy}>{busy ? "同期中…" : "MT5から同期"}</button>
    </div>
    {token && <div className="mt5-token"><strong>MT5 EAへ設定する連携キー（この画面を閉じると表示されません）</strong><code>{token}</code><button type="button" onClick={() => void navigator.clipboard.writeText(token)}>コピー</button></div>}
    {message && <p className="mt5-sync-message" role="status">{message}</p>}
    {summary && <dl className="mt5-sync-summary">{([["取得", summary.fetched], ["新規追加", summary.imported], ["登録済み", summary.existing], ["スキップ", summary.skipped], ["エラー", summary.errors]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}件</dd></div>)}</dl>}
  </section>;
}
