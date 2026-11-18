import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PLATFORM = document.body.dataset.platform;          // 'android' | 'ios'
const SCALE_AR = 1 / 500;                                  // maqueta 1:500 sobre la mesa
const $ = (id) => document.getElementById(id);

// ---------- escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bg = new THREE.Color(0xeeeeec);
scene.background = bg;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 5000);
const far = innerWidth < innerHeight ? 1.9 : 1.0;
camera.position.set(-170 * far, 190 * far, 230 * far);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 25);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8a80, 1.15));
const sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
sun.position.set(-120, 220, 160);
scene.add(sun);

// raiz: en 3D va en metros; en AR se escala a 1:500
const root = new THREE.Group();
scene.add(root);
const model = new THREE.Group();
root.add(model);

// ---------- cortes ----------
// planos en coordenadas del modelo ya centrado (centro original x 100, z -43,5)
const plan = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);       // corte horizontal
const SECS = {
  A: { n: [0, 0, -1], p: [0, 0, 11.0], name: 'A-A · atrio, pasaje y jardín' },
  B: { n: [-1, 0, 0], p: [-62.6, 0, 0], name: 'B-B · shopping y atrio' },
  C: { n: [-1, 0, -0.183], p: [-19.15, 0, 5.5], name: 'C-C · andenes' },
  D: { n: [-1, 0, 0], p: [57.0, 0, 0], name: 'D-D · jardín cubierto' },
};
const sec = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e5);
let secKey = null, secOff = 0, secFlip = false;
const planesLocal = [plan, sec];
const planesWorld = [new THREE.Plane(), new THREE.Plane()];

function setSection(k) {
  secKey = k;
  document.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('on', b.dataset.sec === (k || '0')));
  $('secname').textContent = k ? SECS[k].name : 'sin corte vertical';
  $('secoff').disabled = !k;
  updatePlanes();
}
function updatePlanes() {
  const h = parseFloat($('plan').value);
  $('planval').textContent = h >= 44 ? 'sin corte' : (h <= 0.05 ? '±0,00' : '+' + h.toFixed(2).replace('.', ',')) + ' m';
  plan.set(new THREE.Vector3(0, -1, 0), h >= 44 ? 1000 : h);
  if (secKey) {
    const s = SECS[secKey];
    const n = new THREE.Vector3(...s.n).normalize();
    if (secFlip) n.negate();
    const p = new THREE.Vector3(...s.p).addScaledVector(n, secOff * (secFlip ? -1 : 1));
    sec.setFromNormalAndCoplanarPoint(n, p);
  } else sec.set(new THREE.Vector3(1, 0, 0), 1e5);
  syncWorldPlanes();
}
function syncWorldPlanes() {
  model.updateMatrixWorld(true);
  const m = model.matrixWorld;
  planesLocal.forEach((pl, i) => planesWorld[i].copy(pl).applyMatrix4(m));
}

// ---------- capas ----------
const layers = { cubierta: [], piel: [], ctx: [], edif: [], tren: [], base: [] };
function setLayer(name, vis) { layers[name].forEach((o) => (o.visible = vis)); }

// ---------- carga ----------
const loader = new GLTFLoader();
loader.load('maqueta.glb', (g) => {
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ly = (o.name || '').split('__')[0];
    (layers[ly] || layers.edif).push(o);
    const m = o.material;
    m.clippingPlanes = planesWorld;
    m.clipShadows = true;
    m.side = THREE.DoubleSide;
    if (m.transparent) { m.depthWrite = false; m.opacity = 0.35; }
    m.roughness = 0.9; m.metalness = 0; m.flatShading = true;
  });
  model.add(g.scene);
  $('loading').style.display = 'none';
  updatePlanes();
}, (e) => {
  if (e.total) $('loadpct').textContent = Math.round((e.loaded / e.total) * 100) + ' %';
}, (err) => { $('loading').textContent = 'No se pudo cargar la maqueta.'; console.error(err); });

// ---------- interfaz ----------
$('plan').addEventListener('input', updatePlanes);
$('secoff').addEventListener('input', () => { secOff = parseFloat($('secoff').value); updatePlanes(); });
document.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => setSection(b.dataset.sec === '0' ? null : b.dataset.sec)));
$('flip').addEventListener('click', () => { secFlip = !secFlip; updatePlanes(); });
document.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => setLayer(c.dataset.layer, c.checked)));
$('toggleui').addEventListener('click', () => document.body.classList.toggle('mini'));
setSection(null);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- AR Android (WebXR) ----------
let hitSource = null, placed = false, reticle = null, arRot = 0;
if (PLATFORM === 'android') {
  reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe0457b }));
  reticle.matrixAutoUpdate = false; reticle.visible = false;
  scene.add(reticle);
  const btn = $('arbtn');
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (!ok) { btn.textContent = 'AR no disponible en este celular'; btn.disabled = true; }
    });
  } else { btn.textContent = 'AR no disponible en este navegador'; btn.disabled = true; }
  btn.addEventListener('click', async () => {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: $('overlay') },
    });
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    document.body.classList.add('ar');
    scene.background = null;
    root.visible = false; placed = false;
    root.scale.setScalar(SCALE_AR); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); arRot = 0;
    const viewer = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('select', (ev) => {
      if (ev.inputSource && ev.inputSource.targetRayMode === 'screen' && placed) return;  // los toques en la interfaz no reubican
      if (reticle.visible) {
        reticle.matrix.decompose(root.position, new THREE.Quaternion(), new THREE.Vector3());
        root.visible = true; placed = true; $('arhint').textContent = 'Usá los cortes. Tocá «Reubicar» para moverla.';
      }
    });
    session.addEventListener('end', () => {
      document.body.classList.remove('ar'); scene.background = bg; hitSource = null;
      root.scale.setScalar(1); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.visible = true; reticle.visible = false;
    });
  });
  $('arplace').addEventListener('click', (e) => { e.stopPropagation(); placed = false; root.visible = false; $('arhint').textContent = 'Apuntá a la mesa y tocá para apoyar la maqueta.'; });
  $('arrot').addEventListener('click', (e) => { e.stopPropagation(); arRot += Math.PI / 8; root.rotation.y = arRot; });
  $('arsize').addEventListener('click', (e) => {
    e.stopPropagation();
    const s = root.scale.x > 1 / 400 ? 1 / 1000 : (root.scale.x > 1 / 700 ? 1 / 250 : 1 / 500);
    root.scale.setScalar(s); $('arsize').textContent = 'Escala 1:' + Math.round(1 / s);
  });
  $('arexit').addEventListener('click', (e) => { e.stopPropagation(); renderer.xr.getSession()?.end(); });
  ['overlay'].forEach((id) => $(id).addEventListener('beforexrselect', (e) => e.preventDefault()));
}

// ---------- AR iPhone (Quick Look, sin cortes) ----------
if (PLATFORM === 'ios') {
  const btn = $('arbtn');
  btn.addEventListener('click', async () => {
    btn.textContent = 'Preparando…'; btn.disabled = true;
    try {
      const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
      const g = new THREE.Group();
      const copy = model.clone(true);
      copy.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        o.geometry.computeVertexNormals();
        o.material = o.material.clone(); o.material.clippingPlanes = null; o.material.side = THREE.FrontSide;
      });
      copy.traverse((o) => { if (o.isMesh && !o.visible) o.parent.remove(o); });
      copy.scale.setScalar(SCALE_AR);
      g.add(copy);
      const data = await new USDZExporter().parse(g);
      const url = URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' }));
      const a = $('qlink'); a.href = url; a.click();
    } catch (err) { console.error(err); alert('No se pudo abrir la vista en la mesa.'); }
    btn.textContent = 'Ver en la mesa (AR)'; btn.disabled = false;
  });
}

// ---------- loop ----------
renderer.setAnimationLoop((t, frame) => {
  if (frame && hitSource) {
    const ref = renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length && !placed) {
      reticle.visible = true;
      reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
    } else reticle.visible = false;
  } else controls.update();
  syncWorldPlanes();
  renderer.render(scene, camera);
});
