/* ===========================================================
   工事写真台帳 — アプリ本体
   Phase 0: PWA骨組み（Service Worker登録のみ）
   =========================================================== */

(function () {
  "use strict";

  // Service Worker 登録（PWA成立・オフライン対応）
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

  // Phase 1 以降でホーム画面の機能を実装する
  console.log("[koji] 工事写真台帳 起動（Phase 0）");
})();
