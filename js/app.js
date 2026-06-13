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
    pdfSection: $("pdf-section"),
    generatePdf: $("generate-pdf"),
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
        // 工事件名・工事場所は工事情報の共通値を使うため写真ごとには持たない。
        // 写真ごとに設定するのは施工区分のみ。
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

    // 写真
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = [];

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
    els.count.textContent =
      total === 0 ? "写真は未選択です" : total + " 枚を選択中";
    els.empty.classList.toggle("is-hidden", total > 0);
    els.pdfSection.classList.toggle("is-hidden", total === 0);
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

  // テキストをクリップボードへコピー（失敗時はprompt）
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

  // 宛先つきでメール作成（mailto:）。宛先・件名が入る。添付は手動。
  function composeMail(to, subject) {
    to = (to || "").trim();
    saveRecent(to);
    const params = [];
    if (subject) params.push("subject=" + encodeURIComponent(subject));
    const href =
      "mailto:" +
      encodeURIComponent(to) +
      (params.length ? "?" + params.join("&") : "");
    window.location.href = href;
  }

  // PDFを共有・保存（共有シート）。メール添付や「"ファイル"に保存」が選べる。
  // 非対応環境: ダウンロード保存にフォールバック。
  async function sharePdf(file, subject, to) {
    if (to) saveRecent(to);
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

    // 件名（雛形＋工事名差し込み。コピー可）
    const subjRow = document.createElement("div");
    subjRow.className = "send-box__field";
    const subjLabel = document.createElement("span");
    subjLabel.className = "send-box__label";
    subjLabel.textContent = "件名";
    const subjVal = document.createElement("span");
    subjVal.className = "send-box__subject";
    subjVal.textContent = subject || "（未設定）";
    const subjCopy = document.createElement("button");
    subjCopy.type = "button";
    subjCopy.className = "link-btn";
    subjCopy.textContent = "コピー";
    subjCopy.addEventListener("click", () => copyText(subject, subjCopy));
    subjRow.append(subjLabel, subjVal, subjCopy);

    // ボタン: 宛先つきでメール作成 / PDFを共有・保存
    const mailBtn = document.createElement("button");
    mailBtn.type = "button";
    mailBtn.className = "btn btn--block";
    mailBtn.textContent = "宛先つきでメール作成";
    mailBtn.addEventListener("click", () => composeMail(toInput.value, subject));

    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "btn btn--ghost btn--block";
    shareBtn.textContent = canShareFile
      ? "PDFを共有・保存（“ファイル”や他のメール）"
      : "PDFを保存（ダウンロード）";
    shareBtn.addEventListener("click", () =>
      sharePdf(file, subject, toInput.value)
    );

    const note = document.createElement("p");
    note.className = "send-box__note";
    note.textContent = canShareFile
      ? "「宛先つきでメール作成」: 入力した宛先・件名でメール作成画面が開きます（PDFは手動で添付）。／「PDFを共有・保存」: 共有シートでメールに添付したり“ファイル”に保存できます。"
      : "「宛先つきでメール作成」: 入力した宛先・件名でメール作成が開きます。／「PDFを保存」: ダウンロード保存します。PDFは手動で添付してください。";

    box.append(toRow, subjRow, mailBtn, shareBtn, note);
    return box;
  }

  async function generatePdf() {
    if (state.photos.length === 0) return;
    if (typeof window.KojiPDF === "undefined") {
      alert("PDFライブラリの読み込みに失敗しました。通信状況を確認して再読み込みしてください。");
      return;
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

      // 結果UI
      els.pdfResult.innerHTML = "";

      // プレビュー
      const openLink = document.createElement("a");
      openLink.href = lastPdfUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.className = "btn btn--block";
      openLink.textContent = "PDFを開く（プレビュー）";

      // 送付ブロック（宛先入力＋件名＋メール作成／共有・保存）
      const subject = buildSubject();
      const sendBox = buildSendBox(file, filename, subject, canShareFile);

      const info = document.createElement("p");
      info.className = "pdf-result__info";
      const pages = 1 + Math.ceil(state.photos.length / 3);
      info.textContent =
        filename + "（表紙＋写真" + state.photos.length + "枚 / 全" + pages + "ページ）";

      els.pdfResult.append(openLink, sendBox, info);
      els.pdfResult.classList.remove("is-hidden");
    } catch (e) {
      console.error("[koji] PDF生成エラー:", e);
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
  console.log("[koji] 工事写真台帳 起動（Phase 4）");
})();
