# STEP Web Viewer

ブラウザだけで動く汎用 STEP ビューア。STEP（.step/.stp）をドラッグ&ドロップすると、その場で3D表示する。
**Python不要・サーバーへのアップロードなし**（ファイルはブラウザ内でのみ処理）。

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

## 機能（v0.2）
- ドラッグ&ドロップ / ファイル選択での読み込み
- 回転・パン・ズーム（**慣性なし**）、フィット
- **断面表示**（X/Y/Z軸・位置スライダー・向き反転／キャップなしで内部キャビティを直視）
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

## ファイル構成
```
step_web_viewer/
├── standalone.html       ← 配布用・ブックマーク用（全部入り、生成物）
├── index.html            ← CDN版ローダ
├── app.js                ← 本体ロジック（共有）
├── build_standalone.py   ← standalone 生成スクリプト
├── vendor/               ← three.js / occt-import-js（インライン元）
└── README.md
```

## 今後の候補
- 断面キャップ（切断面を塗りつぶし、ソリッド断面に見せる）
- 寸法計測（2点間距離）
- モデルツリー（ソリッド単位の表示/非表示）
