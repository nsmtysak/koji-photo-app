/* ===========================================================
   工事写真台帳 — アプリ本体
   Phase 1: 写真の複数選択・一覧表示・並べ替え・削除
   写真は長期保存せず、作業セッション中のみメモリ＋ObjectURLで保持。
   =========================================================== */

(function () {
  "use strict";

  /* ---------- Service Worker 登録（PWA成立・オフライン対応） ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js")
        .then(function (reg) {
          console.log("[koji] Service Worker 登録成功:", reg.scope);
        })
        .catch(function (err) {
          console.error("[koji] Service Worker 登録失敗:", err);
        });
    });
  }

  /* ---------- 状態 ---------- */
  // photos: [{ id, file, url }]  ※ url は表示用 ObjectURL（解放管理する）
  const state = {
    photos: [],
  };

  let nextId = 1;

  /* ---------- DOM 参照 ---------- */
  const els = {
    input: document.getElementById("photo-input"),
    list: document.getElementById("photo-list"),
    count: document.getElementById("photo-count"),
    empty: document.getElementById("empty-state"),
    clearAll: document.getElementById("clear-all"),
  };

  /* ---------- 写真の追加（既存に足す） ---------- */
  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;

    files.forEach((file) => {
      state.photos.push({
        id: nextId++,
        file: file,
        url: URL.createObjectURL(file), // 写真は無加工。表示用URLのみ生成
      });
    });
    render();
  }

  /* ---------- 並べ替え（指定位置を上/下へ） ---------- */
  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= state.photos.length) return;
    const arr = state.photos;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    render();
  }

  /* ---------- 1枚削除（ObjectURL を解放） ---------- */
  function remove(id) {
    const idx = state.photos.findIndex((p) => p.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(state.photos[idx].url);
    state.photos.splice(idx, 1);
    render();
  }

  /* ---------- 全削除 ---------- */
  function clearAll() {
    if (state.photos.length === 0) return;
    if (!confirm("選択した写真をすべて取り消します。よろしいですか？")) return;
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = [];
    render();
  }

  /* ---------- 1件分の行を生成 ---------- */
  function createRow(photo, index, total) {
    const li = document.createElement("li");
    li.className = "photo-item";

    // 通し番号バッジ
    const num = document.createElement("span");
    num.className = "photo-item__num";
    num.textContent = String(index + 1);

    // サムネイル
    const thumb = document.createElement("img");
    thumb.className = "photo-item__thumb";
    thumb.src = photo.url;
    thumb.alt = "写真 " + (index + 1);
    thumb.loading = "lazy";
    thumb.decoding = "async";

    // 操作ボタン群
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
    li.append(num, thumb, ctrls);
    return li;
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

  /* ---------- 描画 ---------- */
  function render() {
    const total = state.photos.length;

    // カウント表示
    els.count.textContent =
      total === 0 ? "写真は未選択です" : total + " 枚を選択中";

    // 空状態 / 全削除ボタンの出し分け
    els.empty.classList.toggle("is-hidden", total > 0);
    els.clearAll.classList.toggle("is-hidden", total === 0);

    // 一覧の再描画
    els.list.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.photos.forEach((photo, i) => {
      frag.appendChild(createRow(photo, i, total));
    });
    els.list.appendChild(frag);
  }

  /* ---------- イベント ---------- */
  els.input.addEventListener("change", (e) => {
    addFiles(e.target.files);
    // 同じファイルを連続選択しても change が発火するよう値をリセット
    e.target.value = "";
  });

  els.clearAll.addEventListener("click", clearAll);

  /* ---------- 初期描画 ---------- */
  render();
  console.log("[koji] 工事写真台帳 起動（Phase 1）");
})();
