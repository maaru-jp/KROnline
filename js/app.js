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
  ["sync", "同步試算表"],
];

const SUB = {
  dashboard: "Npay 餘額、本月實付、各卡未對帳台幣",
  "new-purchase": "兩種記法：扣 Npay，或別家商品直接刷卡（韓幣＋手動台幣）",
  "npay-topup": "選卡並手動填台幣後，會自動寫入試算表",
  purchases: "點一筆訂單，看該筆完整商品明細；取消會補回 Npay 並記刷退",
  "npay-ledger": "儲值、扣除、取消訂單後的退款回補，每筆都留下剩餘點數",
  cards: "原刷卡與刷退都記韓幣與手動填的台幣，對到銀行帳單再勾已對帳",
  sheets: "試算表目前的資料",
  sync: "試算表是唯一帳本；這裡只記住連線網址",
  "order-detail": "這一筆的全部商品、折扣、Npay 與刷卡；取消會補回點數並記刷退",
};

function emptyLedger() {
  return { items: [], orders: [], npay: [], cards: [] };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function krw(n) {
  return `₩${Number(n || 0).toLocaleString("ko-KR")}`;
}

function twd(n) {
  return `NT$${Number(n || 0).toLocaleString("zh-TW")}`;
}

function fxText(rate) {
  const n = Number(rate || 0);
  if (!n) return "—";
  return String(Math.round(n * 1e6) / 1e6);
}

function roundRate(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

function derivedFxRate(krwAmt, twdAmt) {
  const krwVal = Number(krwAmt || 0);
  const twdVal = Number(twdAmt || 0);
  if (!(krwVal > 0) || !(twdVal > 0)) return 0;
  return roundRate(twdVal / krwVal);
}

function cardTwdForOrder(orderId) {
  return ledger.cards
    .filter((row) => row.relatedId === orderId && !isCardRefund(row.type))
    .reduce((sum, row) => sum + Number(row.amountTwd || 0), 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function isCardRefund(type) {
  return type === "刷退" || type === "訂單取消退款";
}

function cancelActions(row) {
  return [row.npayUsed ? "補回 Npay" : "", row.cardAmount ? "記刷退" : ""].filter(Boolean);
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

let ledger = emptyLedger();
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
const topupForm = { date: today(), amount: "", card: "富邦", amountTwd: "" };

function blankPurchase() {
  return {
    date: today(),
    shop: "Coupang",
    discount: "0",
    payMethod: "npay",
    npay: "0",
    cardAmount: "0",
    cardTwd: "",
    card: "中信",
    note: "",
    items: [{ name: "", unitPrice: "", quantity: "1" }],
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
    sync: renderSync,
    "order-detail": renderOrderDetail,
  };
  pages[view](root);
}

let lastErrorView = "";
let lastOkView = "";
let writeLock = false;
let topupWriteTimer = 0;
let purchaseWriteTimer = 0;
let sheetInfo = null;

function renderNav() {
  const active = view === "order-detail" ? "purchases" : view;
  document.getElementById("nav").innerHTML = NAV.map(
    ([id, label]) =>
      `<button type="button" data-view="${id}" class="${id === active ? "is-active" : ""}">${esc(label)}</button>`,
  ).join("");
  document.querySelectorAll("#nav [data-view]").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.view;
      if (next !== "sync" && !SheetsSync.configured()) {
        view = "sync";
        notice = SheetsSync.urlHint() || "請先接上試算表。要貼的是 Apps Script 的 /exec 網址，不是試算表連結。";
        render();
        return;
      }
      view = next;
      notice = "";
      render();
    };
  });
}

function rememberSheetInfo(result) {
  if (!result) return;
  if (result.spreadsheet || result.url || result.sheets || result.version) {
    sheetInfo = {
      spreadsheet: result.spreadsheet || sheetInfo?.spreadsheet || "",
      url: result.url || sheetInfo?.url || "",
      version: result.version || sheetInfo?.version || "",
      sheets: result.sheets || sheetInfo?.sheets || [],
    };
  }
}

function sheetInfoHtml() {
  if (!sheetInfo?.spreadsheet) return "";
  const old = sheetInfo.version !== "write-v2";
  const counts = (sheetInfo.sheets || [])
    .map((row) => `${esc(row.name)} ${row.rows} 列`)
    .join("、");
  return `<p class="muted">目前連到：<strong>${esc(sheetInfo.spreadsheet)}</strong>${
    sheetInfo.url ? `　<a href="${esc(sheetInfo.url)}" target="_blank" rel="noopener">打開試算表</a>` : ""
  }${counts ? `<br>分頁：${counts}` : ""}${
    old ? `<br>這還是舊版程式，登記寫不進去。請把最新 Code.gs 貼上後，部署「新版本」。` : ""
  }</p>`;
}

function renderBanner() {
  const el = document.getElementById("banner");
  if (!SheetsSync.configured()) {
    el.innerHTML = `<div class="banner">記帳資料只存在 Google 試算表。請先完成右側連線，之後在網頁登記就會直接寫入試算表。</div>`;
  } else if (notice) {
    el.innerHTML = `<div class="banner">${esc(notice)}</div>`;
  } else {
    el.innerHTML = "";
  }
}

function renderTopbar() {
  const box = document.getElementById("topbar-actions");
  box.innerHTML = `
    <button class="btn" type="button" id="btn-reload">重新載入試算表</button>
  `;
  document.getElementById("btn-reload").onclick = () => boot(view);
}

function renderDashboard(root) {
  const now = today().slice(0, 7);
  const monthPay = ledger.orders
    .filter((row) => monthKey(row.date) === now && row.status !== "已取消")
    .reduce((sum, row) => sum + row.npayUsed + row.cardAmount, 0);
  root.innerHTML = `
    ${sheetInfoHtml()}
    <div class="stats">
      <article class="stat accent"><div class="label">Npay 剩餘</div><div class="value">${krw(npayBalance())}</div></article>
      <article class="stat"><div class="label">${esc(now)} 實付</div><div class="value">${krw(monthPay)}</div></article>
      ${CARDS.map((name) => {
        const openRows = ledger.cards.filter((row) => row.card === name && !row.reconciled);
        const openKrw = openRows.reduce((sum, row) => sum + row.amount, 0);
        const openTwd = openRows.reduce((sum, row) => sum + Number(row.amountTwd || 0), 0);
        return `<article class="stat"><div class="label">${esc(name)} 未對帳</div><div class="value">${twd(openTwd)}</div><div class="sub">${krw(openKrw)}</div></article>`;
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
          const cancelled = row.status === "已取消";
          const pay = row.npayUsed + row.cardAmount;
          const payText = cancelled
            ? "已取消"
            : [
                row.npayUsed ? `Npay ${krw(row.npayUsed)}` : "",
                row.cardAmount
                  ? `${row.card || "刷卡"} ${krw(row.cardAmount)}${cardTwdForOrder(row.id) ? `／${twd(cardTwdForOrder(row.id))}` : ""}`
                  : "",
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
  applyPayMethod();
  const cardMode = purchaseForm.payMethod === "card";
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
        <h2>怎麼付</h2>
        <div class="tabs" style="margin-bottom:14px">
          <button class="btn ${cardMode ? "" : "btn-primary"}" type="button" id="pay-npay">扣 Npay 點數</button>
          <button class="btn ${cardMode ? "btn-primary" : ""}" type="button" id="pay-card">直接刷卡</button>
        </div>
        <div class="totals" id="p-totals"></div>
        ${
          cardMode
            ? `<div class="form-grid" style="margin-top:12px">
          <label class="field">共刷韓幣
            <input type="number" min="0" id="p-card-amt" value="${esc(purchaseForm.cardAmount)}" />
          </label>
          <label class="field">刷哪張卡
            <select id="p-card">${CARDS.map(
              (c) =>
                `<option ${purchaseForm.card === c ? "selected" : ""}>${esc(c)}</option>`,
            ).join("")}</select>
          </label>
          <label class="field field-span">台幣金額（手動填）
            <input type="number" min="0" step="1" id="p-card-twd" value="${esc(purchaseForm.cardTwd)}" placeholder="帳單上的台幣" />
          </label>
        </div>
        <p class="muted">別家商品直接刷卡：韓幣預設等於實付，台幣請自己填。填完台幣會自動寫入試算表。</p>`
            : `<p class="muted" style="margin-top:12px">用 Npay 扣掉實付韓幣，不記刷卡。商品填完後會自動寫入試算表。</p>`
        }
        <p class="error" id="p-error">${formError ? esc(formError) : ""}</p>
        <p class="ok-msg" id="p-ok">${formOk ? esc(formOk) : ""}</p>
        <div class="item-actions">
          <button class="btn btn-primary" type="button" id="save-purchase">立即寫入試算表</button>
          ${lastSavedOrderId ? `<button class="btn" type="button" id="open-last">查看 ${esc(lastSavedOrderId)} 完整明細</button>` : ""}
        </div>
      </section>
    </div>
  `;
  paintItemRows();
  paintPurchaseTotals();
  const keep = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = (e) => {
      purchaseForm[key] = e.target.value;
    };
  };
  keep("p-date", "date");
  keep("p-shop", "shop");
  keep("p-note", "note");
  document.getElementById("p-discount").oninput = (e) => {
    purchaseForm.discount = e.target.value;
    applyPayMethod();
    syncPayInputs();
    paintPurchaseTotals();
    maybeQueuePurchaseWrite();
  };
  document.getElementById("pay-npay").onclick = () => {
    syncItemInputs();
    purchaseForm.payMethod = "npay";
    applyPayMethod();
    render();
  };
  document.getElementById("pay-card").onclick = () => {
    syncItemInputs();
    purchaseForm.payMethod = "card";
    applyPayMethod();
    render();
  };
  const cardAmtEl = document.getElementById("p-card-amt");
  if (cardAmtEl) {
    cardAmtEl.oninput = (e) => {
      purchaseForm.cardAmount = e.target.value;
      purchaseForm.npay = "0";
      paintPurchaseTotals();
    };
  }
  const cardTwdEl = document.getElementById("p-card-twd");
  if (cardTwdEl) {
    cardTwdEl.oninput = (e) => {
      purchaseForm.cardTwd = e.target.value;
      paintPurchaseTotals();
      maybeQueuePurchaseWrite();
    };
    cardTwdEl.onblur = () => maybeQueuePurchaseWrite();
    cardTwdEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        savePurchase();
      }
    };
  }
  const cardEl = document.getElementById("p-card");
  if (cardEl) {
    cardEl.onchange = (e) => {
      purchaseForm.card = e.target.value;
      maybeQueuePurchaseWrite();
    };
  }
  document.getElementById("add-item").onclick = () => {
    syncItemInputs();
    purchaseForm.items.push({ name: "", unitPrice: "", quantity: "1" });
    paintItemRows();
    applyPayMethod();
    syncPayInputs();
    paintPurchaseTotals();
  };
  document.getElementById("save-purchase").onclick = () => savePurchase();
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
      applyPayMethod();
      const total = Number(purchaseForm.items[i].unitPrice || 0) * Number(purchaseForm.items[i].quantity || 0);
      tbody.querySelector(`[data-total="${i}"]`).textContent = krw(total);
      syncPayInputs();
      paintPurchaseTotals();
      maybeQueuePurchaseWrite();
    };
  });
  tbody.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = () => {
      if (purchaseForm.items.length === 1) return;
      syncItemInputs();
      purchaseForm.items.splice(Number(el.dataset.del), 1);
      applyPayMethod();
      paintItemRows();
      syncPayInputs();
      paintPurchaseTotals();
      maybeQueuePurchaseWrite();
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
  const cardMode = purchaseForm.payMethod === "card";
  box.innerHTML = `
    <div><span>商品合計</span><span>${krw(goods)}</span></div>
    <div><span>店家折扣</span><span>− ${krw(discount)}</span></div>
    <div class="pay"><span>實付韓幣</span><span>${krw(payable)}</span></div>
    ${
      cardMode
        ? `<div><span>刷卡 ${esc(purchaseForm.card || "卡")}</span><span>${krw(cardAmt)}${cardAmt === payable ? "" : "（需等於實付）"}</span></div>
    <div><span>台幣（手動）</span><span>${purchaseForm.cardTwd ? twd(Number(purchaseForm.cardTwd)) : "尚未填"}</span></div>`
        : `<div><span>Npay 扣除</span><span>${krw(npayAmt)}</span></div>
    <div><span>目前 Npay 餘額</span><span>${krw(npayBalance())}</span></div>
    <div><span>送出後 Npay</span><span class="${remain < 0 ? "debit" : ""}">${remain < 0 ? "餘額不足" : krw(remain)}</span></div>`
    }
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

function applyPayMethod() {
  const payable = Math.max(0, calcPayable());
  if (purchaseForm.payMethod === "card") {
    purchaseForm.npay = "0";
    purchaseForm.cardAmount = String(payable);
  } else {
    purchaseForm.payMethod = "npay";
    purchaseForm.npay = String(payable);
    purchaseForm.cardAmount = "0";
  }
}

function syncPayInputs() {
  const cardEl = document.getElementById("p-card-amt");
  const twdEl = document.getElementById("p-card-twd");
  if (cardEl) cardEl.value = purchaseForm.cardAmount;
  if (twdEl) twdEl.value = purchaseForm.cardTwd;
}

async function savePurchase(opts = {}) {
  const auto = !!opts.auto;
  if (writeLock) return;
  if (auto && view !== "new-purchase") return;
  lastErrorView = "new-purchase";
  lastOkView = "new-purchase";
  formOk = "";
  syncItemInputs();
  const dateEl = document.getElementById("p-date");
  if (dateEl) {
    purchaseForm.date = dateEl.value;
    purchaseForm.shop = document.getElementById("p-shop").value;
    purchaseForm.discount = document.getElementById("p-discount").value;
    purchaseForm.note = document.getElementById("p-note").value;
    const cardAmtEl = document.getElementById("p-card-amt");
    const cardEl = document.getElementById("p-card");
    const twdEl = document.getElementById("p-card-twd");
    if (cardAmtEl) purchaseForm.cardAmount = cardAmtEl.value;
    if (cardEl) purchaseForm.card = cardEl.value;
    if (twdEl) purchaseForm.cardTwd = twdEl.value;
  }
  const items = purchaseForm.items
    .map((row) => ({
      name: row.name.trim(),
      unitPrice: Number(row.unitPrice),
      quantity: Number(row.quantity),
    }))
    .filter((row) => row.name || row.unitPrice || row.quantity !== 1);

  const skip = (message) => (auto ? undefined : fail(message));
  if (!purchaseForm.date) return skip("請填購買日期");
  if (!purchaseForm.shop.trim()) return skip("請填店家");
  if (!items.length) return skip("請至少登一件商品");
  for (const row of items) {
    if (!row.name) return skip("商品名稱為必填");
    if (!(row.unitPrice > 0)) return skip("單價必須大於 0");
    if (!Number.isInteger(row.quantity) || row.quantity < 1)
      return skip("數量必須是正整數");
  }
  const goods = items.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0);
  const discount = Number(purchaseForm.discount || 0);
  if (discount < 0 || discount > goods) return skip("店家折扣需介於 0 與商品合計之間");
  const payable = goods - discount;
  const cardMode = purchaseForm.payMethod === "card";
  const npayUsed = cardMode ? 0 : payable;
  const cardAmount = cardMode ? Number(purchaseForm.cardAmount || payable) : 0;
  if (npayUsed + cardAmount !== payable)
    return skip(`實付 ${krw(payable)} 必須等於 ${cardMode ? "刷卡韓幣" : "Npay"}`);
  if (npayUsed > npayBalance())
    return fail(`Npay 餘額不足，目前 ${krw(npayBalance())}`);
  if (cardMode && !purchaseForm.card) return skip("刷卡時請選擇富邦或中信");
  const cardTwdAmt = Number(purchaseForm.cardTwd || 0);
  if (cardMode && !(cardTwdAmt > 0)) return skip("刷卡請手動填台幣金額");
  if (auto && cardMode && !(cardAmount > 0 && cardTwdAmt > 0)) return;
  if (auto && !cardMode && !(npayUsed > 0)) return;
  const fxRate = cardAmount > 0 ? derivedFxRate(cardAmount, cardTwdAmt) : 0;
  if (!SheetsSync.configured()) return fail(SheetsSync.urlHint() || "請先到「同步試算表」貼上 Apps Script 的 /exec 網址");

  writeLock = true;
  const beforeCount = ledger.orders.length;
  formError = "";
  formOk = "正在寫入 Google 試算表…";
  render();
  try {
    const result = await SheetsSync.pushPurchase({
      order: {
        date: purchaseForm.date,
        shop: purchaseForm.shop.trim(),
        storeDiscount: discount,
        npayUsed,
        cardAmount,
        card: cardAmount > 0 ? purchaseForm.card : "",
        fxRate: cardAmount > 0 ? fxRate : 0,
        cardTwd: cardAmount > 0 ? cardTwdAmt : 0,
        note: purchaseForm.note.trim(),
      },
      items,
    });
    const loaded = await refreshFromSheets();
    if (!result.ok && !result.opaque) return fail(SheetsSync.label(result));
    if (!loaded.ok) return fail(loaded.error || "已送出，但無法從試算表讀回");
    if (result.opaque && ledger.orders.length <= beforeCount) {
      return fail("試算表沒有新增列。請把最新 Code.gs 貼上後，部署新版本，存取對象選「任何人」。");
    }
    if (ledger.orders.length <= beforeCount) {
      return fail("連線到了，但試算表沒有新列。請把最新 Code.gs 貼上後再部署一次新版本。");
    }
    Object.assign(purchaseForm, blankPurchase());
    lastSavedOrderId = result.orderId || ledger.orders[ledger.orders.length - 1]?.id || "";
    formError = "";
    formOk = `已寫入試算表${lastSavedOrderId ? " " + lastSavedOrderId : ""}，實付 ${krw(payable)}${
      cardAmount > 0 ? `，刷卡 ${krw(cardAmount)}／${twd(cardTwdAmt)}` : `，Npay ${krw(npayUsed)}`
    }。Npay 剩餘 ${krw(npayBalance())}。`;
    lastOkView = "new-purchase";
    render();
  } finally {
    writeLock = false;
  }
}

function fail(message) {
  writeLock = false;
  formError = message;
  formOk = "";
  render();
}

function maybeQueuePurchaseWrite() {
  if (purchaseForm.payMethod === "card") {
    if (!(Number(purchaseForm.cardAmount) > 0) || !(Number(purchaseForm.cardTwd) > 0)) return;
  } else if (!(Number(purchaseForm.npay) > 0)) {
    return;
  }
  clearTimeout(purchaseWriteTimer);
  purchaseWriteTimer = setTimeout(() => savePurchase({ auto: true }), 900);
}

function maybeQueueTopupWrite() {
  if (!topupForm.date || !(Number(topupForm.amount) > 0) || !topupForm.card || !(Number(topupForm.amountTwd) > 0)) {
    return;
  }
  clearTimeout(topupWriteTimer);
  topupWriteTimer = setTimeout(() => saveTopup({ auto: true }), 900);
}

function renderTopup(root) {
  root.innerHTML = `
    <section class="panel" style="max-width:520px">
      <h2>買 Npay 點數</h2>
      <div class="form-grid">
        <label class="field">日期
          <input type="date" id="t-date" value="${esc(topupForm.date)}" />
        </label>
        <label class="field">儲值韓幣
          <input type="number" min="1" id="t-amt" value="${esc(topupForm.amount)}" />
        </label>
        <label class="field">儲值用銀行卡
          <select id="t-card">${CARDS.map(
            (c) => `<option ${topupForm.card === c ? "selected" : ""}>${esc(c)}</option>`,
          ).join("")}</select>
        </label>
        <label class="field">台幣金額（手動填）
          <input type="number" min="0" step="1" id="t-twd" value="${esc(topupForm.amountTwd)}" placeholder="帳單上的台幣" />
        </label>
      </div>
      <p class="muted">選卡並手動填台幣後會自動寫入試算表（Npay 歷程 + 該卡明細）。也可按下方按鈕立即寫入。</p>
      <p>儲值前餘額 <strong>${krw(npayBalance())}</strong>${Number(topupForm.amount) > 0 && Number(topupForm.amountTwd) > 0 ? `　刷卡 ${krw(topupForm.amount)}／${twd(topupForm.amountTwd)}` : ""}</p>
      ${formError && view === "npay-topup" ? `<p class="error">${esc(formError)}</p>` : ""}
      ${formOk && view === "npay-topup" ? `<p class="ok-msg">${esc(formOk)}</p>` : ""}
      <div class="item-actions">
        <button class="btn btn-primary" type="button" id="save-topup">立即寫入試算表</button>
      </div>
    </section>
  `;
  document.getElementById("t-date").oninput = (e) => {
    topupForm.date = e.target.value;
    maybeQueueTopupWrite();
  };
  document.getElementById("t-amt").oninput = (e) => {
    topupForm.amount = e.target.value;
    maybeQueueTopupWrite();
  };
  document.getElementById("t-twd").oninput = (e) => {
    topupForm.amountTwd = e.target.value;
    maybeQueueTopupWrite();
  };
  document.getElementById("t-twd").onblur = () => maybeQueueTopupWrite();
  document.getElementById("t-twd").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTopup();
    }
  };
  document.getElementById("t-card").onchange = (e) => {
    topupForm.card = e.target.value;
    maybeQueueTopupWrite();
  };
  document.getElementById("save-topup").onclick = () => saveTopup();
}

async function saveTopup(opts = {}) {
  const auto = !!opts.auto;
  if (writeLock) return;
  if (auto && view !== "npay-topup") return;
  lastErrorView = "npay-topup";
  lastOkView = "npay-topup";
  const dateEl = document.getElementById("t-date");
  if (dateEl) {
    topupForm.date = dateEl.value;
    topupForm.amount = document.getElementById("t-amt").value;
    topupForm.card = document.getElementById("t-card").value;
    topupForm.amountTwd = document.getElementById("t-twd").value;
  }
  const amount = Number(topupForm.amount);
  const amountTwd = Number(topupForm.amountTwd || 0);
  const skip = (message) => (auto ? undefined : fail(message));
  if (!topupForm.date) return skip("請填日期");
  if (!(amount > 0)) return skip("儲值金額必須大於 0");
  if (!(amountTwd > 0)) return skip("請手動填台幣金額");
  const fxRate = derivedFxRate(amount, amountTwd);
  if (!SheetsSync.configured()) return fail(SheetsSync.urlHint() || "請先到「同步試算表」貼上 Apps Script 的 /exec 網址");
  writeLock = true;
  const before = ledger.npay.length;
  formError = "";
  formOk = "正在寫入 Google 試算表…";
  render();
  try {
    const result = await SheetsSync.pushTopup({
      date: topupForm.date,
      amount,
      card: topupForm.card,
      fxRate,
      amountTwd,
    });
    const loaded = await refreshFromSheets();
    if (!result.ok && !result.opaque) return fail(SheetsSync.label(result));
    if (!loaded.ok) return fail(loaded.error || "已送出，但無法從試算表讀回");
    if (result.opaque && ledger.npay.length <= before) {
      return fail("試算表沒有新增列。請把最新 Code.gs 貼上後，部署新版本，存取對象選「任何人」。");
    }
    if (ledger.npay.length <= before) {
      return fail("連線到了，但試算表沒有新列。請把最新 Code.gs 貼上後再部署一次新版本。");
    }
    topupForm.amount = "";
    topupForm.amountTwd = "";
    formOk = `已寫入試算表，儲值 ${krw(amount)}／${twd(amountTwd)}，Npay 剩餘 ${krw(npayBalance())}，記入 ${topupForm.card}。`;
    render();
  } finally {
    writeLock = false;
  }
}

function renderPurchases(root) {
  if (!ledger.orders.length) {
    root.innerHTML = `<p class="empty">尚無購買紀錄</p>`;
    return;
  }
  root.innerHTML = `<section class="panel">
    <h2>選擇一筆訂單</h2>
    <p class="muted" style="margin:-6px 0 14px">點訂單編號、整列或「完整明細」，只看該筆全部商品。取消訂單會補回 Npay，有刷卡也會另記刷退。</p>
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
      ${
        row.status === "已取消"
          ? ""
          : `<button class="btn btn-danger" type="button" id="cancel-order">取消訂單${cancelActions(row).length ? "並" + cancelActions(row).join("／") : ""}</button>`
      }
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>${esc(row.id)}　${esc(row.shop)}${row.status === "已取消" ? "　已取消" : ""}</h2>
        <p class="muted">購買日 ${esc(row.date)}${row.note ? `　備註 ${esc(row.note)}` : ""}${row.status === "已取消" ? "　已取消：Npay 退款回補與刷退都會另開新單，舊列保留方便對帳" : ""}</p>
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
          <div><span>${esc(row.card || "刷卡")}</span><span>${krw(row.cardAmount)}${cardTwdForOrder(row.id) ? `／${twd(cardTwdForOrder(row.id))}` : ""}</span></div>
        </div>
        ${
          npayRows.length
            ? `<h2 style="margin-top:18px">Npay 歷程</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>日期</th><th>類型</th><th class="num">儲值／補回</th><th class="num">扣除</th><th class="num">剩餘點數</th></tr></thead>
            <tbody>${npayRows
              .map(
                (entry) => `<tr>
              <td>${esc(entry.date)}</td>
              <td>${esc(entry.type)}</td>
              <td class="num">${entry.credit ? krw(entry.credit) : "—"}</td>
              <td class="num">${entry.debit ? krw(entry.debit) : "—"}</td>
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
            <thead><tr><th>日期</th><th>卡</th><th>類型</th><th class="num">韓幣</th><th class="num">匯率</th><th class="num">台幣</th><th>對帳</th></tr></thead>
            <tbody>${cardRows
              .map(
                (entry) => `<tr>
              <td>${esc(entry.date)}</td>
              <td>${esc(entry.card)}</td>
              <td>${esc(entry.type)}</td>
              <td class="num ${entry.amount < 0 ? "credit" : ""}">${krw(entry.amount)}</td>
              <td class="num">${fxText(entry.fxRate)}</td>
              <td class="num ${entry.amountTwd < 0 ? "credit" : ""}">${entry.amountTwd ? twd(entry.amountTwd) : "—"}</td>
              <td>${entry.reconciled ? "已對帳" : "未對帳"}</td>
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
  const cancelBtn = document.getElementById("cancel-order");
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      const lines = [`確定取消 ${row.id}？`];
      if (row.npayUsed) {
        lines.push(`Npay 將補回 ${krw(row.npayUsed)}。舊的「消費扣除」列會保留，另外新增「退款回補」。`);
      }
      if (row.cardAmount) {
        lines.push(`${row.card || "信用卡"} 將新增一筆刷退 ${krw(row.cardAmount)}${cardTwdForOrder(row.id) ? `／${twd(cardTwdForOrder(row.id))}` : ""}，方便對銀行帳單。原刷卡列會保留。`);
      }
      if (!row.npayUsed && !row.cardAmount) {
        lines.push("這筆沒有扣 Npay 也沒有刷卡。");
      }
      if (!confirm(lines.join("\n"))) {
        return;
      }
      notice = "正在取消訂單並寫入退款／刷退…";
      render();
      const result = await SheetsSync.cancelOrder(row.id);
      const loaded = await refreshFromSheets();
      if (!result.ok && !result.opaque) {
        notice = result.error || "取消失敗";
        render();
        return;
      }
      if (!loaded.ok) {
        notice = loaded.error || "已送出取消，但無法從試算表讀回";
        render();
        return;
      }
      const updated = ledger.orders.find((item) => item.id === row.id);
      if (!updated || updated.status !== "已取消") {
        notice =
          result.error ||
          "取消失敗。請把 Code.gs 貼上最新內容後，在 Apps Script 部署新版本，再取消一次。";
        render();
        return;
      }
      const restored =
        Number(result.npayRestored) ||
        ledger.npay
          .filter((entry) => entry.relatedOrderId === row.id && entry.type === "退款回補")
          .reduce((sum, entry) => sum + (entry.credit || 0), 0);
      const cardRefunded =
        Number(result.cardRefunded) ||
        ledger.cards
          .filter((entry) => entry.relatedId === row.id && isCardRefund(entry.type))
          .reduce((sum, entry) => sum + Math.abs(entry.amount || 0), 0);
      const cardRefundTwd =
        Number(result.cardRefundedTwd) ||
        ledger.cards
          .filter((entry) => entry.relatedId === row.id && isCardRefund(entry.type))
          .reduce((sum, entry) => sum + Math.abs(entry.amountTwd || 0), 0);
      const parts = [`已取消 ${row.id}`];
      if (restored) parts.push(`Npay 補回 ${krw(restored)}，目前剩餘 ${krw(npayBalance())}`);
      if (cardRefunded) {
        parts.push(
          `${result.card || row.card || "信用卡"} 已記刷退 ${krw(cardRefunded)}${cardRefundTwd ? `／${twd(cardRefundTwd)}` : ""}`,
        );
      }
      notice = `${parts[0]}${parts.length > 1 ? "，" + parts.slice(1).join("；") : ""}。`;
      render();
    };
  }
}

function renderNpay(root) {
  if (!ledger.npay.length) {
    root.innerHTML = `<p class="empty">尚無 Npay 歷程</p>`;
    return;
  }
  root.innerHTML = `<section class="panel"><div class="table-wrap"><table>
    <thead><tr><th>單號</th><th>日期</th><th>類型</th><th class="num">儲值／補回</th><th class="num">扣除</th><th class="num">剩餘點數</th><th>儲值銀行卡</th><th>關聯訂單</th></tr></thead>
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
        <td>${row.relatedOrderId ? orderLink(row.relatedOrderId) : "—"}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table></div></section>`;
  bindOrderLinks(root);
}

function renderCards(root) {
  const rows = ledger.cards.filter((row) => row.card === cardTab);
  const openRows = rows.filter((row) => !row.reconciled);
  const openKrw = openRows.reduce((sum, row) => sum + row.amount, 0);
  const openTwd = openRows.reduce((sum, row) => sum + Number(row.amountTwd || 0), 0);
  const allKrw = rows.reduce((sum, row) => sum + row.amount, 0);
  const allTwd = rows.reduce((sum, row) => sum + Number(row.amountTwd || 0), 0);
  root.innerHTML = `
    <div class="tabs">
      ${CARDS.map(
        (name) =>
          `<button class="btn ${name === cardTab ? "btn-primary" : ""}" data-card="${esc(name)}" type="button">${esc(name)}</button>`,
      ).join("")}
    </div>
    <div class="stats">
      <article class="stat"><div class="label">${esc(cardTab)} 合計韓幣</div><div class="value">${krw(allKrw)}</div></article>
      <article class="stat"><div class="label">${esc(cardTab)} 合計台幣</div><div class="value">${twd(allTwd)}</div></article>
      <article class="stat"><div class="label">未對帳台幣</div><div class="value">${twd(openTwd)}</div><div class="sub">${krw(openKrw)}</div></article>
      <article class="stat"><div class="label">未對帳筆數</div><div class="value">${openRows.length}</div></article>
    </div>
    <section class="panel">
      ${
        rows.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>單號</th><th>日期</th><th>類型</th><th class="num">韓幣</th><th class="num">匯率</th><th class="num">台幣</th><th>關聯</th><th>對帳</th></tr></thead>
        <tbody>
          ${rows
            .slice()
            .reverse()
            .map(
              (row) => `<tr>
            <td>${esc(row.id)}</td>
            <td>${esc(row.date)}</td>
            <td>${esc(row.type)}</td>
            <td class="num ${row.amount < 0 ? "credit" : ""}">${krw(row.amount)}</td>
            <td class="num">${fxText(row.fxRate)}</td>
            <td class="num ${row.amountTwd < 0 ? "credit" : ""}">${row.amountTwd ? twd(row.amountTwd) : "—"}</td>
            <td>${isOrderId(row.relatedId) ? orderLink(row.relatedId) : esc(row.relatedId || "—")}</td>
            <td><button class="btn ${row.reconciled ? "" : "btn-primary"}" data-toggle="${esc(row.id)}" type="button">${row.reconciled ? "已對帳" : "未對帳"}</button></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table></div>`
          : `<p class="empty">${esc(cardTab)} 尚無刷卡／刷退紀錄</p>`
      }
    </section>
  `;
  bindOrderLinks(root);
  root.querySelectorAll("[data-card]").forEach((btn) => {
    btn.onclick = () => {
      cardTab = btn.dataset.card;
      render();
    };
  });
  root.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = async () => {
      const row = ledger.cards.find((itemRow) => itemRow.id === btn.dataset.toggle);
      if (!row) return;
      const result = await SheetsSync.reconcile(row.id, !row.reconciled);
      if (!result.ok && !result.opaque) {
        notice = result.error || "對帳狀態寫入失敗";
        render();
        return;
      }
      await refreshFromSheets();
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
      <h2>Google 試算表「${esc(sheetTab)}」目前資料</h2>
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
    ["訂單號", "購買日", "店家", "商品合計", "店家折扣", "實付", "Npay", "刷卡", "銀行卡", "狀態"],
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
      row.status || "正常",
    ]),
    [3, 4, 5, 6, 7],
  );
}

function sheetNpay() {
  return simpleTable(
    ["單號", "日期", "類型", "儲值／補回", "扣除", "剩餘點數", "儲值銀行卡", "關聯訂單"],
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
    ["單號", "日期", "銀行卡", "類型", "韓幣", "匯率", "台幣", "關聯", "對帳"],
    ledger.cards.map((row) => [
      row.id,
      row.date,
      row.card,
      row.type,
      krw(row.amount),
      fxText(row.fxRate),
      row.amountTwd ? twd(row.amountTwd) : "—",
      row.relatedId,
      row.reconciled ? "已對帳" : "未對帳",
    ]),
    [4, 5, 6],
  );
}

function renderSync(root) {
  const url = SheetsSync.getUrl();
  const secret = SheetsSync.getSecret();
  const ready = SheetsSync.configured();
  const urlHint = SheetsSync.urlHint(url);
  root.innerHTML = `
    <div class="grid-2">
      <section class="panel">
        <h2>部署步驟（做一次即可）</h2>
        <ol class="steps">
          <li>開一份 Google 試算表，建立五個工作表：<strong>商品明細、購買訂單、Npay歷程、銀行卡明細、設定</strong>。</li>
          <li>試算表選單：<strong>擴充功能 → Apps Script</strong>。</li>
          <li>刪掉預設內容，貼上專案裡 <code>apps-script/Code.gs</code> 的全部程式，按儲存。</li>
          <li>在編輯器選 <code>doGet</code>，按「執行」，允許存取這份試算表。</li>
          <li>右上角 <strong>部署 → 新部署</strong>。類型選「網頁應用程式」。執行身分選「我」，存取對象選「任何人」（即使未登入也可以）。</li>
          <li>複製的網址必須是 <code>https://script.google.com/macros/s/…/exec</code>。<strong>不要貼試算表本身的 docs.google.com 連結</strong>，那個不能寫入。</li>
          <li>貼到右邊、儲存，再按「測試連線」。成功後，登記才會寫進試算表。</li>
        </ol>
        <p class="muted">若之後改過程式，必須再「部署 → 管理部署 → 編輯 → 新版本」，網址才會用到新程式。</p>
      </section>
      <section class="panel">
        <h2>本機連線</h2>
        <p class="muted">這裡要貼的是 Apps Script 部署網址，不是試算表分享連結。</p>
        <div class="form-grid">
          <label class="field field-span">Apps Script 網頁應用程式網址
            <input id="sync-url" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec" />
          </label>
          <label class="field field-span">密鑰（選填，須與 Script 屬性 WEBPASS 相同）
            <input id="sync-secret" value="${esc(secret)}" placeholder="沒有設定可留空" />
          </label>
        </div>
        <p class="error" id="sync-error">${urlHint && url ? esc(urlHint) : ""}</p>
        <p class="ok-msg" id="sync-ok">${ready && !urlHint ? "已記住部署網址。請按測試連線，不要急著去看試算表。" : ""}</p>
        <div id="sync-detail"></div>
        <div class="item-actions">
          <button class="btn btn-primary" type="button" id="sync-save">儲存設定</button>
          <button class="btn" type="button" id="sync-ping">測試連線</button>
          <button class="btn" type="button" id="sync-write">寫入測試列</button>
        </div>
      </section>
    </div>
  `;
  const showUrlState = () => {
    const next = document.getElementById("sync-url").value;
    const hint = SheetsSync.urlHint(next);
    const err = document.getElementById("sync-error");
    const ok = document.getElementById("sync-ok");
    if (hint) {
      err.textContent = hint;
      ok.textContent = "";
    } else {
      err.textContent = "";
    }
  };
  document.getElementById("sync-url").oninput = showUrlState;
  document.getElementById("sync-save").onclick = () => {
    const next = document.getElementById("sync-url").value;
    const hint = SheetsSync.urlHint(next);
    const err = document.getElementById("sync-error");
    const ok = document.getElementById("sync-ok");
    if (hint) {
      err.textContent = hint;
      ok.textContent = "";
      return;
    }
    SheetsSync.saveConfig(next, document.getElementById("sync-secret").value);
    err.textContent = "";
    ok.textContent = "已記住部署網址，請按測試連線。";
    const detail = document.getElementById("sync-detail");
    if (detail) detail.innerHTML = "";
    notice = "";
  };
  const paintPing = (result, extraMsg) => {
    rememberSheetInfo(result);
    const err = document.getElementById("sync-error");
    const ok = document.getElementById("sync-ok");
    const detail = document.getElementById("sync-detail");
    const old = result.version !== "write-v2";
    const rows = (result.sheets || [])
      .map((row) => `<li>${esc(row.name)}：${esc(String(row.rows))} 列</li>`)
      .join("");
    ok.textContent = extraMsg || (result.spreadsheet ? `連線成功：${result.spreadsheet}` : "連線成功");
    err.textContent = old
      ? "這還是舊版程式，所以試算表不會出現新資料。請把專案裡最新的 Code.gs 全部貼上，再部署「新版本」。"
      : "";
    detail.innerHTML = `
      ${result.url ? `<p><a href="${esc(result.url)}" target="_blank" rel="noopener">打開目前連到的這份試算表</a></p>` : ""}
      <p class="muted">資料在這些分頁：<strong>商品明細、購買訂單、Npay歷程、銀行卡明細、設定</strong>。不要只看「工作表1」。</p>
      ${rows ? `<ul class="steps">${rows}</ul>` : "<p class='muted'>還沒讀到分頁清單，多半是舊版程式。</p>"}
      ${old ? "" : "<p class='muted'>若列數都是 0，請按「寫入測試列」。成功後「設定」分頁會多一列「連線測試」。</p>"}
    `;
  };
  document.getElementById("sync-ping").onclick = async () => {
    const next = document.getElementById("sync-url").value;
    const hint = SheetsSync.urlHint(next);
    const err = document.getElementById("sync-error");
    const ok = document.getElementById("sync-ok");
    const detail = document.getElementById("sync-detail");
    if (hint) {
      err.textContent = hint;
      ok.textContent = "";
      detail.innerHTML = "";
      return;
    }
    SheetsSync.saveConfig(next, document.getElementById("sync-secret").value);
    err.textContent = "";
    ok.textContent = "測試中…";
    detail.innerHTML = "";
    const result = await SheetsSync.ping();
    if (result.ok) {
      paintPing(result);
    } else {
      ok.textContent = "";
      detail.innerHTML = "";
      err.textContent = result.error || "連線失敗。請確認已部署為「任何人」可存取，且執行過 doGet 授權。";
    }
  };
  document.getElementById("sync-write").onclick = async () => {
    const err = document.getElementById("sync-error");
    const ok = document.getElementById("sync-ok");
    err.textContent = "";
    ok.textContent = "正在寫入測試列…";
    const result = await SheetsSync.selftest();
    if (!result.ok) {
      ok.textContent = "";
      err.textContent =
        result.error === "未知的 action：selftest"
          ? "連線有通，但程式是舊版，所以寫不進去。請把最新 Code.gs 貼上後，部署新版本，再按一次寫入測試列。"
          : result.error || "寫入測試失敗";
      return;
    }
    const ping = await SheetsSync.ping();
    if (ping.ok) paintPing(ping, `寫入成功。請打開試算表的「設定」分頁，應看到「連線測試」。`);
    else paintPing(result, `寫入成功。請打開試算表的「設定」分頁，應看到「連線測試」。`);
  };
}

async function refreshFromSheets() {
  if (!SheetsSync.configured()) {
    ledger = emptyLedger();
    return { ok: false, skipped: true, error: "尚未設定試算表網址" };
  }
  const result = await SheetsSync.load();
  if (result.ok && result.ledger) {
    ledger = result.ledger;
    rememberSheetInfo(result);
    return result;
  }
  return {
    ok: false,
    error: result.error || "無法讀取試算表",
  };
}

async function boot(nextView) {
  localStorage.removeItem("kronline-ledger-v1");
  localStorage.removeItem("kronline-ledger-v2");
  localStorage.removeItem("kronline-ledger-v3");
  if (!SheetsSync.configured()) {
    ledger = emptyLedger();
    view = "sync";
    notice = SheetsSync.urlHint() || "請先貼上 Apps Script 部署網址（結尾 /exec），不要貼試算表連結。";
    render();
    return;
  }
  notice = "正在從試算表載入…";
  view = nextView || view || "dashboard";
  render();
  const result = await refreshFromSheets();
  if (!result.ok) {
    notice = result.error || "無法讀取試算表，請檢查部署設定";
    view = "sync";
    render();
    return;
  }
  notice = "";
  view = nextView || "dashboard";
  render();
}

boot();
