import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AIUsageResetError, resetTestUserAIUsage } from "./aiUsageAdmin.js";

async function main() {
  const targetUserId = process.argv[2];
  const allowedTestUserId = process.env.AI_USAGE_RESET_TEST_USER_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!targetUserId) {
    throw new AIUsageResetError("使い方: npm run reset-ai-usage -- <テストユーザーID>");
  }
  if (!allowedTestUserId) {
    throw new AIUsageResetError("AI_USAGE_RESET_TEST_USER_IDが未設定です。専用テストユーザーIDを設定してください。");
  }
  if (!supabaseUrl || !serviceRoleKey) {
    throw new AIUsageResetError("SUPABASE_URLまたはSUPABASE_SERVICE_ROLE_KEYが未設定です。");
  }

  const normalizedTarget = targetUserId.toLowerCase();
  if (normalizedTarget !== allowedTestUserId.toLowerCase()) {
    throw new AIUsageResetError("指定IDが許可されたテストユーザーと一致しません。何も削除していません。");
  }

  const readline = createInterface({ input, output });
  let confirmation: string;
  try {
    confirmation = await readline.question(`テストユーザー ${normalizedTarget} のAI利用履歴だけを削除します。続行するには RESET ${normalizedTarget} と入力してください: `);
  } finally {
    readline.close();
  }

  const deletedCount = await resetTestUserAIUsage({
    supabaseUrl,
    serviceRoleKey,
    targetUserId: normalizedTarget,
    allowedTestUserId,
    confirmation,
  });
  console.log(`テストユーザーのAI利用履歴を${deletedCount}件削除しました。`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "AI利用履歴をリセットできませんでした。");
  process.exitCode = 1;
});
