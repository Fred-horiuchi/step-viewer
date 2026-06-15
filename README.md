# STEP Web Viewer

ブラウザだけで動く汎用 STEP ビューア。STEP（.step/.stp）をドラッグ&ドロップすると、その場で3D表示する。
**Python不要・サーバーへのアップロードなし**（ファイルはブラウザ内でのみ処理）。

## 公開URL（社内配布）
**https://final-step-viewer.pages.dev/** （Cloudflare Pages）
Mac / Windows / iPad どのブラウザでもOK。STEPは各自ブラウザ内で処理され外部送信なし。

## 2つの形態

### 1. standalone.html（推奨・ブックマーク用）
依存ライブラリ（three.js / OpenCASCADE WASM）を**すべて1ファイルに内蔵**。
**ダブルクリックで開けてオフライン動作・ブックマーク可能**（CDN/サーバー不要）。

- エクスプローラで `standalone.html` をダブルクリック → 既定ブラウザで開く
- ブラウザで `Ctrl+D` → ブックマークに登録すれば、以後ワンクリックで起動
- 配布も `standalone.html` 1つを渡すだけ（約11MB）

### 2. index.html（開発用・CDN版）
ライブラリを CDN から読む軽量版。`file://` 直開きは不可なのでローカルHTTP配信が必要。
```
python -m http.server 8753
# → http://localhost:8753/index.html
```

## 機能（v0.3）
- ドラッグ&ドロップ / ファイル選択での読み込み
- 回転・パン・ズーム（**慣性なし**）、フィット
- **断面表示**（X/Y/Z軸・位置スライダー・向き反転／**断面キャップで切断面を中実に塗りつぶし**）
- ワイヤーフレーム表示切替、エッジ表示切替
- ソリッド数・三角形数のステータス表示

## 技術構成
- **occt-import-js**（OpenCASCADE の WASM 版）: STEP → メッシュ変換
- **three.js**: 3Dレンダリング + OrbitControls
- ロジックは `app.js` に集約し、index.html / standalone.html で共有

## ビルド（standalone.html の再生成）
`app.js` や `index.html` を変更したら再ビルドする。
```
python build_standalone.py
```
`vendor/` のライブラリを取り直す場合:
```
curl -o vendor/three.module.js  https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js
curl -o vendor/OrbitControls.js https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js
curl -o vendor/occt-import-js.js   https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js
curl -o vendor/occt-import-js.wasm https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm
```

## デプロイ（Cloudflare Pages）
本番URL `https://final-step-viewer.pages.dev/` へは wrangler で直接アップロード（GitHub連携ではない）。
更新時の手順:
```
python build_standalone.py          # standalone.html を再生成
# dist を作り直す（公開ファイル一式）
rm -rf dist && mkdir dist && cp index.html app.js standalone.html dist/ && cp -r vendor dist/vendor
# デプロイ（初回のみブラウザで npx wrangler login）
npx wrangler pages deploy dist --project-name=final-step-viewer --branch=main
```
Cloudflare アカウントは無料枠（帯域無制限・クレカ不要）。`dist/` は生成物で Git 管理外。

## ファイル構成
```
step_web_viewer/
├── standalone.html       ← 配布用・ブックマーク用（全部入り、生成物）
├── index.html            ← 同一オリジン配信版ローダ（./vendor 参照）
├── app.js                ← 本体ロジック（共有）
├── build_standalone.py   ← standalone 生成スクリプト
├── vendor/               ← three.js / occt-import-js（配信元）
├── dist/                 ← Cloudflare 公開ファイル一式（生成物・Git管理外）
└── README.md
```

## 今後の候補
- 寸法計測（2点間距離）
- モデルツリー（ソリッド単位の表示/非表示）
