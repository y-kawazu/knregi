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
  assert.match(html, /納品書/);
  assert.match(html, /お客様名/);
  assert.match(html, /PDFで保存/);
  assert.doesNotMatch(html, /KNレジ 会計票/);
  assert.match(html, /有限会社河津内装/);
  assert.match(html, /〒811-2112/);
  assert.match(html, /福岡県糟屋郡須惠町植木814-23/);
  assert.match(html, /TEL 092-936-0919/);
  assert.doesNotMatch(html, /☎/);
  assert.doesNotMatch(html, /<span>お客様名<\/span>/);
  assert.doesNotMatch(html, /DELIVERY SLIP|document-logo/);
  assert.match(html, /<span>小計<\/span>/);
  assert.doesNotMatch(html, /小計（税抜）/);
  assert.match(html, /消費税（10%）/);
  assert.match(html, /合計/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("supports reordering and saving the current receipt", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function moveCartItem\(/);
  assert.match(page, /onPointerMove=\{continueDragging\}/);
  assert.match(page, /function saveReceipt\(\)/);
  assert.match(page, /import\("html2canvas"\)/);
  assert.match(page, /Math\.max\(capture\.scrollWidth, capture\.getBoundingClientRect\(\)\.width\)/);
  assert.match(page, /windowWidth: captureWidth/);
  assert.match(page, /iPad\|iPhone\|iPod/);
  assert.match(page, /URLSearchParams\(window\.location\.search\)\.has\("download"\)/);
  assert.match(page, /!forceDownload && isAppleMobile && navigator\.canShare/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /await navigator\.share\(\{\s*files: \[file\],?\s*\}\)/s);
  assert.doesNotMatch(page, /title: "納品書"/);
  assert.match(page, /application\/pdf/);
  assert.match(page, /const pdfWidth = 210/);
  assert.match(page, /const pdfHeight = 297/);
  assert.match(page, /format: "a4"/);
  assert.match(page, /pdf\.addPage\("a4", "portrait"\)/);
  assert.match(page, /capture\.scrollHeight/);
  assert.match(page, /windowHeight: captureHeight/);
  assert.match(page, /Math\.floor\(subtotal \* 0\.1\)/);
  assert.match(page, /価格（税抜・円）/);
  assert.doesNotMatch(page, /text\/csv;charset=utf-8/);
});

test("keeps receipt time deterministic until printing", async () => {
  const [page, layout, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const \[receiptTime, setReceiptTime\] = useState\(""\)/);
  assert.match(page, /setReceiptTime\(documentDate\(new Date\(\)\)\)/);
  assert.match(page, /<span className="document-date">\{receiptTime\}<\/span>/);
  assert.match(page, /getFullYear\(\).*年/);
  assert.doesNotMatch(page, /useState\(\(\) => new Date\(\)\)/);
  assert.match(layout, /KNレジ \| カメラでかんたん会計/);
  assert.match(layout, /icon: \[\{ url: "\/kn-logo\.png"/);
  assert.doesNotMatch(layout, /favicon\.svg/);
  assert.match(manifest, /"name": "KNレジ"/);
  assert.match(manifest, /"src": "\/kn-logo\.png"/);
});
