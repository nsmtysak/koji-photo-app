/* ===========================================================
   工事写真台帳 — アプリ本体
   Phase 2: 工事情報入力 / 写真ごとのテキスト入力 / 設定画面
   - 設定・工事情報・区分タグは localStorage に保存。
   - 写真本体と写真ごとのテキストはセッション中のみ保持（長期保存しない）。
   =========================================================== */

(function () {
  "use strict";

  /* ---------- Service Worker 登録 ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js")
        .then((reg) => console.log("[koji] SW 登録:", reg.scope))
        .catch((err) => console.error("[koji] SW 登録失敗:", err));
    });
  }

  /* ---------- localStorage ヘルパ ---------- */
  const LS = {
    job: "koji.jobInfo",
    company: "koji.company",
    mail: "koji.mail",
    cats: "koji.categories",
    recentTo: "koji.recentTo",
    perPage: "koji.perPage",
    session: "koji.session", // 写真の並び順・区分（本体はIndexedDB）
  };

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("[koji] 保存失敗:", key, e);
    }
  }

  /* ---------- IndexedDB（写真本体の一時保存。再読み込みで復元） ----------
     iOSはPWAを背面化/プレビュー表示で再読み込みすることがあり、メモリ上の
     写真が失われる。作業セッション中だけIndexedDBに退避し復元する（クリアで消去）。 */
  const IDB = (function () {
    const DB = "koji-db";
    const STORE = "photos";
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    function run(mode, fn) {
      return open().then(
        (db) =>
          new Promise((res, rej) => {
            const t = db.transaction(STORE, mode);
            const store = t.objectStore(STORE);
            const out = fn(store);
            t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
            t.onerror = () => rej(t.error);
            t.onabort = () => rej(t.error);
          })
      );
    }
    return {
      put: (id, blob) => run("readwrite", (s) => s.put(blob, id)).catch(() => {}),
      del: (id) => run("readwrite", (s) => s.delete(id)).catch(() => {}),
      clear: () => run("readwrite", (s) => s.clear()).catch(() => {}),
      get: (id) => run("readonly", (s) => s.get(id)).catch(() => null),
    };
  })();

  /* ---------- 既定値 ---------- */
  const DEFAULT_CATS = [
    "施工前",
    "解体前",
    "解体後",
    "施工中",
    "隠蔽前",
    "施工後",
    "完了",
  ];
  const DEFAULT_COMPANY = {
    name: "（株）安福冷暖",
    postal: "651-2411",
    address: "神戸市西区上新地1丁目1-6",
    tel: "(078)967-3855",
    fax: "(078)967-3856",
  };
  const DEFAULT_MAIL = {
    to: "",
    subject: "工事写真帳送付の件（{工事名}）",
  };
  const DEFAULT_JOB = { orderNo: "", name: "", place: "" };

  /* ---------- 状態 ---------- */
  const state = {
    // photos: [{ id, file, url, title, place, category }]
    photos: [],
    job: Object.assign({}, DEFAULT_JOB, load(LS.job, {})),
    company: Object.assign({}, DEFAULT_COMPANY, load(LS.company, {})),
    mail: Object.assign({}, DEFAULT_MAIL, load(LS.mail, {})),
    // 候補が空（全削除された等）になると選択肢が出ないため、空なら既定に戻す
    cats: (function () {
      const c = load(LS.cats, null);
      return Array.isArray(c) && c.length ? c : DEFAULT_CATS.slice();
    })(),
    perPage: [2, 3, 4].indexOf(load(LS.perPage, 3)) >= 0 ? load(LS.perPage, 3) : 3,
  };
  let nextId = 1;
  let catEditMode = false; // 写真側の区分チップが「候補を編集」モードか

  /* ---------- DOM 参照 ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    // 工事情報
    jobOrderNo: $("job-orderNo"),
    jobName: $("job-name"),
    jobPlace: $("job-place"),
    // 写真
    input: $("photo-input"),
    list: $("photo-list"),
    count: $("photo-count"),
    empty: $("empty-state"),
    clearAll: $("clear-all"),
    generatePdf: $("generate-pdf"),
    openPdf: $("open-pdf"),
    pdfResult: $("pdf-result"),
    // 設定
    openSettings: $("open-settings"),
    closeSettings: $("close-settings"),
    settings: $("settings"),
    coName: $("co-name"),
    coPostal: $("co-postal"),
    coAddress: $("co-address"),
    coTel: $("co-tel"),
    coFax: $("co-fax"),
    mailTo: $("mail-to"),
    mailSubject: $("mail-subject"),
    catList: $("cat-list"),
    catNew: $("cat-new"),
    catAddBtn: $("cat-add-btn"),
    catReset: $("cat-reset"),
    perPage: $("per-page"),
  };

  /* ===========================================================
     工事情報
     =========================================================== */
  function initJobInfo() {
    els.jobOrderNo.value = state.job.orderNo;
    els.jobName.value = state.job.name;
    els.jobPlace.value = state.job.place;

    els.jobOrderNo.addEventListener("input", () => {
      state.job.orderNo = els.jobOrderNo.value;
      save(LS.job, state.job);
      updateClearBtn();
    });
    els.jobName.addEventListener("input", () => {
      state.job.name = els.jobName.value;
      save(LS.job, state.job);
      updateClearBtn();
    });
    els.jobPlace.addEventListener("input", () => {
      state.job.place = els.jobPlace.value;
      save(LS.job, state.job);
      updateClearBtn();
    });
  }

  /* ===========================================================
     設定画面
     =========================================================== */
  function bindText(input, obj, key, lsKey) {
    input.value = obj[key] || "";
    input.addEventListener("input", () => {
      obj[key] = input.value;
      save(lsKey, obj);
    });
  }

  function initSettings() {
    bindText(els.coName, state.company, "name", LS.company);
    bindText(els.coPostal, state.company, "postal", LS.company);
    bindText(els.coAddress, state.company, "address", LS.company);
    bindText(els.coTel, state.company, "tel", LS.company);
    bindText(els.coFax, state.company, "fax", LS.company);
    bindText(els.mailTo, state.mail, "to", LS.mail);
    bindText(els.mailSubject, state.mail, "subject", LS.mail);

    els.openSettings.addEventListener("click", () => {
      els.settings.classList.remove("is-hidden");
      document.body.classList.add("no-scroll");
    });
    els.closeSettings.addEventListener("click", () => {
      els.settings.classList.add("is-hidden");
      document.body.classList.remove("no-scroll");
    });

    els.catAddBtn.addEventListener("click", addCategory);
    els.catNew.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addCategory();
    });
    els.catReset.addEventListener("click", () => {
      if (!confirm("施工区分タグを初期状態に戻します。よろしいですか？")) return;
      state.cats = DEFAULT_CATS.slice();
      save(LS.cats, state.cats);
      renderCats();
      renderPhotos(); // 各写真の区分チップも更新
    });

    // 1ページの写真枚数（2/3/4）
    els.perPage.querySelectorAll(".segmented__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.perPage = parseInt(btn.dataset.value, 10);
        save(LS.perPage, state.perPage);
        syncPerPage();
      });
    });
    syncPerPage();

    renderCats();
  }

  function syncPerPage() {
    els.perPage.querySelectorAll(".segmented__btn").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        parseInt(btn.dataset.value, 10) === state.perPage
      );
    });
  }

  function addCategory() {
    const v = els.catNew.value.trim();
    if (!v) return;
    if (state.cats.includes(v)) {
      els.catNew.value = "";
      return;
    }
    state.cats.push(v);
    save(LS.cats, state.cats);
    els.catNew.value = "";
    renderCats();
    renderPhotos();
  }

  function editCategory(index) {
    const cur = state.cats[index];
    const v = prompt("区分名を編集", cur);
    if (v == null) return;
    const trimmed = v.trim();
    if (!trimmed) return;
    if (state.cats.includes(trimmed) && trimmed !== cur) return;
    state.cats[index] = trimmed;
    save(LS.cats, state.cats);
    renderCats();
    renderPhotos();
  }

  function deleteCategory(index) {
    state.cats.splice(index, 1);
    save(LS.cats, state.cats);
    renderCats();
    renderPhotos();
  }

  // 区分タグの並べ替え（設定画面で順番入れ替え）
  function moveCategory(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= state.cats.length) return;
    const arr = state.cats;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    save(LS.cats, state.cats);
    renderCats();
    renderPhotos();
  }

  // 値ベースの候補 追加 / 削除（写真側のインライン編集から使用）
  function addCandidateValue(value) {
    const v = (value || "").trim();
    if (!v || state.cats.includes(v)) return;
    state.cats.push(v);
    save(LS.cats, state.cats);
    renderCats();
    renderPhotos();
  }
  function removeCandidateValue(cat) {
    const i = state.cats.indexOf(cat);
    if (i === -1) return;
    state.cats.splice(i, 1);
    save(LS.cats, state.cats);
    renderCats();
    renderPhotos();
  }
  function toggleCatEdit() {
    catEditMode = !catEditMode;
    renderPhotos();
  }

  function renderCats() {
    els.catList.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.cats.forEach((cat, i) => {
      const li = document.createElement("li");
      li.className = "cat-item";

      const name = document.createElement("button");
      name.type = "button";
      name.className = "cat-item__name";
      name.textContent = cat;
      name.title = "タップで編集";
      name.addEventListener("click", () => editCategory(i));

      // 並べ替え（▲▼）
      const up = document.createElement("button");
      up.type = "button";
      up.className = "icon-btn";
      up.textContent = "▲";
      up.setAttribute("aria-label", cat + " を上へ");
      up.disabled = i === 0;
      up.addEventListener("click", () => moveCategory(i, -1));

      const down = document.createElement("button");
      down.type = "button";
      down.className = "icon-btn";
      down.textContent = "▼";
      down.setAttribute("aria-label", cat + " を下へ");
      down.disabled = i === state.cats.length - 1;
      down.addEventListener("click", () => moveCategory(i, 1));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn photo-item__del";
      del.textContent = "✕";
      del.setAttribute("aria-label", cat + " を削除");
      del.addEventListener("click", () => deleteCategory(i));

      li.append(name, up, down, del);
      frag.appendChild(li);
    });
    els.catList.appendChild(frag);
  }

  /* ===========================================================
     写真
     =========================================================== */
  // 写真の並び順・区分を localStorage に、本体はIndexedDBに退避
  function saveSession() {
    const order = state.photos.map((p) => p.id);
    const cats = {};
    state.photos.forEach((p) => {
      if (p.category) cats[p.id] = p.category;
    });
    save(LS.session, { order: order, cats: cats });
  }

  // 起動時: IndexedDBから写真を復元（再読み込み対策）
  async function restoreSession() {
    const s = load(LS.session, null);
    if (!s || !Array.isArray(s.order) || s.order.length === 0) return;
    const restored = [];
    for (const id of s.order) {
      const blob = await IDB.get(id);
      if (!blob) continue;
      restored.push({
        id: id,
        file: blob,
        url: URL.createObjectURL(blob),
        category: (s.cats && s.cats[id]) || "",
      });
    }
    if (restored.length === 0) return;
    state.photos = restored;
    nextId = Math.max.apply(null, restored.map((p) => p.id)) + 1;
    renderPhotos();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;

    files.forEach((file) => {
      const id = nextId++;
      state.photos.push({
        id: id,
        file: file,
        url: URL.createObjectURL(file),
        // 工事件名・工事場所は工事情報の共通値を使うため写真ごとには持たない。
        // 写真ごとに設定するのは施工区分のみ。
        category: "",
      });
      IDB.put(id, file); // 本体を退避
    });
    saveSession();
    renderPhotos();
  }

  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= state.photos.length) return;
    const arr = state.photos;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    saveSession();
    renderPhotos();
  }

  function remove(id) {
    const idx = state.photos.findIndex((p) => p.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(state.photos[idx].url);
    state.photos.splice(idx, 1);
    IDB.del(id);
    saveSession();
    renderPhotos();
  }

  // 最初からやり直す: 写真・工事情報・PDF結果をリセット。
  // 設定（自社情報・メール雛形・区分タグ）は残す。
  function clearAll() {
    const hasJob = state.job.orderNo || state.job.name || state.job.place;
    if (state.photos.length === 0 && !hasJob) return;
    if (
      !confirm(
        "選択した写真と工事情報をリセットします。\n（設定・区分タグ・自社情報・メール雛形は残ります）\nよろしいですか？"
      )
    )
      return;

    // 写真（メモリ・IndexedDB・並び順をすべて消去）
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = [];
    IDB.clear();
    save(LS.session, { order: [], cats: {} });

    // 工事情報
    state.job = { orderNo: "", name: "", place: "" };
    save(LS.job, state.job);
    els.jobOrderNo.value = "";
    els.jobName.value = "";
    els.jobPlace.value = "";

    // PDF結果
    if (lastPdfUrl) {
      URL.revokeObjectURL(lastPdfUrl);
      lastPdfUrl = null;
    }
    els.pdfResult.innerHTML = "";
    els.pdfResult.classList.add("is-hidden");
    els.openPdf.classList.add("is-hidden");
    els.openPdf.removeAttribute("href");

    // 「PDFを生成」ボタンを元の青背景に戻す
    els.generatePdf.classList.remove("btn--ghost");

    renderPhotos();
  }

  function iconButton(label, aria, disabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.disabled = !!disabled;
    return b;
  }

  function createRow(photo, index, total) {
    const li = document.createElement("li");
    li.className = "photo-item";

    /* --- 上段: 番号 + サムネ + 並べ替え/削除 --- */
    const head = document.createElement("div");
    head.className = "photo-item__head";

    const num = document.createElement("span");
    num.className = "photo-item__num";
    num.textContent = String(index + 1);

    const thumb = document.createElement("img");
    thumb.className = "photo-item__thumb";
    thumb.src = photo.url;
    thumb.alt = "写真 " + (index + 1);
    thumb.loading = "lazy";
    thumb.decoding = "async";

    const ctrls = document.createElement("div");
    ctrls.className = "photo-item__ctrls";
    const upBtn = iconButton("▲", "上へ移動", index === 0);
    upBtn.addEventListener("click", () => move(index, -1));
    const downBtn = iconButton("▼", "下へ移動", index === total - 1);
    downBtn.addEventListener("click", () => move(index, 1));
    const delBtn = iconButton("✕", "削除", false);
    delBtn.classList.add("photo-item__del");
    delBtn.addEventListener("click", () => remove(photo.id));
    ctrls.append(upBtn, downBtn, delBtn);

    head.append(num, thumb, ctrls);

    /* --- 下段: 施工区分のみ（件名・場所は工事情報の共通値を使う） --- */
    const body = document.createElement("div");
    body.className = "photo-item__body";

    // 施工区分: 自由入力 + 候補チップ
    const catWrap = document.createElement("div");
    catWrap.className = "pfield";
    const catLabel = document.createElement("span");
    catLabel.className = "pfield__label";
    catLabel.textContent = "施工区分";
    const catInput = document.createElement("input");
    catInput.type = "text";
    catInput.className = "pfield__input";
    catInput.value = photo.category || "";
    catInput.placeholder = "選択または自由入力";
    catInput.addEventListener("input", () => {
      photo.category = catInput.value;
      syncChips(chips, photo.category);
      saveSession();
    });

    const chips = document.createElement("div");
    chips.className = "chips";

    if (catEditMode) {
      // 編集モード: 各候補は ✕ で削除、末尾の「＋追加」で候補を追加
      state.cats.forEach((cat) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip chip--editing";
        chip.textContent = cat + "  ✕";
        chip.setAttribute("aria-label", cat + " を候補から削除");
        chip.addEventListener("click", () => removeCandidateValue(cat));
        chips.appendChild(chip);
      });
      const addChip = document.createElement("button");
      addChip.type = "button";
      addChip.className = "chip chip--add";
      addChip.textContent = "＋ 追加";
      addChip.addEventListener("click", () => {
        const v = prompt("追加する施工区分を入力", catInput.value.trim());
        if (v != null) addCandidateValue(v);
      });
      chips.appendChild(addChip);
    } else {
      // 通常モード: タップで選択
      state.cats.forEach((cat) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = cat;
        chip.addEventListener("click", () => {
          photo.category = cat;
          catInput.value = cat;
          syncChips(chips, cat);
          saveSession();
        });
        chips.appendChild(chip);
      });
      syncChips(chips, photo.category);
    }

    // 候補の編集トグル
    const catTools = document.createElement("div");
    catTools.className = "cat-tools";
    const editToggle = document.createElement("button");
    editToggle.type = "button";
    editToggle.className = "link-btn";
    editToggle.textContent = catEditMode ? "完了" : "候補を編集";
    editToggle.addEventListener("click", toggleCatEdit);
    catTools.appendChild(editToggle);
    if (catEditMode) {
      const hint = document.createElement("span");
      hint.className = "cat-tools__hint";
      hint.textContent = "✕で削除 ／「＋追加」で候補を追加";
      catTools.appendChild(hint);
    }

    catWrap.append(catLabel, catInput, chips, catTools);

    body.append(catWrap);
    li.append(head, body);
    return li;
  }

  // 「最初からやり直す」ボタンの表示制御（写真または工事情報があれば表示）
  function updateClearBtn() {
    const hasJob = !!(state.job.orderNo || state.job.name || state.job.place);
    els.clearAll.classList.toggle(
      "is-hidden",
      state.photos.length === 0 && !hasJob
    );
  }

  function syncChips(chipsEl, value) {
    Array.from(chipsEl.children).forEach((chip) => {
      chip.classList.toggle("is-active", chip.textContent === value);
    });
  }

  function renderPhotos() {
    const total = state.photos.length;
    els.count.textContent = total === 0 ? "" : total + " 枚を選択中";
    els.empty.classList.toggle("is-hidden", total > 0);
    els.generatePdf.classList.toggle("is-hidden", total === 0);
    updateClearBtn();

    els.list.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.photos.forEach((photo, i) => {
      frag.appendChild(createRow(photo, i, total));
    });
    els.list.appendChild(frag);
  }

  /* ===========================================================
     PDF生成
     =========================================================== */
  let lastPdfUrl = null;

  function sanitizeFileName(s) {
    return (s || "工事").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  }

  // 件名の雛形に工事名を差し込む
  function buildSubject() {
    const tmpl = state.mail.subject || "工事写真帳送付の件";
    return tmpl.replace(/\{工事名\}/g, state.job.name || "");
  }

  // 最近使った宛先（最大8件）
  function loadRecents() {
    const arr = load(LS.recentTo, []);
    return Array.isArray(arr) ? arr : [];
  }
  function saveRecent(to) {
    to = (to || "").trim();
    if (!to) return;
    let arr = loadRecents().filter((x) => x !== to);
    arr.unshift(to);
    arr = arr.slice(0, 8);
    save(LS.recentTo, arr);
  }

  // PDFを共有・保存（共有シート）。メール添付や「"ファイル"に保存」が選べる。
  // 共有シートのメールでは宛先を自動入力できないため、先に宛先をクリップボードへ
  // コピーしておく（メールの宛先欄に貼り付けるだけで済む）。
  // 非対応環境: ダウンロード保存にフォールバック。
  async function sharePdf(file, subject, to) {
    to = (to || "").trim();
    if (to) {
      saveRecent(to);
      try {
        await navigator.clipboard.writeText(to);
      } catch (e) {
        /* 失敗しても共有は続行 */
      }
    }
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: subject || "工事写真帳",
          text: subject || "",
        });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    // フォールバック: ダウンロード保存
    const a = document.createElement("a");
    a.href = lastPdfUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 送付ブロック（宛先入力＋件名＋2つの送付ボタン）を組み立てる
  function buildSendBox(file, filename, subject, canShareFile) {
    const box = document.createElement("div");
    box.className = "send-box";

    // 宛先（毎回入力・選択可。初期値は設定の宛先。過去の宛先を候補表示）
    const toRow = document.createElement("div");
    toRow.className = "send-box__field";
    const toLabel = document.createElement("label");
    toLabel.className = "send-box__label";
    toLabel.textContent = "宛先";
    toLabel.htmlFor = "send-to";
    const toInput = document.createElement("input");
    toInput.type = "email";
    toInput.id = "send-to";
    toInput.className = "field__input";
    toInput.placeholder = "送信先メールアドレス";
    toInput.value = state.mail.to || "";
    toInput.setAttribute("list", "recent-to-list");
    toInput.autocapitalize = "off";
    toInput.autocomplete = "email";
    const dl = document.createElement("datalist");
    dl.id = "recent-to-list";
    loadRecents().forEach((addr) => {
      const opt = document.createElement("option");
      opt.value = addr;
      dl.appendChild(opt);
    });
    toRow.append(toLabel, toInput, dl);

    // 件名（雛形＋工事名差し込み。表示のみ）
    const subjRow = document.createElement("div");
    subjRow.className = "send-box__field";
    const subjLabel = document.createElement("span");
    subjLabel.className = "send-box__label";
    subjLabel.textContent = "件名";
    const subjVal = document.createElement("span");
    subjVal.className = "send-box__subject";
    subjVal.textContent = subject || "（未設定）";
    subjRow.append(subjLabel, subjVal);

    // PDFを添付して送る（共有シート → メールでPDFが自動添付）
    // タップ時に宛先をクリップボードへ自動コピー → メールの宛先に貼り付けるだけ。
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "btn btn--block";
    shareBtn.textContent = canShareFile ? "PDFを送る" : "PDFを保存（ダウンロード）";

    const status = document.createElement("p");
    status.className = "send-box__status is-hidden";

    shareBtn.addEventListener("click", async () => {
      const to = toInput.value.trim();
      if (canShareFile && to) {
        status.textContent =
          "宛先「" + to + "」をコピーしました。メールの宛先欄を長押し→ペーストで貼り付けてください。";
        status.classList.remove("is-hidden");
      }
      await sharePdf(file, subject, toInput.value);
    });

    const note = document.createElement("p");
    note.className = "send-box__note";
    note.textContent = canShareFile
      ? "宛先を入れて「PDFを送る」を押すと、入力した宛先が自動でコピーされ、メール送付画面の宛先欄に貼り付け（ペースト）できます。表示中の件名はメールのタイトルとして挿入されます。"
      : "「PDFを保存」でダウンロード後、メールに添付してください。表示中の件名はメールのタイトルに使われます。";

    box.append(toRow, subjRow, shareBtn, status, note);
    return box;
  }

  async function generatePdf() {
    if (state.photos.length === 0) return;
    if (typeof window.KojiPDF === "undefined") {
      alert("PDFライブラリの読み込みに失敗しました。通信状況を確認して再読み込みしてください。");
      return;
    }

    // 生成後に自動でPDFを表示するため、ユーザー操作（クリック）の文脈で
    // 先に空タブを開いておく（iOSのポップアップブロック回避）。
    let previewWin = null;
    try {
      previewWin = window.open("", "_blank");
    } catch (e) {
      previewWin = null;
    }

    els.generatePdf.disabled = true;
    const orgLabel = els.generatePdf.textContent;
    const setLabel = (t) => (els.generatePdf.textContent = t);
    setLabel("生成中…");
    els.pdfResult.classList.add("is-hidden");

    try {
      const bytes = await window.KojiPDF.generate({
        job: state.job,
        company: state.company,
        photos: state.photos,
        perPage: state.perPage,
        onProgress: setLabel,
      });

      // 以前のURLを解放
      if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl);
      const blob = new Blob([bytes], { type: "application/pdf" });
      lastPdfUrl = URL.createObjectURL(blob);

      const today = new Date().toISOString().slice(0, 10);
      const filename =
        "工事写真帳_" + sanitizeFileName(state.job.name) + "_" + today + ".pdf";

      // 保存・共有用の File（iOSの共有シートで「"ファイル"に保存」が選べる）
      const file = new File([blob], filename, { type: "application/pdf" });
      const canShareFile =
        navigator.canShare && navigator.canShare({ files: [file] });

      // 結果UI（送付ブロックのみ。プレビュー/生成/クリアは下部の固定ボタン）
      els.pdfResult.innerHTML = "";
      const subject = buildSubject();
      const sendBox = buildSendBox(file, filename, subject, canShareFile);

      const info = document.createElement("p");
      info.className = "pdf-result__info";
      const pages = 1 + Math.ceil(state.photos.length / state.perPage);
      info.textContent =
        filename + "（表紙＋写真" + state.photos.length + "枚 / 全" + pages + "ページ）";

      els.pdfResult.append(sendBox, info);
      els.pdfResult.classList.remove("is-hidden");

      // 「PDFを開く（プレビュー）」ボタンを表示・リンク更新
      els.openPdf.href = lastPdfUrl;
      els.openPdf.classList.remove("is-hidden");

      // 生成後に自動でPDFを表示（プレビューを押さなくても開く）
      if (previewWin && !previewWin.closed) {
        previewWin.location.href = lastPdfUrl;
      } else {
        // ポップアップがブロックされた場合は別タブで開く（アプリ画面は保持）
        els.openPdf.click();
      }

      // 一度生成したら「PDFを生成」ボタンを白背景・青文字に
      els.generatePdf.classList.add("btn--ghost");
    } catch (e) {
      console.error("[koji] PDF生成エラー:", e);
      if (previewWin && !previewWin.closed) previewWin.close();
      alert("PDFの生成に失敗しました: " + (e && e.message ? e.message : e));
    } finally {
      setLabel(orgLabel);
      els.generatePdf.disabled = false;
    }
  }

  /* ===========================================================
     イベント / 初期化
     =========================================================== */
  els.input.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // 同じ写真を連続選択しても発火させる
  });
  els.clearAll.addEventListener("click", clearAll);
  els.generatePdf.addEventListener("click", generatePdf);

  initJobInfo();
  initSettings();
  renderPhotos();
  restoreSession(); // 再読み込み時に作業中の写真を復元
  console.log("[koji] 工事写真台帳 起動（Phase 4）");
})();
