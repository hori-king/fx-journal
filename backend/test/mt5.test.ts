import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDeal, saveMT5Deals } from "../src/mt5.js";

const sample = (ticket: string, direction: "BUY" | "SELL" = "BUY") => ({
  ticket, positionId: `position-${ticket}`, symbol: "EURUSD", direction,
  volume: 0.1, entryPrice: 1.1, exitPrice: 1.101, entryTime: "2026-10-05T01:00:00Z",
  exitTime: "2026-10-05T02:00:00Z", profit: 10, commission: -0.5, swap: -0.1, fee: 0,
  accountCurrency: "USD",
});

test("MT5の損益・方向・銘柄・ロット・日時・pipsを既存形式に変換する", () => {
  const buy = normalizeDeal(sample("501"), "user-1", "Broker:1");
  const sell = normalizeDeal(sample("502", "SELL"), "user-1", "Broker:1");
  assert.equal(buy.direction, "BUY");
  assert.equal(sell.direction, "SELL");
  assert.equal(buy.symbol, "EURUSD");
  assert.equal(buy.lot, 0.1);
  assert.equal(buy.entry_time, "2026-10-05T01:00:00Z");
  assert.equal(buy.exit, 1.101);
  assert.equal(buy.profit, 9.4);
  assert.ok(Math.abs(buy.pips - 10) < 1e-8);
  assert.equal(buy.reason, "");
  assert.equal(buy.result, "WIN");
  assert.equal(buy.source, "mt5");
});

test("同じMT5取引を複数回同期しても新規件数は増えず、重複件数へ入る", async () => {
  const database = new Set<string>();
  const upsert = async (rows: ReturnType<typeof normalizeDeal>[]) => {
    let inserted = 0;
    for (const row of rows) {
      const key = `${row.user_id}:${row.mt5_account}:${row.mt5_deal_ticket}`;
      if (!database.has(key)) { database.add(key); inserted += 1; }
    }
    return inserted;
  };
  const first = await saveMT5Deals([sample("1"), sample("2", "SELL")], "user-1", "Broker:1", upsert);
  const second = await saveMT5Deals([sample("1"), sample("2", "SELL")], "user-1", "Broker:1", upsert);
  assert.deepEqual(first, { fetched: 2, imported: 2, existing: 0, skipped: 0, errors: 0 });
  assert.deepEqual(second, { fetched: 2, imported: 0, existing: 2, skipped: 0, errors: 0 });
});

test("不正な取引は保存せずスキップする", async () => {
  const result = await saveMT5Deals([{ ...sample("bad"), volume: -1 }], "user-1", "Broker:1", async () => 0);
  assert.deepEqual(result, { fetched: 1, imported: 0, existing: 0, skipped: 1, errors: 0 });
});
