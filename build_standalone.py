"""standalone.html ビルダー。

index.html のマークアップ + vendor の three / OrbitControls / occt-import-js(JS+WASM) +
app.js を 1ファイルに全部インライン化し、file:// でダブルクリック起動できる
single-HTML を生成する（オフライン・ブックマーク可）。

  python build_standalone.py
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).parent
VENDOR = ROOT / "vendor"

# --- 素材読み込み ---
index_html = (ROOT / "index.html").read_text(encoding="utf-8")
three_js = (VENDOR / "three.module.js").read_text(encoding="utf-8")
orbit_js = (VENDOR / "OrbitControls.js").read_text(encoding="utf-8")
stl_js = (VENDOR / "STLLoader.js").read_text(encoding="utf-8")
occt_js = (VENDOR / "occt-import-js.js").read_text(encoding="utf-8")
app_js = (ROOT / "app.js").read_text(encoding="utf-8")
wasm_b64 = base64.b64encode((VENDOR / "occt-import-js.wasm").read_bytes()).decode("ascii")

# 念のため埋め込み破壊シーケンスを検査
for name, text in [("three", three_js), ("orbit", orbit_js), ("stl", stl_js), ("occt", occt_js), ("app", app_js)]:
    if "</script" in text.lower():
        raise SystemExit(f"[NG] {name} に </script が含まれ text/plain 埋め込みできません")

# --- index.html のマークアップ部だけ取り出す（CDN script群は捨てる）---
marker = "<!-- occt-import-js"
head = index_html.split(marker, 1)[0]   # <!DOCTYPE> 〜 #app 閉じまで

# --- インライン script 群を組み立て ---
inline = f"""
<!-- ==== 依存ライブラリをインライン埋め込み（オフライン・file://対応） ==== -->
<!-- occt-import-js グルー（classic script）: グローバル occtimportjs を定義 -->
<script>
{occt_js}
</script>

<!-- ES モジュールソースは text/plain で格納し、実行時に blob URL 化して import する -->
<script type="text/plain" id="src-three">
{three_js}
</script>
<script type="text/plain" id="src-orbit">
{orbit_js}
</script>
<script type="text/plain" id="src-stl">
{stl_js}
</script>
<script type="text/plain" id="src-app">
{app_js}
</script>
<!-- WASM バイナリ（base64） -->
<script type="application/octet-stream" id="wasm-b64">
{wasm_b64}
</script>

<script type="module">
function blobUrl(text) {{ return URL.createObjectURL(new Blob([text], {{ type: 'text/javascript' }})); }}

// three.js を blob 化して import
const threeUrl = blobUrl(document.getElementById('src-three').textContent);
const THREE = await import(threeUrl);

// OrbitControls / STLLoader は 'three' を import しているので blob URL に差し替える
const fixThree = (text) => text.replace(/from\\s+['"]three['"]/g, `from '${{threeUrl}}'`);
const {{ OrbitControls }} = await import(blobUrl(fixThree(document.getElementById('src-orbit').textContent)));
const {{ STLLoader }} = await import(blobUrl(fixThree(document.getElementById('src-stl').textContent)));

// 本体ロジック
const {{ createViewer }} = await import(blobUrl(document.getElementById('src-app').textContent));

// WASM バイナリを復号して occt を初期化（fetch なし）
const b64 = document.getElementById('wasm-b64').textContent.trim();
const wasmBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
let occt = null;
async function getOcct() {{
  if (occt) return occt;
  occt = await occtimportjs({{ wasmBinary: wasmBytes }});
  return occt;
}}

createViewer({{ THREE, OrbitControls, getOcct, STLLoader }});
</script>
</body>
</html>
"""

out = head + inline
out_path = ROOT / "standalone.html"
out_path.write_text(out, encoding="utf-8")
mb = out_path.stat().st_size / 1024 / 1024
print(f"[OK] standalone.html を生成 ({mb:.1f} MB)")
