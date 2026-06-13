# 工事写真台帳アプリ — CLAUDE.md

安福冷暖の工事写真帳を作成・メール送付するためのアプリ。

## 1. 目的

iPhone に保存済みの「黒板が焼き込まれた工事写真」を選択し、アプリ上で並べ替え・テキスト付与を行い、
写真3枚/ページの工事写真帳PDFを自動生成して、メールで送付する。

- **やること**: 写真選択 → 並べ替え → 写真ごとのテキスト入力 → 表紙付きPDF生成 → 共有シートでメール送付
- **やらないこと**: 撮影、黒板合成、写真の長期保存

黒板は別アプリで撮影時に焼き込み済み。このアプリは「資料作成とメール送信に特化」する。

## 2. 技術方針

- **PWA**（iPhone Safari で開きホーム画面に追加）。
- **バニラ HTML / CSS / JavaScript のみ**。ビルドツール・フレームワーク不使用。
- 外部ライブラリは **PDF生成（pdf-lib + fontkit、日本語フォント埋め込み）のみ**許可。それ以外は使わない。
- 設定・軽量データは **localStorage**。写真は溜め込まず、作業セッション内でのみ保持。
- デザインは **Apple風ミニマル**（白〜薄グレー背景、アクセント1色 = `#007AFF`）。
- スマホ前提: viewport メタタグ、タップ領域 **最低44px**、**横スクロールなし**。

## 3. フォルダ構成

```
koujikanri/
├── index.html          # エントリ（タイトル + ホーム画面）
├── manifest.json       # PWA マニフェスト（standalone / テーマカラー）
├── sw.js               # Service Worker（App Shell オフラインキャッシュ）
├── CLAUDE.md           # このファイル
├── css/
│   └── style.css       # グローバルスタイル（CSS変数でテーマ管理）
├── js/
│   ├── app.js          # アプリ本体（写真選択/並べ替え + 工事情報/写真ごとテキスト/設定 + PDF起動）
│   ├── pdf.js          # PDF生成（pdf-lib + fontkit、表紙＋3枚/ページ）
│   └── lib/
│       ├── pdf-lib.min.js        # ローカル同梱（オフライン対応）
│       └── fontkit.umd.min.js    # ローカル同梱
├── fonts/
│   └── MPLUS1p-Regular.ttf       # 日本語フォント（TrueType/glyf、全埋め込み）
└── icons/
    ├── icon-192.png    # プレースホルダ（要差し替え）
    └── icon-512.png    # プレースホルダ（要差し替え）
```

PDF: `window.KojiPDF.generate({ job, company, photos, onProgress })` → Uint8Array。
写真は canvas 経由で JPEG 化（HEIC/EXIF回転/サイズ最適化, 最大1600px）してから `embedJpg`。
日本語は **M PLUS 1p（TrueType/glyf）を `embedFont(bytes, { subset:false })` で全埋め込み**。
- 重要: pdf-lib(1.17.1)+@pdf-lib/fontkit(1.1.1) の**サブセット機能はグリフ欠落のバグ**があり、
  さらに CFF/OTTO フォント（Noto Sans JP 等）はサブセット埋め込みが壊れて iPhone で文字化けする。
  そのため TrueType フォント＋`subset:false`（全埋め込み, 約1MB/PDF）で確実に埋め込む。
ファイル名: `工事写真帳_{工事名}_{YYYY-MM-DD}.pdf`。

## 4. 段階的開発計画（Phase 0〜4）

| Phase | 内容 | ゴール | 状態 |
| :-- | :-- | :-- | :-- |
| Phase 0 | プロジェクト初期化・CLAUDE.md・PWA骨組み | ホーム画面に追加でき、空アプリが起動 | ✅ 完了 |
| Phase 1 | 写真の複数選択＋一覧表示＋並べ替え | 写真を選び、サムネを並べ替えできる | ✅ 完了 |
| Phase 2 | 工事情報入力＋写真ごとのテキスト入力＋設定画面 | 各写真に件名/場所/区分を付与でき、設定が保存される | ✅ 完了 |
| Phase 3 | 写真帳PDF生成（表紙＋3枚/ページ、日本語フォント埋め込み） | 現行報告書と同等のPDFが出力できる | ✅ 完了 |
| Phase 4 | 共有シート連携（宛先・件名の雛形反映）＋仕上げ | PDFをメールで送付でき、UIが整う | 未着手 |

各Phaseは順に積み上げる。1つ完了 → iPhoneで確認 → 次へ。

## localStorage キー（Phase 2〜）

- `koji.jobInfo` … `{ orderNo, name, place }`（工事情報。表紙・写真初期値に使用）
- `koji.company` … `{ name, postal, address, tel, fax }`（自社情報。表紙下部）
- `koji.mail` … `{ to, subject }`（メール雛形。件名は `{工事名}` を差し込み）
- `koji.categories` … `string[]`（施工区分タグの候補）

写真ごとに設定するのは **施工区分（`category`）のみ**。工事件名・工事場所は
工事情報（`koji.jobInfo` の name/place）の共通値を全写真で使う（写真ごとには持たない）。
`category` は state.photos の各要素に保持し、**写真と同様セッション内のみ**で永続化しない。

## 5. 留意点

- **黒板合成は不要**: 写真は無加工で扱う。
- **写真は溜め込まない**: 1工事ぶんの作業セッション内でのみ保持。終わったらクリア。
- **日本語PDF**: pdf-lib は標準で日本語非対応。fontkit で日本語フォントをサブセット埋め込み（Phase 3）。
- **メール送信は手動**: Web Share で共有シートに渡すところまで。宛先・件名の自動反映は iOS 側の制約あり（Phase 4 で最も確実な方法を選ぶ）。
- **アイコン**: 現状 1×1 のプレースホルダPNG。正式アイコンに差し替えること。

## 6. 動作確認（ローカル）

PWA は `file://` では Service Worker が動かないため、簡易HTTPサーバ経由で確認する。
（この環境には Python/Node がないため、確認は別途サーバを用意するか、iPhone から同一LAN上のサーバで開く）
