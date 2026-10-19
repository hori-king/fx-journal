import { Buffer } from "node:buffer";

const maximumImageCount = 5;
const maximumImageBytes = 4 * 1024 * 1024;
const maximumTotalImageBytes = 15 * 1024 * 1024;
const maximumResponseBytes = 22 * 1024 * 1024;

export type AIChartImage = {
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export class ChartImageLoadError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 503) {
    super(message);
    this.name = "ChartImageLoadError";
  }
}

function validImageSignature(bytes: Buffer, mimeType: AIChartImage["mimeType"]): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/webp":
      return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    case "image/gif":
      return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  }
}

export function parseStoredChartImages(value: unknown): AIChartImage[] {
  if (value === null || value === undefined || value === "") return [];

  let encodedImages: unknown[];
  if (typeof value !== "string") {
    throw new ChartImageLoadError("チャート画像の形式を確認できませんでした。", 400);
  } else if (value.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("Invalid image list");
      encodedImages = parsed;
    } catch {
      throw new ChartImageLoadError("チャート画像の形式を確認できませんでした。", 400);
    }
  } else {
    encodedImages = [value];
  }

  if (encodedImages.length > maximumImageCount || !encodedImages.every((image) => typeof image === "string")) {
    throw new ChartImageLoadError("チャート画像は5枚以内で登録してください。", 400);
  }

  let totalBytes = 0;
  const images = encodedImages.map((encoded): AIChartImage => {
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded);
    if (!match) throw new ChartImageLoadError("チャート画像の形式が対応していません。画像を再登録してください。", 400);
    const mimeType = match[1] as AIChartImage["mimeType"];
    const base64 = match[2];
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64") !== base64 || bytes.length === 0 || bytes.length > maximumImageBytes || !validImageSignature(bytes, mimeType)) {
      throw new ChartImageLoadError("チャート画像が破損しているか、サイズ上限を超えています。画像を再登録してください。", 400);
    }
    totalBytes += bytes.length;
    if (totalBytes > maximumTotalImageBytes) {
      throw new ChartImageLoadError("チャート画像の合計サイズが上限を超えています。画像を減らして再度お試しください。", 400);
    }
    return { dataUrl: encoded, mimeType };
  });
  return images;
}

async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ChartImageLoadError("チャート画像を読み込めませんでした。再度お試しください。", 503);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumResponseBytes) {
      await reader.cancel();
      throw new ChartImageLoadError("チャート画像の合計サイズが上限を超えています。画像を減らして再度お試しください。", 400);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadOwnedTradeChartImages(
  tradeId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AIChartImage[]> {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) {
    console.error("Chart image lookup configuration is missing", {
      missing: [!baseUrl && "SUPABASE_URL", !publishableKey && "SUPABASE_PUBLISHABLE_KEY"].filter(Boolean),
    });
    throw new ChartImageLoadError("チャート画像の読み込み設定を確認できません。", 503);
  }

  const url = new URL(`${baseUrl}/rest/v1/trades`);
  url.searchParams.set("id", `eq.${tradeId}`);
  url.searchParams.set("select", "chart_image");

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        apikey: publishableKey,
        // service_roleを使わず、利用者自身のtrades_select_own RLSを適用する。
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Owned chart image lookup failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    throw new ChartImageLoadError("チャート画像を読み込めませんでした。再度お試しください。", 503);
  }

  if (!response.ok) {
    console.error("Owned chart image lookup was rejected", { status: response.status });
    throw new ChartImageLoadError("チャート画像を読み込めませんでした。再度お試しください。", response.status >= 500 ? 503 : 404);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedBody(response));
  } catch (error) {
    if (error instanceof ChartImageLoadError) throw error;
    console.error("Owned chart image lookup returned invalid JSON");
    throw new ChartImageLoadError("チャート画像を読み込めませんでした。再度お試しください。", 503);
  }

  if (!Array.isArray(payload) || payload.length !== 1 || !isRecord(payload[0]) || !("chart_image" in payload[0])) {
    throw new ChartImageLoadError("取引データまたはチャート画像を確認できませんでした。", 404);
  }

  return parseStoredChartImages(payload[0].chart_image);
}
