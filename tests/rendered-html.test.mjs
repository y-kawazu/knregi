import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the KN register checkout", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>KNレジ \| カメラでかんたん会計<\/title>/);
  assert.match(html, /<h1>KNレジ<\/h1>/);
  assert.match(html, /コードを読み取る/);
  assert.match(html, /お買い上げ商品/);
  assert.match(html, /PDFで保存/);
  assert.match(html, /<strong>KNレジ 会計票<\/strong><span><\/span>/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("supports reordering and saving the current receipt", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function moveCartItem\(/);
  assert.match(page, /onPointerMove=\{continueDragging\}/);
  assert.match(page, /function saveReceipt\(\)/);
  assert.match(page, /iCloud DriveへPDF保存/);
  assert.doesNotMatch(page, /text\/csv;charset=utf-8/);
});

test("keeps receipt time deterministic until printing", async () => {
  const [page, layout, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const \[receiptTime, setReceiptTime\] = useState\(""\)/);
  assert.match(page, /setReceiptTime\(new Date\(\)\.toLocaleString\("ja-JP"\)\)/);
  assert.match(page, /<span>\{receiptTime\}<\/span>/);
  assert.doesNotMatch(page, /useState\(\(\) => new Date\(\)\)/);
  assert.match(layout, /KNレジ \| カメラでかんたん会計/);
  assert.match(manifest, /"name": "KNレジ"/);
});
