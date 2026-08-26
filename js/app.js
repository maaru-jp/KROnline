const STORAGE_KEY = "kronline-ledger-v3";
const CARDS = ["富邦", "中信"];
const SHOPS = ["Coupang", "Olive Young", "29CM", "Musinsa", "其他"];

const NAV = [
  ["dashboard", "總覽"],
  ["new-purchase", "新增購買"],
  ["npay-topup", "Npay 儲值"],
  ["purchases", "購買列表"],
  ["npay-ledger", "Npay 歷程"],
  ["cards", "銀行卡對帳"],
  ["sheets", "試算表預覽"],
];

const SUB = {
  dashboard: "Npay 餘額、本月實付、各卡未對帳",
  "new-purchase": "商品、折扣、Npay 與刷哪張卡（富邦／中信）",
  "npay-topup": "記錄何時買 Npay、用哪張卡、儲值後剩餘點數",
  purchases: "點一筆訂單，看該筆完整商品明細",
  "npay-ledger": "儲值／扣除時間軸，每筆都留下剩餘點數",
  cards: "富邦、中信分開對銀行帳單",
  sheets: "確認後會自動寫入 Google 試算表的欄位長相",
  "order-detail": "這一筆的全部商品、折扣、Npay 與刷卡",
};

function seedLedger() {
  return {
    items: [
      item("I-001", "P-001", "2026-08-05", "Coupang", "洗面乳", 29000, 2),
      item("I-002", "P-002", "2026-08-12", "Olive Young", "防曬乳", 16000, 1),
      item("I-003", "P-002", "2026-08-12", "Olive Young", "唇膏", 16000, 1),
      item("I-004", "P-003", "2026-08-20", "29CM", "襯衫", 45000, 1),
    ],
    orders: [
      order("P-001", "2026-08-05", "Coupang", 8000, 50000, 0, undefined, ""),
      order("P-002", "2026-08-12", "Olive Young", 2000, 20000, 10000, "中信", ""),
      order("P-003", "2026-08-20", "29CM", 0, 0, 45000, "中信", ""),
    ],
    npay: [
      npay("N-001", "2026-08-01", "儲值", 100000, 0, 100000, "富邦"),
      npay("N-002", "2026-08-05", "消費扣除", 0, 50000, 50000, undefined, "P-001"),
      npay("N-003", "2026-08-12", "消費扣除", 0, 20000, 30000, undefined, "P-002"),
    ],
    cards: [
      card("C-001", "2026-08-01", "富邦", "Npay儲值", 100000, "N-001", false),
      card("C-002", "2026-08-12", "中信", "購物補差額", 10000, "P-002", false),
      card("C-003", "2026-08-20", "中信", "直接刷卡", 45000, "P-003", false),
    ],
    seeded: true,
  };
}

function item(id, orderId, date, shop, name, unitPrice, quantity) {
  return { id, orderId, date, shop, name, unitPrice, quantity };
}
function order(id, date, shop, storeDiscount, npayUsed, cardAmount, cardName, note) {
  return { id, date, shop, storeDiscount, npayUsed, cardAmount, card: cardName, note };
}
function npay(id, date, type, credit, debit, balance, topUpCard, relatedOrderId) {
  return { id, date, type, credit, debit, balance, topUpCard, relatedOrderId };
}
function card(id, date, cardName, type, amount, relatedId, reconciled) {
  return { id, date, card: cardName, type, amount, relatedId, reconciled };
}

function emptyLedger() {
  return { items: [], orders: [], npay: [], cards: [], seeded: false };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedLedger();
    return JSON.parse(raw);
  } catch {
    return seedLedger();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function krw(n) {
  return `₩${Number(n || 0).toLocaleString("ko-KR")}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(prefix, rows) {
  const max = rows.reduce((acc, row) => {
    const num = Number(String(row.id).replace(/^[A-Z]+-/, ""));
    return Number.isFinite(num) ? Math.max(acc, num) : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function itemTotal(row) {
  return Number(row.unitPrice || 0) * Number(row.quantity || 0);
}

function goodsTotal(orderId) {
  return ledger.items
    .filter((row) => row.orderId === orderId)
    .reduce((sum, row) => sum + itemTotal(row), 0);
}

function npayBalance() {
  if (!ledger.npay.length) return 0;
  return ledger.npay[ledger.npay.length - 1].balance;
}

function monthKey(date) {
  return String(date || "").slice(0, 7);
}

function isOrderId(id) {
  return /^P-\d+/.test(String(id || ""));
}

function openOrder(id, from) {
  if (!ledger.orders.some((row) => row.id === id)) return;
  selectedOrderId = id;
  detailFrom = from || view;
  view = "order-detail";
  render();
}

function orderLink(id) {
  if (!isOrderId(id)) return esc(id || "—");
  return `<button type="button" class="linkish" data-order="${esc(id)}">${esc(id)}</button>`;
}

function bindOrderLinks(root) {
  (root || document).querySelectorAll("[data-order]").forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      openOrder(el.dataset.order, view === "order-detail" ? detailFrom : view);
    };
  });
}

let ledger = load();
let view = "dashboard";
let cardTab = "富邦";
let sheetTab = "商品明細";
let selectedOrderId = "";
let detailFrom = "purchases";
let lastSavedOrderId = "";
let notice = "";
let formError = "";
let formOk = "";

const purchaseForm = blankPurchase();
const topupForm = { date: today(), amount: "", card: "富邦" };

function blankPurchase() {
  return {
    date: today(),
    shop: "Coupang",
    discount: "0",
    npay: "0",
    cardAmount: "0",
    card: "中信",
    note: "",
    items: [{ name: "", unitPrice: "", quantity: "1" }],
    autoSplit: true,
  };
}

function render() {
  const title =
    view === "order-detail"
      ? `商品明細 ${selectedOrderId}`
      : NAV.find((item) => item[0] === view)?.[1] || "";
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-sub").textContent = SUB[view] || "";
  renderNav();
  renderBanner();
  renderTopbar();
  const root = document.getElementById("view");
  root.innerHTML = "";
  formError = view === lastErrorView ? formError : "";
  formOk = view === lastOkView ? formOk : "";
  const pages = {
    dashboard: renderDashboard,
    "new-purchase": renderPurchase,
    "npay-topup": renderTopup,
    purchases: renderPurchases,
    "npay-ledger": renderNpay,
    cards: renderCards,
    sheets: renderSheets,
    "order-detail": renderOrderDetail,
  };
  pages[view](root);
}

let lastErrorView = "";
let lastOkView = "";

function renderNav() {
  const active = view === "order-detail" ? "purchases" : view;
  document.getElementById("nav").innerHTML = NAV.map(
    ([id, label]) =>
      `<button type="button" data-view="${id}" class="${id === active ? "is-active" : ""}">${esc(label)}</button>`,
  ).join("");
  document.querySelectorAll("#nav [data-view]").forEach((btn) => {
    btn.onclick = () => {
      view = btn.dataset.view;
      notice = "";
      render();
    };
  });
}

function renderBanner() {
  const el = document.getElementById("banner");
  if (ledger.seeded) {
    el.innerHTML = `<div class="banner">目前顯示示範資料（富邦儲值 Npay；購物有純 Npay、Npay+中信、純刷中信）。確認畫面後可清除。Google 試算表自動寫入尚未接上。</div>`;
  } else if (notice) {
    el.innerHTML = `<div class="banner">${esc(notice)}</div>`;
  } else {
    el.innerHTML = "";
  }
}

function renderTopbar() {
  const box = document.getElementById("topbar-actions");
  box.innerHTML = `
    <button class="btn" type="button" id="btn-seed">載入示範</button>
    <button class="btn btn-danger" type="button" id="btn-reset">清除資料</button>
  `;
  document.getElementById("btn-seed").onclick = () => {
    ledger = seedLedger();
    save();
    view = "dashboard";
    render();
  };
  document.getElementById("btn-reset").onclick = () => {
    if (!confirm("清除本機全部記帳資料？")) return;
    ledger = emptyLedger();
    save();
    view = "dashboard";
    notice = "已清空。可從「新增購買」或「Npay 儲值」開始登第一筆。";
    render();
  };
}

function renderDashboard(root) {
  const now = today().slice(0, 7);
  const monthPay = ledger.orders
    .filter((row) => monthKey(row.date) === now)
    .reduce((sum, row) => sum + row.npayUsed + row.cardAmount, 0);
  root.innerHTML = `
    <div class="stats">
      <article class="stat accent"><div class="label">Npay 剩餘</div><div class="value">${krw(npayBalance())}</div></article>
      <article class="stat"><div class="label">${esc(now)} 實付</div><div class="value">${krw(monthPay)}</div></article>
      ${CARDS.map((name) => {
        const open = ledger.cards
          .filter((row) => row.card === name && !row.reconciled)
          .reduce((sum, row) => sum + row.amount, 0);
        return `<article class="stat"><div class="label">${esc(name)} 未對帳</div><div class="value">${krw(open)}</div></article>`;
      }).join("")}
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>最近購買</h2>
        ${orderTable(ledger.orders.slice().reverse().slice(0, 6))}
      </section>
      <section class="panel">
        <h2>Npay 最近流水</h2>
        <div class="ledger-list">
          ${
            ledger.npay.length
              ? ledger.npay
                  .slice()
                  .reverse()
                  .slice(0, 5)
                  .map(
                    (row) => `
            <div class="ledger-item">
              <div>${esc(row.date)}<div class="muted">${esc(row.type)}</div></div>
              <div>${row.relatedOrderId ? orderLink(row.relatedOrderId) : esc(row.topUpCard || "")}</div>
              <div class="amt ${row.credit ? "credit" : "debit"}">${row.credit ? "+" : "−"}${krw(row.credit || row.debit)}</div>
            </div>`,
                  )
                  .join("")
              : `<p class="empty">尚無 Npay 紀錄</p>`
          }
        </div>
      </section>
    </div>
  `;
  bindOrderLinks(root);
}

function orderTable(orders, withAction) {
  if (!orders.length) return `<p class="empty">尚無購買紀錄</p>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>訂單</th><th>日期</th><th>店家</th><th class="num">商品合計</th><th class="num">折扣</th><th class="num">實付</th><th>付款</th>${withAction ? "<th></th>" : ""}</tr></thead>
    <tbody>
      ${orders
        .map((row) => {
          const goods = goodsTotal(row.id);
          const pay = row.npayUsed + row.cardAmount;
          const payText = [
            row.npayUsed ? `Npay ${krw(row.npayUsed)}` : "",
            row.cardAmount ? `${row.card || "刷卡"} ${krw(row.cardAmount)}` : "",
          ]
            .filter(Boolean)
            .join(" + ") || "—";
          return `<tr class="row-click" data-order="${esc(row.id)}">
            <td>${orderLink(row.id)}</td>
            <td>${esc(row.date)}</td>
            <td>${esc(row.shop)}</td>
            <td class="num">${krw(goods)}</td>
            <td class="num">${krw(row.storeDiscount)}</td>
            <td class="num">${krw(pay)}</td>
            <td>${esc(payText || "—")}</td>
            ${withAction ? `<td><button class="btn" type="button" data-order="${esc(row.id)}">完整明細</button></td>` : ""}
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

function renderPurchase(root) {
  root.innerHTML = `
    <div class="grid-2">
      <section class="panel">
        <h2>訂單</h2>
        <div class="form-grid">
          <label class="field">購買日期
            <input type="date" id="p-date" value="${esc(purchaseForm.date)}" />
          </label>
          <label class="field">店家
            <input list="shops" id="p-shop" value="${esc(purchaseForm.shop)}" />
          </label>
          <label class="field">店家折扣（韓幣）
            <input type="number" min="0" id="p-discount" value="${esc(purchaseForm.discount)}" />
          </label>
          <label class="field">備註
            <input id="p-note" value="${esc(purchaseForm.note)}" />
          </label>
        </div>
        <datalist id="shops">${SHOPS.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
        <h2 style="margin-top:18px">商品明細</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>商品名稱</th><th class="num">單價 KRW</th><th class="num">數量</th><th class="num">總金額</th><th></th></tr></thead>
            <tbody id="item-rows"></tbody>
          </table>
        </div>
        <div class="item-actions">
          <button class="btn" type="button" id="add-item">新增商品列</button>
        </div>
      </section>
      <section class="panel">
        <h2>付款與試算</h2>
        <div class="totals" id="p-totals"></div>
        <div class="form-grid" style="margin-top:12px">
          <label class="field">使用 Npay
            <input type="number" min="0" id="p-npay" value="${esc(purchaseForm.npay)}" />
          </label>
          <label class="field">刷卡金額
            <input type="number" min="0" id="p-card-amt" value="${esc(purchaseForm.cardAmount)}" />
          </label>
          <label class="field">刷哪張卡
            <select id="p-card">${CARDS.map(
              (c) =>
                `<option ${purchaseForm.card === c ? "selected" : ""}>${esc(c)}</option>`,
            ).join("")}</select>
          </label>
        </div>
        <p class="muted">實付必須等於 Npay + 刷卡。刷卡大於 0 時必選富邦或中信，並寫入該卡對帳。</p>
        <p class="error" id="p-error">${formError ? esc(formError) : ""}</p>
        <p class="ok-msg" id="p-ok">${formOk ? esc(formOk) : ""}</p>
        <div class="item-actions">
          <button class="btn btn-primary" type="button" id="save-purchase">寫入紀錄</button>
          ${lastSavedOrderId ? `<button class="btn" type="button" id="open-last">查看 ${esc(lastSavedOrderId)} 完整明細</button>` : ""}
        </div>
      </section>
    </div>
  `;
  paintItemRows();
  paintPurchaseTotals();
  const keep = (id, key) => {
    document.getElementById(id).oninput = (e) => {
      purchaseForm[key] = e.target.value;
    };
  };
  keep("p-date", "date");
  keep("p-shop", "shop");
  keep("p-note", "note");
  document.getElementById("p-discount").oninput = (e) => {
    purchaseForm.discount = e.target.value;
    if (purchaseForm.autoSplit) applySplit(calcPayable());
    syncPayInputs();
    paintPurchaseTotals();
  };
  document.getElementById("p-npay").oninput = (e) => {
    purchaseForm.npay = e.target.value;
    purchaseForm.autoSplit = false;
    purchaseForm.cardAmount = String(Math.max(0, calcPayable() - Number(e.target.value || 0)));
    document.getElementById("p-card-amt").value = purchaseForm.cardAmount;
    paintPurchaseTotals();
  };
  document.getElementById("p-card-amt").oninput = (e) => {
    purchaseForm.cardAmount = e.target.value;
    purchaseForm.autoSplit = false;
    purchaseForm.npay = String(Math.max(0, calcPayable() - Number(e.target.value || 0)));
    document.getElementById("p-npay").value = purchaseForm.npay;
    paintPurchaseTotals();
  };
  document.getElementById("p-card").onchange = (e) => {
    purchaseForm.card = e.target.value;
  };
  document.getElementById("add-item").onclick = () => {
    syncItemInputs();
    purchaseForm.items.push({ name: "", unitPrice: "", quantity: "1" });
    paintItemRows();
    paintPurchaseTotals();
  };
  document.getElementById("save-purchase").onclick = savePurchase;
  const openLast = document.getElementById("open-last");
  if (openLast) {
    openLast.onclick = () => openOrder(lastSavedOrderId, "new-purchase");
  }
}

function paintItemRows() {
  const tbody = document.getElementById("item-rows");
  tbody.innerHTML = purchaseForm.items
    .map((row, i) => {
      const total = Number(row.unitPrice || 0) * Number(row.quantity || 0);
      return `<tr>
        <td><input data-i="${i}" data-k="name" value="${esc(row.name)}" placeholder="商品名稱" /></td>
        <td><input data-i="${i}" data-k="unitPrice" type="number" min="0" value="${esc(row.unitPrice)}" /></td>
        <td><input data-i="${i}" data-k="quantity" type="number" min="1" value="${esc(row.quantity)}" /></td>
        <td class="num" data-total="${i}">${krw(total)}</td>
        <td><button class="row-del" data-del="${i}" type="button">刪</button></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll("input").forEach((el) => {
    el.oninput = () => {
      const i = Number(el.dataset.i);
      purchaseForm.items[i][el.dataset.k] = el.value;
      if (purchaseForm.autoSplit) applySplit(calcPayable());
      const total = Number(purchaseForm.items[i].unitPrice || 0) * Number(purchaseForm.items[i].quantity || 0);
      tbody.querySelector(`[data-total="${i}"]`).textContent = krw(total);
      syncPayInputs();
      paintPurchaseTotals();
    };
  });
  tbody.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = () => {
      if (purchaseForm.items.length === 1) return;
      syncItemInputs();
      purchaseForm.items.splice(Number(el.dataset.del), 1);
      if (purchaseForm.autoSplit) applySplit(calcPayable());
      paintItemRows();
      syncPayInputs();
      paintPurchaseTotals();
    };
  });
}

function syncItemInputs() {
  document.querySelectorAll("#item-rows input").forEach((el) => {
    const i = Number(el.dataset.i);
    if (purchaseForm.items[i]) purchaseForm.items[i][el.dataset.k] = el.value;
  });
}

function paintPurchaseTotals() {
  const goods = calcGoods();
  const discount = Number(purchaseForm.discount || 0);
  const payable = goods - discount;
  const npayAmt = Number(purchaseForm.npay || 0);
  const cardAmt = Number(purchaseForm.cardAmount || 0);
  const remain = npayBalance() - npayAmt;
  const box = document.getElementById("p-totals");
  if (!box) return;
  box.innerHTML = `
    <div><span>商品合計</span><span>${krw(goods)}</span></div>
    <div><span>店家折扣</span><span>− ${krw(discount)}</span></div>
    <div class="pay"><span>實付</span><span>${krw(payable)}</span></div>
    <div><span>Npay ${krw(npayAmt)} + ${esc(purchaseForm.card || "卡")} ${krw(cardAmt)}</span><span>${npayAmt + cardAmt === payable ? "相符" : "需等於實付"}</span></div>
    <div><span>目前 Npay 餘額</span><span>${krw(npayBalance())}</span></div>
    <div><span>送出後 Npay</span><span class="${remain < 0 ? "debit" : ""}">${remain < 0 ? "餘額不足" : krw(remain)}</span></div>
  `;
}

function calcGoods() {
  return purchaseForm.items.reduce(
    (sum, row) => sum + Number(row.unitPrice || 0) * Number(row.quantity || 0),
    0,
  );
}

function calcPayable() {
  return calcGoods() - Number(purchaseForm.discount || 0);
}

function applySplit(payable) {
  if (!purchaseForm.autoSplit) return;
  const npayAmt = Math.min(npayBalance(), Math.max(0, payable));
  purchaseForm.npay = String(npayAmt);
  purchaseForm.cardAmount = String(Math.max(0, payable - npayAmt));
}

function syncPayInputs() {
  const npayEl = document.getElementById("p-npay");
  const cardEl = document.getElementById("p-card-amt");
  if (npayEl) npayEl.value = purchaseForm.npay;
  if (cardEl) cardEl.value = purchaseForm.cardAmount;
}

function savePurchase() {
  lastErrorView = "new-purchase";
  lastOkView = "new-purchase";
  formOk = "";
  syncItemInputs();
  purchaseForm.date = document.getElementById("p-date").value;
  purchaseForm.shop = document.getElementById("p-shop").value;
  purchaseForm.discount = document.getElementById("p-discount").value;
  purchaseForm.note = document.getElementById("p-note").value;
  purchaseForm.npay = document.getElementById("p-npay").value;
  purchaseForm.cardAmount = document.getElementById("p-card-amt").value;
  purchaseForm.card = document.getElementById("p-card").value;
  const items = purchaseForm.items
    .map((row) => ({
      name: row.name.trim(),
      unitPrice: Number(row.unitPrice),
      quantity: Number(row.quantity),
    }))
    .filter((row) => row.name || row.unitPrice || row.quantity !== 1);

  if (!purchaseForm.date) return fail("請填購買日期");
  if (!purchaseForm.shop.trim()) return fail("請填店家");
  if (!items.length) return fail("請至少登一件商品");
  for (const row of items) {
    if (!row.name) return fail("商品名稱為必填");
    if (!(row.unitPrice > 0)) return fail("單價必須大於 0");
    if (!Number.isInteger(row.quantity) || row.quantity < 1)
      return fail("數量必須是正整數");
  }
  const goods = items.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0);
  const discount = Number(purchaseForm.discount || 0);
  if (discount < 0 || discount > goods) return fail("店家折扣需介於 0 與商品合計之間");
  const payable = goods - discount;
  const npayUsed = Number(purchaseForm.npay || 0);
  const cardAmount = Number(purchaseForm.cardAmount || 0);
  if (npayUsed + cardAmount !== payable)
    return fail(`實付 ${krw(payable)} 必須等於 Npay + 刷卡`);
  if (npayUsed > npayBalance())
    return fail(`Npay 餘額不足，目前 ${krw(npayBalance())}`);
  if (cardAmount > 0 && !purchaseForm.card) return fail("刷卡時請選擇富邦或中信");

  const orderId = nextId("P", ledger.orders);
  items.forEach((row) => {
    ledger.items.push({
      id: nextId("I", ledger.items),
      orderId,
      date: purchaseForm.date,
      shop: purchaseForm.shop.trim(),
      name: row.name,
      unitPrice: row.unitPrice,
      quantity: row.quantity,
    });
  });
  ledger.orders.push({
    id: orderId,
    date: purchaseForm.date,
    shop: purchaseForm.shop.trim(),
    storeDiscount: discount,
    npayUsed,
    cardAmount,
    card: cardAmount > 0 ? purchaseForm.card : undefined,
    note: purchaseForm.note.trim(),
  });
  if (npayUsed > 0) {
    const balance = npayBalance() - npayUsed;
    ledger.npay.push({
      id: nextId("N", ledger.npay),
      date: purchaseForm.date,
      type: "消費扣除",
      credit: 0,
      debit: npayUsed,
      balance,
      relatedOrderId: orderId,
    });
  }
  if (cardAmount > 0) {
    ledger.cards.push({
      id: nextId("C", ledger.cards),
      date: purchaseForm.date,
      card: purchaseForm.card,
      type: npayUsed > 0 ? "購物補差額" : "直接刷卡",
      amount: cardAmount,
      relatedId: orderId,
      reconciled: false,
    });
  }
  ledger.seeded = false;
  save();
  Object.assign(purchaseForm, blankPurchase());
  formError = "";
  formOk = `已登記 ${orderId}，實付 ${krw(payable)}。Npay 剩餘 ${krw(npayBalance())}。`;
  lastSavedOrderId = orderId;
  render();
}

function fail(message) {
  formError = message;
  formOk = "";
  render();
}

function renderTopup(root) {
  root.innerHTML = `
    <section class="panel" style="max-width:520px">
      <h2>買 Npay 點數</h2>
      <div class="form-grid">
        <label class="field">日期
          <input type="date" id="t-date" value="${esc(topupForm.date)}" />
        </label>
        <label class="field">儲值金額 KRW
          <input type="number" min="1" id="t-amt" value="${esc(topupForm.amount)}" />
        </label>
        <label class="field">儲值用銀行卡
          <select id="t-card">${CARDS.map(
            (c) => `<option ${topupForm.card === c ? "selected" : ""}>${esc(c)}</option>`,
          ).join("")}</select>
        </label>
      </div>
      <p class="muted">會同時寫入 Npay 歷程（剩餘點數）與該卡明細，方便對銀行帳單。</p>
      <p>儲值前餘額 <strong>${krw(npayBalance())}</strong></p>
      ${formError && view === "npay-topup" ? `<p class="error">${esc(formError)}</p>` : ""}
      ${formOk && view === "npay-topup" ? `<p class="ok-msg">${esc(formOk)}</p>` : ""}
      <div class="item-actions">
        <button class="btn btn-primary" type="button" id="save-topup">寫入儲值</button>
      </div>
    </section>
  `;
  document.getElementById("t-date").oninput = (e) => (topupForm.date = e.target.value);
  document.getElementById("t-amt").oninput = (e) => (topupForm.amount = e.target.value);
  document.getElementById("t-card").onchange = (e) => (topupForm.card = e.target.value);
  document.getElementById("save-topup").onclick = saveTopup;
}

function saveTopup() {
  lastErrorView = "npay-topup";
  lastOkView = "npay-topup";
  const amount = Number(topupForm.amount);
  if (!topupForm.date) return fail("請填日期");
  if (!(amount > 0)) return fail("儲值金額必須大於 0");
  const id = nextId("N", ledger.npay);
  const balance = npayBalance() + amount;
  ledger.npay.push({
    id,
    date: topupForm.date,
    type: "儲值",
    credit: amount,
    debit: 0,
    balance,
    topUpCard: topupForm.card,
  });
  ledger.cards.push({
    id: nextId("C", ledger.cards),
    date: topupForm.date,
    card: topupForm.card,
    type: "Npay儲值",
    amount,
    relatedId: id,
    reconciled: false,
  });
  ledger.seeded = false;
  save();
  topupForm.amount = "";
  formError = "";
  formOk = `已儲值 ${krw(amount)}，Npay 剩餘 ${krw(balance)}，並記入 ${topupForm.card}。`;
  render();
}

function renderPurchases(root) {
  if (!ledger.orders.length) {
    root.innerHTML = `<p class="empty">尚無購買紀錄</p>`;
    return;
  }
  root.innerHTML = `<section class="panel">
    <h2>選擇一筆訂單</h2>
    <p class="muted" style="margin:-6px 0 14px">點訂單編號、整列或「完整明細」，只看該筆全部商品。</p>
    ${orderTable(ledger.orders.slice().reverse(), true)}
  </section>`;
  bindOrderLinks(root);
}

function renderOrderDetail(root) {
  const row = ledger.orders.find((order) => order.id === selectedOrderId);
  const backLabel =
    NAV.find((item) => item[0] === detailFrom)?.[1] || "購買列表";
  if (!row) {
    root.innerHTML = `<p class="empty">找不到這筆訂單</p>
      <button class="btn" type="button" id="back-detail">返回${esc(backLabel)}</button>`;
    document.getElementById("back-detail").onclick = () => {
      view = detailFrom === "order-detail" ? "purchases" : detailFrom;
      render();
    };
    return;
  }
  const lines = ledger.items.filter((itemRow) => itemRow.orderId === row.id);
  const npayRows = ledger.npay.filter((entry) => entry.relatedOrderId === row.id);
  const cardRows = ledger.cards.filter((entry) => entry.relatedId === row.id);
  const goods = goodsTotal(row.id);
  const payable = row.npayUsed + row.cardAmount;
  root.innerHTML = `
    <div class="item-actions" style="margin-bottom:16px">
      <button class="btn" type="button" id="back-detail">返回${esc(backLabel)}</button>
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>${esc(row.id)}　${esc(row.shop)}</h2>
        <p class="muted">購買日 ${esc(row.date)}${row.note ? `　備註 ${esc(row.note)}` : ""}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>明細號</th>
                <th>購買日</th>
                <th>店家</th>
                <th>商品名稱</th>
                <th class="num">單價 KRW</th>
                <th class="num">數量</th>
                <th class="num">總金額</th>
              </tr>
            </thead>
            <tbody>
              ${
                lines.length
                  ? lines
                      .map(
                        (itemRow) => `<tr>
                  <td>${esc(itemRow.id)}</td>
                  <td>${esc(itemRow.date)}</td>
                  <td>${esc(itemRow.shop)}</td>
                  <td>${esc(itemRow.name)}</td>
                  <td class="num">${krw(itemRow.unitPrice)}</td>
                  <td class="num">${itemRow.quantity}</td>
                  <td class="num">${krw(itemTotal(itemRow))}</td>
                </tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="7">此筆沒有商品列</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>這一筆怎麼付</h2>
        <div class="totals">
          <div><span>商品合計</span><span>${krw(goods)}</span></div>
          <div><span>店家折扣</span><span>− ${krw(row.storeDiscount)}</span></div>
          <div class="pay"><span>實付</span><span>${krw(payable)}</span></div>
          <div><span>Npay</span><span>${krw(row.npayUsed)}</span></div>
          <div><span>${esc(row.card || "刷卡")}</span><span>${krw(row.cardAmount)}</span></div>
        </div>
        ${
          npayRows.length
            ? `<h2 style="margin-top:18px">Npay 歷程</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>日期</th><th>類型</th><th class="num">扣除</th><th class="num">剩餘點數</th></tr></thead>
            <tbody>${npayRows
              .map(
                (entry) => `<tr>
              <td>${esc(entry.date)}</td>
              <td>${esc(entry.type)}</td>
              <td class="num">${krw(entry.debit)}</td>
              <td class="num">${krw(entry.balance)}</td>
            </tr>`,
              )
              .join("")}</tbody>
          </table></div>`
            : ""
        }
        ${
          cardRows.length
            ? `<h2 style="margin-top:18px">銀行卡</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>日期</th><th>卡</th><th>類型</th><th class="num">金額</th></tr></thead>
            <tbody>${cardRows
              .map(
                (entry) => `<tr>
              <td>${esc(entry.date)}</td>
              <td>${esc(entry.card)}</td>
              <td>${esc(entry.type)}</td>
              <td class="num">${krw(entry.amount)}</td>
            </tr>`,
              )
              .join("")}</tbody>
          </table></div>`
            : ""
        }
      </section>
    </div>
  `;
  document.getElementById("back-detail").onclick = () => {
    view = detailFrom && detailFrom !== "order-detail" ? detailFrom : "purchases";
    render();
  };
}

function renderNpay(root) {
  if (!ledger.npay.length) {
    root.innerHTML = `<p class="empty">尚無 Npay 歷程</p>`;
    return;
  }
  root.innerHTML = `<section class="panel"><div class="table-wrap"><table>
    <thead><tr><th>單號</th><th>日期</th><th>類型</th><th class="num">儲值</th><th class="num">扣除</th><th class="num">剩餘點數</th><th>儲值銀行卡</th><th>關聯訂單</th></tr></thead>
    <tbody>
      ${ledger.npay
        .slice()
        .reverse()
        .map(
          (row) => `<tr>
        <td>${esc(row.id)}</td>
        <td>${esc(row.date)}</td>
        <td>${esc(row.type)}</td>
        <td class="num">${row.credit ? krw(row.credit) : "—"}</td>
        <td class="num">${row.debit ? krw(row.debit) : "—"}</td>
        <td class="num">${krw(row.balance)}</td>
        <td>${esc(row.topUpCard || "—")}</td>
        <td>${esc(row.relatedOrderId || "—")}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table></div></section>`;
}

function renderCards(root) {
  const rows = ledger.cards.filter((row) => row.card === cardTab);
  const open = rows.filter((row) => !row.reconciled).reduce((sum, row) => sum + row.amount, 0);
  const all = rows.reduce((sum, row) => sum + row.amount, 0);
  root.innerHTML = `
    <div class="tabs">
      ${CARDS.map(
        (name) =>
          `<button class="btn ${name === cardTab ? "btn-primary" : ""}" data-card="${esc(name)}" type="button">${esc(name)}</button>`,
      ).join("")}
    </div>
    <div class="stats">
      <article class="stat"><div class="label">${esc(cardTab)} 合計</div><div class="value">${krw(all)}</div></article>
      <article class="stat"><div class="label">未對帳</div><div class="value">${krw(open)}</div></article>
    </div>
    <section class="panel">
      ${
        rows.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>單號</th><th>日期</th><th>類型</th><th class="num">金額</th><th>關聯</th><th>對帳</th></tr></thead>
        <tbody>
          ${rows
            .slice()
            .reverse()
            .map(
              (row) => `<tr>
            <td>${esc(row.id)}</td>
            <td>${esc(row.date)}</td>
            <td>${esc(row.type)}</td>
            <td class="num">${krw(row.amount)}</td>
            <td>${esc(row.relatedId)}</td>
            <td><button class="btn ${row.reconciled ? "" : "btn-primary"}" data-toggle="${esc(row.id)}" type="button">${row.reconciled ? "已對帳" : "未對帳"}</button></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table></div>`
          : `<p class="empty">${esc(cardTab)} 尚無刷卡紀錄</p>`
      }
    </section>
  `;
  root.querySelectorAll("[data-card]").forEach((btn) => {
    btn.onclick = () => {
      cardTab = btn.dataset.card;
      render();
    };
  });
  root.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const row = ledger.cards.find((itemRow) => itemRow.id === btn.dataset.toggle);
      if (!row) return;
      row.reconciled = !row.reconciled;
      ledger.seeded = false;
      save();
      render();
    };
  });
}

function renderSheets(root) {
  const tabs = ["商品明細", "購買訂單", "Npay歷程", "銀行卡明細"];
  const tables = {
    商品明細: sheetItems(),
    購買訂單: sheetOrders(),
    Npay歷程: sheetNpay(),
    銀行卡明細: sheetCards(),
  };
  root.innerHTML = `
    <div class="tabs">
      ${tabs
        .map(
          (name) =>
            `<button class="btn ${name === sheetTab ? "btn-primary" : ""}" data-sheet="${esc(name)}" type="button">${esc(name)}</button>`,
        )
        .join("")}
    </div>
    <section class="panel">
      <h2>將寫入 Google 試算表「${esc(sheetTab)}」</h2>
      ${tables[sheetTab]}
    </section>
  `;
  root.querySelectorAll("[data-sheet]").forEach((btn) => {
    btn.onclick = () => {
      sheetTab = btn.dataset.sheet;
      render();
    };
  });
}

function simpleTable(headers, rows, numIdx) {
  if (!rows.length) return `<p class="empty">此分頁尚無資料</p>`;
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map((h, i) => `<th class="${numIdx.includes(i) ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, i) =>
                  `<td class="${numIdx.includes(i) ? "num" : ""}">${esc(cell)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}
    </tbody>
  </table></div>`;
}

function sheetItems() {
  return simpleTable(
    ["明細號", "訂單號", "購買日", "店家", "商品名稱", "單價 KRW", "數量", "總金額"],
    ledger.items.map((row) => [
      row.id,
      row.orderId,
      row.date,
      row.shop,
      row.name,
      krw(row.unitPrice),
      row.quantity,
      krw(itemTotal(row)),
    ]),
    [5, 6, 7],
  );
}

function sheetOrders() {
  return simpleTable(
    ["訂單號", "購買日", "店家", "商品合計", "店家折扣", "實付", "Npay", "刷卡", "銀行卡"],
    ledger.orders.map((row) => [
      row.id,
      row.date,
      row.shop,
      krw(goodsTotal(row.id)),
      krw(row.storeDiscount),
      krw(row.npayUsed + row.cardAmount),
      krw(row.npayUsed),
      krw(row.cardAmount),
      row.card || "—",
    ]),
    [3, 4, 5, 6, 7],
  );
}

function sheetNpay() {
  return simpleTable(
    ["單號", "日期", "類型", "儲值", "扣除", "剩餘點數", "儲值銀行卡", "關聯訂單"],
    ledger.npay.map((row) => [
      row.id,
      row.date,
      row.type,
      row.credit ? krw(row.credit) : "—",
      row.debit ? krw(row.debit) : "—",
      krw(row.balance),
      row.topUpCard || "—",
      row.relatedOrderId || "—",
    ]),
    [3, 4, 5],
  );
}

function sheetCards() {
  return simpleTable(
    ["單號", "日期", "銀行卡", "類型", "金額 KRW", "關聯", "對帳"],
    ledger.cards.map((row) => [
      row.id,
      row.date,
      row.card,
      row.type,
      krw(row.amount),
      row.relatedId,
      row.reconciled ? "已對帳" : "未對帳",
    ]),
    [4],
  );
}

render();
