const SheetsSync = {
  urlKey: "kronline-script-url",
  secretKey: "kronline-script-secret",

  getUrl() {
    return (localStorage.getItem(this.urlKey) || "").trim();
  },

  getSecret() {
    return (localStorage.getItem(this.secretKey) || "").trim();
  },

  saveConfig(url, secret) {
    localStorage.setItem(this.urlKey, (url || "").trim());
    localStorage.setItem(this.secretKey, (secret || "").trim());
  },

  urlKind(url) {
    const value = (url || this.getUrl() || "").trim();
    if (/docs\.google\.com\/spreadsheets/i.test(value)) return "sheet";
    if (/^https:\/\/script\.google\.com\/macros\/s\//i.test(value)) return "script";
    if (/^https:\/\/script\.google\.com\//i.test(value)) return "script-other";
    return value ? "unknown" : "empty";
  },

  urlHint(url) {
    const kind = this.urlKind(url);
    if (kind === "sheet") {
      return "這是 Google 試算表連結（docs.google.com），網頁沒辦法寫進去。請改貼 Apps Script「網頁應用程式」部署網址，開頭是 script.google.com，結尾是 /exec。";
    }
    if (kind === "empty") return "請貼 Apps Script 部署網址，不是試算表網址。";
    if (kind === "unknown") {
      return "網址不正確。需要 https://script.google.com/macros/s/…/exec";
    }
    if (kind === "script-other") {
      return "請貼部署後的網址，通常結尾是 /exec。不要貼編輯器或試算表連結。";
    }
    return "";
  },

  configured() {
    return this.urlKind() === "script";
  },

  async ping() {
    const hint = this.urlHint();
    if (hint) return { ok: false, error: hint };
    try {
      return await this.jsonp("ping");
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },

  async load() {
    const hint = this.urlHint();
    if (hint) return { ok: false, error: hint };
    let result;
    try {
      result = await this.jsonp("load");
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    if (!result.ok) return result;
    if (!result.ledger && (result.items || result.orders || result.npay || result.cards)) {
      result.ledger = {
        items: result.items || [],
        orders: result.orders || [],
        npay: result.npay || [],
        cards: result.cards || [],
      };
    }
    if (result.ok && !result.ledger) {
      return {
        ok: false,
        error: "瀏覽器無法讀回試算表。請把 Code.gs 更新後，再部署一個新版本。",
      };
    }
    return result;
  },

  jsonp(action, extra) {
    return new Promise((resolve, reject) => {
      const url = this.getUrl();
      if (!url) {
        reject(new Error("尚未設定試算表網址"));
        return;
      }
      const cb = "krCb" + Date.now() + Math.floor(Math.random() * 100000);
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("連線逾時"));
      }, 20000);
      const cleanup = () => {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
      };
      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("無法連線。請確認貼的是 /exec 部署網址，且存取對象是「任何人」。"));
      };
      let target;
      try {
        target = new URL(url);
      } catch (err) {
        cleanup();
        reject(new Error("網址格式不正確"));
        return;
      }
      target.searchParams.set("action", action);
      target.searchParams.set("callback", cb);
      if (this.getSecret()) target.searchParams.set("secret", this.getSecret());
      Object.entries(extra || {}).forEach(([key, value]) => {
        if (value == null || value === "") return;
        target.searchParams.set(key, String(value));
      });
      script.src = target.toString();
      document.body.appendChild(script);
    });
  },

  async pushPurchase({ order, items }) {
    return this.send({ action: "purchase", order, items });
  },

  async pushTopup({ date, amount, card, fxRate, amountTwd }) {
    return this.send({
      action: "topup",
      npay: { date, credit: amount, topUpCard: card, fxRate, amountTwd },
    });
  },

  async cancelOrder(orderId) {
    return this.send({ action: "cancel", orderId: orderId });
  },

  async send(payload) {
    const hint = this.urlHint();
    if (hint) return { ok: false, error: hint };
    const body = {
      ...payload,
      secret: this.getSecret() || undefined,
    };
    try {
      return await this.jsonp(payload.action, { payload: JSON.stringify(body) });
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },

  label(result) {
    if (!result) return "";
    if (result.skipped) return "尚未接上試算表，資料沒有寫入";
    if (result.ok && result.opaque) return "已送出，正在從試算表重新讀取";
    if (result.ok) return "已寫入 Google 試算表";
    return result.error || "寫入試算表失敗";
  },
};
