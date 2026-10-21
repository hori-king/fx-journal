const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AIUsageResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUsageResetError";
  }
}

export async function resetTestUserAIUsage(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  targetUserId: string;
  allowedTestUserId: string;
  confirmation: string;
  fetcher?: typeof fetch;
}): Promise<number> {
  const targetUserId = options.targetUserId.toLowerCase();
  const allowedTestUserId = options.allowedTestUserId.toLowerCase();
  if (!userIdPattern.test(targetUserId) || targetUserId !== allowedTestUserId) {
    throw new AIUsageResetError("対象IDはAI_USAGE_RESET_TEST_USER_IDに登録されたテストユーザーと一致しません。");
  }
  if (options.confirmation !== `RESET ${targetUserId}`) {
    throw new AIUsageResetError("確認文字列が一致しません。利用履歴は削除されていません。");
  }

  const url = new URL(`${options.supabaseUrl.replace(/\/$/, "")}/rest/v1/ai_usage`);
  url.searchParams.set("user_id", `eq.${targetUserId}`);
  url.searchParams.set("select", "id");
  const response = await (options.fetcher ?? fetch)(url, {
    method: "DELETE",
    headers: {
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
      Prefer: "return=representation",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new AIUsageResetError(`Supabaseで利用履歴を削除できませんでした（HTTP ${response.status}）。`);
  }

  const deletedRows: unknown = await response.json();
  if (!Array.isArray(deletedRows)) {
    throw new AIUsageResetError("Supabaseから想定外の応答が返りました。削除件数を確認できません。");
  }
  return deletedRows.length;
}
