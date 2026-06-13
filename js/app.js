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
    cats: load(LS.cats, null) || DEFAULT_CATS.slice(),
  };
  let nextId = 1;

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
    });
    els.jobName.addEventListener("input", () => {
      state.job.name = els.jobName.value;
      save(LS.job, state.job);
    });
    els.jobPlace.addEventListener("input", () => {
      state.job.place = els.jobPlace.value;
      save(LS.job, state.job);
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

    renderCats();
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

      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn photo-item__del";
      del.textContent = "✕";
      del.setAttribute("aria-label", cat + " を削除");
      del.addEventListener("click", () => deleteCategory(i));

      li.append(name, del);
      frag.appendChild(li);
    });
    els.catList.appendChild(frag);
  }

  /* ===========================================================
     写真
     =========================================================== */
  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;

    files.forEach((file) => {
      state.photos.push({
        id: nextId++,
        file: file,
        url: URL.createObjectURL(file),
        // 工事件名・工事場所は工事情報を初期値として引き継ぐ
        title: state.job.name || "",
        place: state.job.place || "",
        category: "",
      });
    });
    renderPhotos();
  }

  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= state.photos.length) return;
    const arr = state.photos;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    renderPhotos();
  }

  function remove(id) {
    const idx = state.photos.findIndex((p) => p.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(state.photos[idx].url);
    state.photos.splice(idx, 1);
    renderPhotos();
  }

  function clearAll() {
    if (state.photos.length === 0) return;
    if (!confirm("選択した写真と入力内容をすべて取り消します。よろしいですか？"))
      return;
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = [];
    renderPhotos();
  }

  // 直前の写真の値（件名/場所/区分）をこの写真へ引き継ぐ
  function inheritPrev(index) {
    if (index <= 0) return;
    const prev = state.photos[index - 1];
    const cur = state.photos[index];
    cur.title = prev.title;
    cur.place = prev.place;
    cur.category = prev.category;
    renderPhotos();
  }

  // この写真の件名/場所/区分を全写真へコピー
  function copyToAll(index) {
    const src = state.photos[index];
    if (!confirm("この写真の件名・場所・区分を全写真にコピーします。よろしいですか？"))
      return;
    state.photos.forEach((p) => {
      p.title = src.title;
      p.place = src.place;
      p.category = src.category;
    });
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

  function textField(labelText, value, onInput) {
    const wrap = document.createElement("label");
    wrap.className = "pfield";
    const span = document.createElement("span");
    span.className = "pfield__label";
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "pfield__input";
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    wrap.append(span, input);
    return { wrap, input };
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

    /* --- 下段: 件名 / 場所 / 区分 --- */
    const body = document.createElement("div");
    body.className = "photo-item__body";

    const title = textField("工事件名", photo.title, (v) => {
      photo.title = v;
    });
    const place = textField("工事場所", photo.place, (v) => {
      photo.place = v;
    });

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
    });

    const chips = document.createElement("div");
    chips.className = "chips";
    state.cats.forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = cat;
      chip.addEventListener("click", () => {
        photo.category = cat;
        catInput.value = cat;
        syncChips(chips, cat);
      });
      chips.appendChild(chip);
    });
    syncChips(chips, photo.category);

    catWrap.append(catLabel, catInput, chips);

    /* --- 補助ボタン --- */
    const helpers = document.createElement("div");
    helpers.className = "photo-item__helpers";
    const inheritBtn = document.createElement("button");
    inheritBtn.type = "button";
    inheritBtn.className = "btn btn--ghost btn--sm";
    inheritBtn.textContent = "直前を引き継ぐ";
    inheritBtn.disabled = index === 0;
    inheritBtn.addEventListener("click", () => inheritPrev(index));

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn--ghost btn--sm";
    copyBtn.textContent = "全写真にコピー";
    copyBtn.addEventListener("click", () => copyToAll(index));

    helpers.append(inheritBtn, copyBtn);

    body.append(title.wrap, place.wrap, catWrap, helpers);
    li.append(head, body);
    return li;
  }

  function syncChips(chipsEl, value) {
    Array.from(chipsEl.children).forEach((chip) => {
      chip.classList.toggle("is-active", chip.textContent === value);
    });
  }

  function renderPhotos() {
    const total = state.photos.length;
    els.count.textContent =
      total === 0 ? "写真は未選択です" : total + " 枚を選択中";
    els.empty.classList.toggle("is-hidden", total > 0);
    els.clearAll.classList.toggle("is-hidden", total === 0);

    els.list.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.photos.forEach((photo, i) => {
      frag.appendChild(createRow(photo, i, total));
    });
    els.list.appendChild(frag);
  }

  /* ===========================================================
     イベント / 初期化
     =========================================================== */
  els.input.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // 同じ写真を連続選択しても発火させる
  });
  els.clearAll.addEventListener("click", clearAll);

  initJobInfo();
  initSettings();
  renderPhotos();
  console.log("[koji] 工事写真台帳 起動（Phase 2）");
})();
