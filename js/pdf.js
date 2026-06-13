/* ===========================================================
   工事写真台帳 — PDF生成（Phase 3）
   pdf-lib + fontkit で日本語フォントをサブセット埋め込み。
   レイアウト:
     1ページ目  : 表紙（「工事写真帳」/ 注文番号・工事名・工事場所 / 自社情報）
     2ページ目〜: 写真3枚/ページ（左=写真、右=工事件名/工事場所/施工区分）
   公開API: window.KojiPDF.generate({ job, company, photos }) -> Uint8Array
   =========================================================== */

window.KojiPDF = (function () {
  "use strict";

  const { PDFDocument, rgb } = PDFLib;

  // A4 ポートレート（pt）
  const W = 595.28;
  const H = 841.89;
  const MARGIN = 40;

  const COLOR_TEXT = rgb(0.11, 0.11, 0.12);
  const COLOR_SUB = rgb(0.45, 0.45, 0.46);
  const COLOR_LINE = rgb(0.78, 0.78, 0.8);

  // 日本語フォント（TrueType/glyf）。
  // 注: pdf-lib(1.17.1)+fontkit のサブセット機能はグリフ欠落のバグがあるため、
  //     subset を使わず全埋め込み（embedFont の subset:false）で確実に埋め込む。
  const FONT_URL = "fonts/MPLUS1p-Regular.ttf";
  let fontBytesCache = null;

  async function getFontBytes() {
    if (fontBytesCache) return fontBytesCache;
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error("フォントの読み込みに失敗しました");
    fontBytesCache = await res.arrayBuffer();
    return fontBytesCache;
  }

  /* ---------- 文字列を幅に合わせて折り返す（日本語=文字単位） ---------- */
  function wrapText(font, text, size, maxW) {
    const lines = [];
    let cur = "";
    for (const ch of String(text)) {
      if (ch === "\n") {
        lines.push(cur);
        cur = "";
        continue;
      }
      const test = cur + ch;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    lines.push(cur);
    return lines;
  }

  /* ---------- 写真を JPEG バイト列へ（HEIC/回転/サイズ最適化） ---------- */
  async function fileToJpegBytes(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.82;

    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      bmp = await createImageBitmap(file); // 古い実装向けフォールバック
    }

    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const cw = Math.max(1, Math.round(bmp.width * scale));
    const ch = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, cw, ch);
    if (bmp.close) bmp.close();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* ---------- 表紙 ---------- */
  function drawCover(page, font, job, company) {
    // タイトル
    const title = "工事写真帳";
    const titleSize = 30;
    const tw = font.widthOfTextAtSize(title, titleSize);
    page.drawText(title, {
      x: (W - tw) / 2,
      y: H - 130,
      size: titleSize,
      font,
      color: COLOR_TEXT,
    });

    // 情報テーブル（罫線付き）
    const rows = [
      ["注文番号", job.orderNo || ""],
      ["工事名", job.name || ""],
      ["工事場所", job.place || ""],
    ];
    const tableW = W - MARGIN * 2;
    const labelW = 110;
    const rowH = 44;
    const tableTop = H - 230;
    const tableLeft = MARGIN;
    const valSize = 13;
    const labelSize = 12;

    rows.forEach((row, i) => {
      const top = tableTop - i * rowH;
      const bottom = top - rowH;
      // 行の外枠
      page.drawRectangle({
        x: tableLeft,
        y: bottom,
        width: tableW,
        height: rowH,
        borderColor: COLOR_LINE,
        borderWidth: 1,
      });
      // ラベル列の区切り
      page.drawLine({
        start: { x: tableLeft + labelW, y: top },
        end: { x: tableLeft + labelW, y: bottom },
        thickness: 1,
        color: COLOR_LINE,
      });
      // ラベル
      page.drawText(row[0], {
        x: tableLeft + 12,
        y: bottom + (rowH - labelSize) / 2,
        size: labelSize,
        font,
        color: COLOR_SUB,
      });
      // 値（長ければ縮小して1行に収める）
      let vs = valSize;
      const maxValW = tableW - labelW - 24;
      while (vs > 8 && font.widthOfTextAtSize(row[1], vs) > maxValW) vs -= 0.5;
      page.drawText(row[1], {
        x: tableLeft + labelW + 12,
        y: bottom + (rowH - vs) / 2,
        size: vs,
        font,
        color: COLOR_TEXT,
      });
    });

    // 自社情報（下部・中央寄せ）
    const infoLines = [];
    if (company.name) infoLines.push(company.name);
    const addr =
      (company.postal ? "〒" + company.postal + "  " : "") +
      (company.address || "");
    if (addr.trim()) infoLines.push(addr);
    const telfax =
      (company.tel ? "TEL " + company.tel : "") +
      (company.fax ? "　　FAX " + company.fax : "");
    if (telfax.trim()) infoLines.push(telfax);

    const infoSize = 12;
    let y = 150;
    infoLines.forEach((line, idx) => {
      const size = idx === 0 ? 14 : infoSize;
      const lw = font.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: (W - lw) / 2,
        y: y,
        size,
        font,
        color: idx === 0 ? COLOR_TEXT : COLOR_SUB,
      });
      y -= idx === 0 ? 24 : 20;
    });
  }

  /* ---------- 写真ページの1スロット ---------- */
  function drawPhotoSlot(page, font, image, texts, slotTop, slotH) {
    const pad = 10;
    const innerTop = slotTop - pad;
    const innerH = slotH - pad * 2;
    const imgBoxX = MARGIN;
    const imgBoxW = 290;
    const imgBoxY = innerTop - innerH;
    const imgBoxH = innerH;

    // 画像枠
    page.drawRectangle({
      x: imgBoxX,
      y: imgBoxY,
      width: imgBoxW,
      height: imgBoxH,
      borderColor: COLOR_LINE,
      borderWidth: 1,
    });

    // 画像（アスペクト比保持で枠内に収める）
    if (image) {
      const iw = image.width;
      const ih = image.height;
      const scale = Math.min(imgBoxW / iw, imgBoxH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      page.drawImage(image, {
        x: imgBoxX + (imgBoxW - dw) / 2,
        y: imgBoxY + (imgBoxH - dh) / 2,
        width: dw,
        height: dh,
      });
    }

    // 右側テキスト
    const textX = imgBoxX + imgBoxW + 18;
    const textW = W - MARGIN - textX;
    const labelSize = 10;
    const valSize = 12;
    let ty = innerTop - 6;

    const fields = [
      ["工事件名", texts.title],
      ["工事場所", texts.place],
      ["施工区分", texts.category],
    ];

    fields.forEach((f) => {
      page.drawText(f[0], {
        x: textX,
        y: ty - labelSize,
        size: labelSize,
        font,
        color: COLOR_SUB,
      });
      ty -= labelSize + 4;
      const valLines = wrapText(font, f[1] || "", valSize, textW);
      valLines.forEach((line) => {
        page.drawText(line, {
          x: textX,
          y: ty - valSize,
          size: valSize,
          font,
          color: COLOR_TEXT,
        });
        ty -= valSize + 4;
      });
      ty -= 8; // フィールド間
    });
  }

  /* ---------- メイン ---------- */
  async function generate(data) {
    const job = data.job || {};
    const company = data.company || {};
    const photos = data.photos || [];
    const onProgress = data.onProgress || function () {};

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    onProgress("フォントを準備中…");
    const fontBytes = await getFontBytes();
    // subset:false で全グリフを埋め込む（サブセッタのグリフ欠落バグ回避）
    const font = await doc.embedFont(fontBytes, { subset: false });

    // 表紙
    const cover = doc.addPage([W, H]);
    drawCover(cover, font, job, company);

    // 写真ページ（3枚/ページ）
    const perPage = 3;
    const contentH = H - MARGIN * 2;
    const slotH = contentH / perPage;

    for (let i = 0; i < photos.length; i++) {
      onProgress("写真を処理中… " + (i + 1) + "/" + photos.length);
      const photo = photos[i];

      // ページ確保
      if (i % perPage === 0) {
        doc.addPage([W, H]);
      }
      const page = doc.getPages()[doc.getPageCount() - 1];

      // 画像を埋め込み（常にJPEG化）
      let image = null;
      try {
        const jpgBytes = await fileToJpegBytes(photo.file);
        image = await doc.embedJpg(jpgBytes);
      } catch (e) {
        console.error("[koji] 画像の埋め込み失敗:", e);
      }

      const slotIndex = i % perPage;
      const slotTop = H - MARGIN - slotIndex * slotH;

      drawPhotoSlot(
        page,
        font,
        image,
        {
          // 件名・場所は工事情報の共通値、区分は写真ごと
          title: job.name || "",
          place: job.place || "",
          category: photo.category || "",
        },
        slotTop,
        slotH
      );
    }

    onProgress("PDFを書き出し中…");
    return await doc.save();
  }

  return { generate };
})();
