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

  configured() {
    return /^https:\/\/script\.google\.com\//.test(this.getUrl());
  },

  async ping() {
    try {
      return await this.jsonp("ping");
    } catch (err) {
      return this.send({ action: "ping" });
    }
  },

  async load() {
    let result;
    try {
      result = await this.jsonp("load");
    } catch (err) {
      result = await this.send({ action: "load" });
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

  jsonp(action) {
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
        reject(new Error("無法連線試算表"));
      };
      const target = new URL(url);
      target.searchParams.set("action", action);
      target.searchParams.set("callback", cb);
      if (this.getSecret()) target.searchParams.set("secret", this.getSecret());
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
    const url = this.getUrl();
    if (!url) return { ok: false, skipped: true, error: "尚未設定試算表網址" };
    const body = JSON.stringify({
      ...payload,
      secret: this.getSecret() || undefined,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      try {
        await fetch(url, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body,
        });
        return { ok: true, opaque: true };
      } catch (err2) {
        return { ok: false, error: String(err.message || err) };
      }
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
