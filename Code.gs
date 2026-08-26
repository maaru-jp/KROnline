/**
 * KR Online — 綁在記帳試算表上的寫入 API
 *
 * 部署：部署 → 新部署 → 類型選「網頁應用程式」
 * 執行身分：我
 * 存取對象：任何人（即使未登入）也可以，否則本機網頁無法寫入
 * 授權：第一次請在編輯器執行 doGet，允許存取試算表
 */

var SHEETS = {
  items: "商品明細",
  orders: "購買訂單",
  npay: "Npay歷程",
  cards: "銀行卡明細",
};

var HEADERS = {
  商品明細: ["明細號", "訂單號", "購買日", "店家", "商品名稱", "單價KRW", "數量", "總金額KRW", "寫入時間"],
  購買訂單: ["訂單號", "購買日", "店家", "商品合計KRW", "店家折扣KRW", "實付KRW", "Npay", "刷卡KRW", "銀行卡", "備註", "寫入時間"],
  Npay歷程: ["單號", "日期", "類型", "儲值KRW", "扣除KRW", "剩餘點數", "儲值銀行卡", "關聯訂單", "寫入時間"],
  銀行卡明細: ["單號", "日期", "銀行卡", "類型", "金額KRW", "關聯", "對帳", "寫入時間"],
};

function doGet(e) {
  return handle_(e ? e.parameter : { action: "ping" });
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
    if (action === "purchase") return writePurchase_(data);
    if (action === "topup") return writeTopup_(data);
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

function writePurchase_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var order = data.order || {};
    var items = data.items || [];
    if (!order.id || !order.date || !order.shop) {
      throw new Error("訂單資料不完整");
    }
    if (!items.length) throw new Error("至少需要一件商品");

    var goods = 0;
    var now = now_();
    var itemSheet = sheet_(SHEETS.items);
    items.forEach(function (row) {
      var qty = Number(row.quantity || 0);
      var price = Number(row.unitPrice || 0);
      var total = price * qty;
      goods += total;
      itemSheet.appendRow([
        row.id,
        order.id,
        order.date,
        order.shop,
        row.name,
        price,
        qty,
        total,
        now,
      ]);
    });

    var discount = Number(order.storeDiscount || 0);
    var npayUsed = Number(order.npayUsed || 0);
    var cardAmount = Number(order.cardAmount || 0);
    var payable = goods - discount;

    sheet_(SHEETS.orders).appendRow([
      order.id,
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

    if (data.npay) {
      var n = data.npay;
      sheet_(SHEETS.npay).appendRow([
        n.id,
        n.date,
        n.type || "消費扣除",
        Number(n.credit || 0),
        Number(n.debit || 0),
        Number(n.balance || 0),
        n.topUpCard || "",
        n.relatedOrderId || order.id,
        now,
      ]);
    }

    if (data.card) {
      var c = data.card;
      sheet_(SHEETS.cards).appendRow([
        c.id,
        c.date,
        c.card,
        c.type,
        Number(c.amount || 0),
        c.relatedId || order.id,
        c.reconciled ? "已對帳" : "未對帳",
        now,
      ]);
    }

    return json_({ ok: true, action: "purchase", orderId: order.id, items: items.length });
  } finally {
    lock.releaseLock();
  }
}

function writeTopup_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var n = data.npay || {};
    var c = data.card || {};
    if (!n.id || !n.date || !(Number(n.credit) > 0)) {
      throw new Error("儲值資料不完整");
    }
    var now = now_();
    sheet_(SHEETS.npay).appendRow([
      n.id,
      n.date,
      "儲值",
      Number(n.credit),
      0,
      Number(n.balance || 0),
      n.topUpCard || "",
      "",
      now,
    ]);
    if (c.id) {
      sheet_(SHEETS.cards).appendRow([
        c.id,
        c.date || n.date,
        c.card || n.topUpCard,
        "Npay儲值",
        Number(c.amount || n.credit),
        c.relatedId || n.id,
        "未對帳",
        now,
      ]);
    }
    return json_({ ok: true, action: "topup", npayId: n.id });
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  var headers = HEADERS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0 && headers) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function now_() {
  return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
