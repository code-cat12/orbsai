// The 3D hero orb: a glossy, iridescent sphere with a thin glass ring (like the logo) that slowly floats.
// Three.js is vendored (vendor/three-orb.min.js) and only loaded once an orb is actually on screen.
// Each [data-orb3d] element holds a CSS fallback orb (.orb3d-fb) that stays put if WebGL or the import fails.
// Cheap on purpose: DPR capped at 2, renders only while visible and the tab is shown, one still frame for reduced motion.

const els = [...document.querySelectorAll("[data-orb3d]")];
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const kicks = new Set();   // restart hooks for mounted orbs (e.g. when the landing page closes and Home shows)
const gateEl = document.getElementById("gate");
if (gateEl) new MutationObserver(() => kicks.forEach(k => k())).observe(gateEl, { attributes: true, attributeFilter: ["hidden"] });
let threeP = null;
const loadThree = () => threeP ||= import("./vendor/three-orb.min.js");

function hasWebGL(){
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch(e) { return false; }
}

// A soft equirectangular "studio" painted in the current sky palette (tod.js): blended blobs + a few bright softboxes,
// so the orb's reflections shimmer in the same colors as the background and shift with the time of day.
const FALLBACK_SKY = { sky1:"#f4efff", sky2:"#cfc6ea", b1:"#5b5bd6", b2:"#9b5cff", b3:"#ff5fb8", b4:"#ffb080", b5:"#34c7be", dark:0 };
function envCanvas(p){
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d");
  const base = g.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, p.sky1); base.addColorStop(1, p.sky2);
  g.fillStyle = base; g.fillRect(0, 0, 1024, 512);
  const blob = (x, y, r, col, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); g.globalAlpha = a; rg.addColorStop(0, col); rg.addColorStop(1, col + "00"); g.fillStyle = rg; g.fillRect(0, 0, 1024, 512); g.globalAlpha = 1; };
  blob(120, 250, 250, p.b1, .95); blob(380, 300, 240, p.b2, .9); blob(620, 230, 250, p.b3, .9);
  blob(830, 300, 230, p.b4, .9); blob(1010, 260, 210, p.b5, .85); blob(-10, 260, 210, p.b5, .7);
  const box = (x, y, w, h, a) => { g.save(); g.globalAlpha = a; g.fillStyle = "#ffffff"; g.shadowColor = "#fff"; g.shadowBlur = 40; g.fillRect(x, y, w, h); g.restore(); };
  const glow = p.dark > .5 ? .85 : 1;
  box(430, 40, 170, 70, glow);  // key softbox above
  box(140, 120, 70, 120, glow * .9); // side strip
  box(760, 110, 60, 90, glow * .8);  // rim
  return c;
}

async function mount(el){
  if (el._orb) return; el._orb = true;
  if (!hasWebGL()) return;
  let T;
  try { T = await loadThree(); } catch(e) { return; }
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); } catch(e) { return; }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement; canvas.className = "orb3d-cv"; canvas.setAttribute("aria-hidden", "true");

  const scene = new T.Scene();
  let envRT = null;
  const tint = (p) => {   // (re)light the orb from the current sky palette
    const pmrem = new T.PMREMGenerator(renderer);
    const envTex = new T.CanvasTexture(envCanvas(p || FALLBACK_SKY)); envTex.mapping = T.EquirectangularReflectionMapping; envTex.colorSpace = T.SRGBColorSpace;
    const rt = pmrem.fromEquirectangular(envTex);
    scene.environment = rt.texture; envRT?.dispose(); envRT = rt;
    envTex.dispose(); pmrem.dispose();
  };
  tint(window.__orbsSky);

  const camera = new T.PerspectiveCamera(30, 1, .1, 50);
  camera.position.set(0, 0, 6.8);

  const group = new T.Group(); scene.add(group);
  const sphere = new T.Mesh(new T.SphereGeometry(1, 96, 64), new T.MeshPhysicalMaterial({
    color: new T.Color("#e2d9fb"), metalness: .42, roughness: .1,
    clearcoat: 1, clearcoatRoughness: .04,
    iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 820],
    sheen: .6, sheenColor: new T.Color("#ffb3dd"), sheenRoughness: .4,
    envMapIntensity: 1.25
  }));
  group.add(sphere);

  const ring = new T.Mesh(new T.TorusGeometry(1.5, .028, 24, 180), new T.MeshPhysicalMaterial({
    color: new T.Color("#ffffff"), metalness: .55, roughness: .08, clearcoat: 1,
    iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [300, 900], envMapIntensity: 1.4
  }));
  ring.rotation.set(Math.PI / 2 - .32, 0, -.38);
  group.add(ring);

  const moon = new T.Mesh(new T.SphereGeometry(.085, 32, 24), new T.MeshPhysicalMaterial({
    color: new T.Color("#ff5fb8"), roughness: .2, clearcoat: 1, emissive: new T.Color("#ff5fb8"), emissiveIntensity: .35
  }));
  group.add(moon);

  const key = new T.DirectionalLight(0xffffff, 1.4); key.position.set(-2.5, 3, 4); scene.add(key);
  const retint = (p) => {
    p = p || FALLBACK_SKY;
    tint(p);
    key.color.set(p.b4).lerp(new T.Color("#ffffff"), .6);   // warm at golden hour, cool at night
    sphere.material.sheenColor.set(p.b3);
    // On bright skies a pale orb disappears, so give the glass more body from the palette; at night keep it luminous
    sphere.material.color.set(p.b3).lerp(new T.Color("#ffffff"), p.dark > .5 ? .7 : .42);
    ring.material.color.set(p.b1).lerp(new T.Color("#ffffff"), .45);
    moon.material.color.set(p.b4); moon.material.emissive.set(p.b4);
    renderer.toneMappingExposure = p.dark > .5 ? 1.2 : .92;
    if (!raf) requestAnimationFrame(frame);
  };
  addEventListener("orbs:sky", (e) => retint(e.detail));

  el.appendChild(canvas);

  let w = 0, h = 0;
  const size = () => {
    const r = el.getBoundingClientRect(); const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    if (nw === w && nh === h) return; w = nw; h = nh;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };

  let visible = false, raf = 0, t0 = performance.now(), shown = false;
  const frame = (now) => {
    const t = (now - t0) / 1000;
    group.position.y = Math.sin(t * .55) * .07;
    group.rotation.z = Math.sin(t * .3) * .05;
    sphere.rotation.y = t * .18;
    scene.environmentRotation.y = t * .12;   // reflections drift across the surface
    scene.environmentRotation.x = Math.sin(t * .2) * .15;
    const a = t * .55; // the little moon rides the ring
    moon.position.set(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0).applyEuler(ring.rotation);
    size();
    renderer.render(scene, camera);
    if (!shown) { shown = true; el.classList.add("live"); }
  };
  // visibility:hidden (the app behind the landing page) still counts as "intersecting", so check for real
  const onScreen = () => visible && !document.hidden && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true);
  const loop = (now) => { raf = 0; if (!onScreen()) return; frame(now); if (!reduce.matches) raf = requestAnimationFrame(loop); };
  const kick = () => { if (!raf && onScreen()) raf = requestAnimationFrame(loop); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  retint(window.__orbsSky);
  kicks.add(kick);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? kick() : stop(); }).observe(el);
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : kick());
  reduce.addEventListener?.("change", kick);
  new ResizeObserver(() => { if (!raf && visible) requestAnimationFrame(frame); }).observe(el);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); el.classList.remove("live"); });
}

// Wait until an orb is visible (and the browser is idle) before pulling in Three.js.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    io.unobserve(e.target);
    const go = () => mount(e.target);
    "requestIdleCallback" in window ? requestIdleCallback(go, { timeout: 1200 }) : setTimeout(go, 200);
  }
});
for (const el of els) io.observe(el);
