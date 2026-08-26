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
  購買訂單: ["訂單號", "購買日", "店家", "商品合計KRW", "店家折扣KRW", "實付KRW", "Npay", "刷卡KRW", "銀行卡", "備註", "寫入時間"],
  Npay歷程: ["單號", "日期", "類型", "儲值KRW", "扣除KRW", "剩餘點數", "儲值銀行卡", "關聯訂單", "寫入時間"],
  銀行卡明細: ["單號", "日期", "銀行卡", "類型", "金額KRW", "關聯", "對帳", "寫入時間"],
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
  try {
    checkSecret_(data.secret);
    var action = data.action || "ping";
    if (action === "ping") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return json_({
        ok: true,
        action: "ping",
        spreadsheet: ss.getName(),
        url: ss.getUrl(),
      });
    }
    if (action === "load") return loadAll_();
    if (action === "purchase") return writePurchase_(data);
    if (action === "topup") return writeTopup_(data);
    if (action === "reconcile") return reconcile_(data);
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

function loadAll_() {
  ensure_();
  return json_({
    ok: true,
    action: "load",
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
      storeDiscount: num_(r[4]),
      npayUsed: num_(r[6]),
      cardAmount: num_(r[7]),
      card: cardName || undefined,
      note: str_(r[9]),
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
    var npayUsed = Number(order.npayUsed || 0);
    var cardAmount = Number(order.cardAmount || 0);
    var payable = goods - discount;
    if (discount < 0 || discount > goods) throw new Error("店家折扣不正確");
    if (npayUsed + cardAmount !== payable) {
      throw new Error("實付必須等於 Npay + 刷卡");
    }
    if (cardAmount > 0 && !order.card) throw new Error("刷卡時請選擇銀行卡");

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
      goods,
      discount,
      payable,
      npayUsed,
      cardAmount,
      order.card || "",
      order.note || "",
      now,
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
      sheet_(SHEETS.cards).appendRow([
        cardId,
        order.date,
        order.card,
        npayUsed > 0 ? "購物補差額" : "直接刷卡",
        cardAmount,
        orderId,
        "未對帳",
        now,
      ]);
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
    sheet_(SHEETS.cards).appendRow([
      cardId,
      n.date,
      cardName,
      "Npay儲值",
      amount,
      npayId,
      "未對帳",
      now,
    ]);
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
    sh.getRange(found, 7).setValue(next);
    return json_({ ok: true, action: "reconcile", id: id, reconciled: !!data.reconciled });
  } finally {
    lock.releaseLock();
  }
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

function ensure_() {
  Object.keys(HEADERS).forEach(function (name) {
    sheet_(name);
  });
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
