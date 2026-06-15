// STEP Viewer 本体ロジック。
// index.html(CDN版) と standalone.html(全部入り) の両方から呼ばれる。
// 依存は引数で注入する（環境ごとに three / OrbitControls / occt の取得方法が違うため）。
//   THREE          : three.js モジュール
//   OrbitControls  : OrbitControls クラス
//   getOcct        : async () => occt インスタンス（WASM初期化済み）

export function createViewer({ THREE, OrbitControls, getOcct }) {
  const wrap = document.getElementById('canvas-wrap');
  const statusEl = document.getElementById('status');
  const spinner = document.getElementById('spinner');
  const spinnerMsg = document.getElementById('spinner-msg');
  const dropzone = document.getElementById('dropzone');
  const filenameEl = document.getElementById('filename');

  function setStatus(t) { statusEl.textContent = t; }
  function showSpinner(show, msg) { spinner.classList.toggle('show', show); if (msg) spinnerMsg.textContent = msg; }

  // --- three.js セットアップ ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e2126);

  const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 1e6);
  camera.position.set(100, 100, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });  // r163+ は既定で stencil 無効
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // 高DPRスマホの描画負荷を抑制
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.localClippingEnabled = true;   // 断面表示に必要
  wrap.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;          // 慣性なし

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(1, 1.5, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1, -0.5, -1); scene.add(fill);

  const grid = new THREE.GridHelper(1000, 50, 0x444444, 0x2a2d33);
  scene.add(grid);

  let modelGroup = null;
  let edgeGroup = null;
  let stencilGroup = null;   // 断面キャップ用ステンシル書き込みオブジェクト
  let capMesh = null;        // 断面キャップ（切断面の塗りつぶし）
  let showWire = false;
  let showEdges = true;
  let bbox = null;

  const sectionState = { enabled: false, axis: 0, flip: false, t: 0.5 };
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

  // 断面キャップ: ジオメトリの裏面/表面をステンシルに増減記録し、内部(=非ゼロ)だけを塗る
  function createPlaneStencilGroup(geometry, plane, renderOrder) {
    const group = new THREE.Group();
    const baseMat = new THREE.MeshBasicMaterial();
    baseMat.depthWrite = false;
    baseMat.depthTest = false;
    baseMat.colorWrite = false;
    baseMat.stencilWrite = true;
    baseMat.stencilFunc = THREE.AlwaysStencilFunc;

    const mat0 = baseMat.clone();
    mat0.side = THREE.BackSide;
    mat0.clippingPlanes = [plane];
    mat0.stencilFail = THREE.IncrementWrapStencilOp;
    mat0.stencilZFail = THREE.IncrementWrapStencilOp;
    mat0.stencilZPass = THREE.IncrementWrapStencilOp;
    const mesh0 = new THREE.Mesh(geometry, mat0);
    mesh0.renderOrder = renderOrder;
    group.add(mesh0);

    const mat1 = baseMat.clone();
    mat1.side = THREE.FrontSide;
    mat1.clippingPlanes = [plane];
    mat1.stencilFail = THREE.DecrementWrapStencilOp;
    mat1.stencilZFail = THREE.DecrementWrapStencilOp;
    mat1.stencilZPass = THREE.DecrementWrapStencilOp;
    const mesh1 = new THREE.Mesh(geometry, mat1);
    mesh1.renderOrder = renderOrder;
    group.add(mesh1);

    return group;
  }

  function updateCap() {
    if (!capMesh || !sectionState.enabled) return;
    clipPlane.coplanarPoint(capMesh.position);
    capMesh.lookAt(
      capMesh.position.x - clipPlane.normal.x,
      capMesh.position.y - clipPlane.normal.y,
      capMesh.position.z - clipPlane.normal.z
    );
  }

  function render() { renderer.render(scene, camera); }
  function animate() { requestAnimationFrame(animate); controls.update(); updateCap(); render(); }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  });

  // --- STEP読み込み ---
  async function loadStepBuffer(arrayBuffer, name) {
    try {
      showSpinner(true, 'CADエンジン初期化中...');
      const occt = await getOcct();
      showSpinner(true, 'STEP解析中...');

      const fileBuffer = new Uint8Array(arrayBuffer);
      const result = occt.ReadStepFile(fileBuffer, null);
      if (!result || !result.success) throw new Error('STEPの解析に失敗しました');

      if (modelGroup) { scene.remove(modelGroup); disposeGroup(modelGroup); }
      if (edgeGroup) { scene.remove(edgeGroup); disposeGroup(edgeGroup); }
      if (stencilGroup) { scene.remove(stencilGroup); disposeGroup(stencilGroup); }
      if (capMesh) { scene.remove(capMesh); capMesh.geometry.dispose(); capMesh.material.dispose(); capMesh = null; }
      modelGroup = new THREE.Group();
      edgeGroup = new THREE.Group();
      stencilGroup = new THREE.Group();

      let triCount = 0;
      for (const mesh of result.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
        if (mesh.attributes.normal) {
          geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
        }
        const index = mesh.index ? mesh.index.array : null;
        if (index) geometry.setIndex(new THREE.Uint32BufferAttribute(index, 1));
        if (!mesh.attributes.normal) geometry.computeVertexNormals();
        triCount += (index ? index.length : geometry.attributes.position.count) / 3;

        let color = 0xb0b6bd;
        if (mesh.color) color = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]).getHex();
        const material = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide, flatShading: false, clippingPlanes: [], clipShadows: true });
        const obj = new THREE.Mesh(geometry, material);
        modelGroup.add(obj);

        const edges = new THREE.EdgesGeometry(geometry, 30);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2a2d33, clippingPlanes: [] }));
        edgeGroup.add(line);
      }

      scene.add(modelGroup);
      scene.add(edgeGroup);
      edgeGroup.visible = showEdges;
      bbox = new THREE.Box3().setFromObject(modelGroup);

      // 断面キャップ: 各ソリッドのステンシル書き込み群 + 切断面を塗るキャップ平面
      let ro = 1;
      modelGroup.traverse(o => { if (o.isMesh) { stencilGroup.add(createPlaneStencilGroup(o.geometry, clipPlane, ro++)); } });
      scene.add(stencilGroup);

      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      const capSize = sphere.radius * 2.5;
      const capMat = new THREE.MeshStandardMaterial({
        color: 0x7d8893, metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      });
      capMesh = new THREE.Mesh(new THREE.PlaneGeometry(capSize, capSize), capMat);
      capMesh.renderOrder = 10;
      capMesh.onAfterRender = (r) => r.clearStencil();
      scene.add(capMesh);

      applyWire();
      applySection();

      fitView();
      dropzone.classList.add('hidden');
      filenameEl.textContent = name;
      showSpinner(false);
      setStatus(`${name} ・ ${result.meshes.length} ソリッド ・ ${Math.round(triCount).toLocaleString()} 三角形`);
    } catch (e) {
      showSpinner(false);
      setStatus('エラー: ' + e.message);
      console.error(e);
      alert('読み込みエラー: ' + e.message);
    }
  }

  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  function fitView() {
    if (!modelGroup) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 100;

    grid.position.set(center.x, box.min.y, center.z);
    const gscale = maxDim / 1000 * 2;
    grid.scale.setScalar(gscale > 0 ? gscale : 1);

    const dist = maxDim * 2.2;
    camera.near = maxDim / 1000;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    camera.position.set(center.x + dist, center.y + dist * 0.8, center.z + dist);
    controls.target.copy(center);
    controls.update();
  }

  function applyWire() {
    if (!modelGroup) return;
    modelGroup.traverse(o => { if (o.isMesh) o.material.wireframe = showWire; });
  }

  function applySection() {
    if (!modelGroup) return;
    const planes = sectionState.enabled ? [clipPlane] : [];
    if (sectionState.enabled && bbox) {
      const min = bbox.min, max = bbox.max;
      const lo = [min.x, min.y, min.z][sectionState.axis];
      const hi = [max.x, max.y, max.z][sectionState.axis];
      const pos = lo + (hi - lo) * sectionState.t;
      const n = new THREE.Vector3(0, 0, 0);
      n.setComponent(sectionState.axis, sectionState.flip ? 1 : -1);
      clipPlane.normal.copy(n);
      clipPlane.constant = -n.dot(new THREE.Vector3().setComponent(sectionState.axis, pos));
    }
    modelGroup.traverse(o => { if (o.isMesh) o.material.clippingPlanes = planes; });
    if (edgeGroup) edgeGroup.traverse(o => { if (o.isLineSegments) o.material.clippingPlanes = planes; });
    if (stencilGroup) stencilGroup.visible = sectionState.enabled;
    if (capMesh) capMesh.visible = sectionState.enabled;
    updateCap();
  }

  // --- ファイル受け取り ---
  async function handleFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'step' && ext !== 'stp') { alert('STEPファイル（.step / .stp）を指定してください'); return; }
    const buf = await file.arrayBuffer();
    await loadStepBuffer(buf, file.name);
  }

  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
    e.target.value = '';   // 同じファイルを連続で選べるようにリセット
  });
  // ドロップゾーンのタップ/クリックでもファイル選択を開く（スマホ向け）
  dropzone.addEventListener('click', () => fileInput.click());

  // タッチ端末向けの文言・選択制限の調整
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (isTouch) {
    const msg = dropzone.querySelector('.msg');
    const sub = dropzone.querySelector('.sub');
    if (msg) msg.textContent = 'タップしてSTEPファイルを開く';
    if (sub) sub.textContent = '.step / .stp に対応 ・ 端末内で処理（アップロードなし）';
    fileInput.removeAttribute('accept');  // iOS等で .step が選べない問題を回避
  }

  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.remove('hidden'); dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    if (ev === 'dragleave' && e.relatedTarget) return;
    if (ev !== 'drop' && modelGroup) dropzone.classList.add('hidden');
  }));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    else if (modelGroup) dropzone.classList.add('hidden');
  });

  // --- ツールバー ---
  const btnWire = document.getElementById('btn-wire');
  const btnEdges = document.getElementById('btn-edges');
  const btnSection = document.getElementById('btn-section');
  const sectionPanel = document.getElementById('section-panel');
  btnEdges.classList.toggle('active', showEdges);

  document.getElementById('btn-fit').addEventListener('click', fitView);
  btnWire.addEventListener('click', () => { showWire = !showWire; btnWire.classList.toggle('active', showWire); applyWire(); });
  btnEdges.addEventListener('click', () => { showEdges = !showEdges; btnEdges.classList.toggle('active', showEdges); if (edgeGroup) edgeGroup.visible = showEdges; });

  btnSection.addEventListener('click', () => {
    sectionState.enabled = !sectionState.enabled;
    btnSection.classList.toggle('active', sectionState.enabled);
    sectionPanel.classList.toggle('show', sectionState.enabled);
    applySection();
  });

  sectionPanel.querySelectorAll('.axisbtns button').forEach(b => {
    b.addEventListener('click', () => {
      sectionPanel.querySelectorAll('.axisbtns button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      sectionState.axis = parseInt(b.dataset.axis, 10);
      applySection();
    });
  });
  document.getElementById('sec-pos').addEventListener('input', (e) => {
    sectionState.t = e.target.value / 1000;
    applySection();
  });
  document.getElementById('sec-flip').addEventListener('click', () => {
    sectionState.flip = !sectionState.flip;
    applySection();
  });

  setStatus(isTouch ? 'STEPファイルをタップして開く' : 'STEPファイルをドラッグ&ドロップ、または「ファイルを開く」');
}
