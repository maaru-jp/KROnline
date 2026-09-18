/**
 * KR Online — 試算表是唯一帳本
 * 網頁只讀寫這裡，不把記帳資料存在瀏覽器。
 *
 * 部署：部署 → 新部署 → 網頁應用程式
 * 執行身分：我
 * 存取對象：任何人（即使未登入也可以）
 * 改過程式後必須再部署「新版本」
 */

var SHEETS = {
  items: "商品明細",
  orders: "購買訂單",
  npay: "Npay歷程",
  cards: "銀行卡明細",
  settings: "設定",
};

var HEADERS = {
  商品明細: ["明細號", "訂單號", "購買日", "店家", "商品名稱", "單價KRW", "數量", "總金額KRW", "寫入時間"],
  購買訂單: ["訂單號", "購買日", "店家", "商品合計KRW", "店家折扣KRW", "實付KRW", "Npay", "刷卡KRW", "銀行卡", "備註", "寫入時間", "狀態", "運費KRW", "刷卡手續費KRW"],
  Npay歷程: ["單號", "日期", "類型", "儲值KRW", "扣除KRW", "剩餘點數", "儲值銀行卡", "關聯訂單", "寫入時間"],
  銀行卡明細: ["單號", "日期", "銀行卡", "類型", "金額KRW", "關聯", "對帳", "寫入時間", "匯率", "金額TWD"],
  設定: ["類型", "名稱", "備註"],
};

function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : { action: "ping" });
}

function doPost(e) {
  var data = {};
  try {
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return json_({ ok: false, error: "JSON 格式不正確" });
  }
  return handle_(data);
}

function handle_(data) {
  data = data || {};
  CALLBACK_ = data.callback || "";
  if (data.payload) {
    try {
      var parsed = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
      var key;
      for (key in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key) && key !== "callback") {
          data[key] = parsed[key];
        }
      }
    } catch (err) {
      return json_({ ok: false, error: "寫入資料格式不正確" });
    }
  }
  try {
    checkSecret_(data.secret);
    var action = data.action || "ping";
    if (action === "ping") return ping_();
    if (action === "load") return loadAll_();
    if (action === "selftest") return selftest_();
    if (action === "purchase") return writePurchase_(data);
    if (action === "topup") return writeTopup_(data);
    if (action === "reconcile") return reconcile_(data);
    if (action === "cancel") return cancelOrder_(data);
    return json_({ ok: false, error: "未知的 action：" + action });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function checkSecret_(given) {
  var expected = PropertiesService.getScriptProperties().getProperty("WEBPASS");
  if (!expected) return;
  if (String(given || "") !== expected) {
    throw new Error("密鑰不正確");
  }
}

function ping_() {
  ensure_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets().map(function (sh) {
    return {
      name: sh.getName(),
      rows: Math.max(0, sh.getLastRow() - 1),
    };
  });
  return json_({
    ok: true,
    action: "ping",
    version: "write-v4",
    spreadsheet: ss.getName(),
    url: ss.getUrl(),
    sheets: sheets,
  });
}

function selftest_() {
  ensure_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = now_();
  sheet_(SHEETS.settings).appendRow(["連線測試", now, "網頁寫入成功"]);
  return json_({
    ok: true,
    action: "selftest",
    version: "write-v4",
    spreadsheet: ss.getName(),
    url: ss.getUrl(),
    wrote: "設定",
    at: now,
  });
}

function loadAll_() {
  ensure_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return json_({
    ok: true,
    action: "load",
    version: "write-v4",
    spreadsheet: ss.getName(),
    url: ss.getUrl(),
    items: loadItems_(),
    orders: loadOrders_(),
    npay: loadNpay_(),
    cards: loadCards_(),
    npayBalance: npayBalance_(),
  });
}

function loadItems_() {
  return rows_(SHEETS.items).map(function (r) {
    return {
      id: str_(r[0]),
      orderId: str_(r[1]),
      date: date_(r[2]),
      shop: str_(r[3]),
      name: str_(r[4]),
      unitPrice: num_(r[5]),
      quantity: num_(r[6]),
    };
  });
}

function loadOrders_() {
  return rows_(SHEETS.orders).map(function (r) {
    var cardName = str_(r[8]);
    return {
      id: str_(r[0]),
      date: date_(r[1]),
      shop: str_(r[2]),
      productPrice: num_(r[3]),
      storeDiscount: num_(r[4]),
      npayUsed: num_(r[6]),
      cardAmount: num_(r[7]),
      card: cardName || undefined,
      note: str_(r[9]),
      status: str_(r[11]) || "正常",
      shipping: num_(r[12]),
      cardFee: num_(r[13]),
    };
  });
}

function loadNpay_() {
  return rows_(SHEETS.npay).map(function (r) {
    var related = str_(r[7]);
    var topUp = str_(r[6]);
    return {
      id: str_(r[0]),
      date: date_(r[1]),
      type: str_(r[2]),
      credit: num_(r[3]),
      debit: num_(r[4]),
      balance: num_(r[5]),
      topUpCard: topUp || undefined,
      relatedOrderId: related || undefined,
    };
  });
}

function loadCards_() {
  return rows_(SHEETS.cards).map(function (r) {
    return {
      id: str_(r[0]),
      date: date_(r[1]),
      card: str_(r[2]),
      type: str_(r[3]),
      amount: num_(r[4]),
      relatedId: str_(r[5]),
      reconciled: str_(r[6]) === "已對帳",
      fxRate: num_(r[8]),
      amountTwd: num_(r[9]),
    };
  });
}

function writePurchase_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensure_();
    var order = data.order || {};
    var items = data.items || [];
    if (!order.date || !order.shop) throw new Error("訂單資料不完整");
    if (!items.length) throw new Error("至少需要一件商品");

    var goods = 0;
    items.forEach(function (row) {
      var qty = Number(row.quantity || 0);
      var price = Number(row.unitPrice || 0);
      if (!row.name || !(price > 0) || qty < 1) {
        throw new Error("商品名稱、單價、數量不完整");
      }
      goods += price * qty;
    });

    var discount = Number(order.storeDiscount || 0);
    var shipping = Number(order.shipping || 0);
    var npayUsed = Number(order.npayUsed || 0);
    var cardAmount = Number(order.cardAmount || 0);
    var cardFee = cardAmount > 0 ? Number(order.cardFee || 0) : 0;
    var productPrice = Number(order.productPrice || 0);
    if (cardAmount > 0) {
      if (!(productPrice > 0)) productPrice = goods;
    } else {
      productPrice = goods;
      cardFee = 0;
    }
    var payable = productPrice - discount + shipping + cardFee;
    if (discount < 0 || discount > productPrice) throw new Error("優惠劵折扣不正確");
    if (shipping < 0) throw new Error("運費不能是負數");
    if (cardFee < 0) throw new Error("刷卡手續費不能是負數");
    if (npayUsed + cardAmount !== payable) {
      throw new Error("實付必須等於 Npay + 刷卡");
    }
    if (cardAmount > 0 && !order.card) throw new Error("刷卡時請選擇銀行卡");
    var cardFx = cardFx_(cardAmount, order.fxRate, order.cardTwd);
    if (cardAmount > 0 && !(Math.abs(cardFx.twd) > 0)) {
      throw new Error("刷卡請手動填台幣金額");
    }

    var balance = npayBalance_();
    if (npayUsed > balance) {
      throw new Error("Npay 餘額不足，目前 " + balance);
    }

    var now = now_();
    var orderId = nextId_(SHEETS.orders, "P");
    var itemNo = maxId_(SHEETS.items);
    var itemSheet = sheet_(SHEETS.items);

    items.forEach(function (row) {
      itemNo += 1;
      var qty = Number(row.quantity);
      var price = Number(row.unitPrice);
      itemSheet.appendRow([
        id_("I", itemNo),
        orderId,
        order.date,
        order.shop,
        row.name,
        price,
        qty,
        price * qty,
        now,
      ]);
    });

    sheet_(SHEETS.orders).appendRow([
      orderId,
      order.date,
      order.shop,
      productPrice,
      discount,
      payable,
      npayUsed,
      cardAmount,
      order.card || "",
      order.note || "",
      now,
      "正常",
      shipping,
      cardFee,
    ]);

    var npayId = "";
    if (npayUsed > 0) {
      npayId = nextId_(SHEETS.npay, "N");
      balance -= npayUsed;
      sheet_(SHEETS.npay).appendRow([
        npayId,
        order.date,
        "消費扣除",
        0,
        npayUsed,
        balance,
        "",
        orderId,
        now,
      ]);
    }

    var cardId = "";
    if (cardAmount > 0) {
      cardId = nextId_(SHEETS.cards, "C");
      appendCard_({
        id: cardId,
        date: order.date,
        card: order.card,
        type: npayUsed > 0 ? "購物補差額" : "直接刷卡",
        amount: cardAmount,
        related: orderId,
        now: now,
        rate: cardFx.rate,
        twd: cardFx.twd,
      });
    }

    return json_({
      ok: true,
      action: "purchase",
      orderId: orderId,
      npayId: npayId,
      cardId: cardId,
      npayBalance: balance,
    });
  } finally {
    lock.releaseLock();
  }
}

function writeTopup_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensure_();
    var n = data.npay || {};
    var amount = Number(n.credit || 0);
    var cardName = n.topUpCard || (data.card && data.card.card) || "";
    if (!n.date || !(amount > 0) || !cardName) {
      throw new Error("儲值資料不完整");
    }
    var topupFx = cardFx_(amount, n.fxRate, n.amountTwd || n.cardTwd);
    if (!(Math.abs(topupFx.twd) > 0)) {
      throw new Error("儲值刷卡請手動填台幣金額");
    }
    var now = now_();
    var npayId = nextId_(SHEETS.npay, "N");
    var balance = npayBalance_() + amount;
    sheet_(SHEETS.npay).appendRow([
      npayId,
      n.date,
      "儲值",
      amount,
      0,
      balance,
      cardName,
      "",
      now,
    ]);
    var cardId = nextId_(SHEETS.cards, "C");
    appendCard_({
      id: cardId,
      date: n.date,
      card: cardName,
      type: "Npay儲值",
      amount: amount,
      related: npayId,
      now: now,
      rate: topupFx.rate,
      twd: topupFx.twd,
    });
    return json_({
      ok: true,
      action: "topup",
      npayId: npayId,
      cardId: cardId,
      npayBalance: balance,
    });
  } finally {
    lock.releaseLock();
  }
}

function reconcile_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var id = str_(data.id);
    if (!id) throw new Error("缺少單號");
    var sh = sheet_(SHEETS.cards);
    var last = sh.getLastRow();
    if (last < 2) throw new Error("找不到這筆卡帳");
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    var found = 0;
    for (var i = 0; i < vals.length; i++) {
      if (str_(vals[i][0]) === id) {
        found = i + 2;
        break;
      }
    }
    if (!found) throw new Error("找不到 " + id);
    var next = data.reconciled ? "已對帳" : "未對帳";
    var reconCol = headerCol_(sh, "對帳") || 7;
    sh.getRange(found, reconCol).setValue(next);
    return json_({ ok: true, action: "reconcile", id: id, reconciled: !!data.reconciled });
  } finally {
    lock.releaseLock();
  }
}

function cancelOrder_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensure_();
    var statusCol = ensureOrderStatusCol_();
    var orderId = str_(data.orderId || data.id);
    if (!orderId) throw new Error("缺少訂單號");
    var sh = sheet_(SHEETS.orders);
    var last = sh.getLastRow();
    if (last < 2) throw new Error("找不到訂單");
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    var row = 0;
    for (var i = 0; i < ids.length; i++) {
      if (str_(ids[i][0]) === orderId) {
        row = i + 2;
        break;
      }
    }
    if (!row) throw new Error("找不到訂單 " + orderId);
    var status = str_(sh.getRange(row, statusCol).getValue());
    if (status === "已取消") {
      throw new Error("這筆訂單已經取消過，不會再補 Npay 或刷退");
    }
    var npayUsed = num_(sh.getRange(row, 7).getValue());
    var cardAmount = num_(sh.getRange(row, 8).getValue());
    var cardName = str_(sh.getRange(row, 9).getValue());
    var charge = findOrderCardCharge_(orderId);
    var refundAmount = cardAmount > 0 ? cardAmount : charge.amount;
    var refundCard = cardName || charge.card;
    var now = now_();
    var cancelDate = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
    var restored = 0;
    var balance = npayBalance_();
    var cardRefundId = "";
    if (npayUsed > 0) {
      restored = npayUsed;
      balance += npayUsed;
      sheet_(SHEETS.npay).appendRow([
        nextId_(SHEETS.npay, "N"),
        cancelDate,
        "退款回補",
        npayUsed,
        0,
        balance,
        "",
        orderId,
        now,
      ]);
    }
    if (refundAmount > 0) {
      if (!refundCard) {
        throw new Error("這筆有刷卡金額但找不到銀行卡，無法記刷退");
      }
      var refundFx = cardFx_(refundAmount, charge.rate, charge.twd);
      cardRefundId = nextId_(SHEETS.cards, "C");
      appendCard_({
        id: cardRefundId,
        date: cancelDate,
        card: refundCard,
        type: "刷退",
        amount: -refundAmount,
        related: orderId,
        now: now,
        rate: refundFx.rate,
        twd: -Math.abs(refundFx.twd),
      });
    }
    sh.getRange(row, statusCol).setValue("已取消");
    return json_({
      ok: true,
      action: "cancel",
      orderId: orderId,
      npayRestored: restored,
      npayBalance: balance,
      cardRefunded: refundAmount > 0 ? refundAmount : 0,
      cardRefundedTwd: refundAmount > 0 ? Math.abs(refundFx && refundFx.twd ? refundFx.twd : 0) : 0,
      card: refundCard || "",
      cardId: cardRefundId,
    });
  } finally {
    lock.releaseLock();
  }
}

function isCardRefundType_(type) {
  return type === "刷退" || type === "訂單取消退款";
}

function findOrderCardCharge_(orderId) {
  var rows = rows_(SHEETS.cards);
  var amount = 0;
  var card = "";
  var rate = 0;
  var twd = 0;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][5]) !== orderId) continue;
    var type = str_(rows[i][3]);
    if (isCardRefundType_(type) || type === "Npay儲值") continue;
    var amt = num_(rows[i][4]);
    if (amt > 0) {
      amount += amt;
      twd += num_(rows[i][9]);
      if (!card) card = str_(rows[i][2]);
      if (!rate) rate = num_(rows[i][8]);
    }
  }
  return { amount: amount, card: card, rate: rate, twd: twd };
}

function cardFx_(krwAmt, rate, twd) {
  krwAmt = Number(krwAmt || 0);
  rate = Number(rate || 0);
  twd = Number(twd || 0);
  var absKrw = Math.abs(krwAmt);
  var absTwd = Math.abs(twd);
  if (!(absKrw > 0)) return { rate: 0, twd: 0 };
  if (!(absTwd > 0) && rate > 0) absTwd = Math.round(absKrw * rate);
  if (!(rate > 0) && absTwd > 0) rate = absTwd / absKrw;
  return { rate: rate, twd: krwAmt < 0 ? -absTwd : absTwd };
}

function appendCard_(row) {
  ensureSheetHeaders_(SHEETS.cards);
  sheet_(SHEETS.cards).appendRow([
    row.id,
    row.date,
    row.card,
    row.type,
    row.amount,
    row.related || "",
    row.reconciled || "未對帳",
    row.now,
    row.rate || 0,
    row.twd || 0,
  ]);
}

function headerCol_(sh, name) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (str_(headers[i]) === name) return i + 1;
  }
  return 0;
}

function ensureOrderStatusCol_() {
  var sh = sheet_(SHEETS.orders);
  var col = headerCol_(sh, "狀態");
  if (!col) {
    col = Math.max(12, sh.getLastColumn() + 1);
    sh.getRange(1, col).setValue("狀態");
    sh.getRange(1, col).setFontWeight("bold");
  }
  return col;
}

function npayBalance_() {
  var sh = sheet_(SHEETS.npay);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  return num_(sh.getRange(last, 6).getValue());
}

function maxId_(sheetName) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  var max = 0;
  if (last < 2) return 0;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var n = Number(String(vals[i][0]).replace(/^[A-Z]+-/, ""));
    if (n > max) max = n;
  }
  return max;
}

function nextId_(sheetName, prefix) {
  return id_(prefix, maxId_(sheetName) + 1);
}

function id_(prefix, n) {
  var s = String(n);
  while (s.length < 3) s = "0" + s;
  return prefix + "-" + s;
}

function rows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var cols = sh.getLastColumn();
  if (last < 2 || cols < 1) return [];
  return sh.getRange(2, 1, last - 1, cols).getValues();
}

function ensureSheetHeaders_(name) {
  var sh = sheet_(name);
  var wanted = HEADERS[name];
  if (!wanted) return;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var have = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  wanted.forEach(function (h) {
    if (have.indexOf(h) === -1) {
      var col = Math.max(sh.getLastColumn() + 1, 1);
      sh.getRange(1, col).setValue(h);
      sh.getRange(1, col).setFontWeight("bold");
      have.push(h);
    }
  });
}

function ensure_() {
  Object.keys(HEADERS).forEach(function (name) {
    sheet_(name);
  });
  ensureOrderStatusCol_();
  ensureSheetHeaders_(SHEETS.cards);
  ensureSheetHeaders_(SHEETS.orders);
  var settings = sheet_(SHEETS.settings);
  if (settings.getLastRow() < 2) {
    [
      ["銀行卡", "富邦", "儲值或購物刷卡"],
      ["銀行卡", "中信", "儲值或購物刷卡"],
      ["店家", "Coupang", ""],
      ["店家", "Olive Young", ""],
      ["店家", "29CM", ""],
      ["店家", "Musinsa", ""],
      ["店家", "其他", ""],
    ].forEach(function (row) {
      settings.appendRow(row);
    });
  }
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  var headers = HEADERS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function date_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return Utilities.formatDate(v, "Asia/Taipei", "yyyy-MM-dd");
  }
  return str_(v).slice(0, 10);
}

function num_(v) {
  if (v === "" || v === null || typeof v === "undefined") return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str_(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

function now_() {
  return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
}

var CALLBACK_ = "";

function json_(obj) {
  var text = JSON.stringify(obj);
  if (CALLBACK_) {
    return ContentService.createTextOutput(CALLBACK_ + "(" + text + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT,
    );
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
