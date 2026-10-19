import assert from "node:assert/strict";
import test from "node:test";
import { ChartImageLoadError, loadOwnedTradeChartImages, parseStoredChartImages } from "../src/chartImages.js";

const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;

test("parses a legacy single image and a list of supported chart images", () => {
  assert.deepEqual(parseStoredChartImages(jpegDataUrl), [{ dataUrl: jpegDataUrl, mimeType: "image/jpeg" }]);
  assert.equal(parseStoredChartImages(JSON.stringify([jpegDataUrl, jpegDataUrl])).length, 2);
  assert.deepEqual(parseStoredChartImages(""), []);
});

test("rejects invalid, excessive, or oversized image content", () => {
  assert.throws(() => parseStoredChartImages("data:image/svg+xml;base64,PHN2Zz4="), ChartImageLoadError);
  assert.throws(() => parseStoredChartImages(JSON.stringify(Array(6).fill(jpegDataUrl))), ChartImageLoadError);
  const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024)]).toString("base64");
  assert.throws(() => parseStoredChartImages(`data:image/jpeg;base64,${oversized}`), ChartImageLoadError);
});

test("loads images through the authenticated user's RLS-protected trade query", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  let capturedUrl: URL | null = null;
  let capturedHeaders: Headers | null = null;

  try {
    const images = await loadOwnedTradeChartImages(
      "123e4567-e89b-42d3-a456-426614174000",
      "user-access-token",
      async (input, init) => {
        capturedUrl = new URL(input.toString());
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify([{ chart_image: jpegDataUrl }]), { status: 200 });
      },
    );

    assert.equal(images.length, 1);
    assert.equal(capturedUrl?.pathname, "/rest/v1/trades");
    assert.equal(capturedUrl?.searchParams.get("id"), "eq.123e4567-e89b-42d3-a456-426614174000");
    assert.equal(capturedUrl?.searchParams.get("select"), "chart_image");
    assert.equal(capturedHeaders?.get("authorization"), "Bearer user-access-token");
    assert.equal(capturedHeaders?.get("apikey"), "publishable-key");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test("does not return another user's or missing trade's images", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  try {
    await assert.rejects(
      loadOwnedTradeChartImages(
        "123e4567-e89b-42d3-a456-426614174000",
        "user-access-token",
        async () => new Response("[]", { status: 200 }),
      ),
      ChartImageLoadError,
    );
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
