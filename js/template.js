/* ===========================================================
   工事写真台帳 — 撮影指示テンプレート
   元請けが「注文番号・顧客名・工事名・工事場所＋撮影ポイント（区分＋メモ）」を
   入力してリンク（#t=...）を発行。協力会社はそのリンクを開くだけで開始できる。

   このファイルは window.KojiTemplate を公開する（app.js より前に読み込む）:
   - encode(obj) / decode(str)   … テンプレJSON ⇔ URL用 base64url(UTF-8)
   - open()                       … 作成オーバーレイを開く（メインの専用ボタンから）
   =========================================================== */
(function () {
  "use strict";

  /* ---------- base64url(UTF-8) エンコード/デコード ---------- */
  // 日本語を encodeURIComponent で展開すると %XX が増え URL が長くなるため、
  // UTF-8 バイト列を base64url 化して短く保つ。
  function b64urlEncode(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function encode(obj) {
    const json = JSON.stringify(obj);
    return b64urlEncode(new TextEncoder().encode(json));
  }
  function decode(str) {
    const json = new TextDecoder().decode(b64urlDecode(str));
    return JSON.parse(json);
  }

  function genId() {
    return Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 区分候補（localStorage から読む。app.js と同じキー） ---------- */
  function loadCats() {
    try {
      const v = localStorage.getItem("koji.categories");
      const arr = v ? JSON.parse(v) : null;
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /* ---------- コピー / 共有（app.js と同等の挙動を自前で持つ） ---------- */
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const org = btn.textContent;
        btn.textContent = "コピー済み";
        setTimeout(() => (btn.textContent = org), 1200);
      }
    } catch (e) {
      window.prompt("コピーしてください", text);
    }
  }
  async function shareLink(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text: text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
        // 失敗時はコピーにフォールバック
      }
    }
    copyText(text);
  }

  /* ---------- 状態（作成中のポイント一覧） ---------- */
  let points = []; // [{ cat, memo }]
  let els = null;

  function $(id) {
    return document.getElementById(id);
  }

  function grab() {
    if (els) return;
    els = {
      overlay: $("link-creator"),
      cancel: $("lc-cancel"),
      orderNo: $("lc-orderNo"),
      customer: $("lc-customer"),
      name: $("lc-name"),
      place: $("lc-place"),
      list: $("lc-points"),
      add: $("lc-point-add"),
      catOptions: $("lc-cat-options"),
      generate: $("lc-generate"),
      result: $("lc-result"),
      url: $("lc-url"),
      copy: $("lc-copy"),
      share: $("lc-share"),
      length: $("lc-length"),
    };
  }

  /* ---------- ポイント一覧の描画 ---------- */
  function renderPoints() {
    els.list.innerHTML = "";
    const frag = document.createDocumentFragment();
    points.forEach((pt, i) => {
      const row = document.createElement("div");
      row.className = "lc-point";

      // 区分（datalist で既存候補をサジェスト・自由入力も可）
      const cat = document.createElement("input");
      cat.type = "text";
      cat.className = "field__input lc-point__cat";
      cat.value = pt.cat || "";
      cat.placeholder = "区分（例: 施工前）";
      cat.setAttribute("list", "lc-cat-options");
      cat.addEventListener("input", () => {
        pt.cat = cat.value;
        hideResult();
      });

      // 撮影メモ
      const memo = document.createElement("input");
      memo.type = "text";
      memo.className = "field__input lc-point__memo";
      memo.value = pt.memo || "";
      memo.placeholder = "撮影メモ（例: 全景がわかるように）";
      memo.addEventListener("input", () => {
        pt.memo = memo.value;
        hideResult();
      });

      // 並べ替え・削除
      const tools = document.createElement("div");
      tools.className = "lc-point__tools";
      const up = iconBtn("▲", "上へ", i === 0, () => movePoint(i, -1));
      const down = iconBtn("▼", "下へ", i === points.length - 1, () =>
        movePoint(i, 1)
      );
      const del = iconBtn("✕", "削除", false, () => removePoint(i));
      del.classList.add("photo-item__del");
      tools.append(up, down, del);

      row.append(cat, memo, tools);
      frag.appendChild(row);
    });
    els.list.appendChild(frag);
  }

  function iconBtn(label, aria, disabled, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function addPoint() {
    points.push({ cat: "", memo: "" });
    hideResult();
    renderPoints();
  }
  function removePoint(i) {
    points.splice(i, 1);
    hideResult();
    renderPoints();
  }
  function movePoint(i, dir) {
    const t = i + dir;
    if (t < 0 || t >= points.length) return;
    const tmp = points[i];
    points[i] = points[t];
    points[t] = tmp;
    hideResult();
    renderPoints();
  }

  function hideResult() {
    if (els && els.result) els.result.classList.add("is-hidden");
  }

  /* ---------- 区分候補を datalist へ ---------- */
  function fillCatOptions() {
    els.catOptions.innerHTML = "";
    loadCats().forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      els.catOptions.appendChild(o);
    });
  }

  /* ---------- リンク生成 ---------- */
  function buildUrl() {
    const cleanPoints = points
      .map((p) => ({ cat: (p.cat || "").trim(), memo: (p.memo || "").trim() }))
      .filter((p) => p.cat || p.memo);

    const tpl = {
      v: 1,
      id: genId(),
      job: {
        orderNo: els.orderNo.value.trim(),
        name: els.name.value.trim(),
        place: els.place.value.trim(),
      },
      customer: els.customer.value.trim(),
      points: cleanPoints,
    };
    const base = location.origin + location.pathname;
    return base + "#t=" + encode(tpl);
  }

  function generate() {
    const hasName = els.name.value.trim();
    const hasPoints = points.some((p) => (p.cat || "").trim());
    if (!hasName && !hasPoints) {
      alert("工事名、または撮影ポイントを少なくとも1つ入力してください。");
      return;
    }
    const url = buildUrl();
    els.url.value = url;
    els.length.textContent = "リンクの長さ: 約 " + url.length + " 文字";
    els.result.classList.remove("is-hidden");
    // 生成直後にURLを選択状態にして手動コピーもしやすく
    els.url.focus();
    els.url.select();
  }

  /* ---------- 開く / 閉じる ---------- */
  function open() {
    grab();
    if (!els.overlay) return;
    // 初回イベント配線
    if (!els.overlay.dataset.wired) {
      els.cancel.addEventListener("click", close);
      els.add.addEventListener("click", addPoint);
      els.generate.addEventListener("click", generate);
      els.copy.addEventListener("click", () => copyText(els.url.value, els.copy));
      els.share.addEventListener("click", () => shareLink(els.url.value));
      // 工事情報を編集したら結果URLは作り直しが必要なので隠す
      [els.orderNo, els.customer, els.name, els.place].forEach((inp) =>
        inp.addEventListener("input", hideResult)
      );
      els.overlay.dataset.wired = "1";
    }

    // 状態リセット（作るたび新しい指示として開く）
    points = [{ cat: "", memo: "" }];
    els.orderNo.value = "";
    els.customer.value = "";
    els.name.value = "";
    els.place.value = "";
    hideResult();
    fillCatOptions();
    renderPoints();

    els.overlay.classList.remove("is-hidden");
    document.body.classList.add("no-scroll");
  }

  function close() {
    if (els && els.overlay) els.overlay.classList.add("is-hidden");
    document.body.classList.remove("no-scroll");
  }

  /* ---------- 公開 ---------- */
  window.KojiTemplate = {
    encode: encode,
    decode: decode,
    open: open,
  };
})();
