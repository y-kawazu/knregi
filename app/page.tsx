"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Product = {
  code: string;
  name: string;
  price: number;
};

type CartLine = Product & {
  quantity: number;
};

const PRODUCT_STORAGE_KEY = "smart-register-products-v1";
const CART_STORAGE_KEY = "smart-register-cart-v1";

const demoProducts: Product[] = [
  { code: "4900000000015", name: "デモ商品・りんご", price: 198 },
  { code: "4900000000022", name: "デモ商品・牛乳", price: 238 },
  { code: "4900000000039", name: "デモ商品・食パン", price: 278 },
];

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function documentDate(value: Date) {
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

function parseSmartCode(rawValue: string): Product | null {
  const raw = rawValue.trim();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const code = normalizeCode(String(parsed.code ?? parsed.barcode ?? parsed.id ?? ""));
    const name = String(parsed.name ?? parsed.productName ?? "").trim();
    const price = Number(parsed.price ?? parsed.amount);
    if (code && name && Number.isFinite(price) && price >= 0) {
      return { code, name, price: Math.round(price) };
    }
  } catch {
    // Plain barcodes are expected to fail JSON parsing.
  }

  try {
    const url = new URL(raw);
    const code = normalizeCode(url.searchParams.get("code") ?? url.searchParams.get("barcode") ?? "");
    const name = (url.searchParams.get("name") ?? "").trim();
    const price = Number(url.searchParams.get("price") ?? url.searchParams.get("amount"));
    if (code && name && Number.isFinite(price) && price >= 0) {
      return { code, name, price: Math.round(price) };
    }
  } catch {
    // Non-URL QR values continue to the next format.
  }

  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length >= 3) {
    const code = normalizeCode(parts[0]);
    const name = parts[1];
    const price = Number(parts[2]);
    if (code && name && Number.isFinite(price) && price >= 0) {
      return { code, name, price: Math.round(price) };
    }
  }

  return null;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [manualCode, setManualCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("カメラを商品コードに向けてください");
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editingCode, setEditingCode] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingPrice, setEditingPrice] = useState("");
  const [addAfterSave, setAddAfterSave] = useState(true);
  const [notice, setNotice] = useState("準備完了。商品をスキャンしてください。");
  const [receiptTime, setReceiptTime] = useState("");
  const [draggingCode, setDraggingCode] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const receiptRef = useRef<HTMLElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastScanRef = useRef({ value: "", time: 0 });
  const draggingCodeRef = useRef("");
  const lastDragTargetRef = useRef("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const savedProducts = localStorage.getItem(PRODUCT_STORAGE_KEY);
        const savedCart = localStorage.getItem(CART_STORAGE_KEY);
        if (savedProducts) setProducts(JSON.parse(savedProducts) as Product[]);
        if (savedCart) setCart(JSON.parse(savedCart) as CartLine[]);
      } catch {
        setNotice("保存データを読み込めなかったため、初期状態で開始しました。");
      } finally {
        setHydrated(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products));
  }, [hydrated, products]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, hydrated]);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;

    let cancelled = false;
    const reader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 120,
      delayBetweenScanSuccess: 900,
    });

    setScannerMessage("カメラを起動しています…");
    reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current,
        (result) => {
          if (!result || cancelled) return;
          const value = result.getText().trim();
          const now = Date.now();
          if (lastScanRef.current.value === value && now - lastScanRef.current.time < 1400) return;
          lastScanRef.current = { value, time: now };
          playScanSound();
          handleCode(value);
        },
      )
      .then((controls) => {
        if (cancelled) controls.stop();
        else {
          scannerControlsRef.current = controls;
          setScannerMessage("枠内にバーコードまたはQRコードを映してください");
        }
      })
      .catch(() => {
        setScannerMessage("カメラを使用できません。Safariの設定でカメラを許可してください。");
      });

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  // handleCode deliberately uses the latest product state via its functional branches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen, products]);

  const itemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );
  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const consumptionTax = useMemo(() => Math.floor(subtotal * 0.1), [subtotal]);
  const total = subtotal + consumptionTax;

  function prepareScanAudio() {
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
    } catch {
      // Scanning remains usable if a browser blocks Web Audio.
    }
  }

  function playScanSound() {
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();

      const start = context.currentTime;
      [880, 1175].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = start + index * 0.09;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.085);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.09);
      });
    } catch {
      // Visual confirmation still communicates a successful scan.
    }
  }

  function openScanner() {
    prepareScanAudio();
    setLastScannedProduct(null);
    setScannerMessage("カメラを起動しています…");
    setScannerOpen(true);
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((item) => item.code === product.code);
      if (existing) {
        return current.map((item) =>
          item.code === product.code ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...current, { ...product, quantity: 1 }];
    });
    setNotice(`${product.name}を追加しました。`);
  }

  function handleCode(rawCode: string) {
    const smartProduct = parseSmartCode(rawCode);
    if (smartProduct) {
      setProducts((current) => {
        const withoutSameCode = current.filter((product) => product.code !== smartProduct.code);
        return [...withoutSameCode, smartProduct].sort((a, b) => a.name.localeCompare(b.name, "ja"));
      });
      addToCart(smartProduct);
      setLastScannedProduct(smartProduct);
      setScannerMessage(`${smartProduct.name}を会計に追加しました`);
      return;
    }

    const code = normalizeCode(rawCode);
    if (!code) return;
    const product = products.find((item) => item.code === code);
    if (product) {
      addToCart(product);
      setLastScannedProduct(product);
      setScannerMessage(`${product.name}を会計に追加しました`);
      return;
    }

    setEditingCode(code);
    setEditingName("");
    setEditingPrice("");
    setAddAfterSave(true);
    setLastScannedProduct(null);
    setScannerOpen(false);
    setRegisterOpen(true);
    setNotice("未登録の商品です。商品名と価格を登録してください。");
  }

  function submitManualCode(event: FormEvent) {
    event.preventDefault();
    handleCode(manualCode);
    setManualCode("");
    manualInputRef.current?.focus();
  }

  function saveProduct(event: FormEvent) {
    event.preventDefault();
    const code = normalizeCode(editingCode);
    const name = editingName.trim();
    const price = Math.round(Number(editingPrice));
    if (!code || !name || !Number.isFinite(price) || price < 0) {
      setNotice("商品コード、商品名、0円以上の価格を入力してください。");
      return;
    }

    const product = { code, name, price };
    setProducts((current) => {
      const withoutSameCode = current.filter((item) => item.code !== code);
      return [...withoutSameCode, product].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    });
    setRegisterOpen(false);
    setEditingCode("");
    setEditingName("");
    setEditingPrice("");
    if (addAfterSave) addToCart(product);
    else setNotice(`${product.name}を保存しました。`);
  }

  function beginNewProduct() {
    setEditingCode("");
    setEditingName("");
    setEditingPrice("");
    setAddAfterSave(false);
    setRegisterOpen(true);
  }

  function editProduct(product: Product) {
    setEditingCode(product.code);
    setEditingName(product.name);
    setEditingPrice(String(product.price));
    setAddAfterSave(false);
    setRegisterOpen(true);
  }

  function removeProduct(code: string) {
    if (!window.confirm("この商品を商品マスターから削除しますか？")) return;
    setProducts((current) => current.filter((product) => product.code !== code));
    setNotice("商品マスターから削除しました。");
  }

  function changeQuantity(code: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.code === code ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function moveCartItem(sourceCode: string, targetCode: string) {
    if (!sourceCode || sourceCode === targetCode) return;
    setCart((current) => {
      const sourceIndex = current.findIndex((item) => item.code === sourceCode);
      const targetIndex = current.findIndex((item) => item.code === targetCode);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function moveCartItemByKeyboard(code: string, direction: -1 | 1) {
    setCart((current) => {
      const index = current.findIndex((item) => item.code === code);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function startDragging(event: ReactPointerEvent<HTMLButtonElement>, code: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingCodeRef.current = code;
    lastDragTargetRef.current = code;
    setDraggingCode(code);
  }

  function continueDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingCodeRef.current) return;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-cart-code]");
    const targetCode = target?.dataset.cartCode ?? "";
    if (targetCode && targetCode !== lastDragTargetRef.current) {
      lastDragTargetRef.current = targetCode;
      moveCartItem(draggingCodeRef.current, targetCode);
    }
  }

  function stopDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingCodeRef.current = "";
    lastDragTargetRef.current = "";
    setDraggingCode("");
  }

  function handleDragKey(event: KeyboardEvent<HTMLButtonElement>, code: string) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveCartItemByKeyboard(code, event.key === "ArrowUp" ? -1 : 1);
  }

  function clearCart() {
    if (cart.length === 0 || window.confirm("会計中の商品をすべて取り消しますか？")) {
      setCart([]);
      setCustomerName("");
      setNotice("新しい会計を開始できます。");
    }
  }

  function printReceipt() {
    if (cart.length === 0) {
      setNotice("印刷する商品がありません。");
      return;
    }
    if (!customerName.trim()) {
      setNotice("納品書に記載するお客様名を入力してください。");
      customerInputRef.current?.focus();
      return;
    }
    setReceiptTime(documentDate(new Date()));
    window.setTimeout(() => window.print(), 60);
  }

  async function saveReceipt() {
    if (cart.length === 0) {
      setNotice("保存する商品がありません。");
      return;
    }
    if (!customerName.trim()) {
      setNotice("納品書に記載するお客様名を入力してください。");
      customerInputRef.current?.focus();
      return;
    }

    const receipt = receiptRef.current;
    if (!receipt) return;

    const savedAt = new Date();
    setReceiptTime(documentDate(savedAt));
    setNotice("納品書のPDFを作成しています…");

    let capture: HTMLElement | null = null;
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      capture = receipt.cloneNode(true) as HTMLElement;
      capture.classList.add("pdf-capture");
      document.body.appendChild(capture);

      await document.fonts.ready;
      const captureHeight = Math.ceil(capture.scrollHeight) + 16;
      capture.style.height = `${captureHeight}px`;

      const canvas = await html2canvas(capture, {
        backgroundColor: "#ffffff",
        height: captureHeight,
        scale: 2,
        useCORS: true,
        windowHeight: captureHeight,
        logging: false,
      });
      const pdfWidth = 80;
      const pdfHeight = Math.max(80, (canvas.height * pdfWidth) / canvas.width);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [pdfWidth, pdfHeight],
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pdfWidth, pdfHeight);

      const timestamp = [
        savedAt.getFullYear(),
        String(savedAt.getMonth() + 1).padStart(2, "0"),
        String(savedAt.getDate()).padStart(2, "0"),
        "-",
        String(savedAt.getHours()).padStart(2, "0"),
        String(savedAt.getMinutes()).padStart(2, "0"),
      ].join("");
      const fileName = `納品書_${timestamp}.pdf`;
      const file = new File([pdf.output("blob")], fileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "納品書",
          });
          setNotice("納品書のPDFを共有しました。");
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setNotice("PDFの保存をキャンセルしました。");
            return;
          }
          throw error;
        }
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("納品書のPDFを保存しました。");
      }
    } catch {
      setNotice("PDFを作成できませんでした。もう一度お試しください。");
    } finally {
      capture?.remove();
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar no-print">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">SMART CHECKOUT</p>
            <h1>KNレジ</h1>
          </div>
        </div>
        <button className="ghost-button" type="button" onClick={() => setCatalogOpen(true)}>
          商品マスター
        </button>
      </header>

      <section className="checkout-grid">
        <div className="control-column no-print">
          <section className="scan-panel">
            <div>
              <p className="section-kicker">商品を追加</p>
              <h2>コードを読み取る</h2>
              <p>iPad・iPhoneの背面カメラでバーコードまたはQRコードをスキャンします。</p>
            </div>
            <button className="scan-button" type="button" onClick={openScanner}>
              <span className="scan-icon" aria-hidden="true" />
              カメラでスキャン
            </button>
            <form className="manual-entry" onSubmit={submitManualCode}>
              <label htmlFor="manual-code">コードを手入力</label>
              <div>
                <input
                  ref={manualInputRef}
                  id="manual-code"
                  inputMode="numeric"
                  autoComplete="off"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="バーコード番号"
                />
                <button type="submit">追加</button>
              </div>
            </form>
            <div className="customer-entry">
              <label htmlFor="customer-name">お客様名</label>
              <input
                ref={customerInputRef}
                id="customer-name"
                type="text"
                autoComplete="name"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="例：山田 太郎"
              />
              <small>納品書には「様」を付けて表示します</small>
            </div>
            <div className="status-strip" role="status">
              <span className="status-dot" />
              {notice}
            </div>
          </section>

          <section className="quick-guide">
            <p className="section-kicker">使い方</p>
            <ol>
              <li><span>1</span>商品コードをスキャン</li>
              <li><span>2</span>数量と金額を確認</li>
              <li><span>3</span>会計票を印刷</li>
            </ol>
          </section>
        </div>

        <section className="receipt-card" aria-label="会計一覧" ref={receiptRef}>
          <div className="receipt-heading">
            <div className="receipt-title-group">
              <div>
                <p className="section-kicker">現在の会計</p>
                <h2>納品書</h2>
              </div>
            </div>
            <div className="item-count">{itemCount}<small>点</small></div>
          </div>

          <div className="receipt-meta print-only">
            <span className="document-date">{receiptTime}</span>
            <p className="document-customer">
              <strong>{customerName.trim()} 様</strong>
            </p>
          </div>

          {cart.length > 0 && (
            <div className="document-table-head print-only">
              <span>No.</span>
              <span>品名・単価（税抜）</span>
              <span>金額（税抜）</span>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="empty-cart">
              <span aria-hidden="true">＋</span>
              <p>商品をスキャンすると<br />ここに縦一覧で表示されます</p>
            </div>
          ) : (
            <div className="cart-list">
              {cart.map((item, index) => (
                <article
                  className={`cart-line${draggingCode === item.code ? " is-dragging" : ""}`}
                  data-cart-code={item.code}
                  key={item.code}
                >
                  <div className="line-order">
                    <div className="line-number">{String(index + 1).padStart(2, "0")}</div>
                    <button
                      className="drag-handle no-print"
                      type="button"
                      aria-label={`${item.name}の表示順を変更`}
                      aria-pressed={draggingCode === item.code}
                      title="ドラッグして順番を変更"
                      onPointerDown={(event) => startDragging(event, item.code)}
                      onPointerMove={continueDragging}
                      onPointerUp={stopDragging}
                      onPointerCancel={stopDragging}
                      onKeyDown={(event) => handleDragKey(event, item.code)}
                    >
                      <span aria-hidden="true">⠿</span>
                    </button>
                  </div>
                  <div className="line-main">
                    <h3>{item.name}</h3>
                    <p>{item.code} · 単価（税抜） {yen(item.price)}</p>
                    <div className="quantity-controls no-print" aria-label={`${item.name}の数量`}>
                      <button type="button" onClick={() => changeQuantity(item.code, -1)} aria-label="数量を1減らす">−</button>
                      <strong>{item.quantity}</strong>
                      <button type="button" onClick={() => changeQuantity(item.code, 1)} aria-label="数量を1増やす">＋</button>
                    </div>
                    <p className="print-only quantity-print">{item.quantity}点 × {yen(item.price)}</p>
                  </div>
                  <strong className="line-total">{yen(item.price * item.quantity)}</strong>
                </article>
              ))}
            </div>
          )}

          <div className="total-panel">
            <div className="tax-breakdown">
              <p><span>小計</span><strong>{yen(subtotal)}</strong></p>
              <p><span>消費税（10%）</span><strong>{yen(consumptionTax)}</strong></p>
            </div>
            <div className="grand-total">
              <div>
                <span>合計</span>
                <small>税込</small>
              </div>
              <strong>{yen(total)}</strong>
            </div>
          </div>

          <div className="checkout-actions no-print">
            <button className="clear-button" type="button" onClick={clearCart}>会計をクリア</button>
            <button className="save-receipt-button" type="button" onClick={saveReceipt} disabled={cart.length === 0}>
              PDFで保存
            </button>
            <button className="print-button" type="button" onClick={printReceipt} disabled={cart.length === 0}>
              会計票を印刷
            </button>
          </div>
          <p className="print-note no-print">
            PDF保存：Appleの共有画面から「ファイルに保存」→ iCloud Drive ／ 印刷：AirPrint対応プリンターを選択
          </p>
          <footer className="receipt-footer print-only">
            <div className="company-block">
              <strong>有限会社河津内装</strong>
              <span>〒811-2112</span>
              <span>福岡県糟屋郡須惠町植木814-23</span>
              <span>☎092-936-0919</span>
            </div>
          </footer>
        </section>
      </section>

      {scannerOpen && (
        <div className="modal-backdrop scanner-modal" role="dialog" aria-modal="true" aria-label="コードスキャナー">
          <div className="scanner-sheet">
            <div className="modal-heading">
              <div>
                <p className="section-kicker">CAMERA SCAN</p>
                <h2>商品コードを読み取る</h2>
              </div>
              <button type="button" onClick={() => setScannerOpen(false)} aria-label="スキャナーを閉じる">×</button>
            </div>
            <div className="camera-frame">
              <video ref={videoRef} playsInline muted />
              <div className="scan-guide" aria-hidden="true"><span /></div>
            </div>
            {lastScannedProduct && (
              <div className="scan-result" role="status" aria-live="assertive">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>{lastScannedProduct.name}</strong>
                  <small>{yen(lastScannedProduct.price)}を会計に追加しました</small>
                </div>
              </div>
            )}
            <p className="scanner-message" role="status">{scannerMessage}</p>
            <button className="full-button" type="button" onClick={() => setScannerOpen(false)}>スキャンを終了</button>
          </div>
        </div>
      )}

      {catalogOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="商品マスター">
          <section className="catalog-sheet">
            <div className="modal-heading">
              <div>
                <p className="section-kicker">PRODUCT MASTER</p>
                <h2>商品マスター</h2>
              </div>
              <button type="button" onClick={() => setCatalogOpen(false)} aria-label="商品マスターを閉じる">×</button>
            </div>
            <div className="catalog-toolbar">
              <p>{products.length}商品をこの端末に保存中</p>
              <button type="button" onClick={beginNewProduct}>新しい商品を登録</button>
            </div>
            <div className="catalog-list">
              {products.map((product) => (
                <article key={product.code}>
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.code}</p>
                  </div>
                  <strong>{yen(product.price)}</strong>
                  <div className="catalog-actions">
                    <button type="button" onClick={() => editProduct(product)}>編集</button>
                    <button className="danger-link" type="button" onClick={() => removeProduct(product.code)}>削除</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {registerOpen && (
        <div className="modal-backdrop modal-top" role="dialog" aria-modal="true" aria-label="商品登録">
          <form className="register-card" onSubmit={saveProduct}>
            <div className="modal-heading">
              <div>
                <p className="section-kicker">PRODUCT ENTRY</p>
                <h2>商品を登録</h2>
              </div>
              <button type="button" onClick={() => setRegisterOpen(false)} aria-label="商品登録を閉じる">×</button>
            </div>
            <label>
              商品コード
              <input value={editingCode} onChange={(event) => setEditingCode(event.target.value)} autoComplete="off" required />
            </label>
            <label>
              商品名
              <input value={editingName} onChange={(event) => setEditingName(event.target.value)} autoComplete="off" autoFocus required />
            </label>
            <label>
              価格（税抜・円）
              <input type="number" min="0" step="1" inputMode="numeric" value={editingPrice} onChange={(event) => setEditingPrice(event.target.value)} required />
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => setRegisterOpen(false)}>キャンセル</button>
              <button className="save-button" type="submit">{addAfterSave ? "登録して会計に追加" : "商品を保存"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
