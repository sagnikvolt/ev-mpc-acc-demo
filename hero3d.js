/* Home page: 3D background of the hero band (decorative, stored data only). ES module, loaded on / only.
   The scene fills the whole hero band behind the glass panels. It is driven by the hero Road object from road.js (one clock: play/pause, 5x/10x/20x,
   slider, ev:scrub link with the median card all move the 2D strip and this background together); this module only adds drawing, it does not replace the 2D strip.
   Positions: lead = integral of lead speed (road.js: D.L), every follower sits at lead position minus its own gap, cars are 4.5 m long.
   No three.js / no WebGL / phone width: nothing is added and the CSS gradient + grid background stays. */
const THREE_URL = window.__THREE_URL || 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const SHX = +(new URLSearchParams(location.search).get('shx') || -0.015), SHY = +(new URLSearchParams(location.search).get('shy') || 0.25);
const CAR = 4.5, HALF = CAR / 2, WR = 0.36, LANE = 1.75, DECK = 8.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = v => v !== null && v !== undefined && Number.isFinite(v);
function lerp(arr, f) {
  const n = arr.length, i0 = clamp(Math.floor(f), 0, n - 1), i1 = Math.min(i0 + 1, n - 1), a = arr[i0], b = arr[i1], u = clamp(f - i0, 0, 1);
  if (fin(a) && fin(b)) return a + (b - a) * u; return fin(a) ? a : (fin(b) ? b : null);
}

async function main() {
  const RV = window.RoadView, hero = RV && RV.hero, D = hero && hero.data, bg = document.getElementById('hero-bg');
  if (!hero || !D || D.multi || !bg || matchMedia('(max-width:759px)').matches) return;
  let THREE;
  try { THREE = await import(THREE_URL); } catch (err) { return; }
  let renderer;
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (err) { return; }

  /* ---------- theme colours from the page's CSS variables ---------- */
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const palette = () => {
    const bgc = new THREE.Color(css('--bg')), text = new THREE.Color(css('--text')), t3 = new THREE.Color(css('--text3')), acc = new THREE.Color(css('--accent'));
    const mix = k => bgc.clone().lerp(text, k), d = isDark();
    return { bg: bgc, text, t3, acc, ground: d ? bgc.clone().multiplyScalar(0.8) : mix(0.035), grid: mix(d ? 0.3 : 0.2), road: mix(d ? 0.13 : 0.42), kerb: mix(d ? 0.3 : 0.24), dash: mix(d ? 0.7 : 0.02), pylon: mix(d ? 0.3 : 0.27), cap: mix(d ? 0.38 : 0.32), dark: d };
  };
  let P = palette();

  const scene = new THREE.Scene();
  scene.background = P.bg.clone(); scene.fog = new THREE.Fog(P.bg.clone(), 48, 140);
  const camera = new THREE.PerspectiveCamera(27, 2.4, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x777788, 1.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-14, 30, 22); scene.add(sun);

  /* ---------- scenery that follows the camera along the road: ground + grid, elevated deck on pylons ---------- */
  const world = new THREE.Group(); scene.add(world);
  const top = new THREE.Group(); top.position.y = DECK; world.add(top);   // everything that drives or sits on the deck
  const follow = [];   // objects whose x tracks the camera, snapped to 5 m so the grid never swims
  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0 }, o || {}));
  const matGround = std(P.ground.clone()), matRoad = std(P.road.clone(), { roughness: 0.95 }), matKerb = std(P.kerb.clone()), matDash = std(P.dash.clone()), matPylon = std(P.pylon.clone()), matCap = std(P.cap.clone());
  const add = (o, parent) => { (parent || world).add(o); follow.push(o); return o; };
  add(new THREE.Mesh(new THREE.PlaneGeometry(500, 200).rotateX(-Math.PI / 2), matGround)).position.y = -0.02;
  const gp = []; for (let x = -250; x <= 250; x += 5) gp.push(x, 0, -100, x, 0, 100); for (let z = -100; z <= 100; z += 5) gp.push(-250, 0, z, 250, 0, z);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  const matGrid = new THREE.LineBasicMaterial({ color: P.grid.clone() }); add(new THREE.LineSegments(gg, matGrid)).position.y = -0.01;   // 5 m cells, fades to the background through the fog
  const matShade = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: P.dark ? 0.55 : 0.16, depthWrite: false });
  add(new THREE.Mesh(new THREE.PlaneGeometry(500, 6.4).rotateX(-Math.PI / 2), matShade)).position.y = 0.01;   // shade of the deck on the ground
  const DW = 2 * LANE + 1.8;
  add(new THREE.Mesh(new THREE.BoxGeometry(500, 0.9, DW), matRoad), top).position.y = -0.45;
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(500, 0.5, 0.34), matKerb), top).position.set(0, 0.25, s * (DW / 2 - 0.17));
  const DASH_STEP = 9, dashes = []; for (let i = 0; i < 44; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 0.14), matDash); d.position.y = 0.01; top.add(d); dashes.push(d); }
  const PY_STEP = 30, pylons = [];
  function pylon() {   // solid tapered column standing on the ground, with a wide cap under the deck
    const g = new THREE.Group(), h = DECK - 0.9 - 0.6;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.95, h, 4, 1).rotateY(Math.PI / 4), matPylon); col.position.y = h / 2; g.add(col);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, DW - 0.4), matCap); cap.position.y = DECK - 0.9 - 0.3; g.add(cap);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 2.3), matCap); foot.position.y = 0.15; g.add(foot);
    return g;
  }
  for (let i = 0; i < 9; i++) { const p = pylon(); world.add(p); pylons.push(p); }

  /* ---------- cars: extruded side profile, glass cabin, four wheels ---------- */
  function extrude(pts, depth, bevel) {
    const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(depth - 2 * bevel) / 2); return g;
  }
  const geo = {
    body: extrude([[-2.25, 0.46], [2.25, 0.46], [2.28, 0.72], [2.12, 0.92], [1.25, 1.02], [-1.5, 1.02], [-2.12, 0.98], [-2.28, 0.74]], 1.8, 0.06),
    cabin: extrude([[-1.4, 1.0], [1.3, 1.0], [0.62, 1.5], [-0.95, 1.5]], 1.6, 0.04),
    roof: extrude([[-1.0, 1.49], [0.66, 1.49], [0.6, 1.57], [-0.96, 1.57]], 1.66, 0.03),
    wheel: new THREE.CylinderGeometry(WR, WR, 0.26, 20).rotateX(Math.PI / 2),
    hub: new THREE.CylinderGeometry(0.17, 0.17, 0.28, 12).rotateX(Math.PI / 2),
    spoke: new THREE.BoxGeometry(0.34, 0.07, 0.3)
  };
  geo.edges = [new THREE.EdgesGeometry(geo.body, 25), new THREE.EdgesGeometry(geo.cabin, 25), new THREE.EdgesGeometry(geo.roof, 25)];
  const matTyre = std(0x1a1a1c, { roughness: 0.9 }), matHub = std(0x9a9aa0, { roughness: 0.5 }), matSpoke = std(0x3a3a3e);
  const WHEELS = [[1.4, 0.8], [1.4, -0.8], [-1.4, 0.8], [-1.4, -0.8]];
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 31); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadowGeo = new THREE.PlaneGeometry(6.2, 3.1).rotateX(-Math.PI / 2);
  function makeCar(kind, base) {
    const g = new THREE.Group(), wheels = [], mats = [];
    if (kind === 'ghost') {
      const fill = new THREE.MeshBasicMaterial({ color: P.text.clone(), transparent: true, opacity: 0.09, depthWrite: false });
      const line = new THREE.LineBasicMaterial({ color: P.text.clone(), transparent: true, opacity: 0.9 }), wl = new THREE.LineBasicMaterial({ color: P.text.clone(), transparent: true, opacity: 0.8 }), sm = new THREE.MeshBasicMaterial({ color: P.text.clone(), transparent: true, opacity: 0.55 });
      mats.push(fill, line, wl, sm);
      for (const k of ['body', 'cabin', 'roof']) g.add(new THREE.Mesh(geo[k], fill));
      for (const eg of geo.edges) g.add(new THREE.LineSegments(eg, line));
      const we = new THREE.EdgesGeometry(geo.wheel, 30);
      WHEELS.forEach(([x, z]) => { const w = new THREE.Group(); w.position.set(x, WR, z); w.add(new THREE.LineSegments(we, wl)); w.add(new THREE.Mesh(geo.spoke, sm)); g.add(w); wheels.push(w); });
    } else {
      const body = std(base.clone(), { roughness: 0.55, metalness: 0.1 }), glass = std(base.clone().multiplyScalar(0.28), { roughness: 0.25, metalness: 0.1 });
      g.add(new THREE.Mesh(geo.body, body), new THREE.Mesh(geo.cabin, glass), new THREE.Mesh(geo.roof, body));
      WHEELS.forEach(([x, z]) => { const w = new THREE.Group(); w.position.set(x, WR, z); w.add(new THREE.Mesh(geo.wheel, matTyre), new THREE.Mesh(geo.hub, matHub), new THREE.Mesh(geo.spoke, matSpoke)); g.add(w); wheels.push(w); });
      const shm = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: P.dark ? 0.7 : 0.45 }), sh = new THREE.Mesh(shadowGeo, shm); sh.position.y = 0.03; sh.renderOrder = 1; g.add(sh);
      mats.push(body, glass, shm);
    }
    top.add(g); return { g, wheels, mats, kind };
  }
  const lead = makeCar('solid', P.t3), ours = makeCar('solid', P.acc), ghost = makeCar('ghost');
  const gapBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.22), new THREE.MeshBasicMaterial({ color: P.acc.clone(), transparent: true, opacity: 0.55 })); gapBar.position.y = 0.02; top.add(gapBar);
  /* soft short light streak behind our car: one gradient plane (decoration), no bloom, no particles */
  const streakTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 128, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)'); x.fillStyle = g; x.fillRect(0, 8, 128, 16); const v = x.createLinearGradient(0, 0, 0, 32); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, 128, 32); return new THREE.CanvasTexture(c); })();
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: streakTex, color: P.acc.clone(), transparent: true, opacity: 0.4, depthWrite: false, blending: P.dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
  streak.position.set(-2.4 - 4, 0.06, 0); streak.renderOrder = 2; ours.g.add(streak);
  const recolorCars = () => {
    P = palette(); hemi.intensity = P.dark ? 0.8 : 1.35; sun.intensity = P.dark ? 1.9 : 2.2; scene.background.copy(P.bg); scene.fog.color.copy(P.bg);
    matGround.color.copy(P.ground); matRoad.color.copy(P.road); matKerb.color.copy(P.kerb); matDash.color.copy(P.dash); matPylon.color.copy(P.pylon); matCap.color.copy(P.cap); matGrid.color.copy(P.grid); matShade.opacity = P.dark ? 0.55 : 0.16;
    lead.mats[0].color.copy(P.t3); lead.mats[1].color.copy(P.t3).multiplyScalar(0.28); ours.mats[0].color.copy(P.acc); ours.mats[1].color.copy(P.acc).multiplyScalar(0.28);
    ours.mats[0].emissive.copy(P.acc).multiplyScalar(P.dark ? 0.3 : 0.08);
    lead.mats[2].opacity = ours.mats[2].opacity = P.dark ? 0.7 : 0.45; ghost.mats.forEach(m => m.color.copy(P.text)); gapBar.material.color.copy(P.acc);
    streak.material.color.copy(P.acc); streak.material.blending = P.dark ? THREE.AdditiveBlending : THREE.NormalBlending; streak.material.needsUpdate = true;
  };

  /* ---------- camera track: smoothed in data time (deterministic, safe to scrub) ---------- */
  const n = D.n, dt = D.dt, recPos = D.rec ? D.rec.pos : D.ego.pos;
  const cx = [], sp = [];
  for (let i = 0; i < n; i++) { const front = D.L[i] + CAR, rear = Math.min(D.ego.pos[i], recPos[Math.min(i, recPos.length - 1)]) - CAR; cx.push((front + rear) / 2); sp.push(front - rear); }
  const smooth = (a, w) => a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { s += a[j]; c++; } return s / c; });
  const camX = smooth(cx, 12), camS = smooth(sp, 12);

  /* ---------- the canvas is the band background ---------- */
  const cv = renderer.domElement; cv.setAttribute('aria-hidden', 'true'); cv.className = 'hero-3d'; bg.appendChild(cv);
  const note = document.createElement('p'); note.className = 'rv-bgnote meta'; note.textContent = 'Background: 3D view of the same window, decorative.'; hero.host.appendChild(note);
  const orig = { draw: hero.draw, recolor: hero.recolor };
  let failed = false, bgVis = true, frames = 0;
  const fallback = () => {
    if (failed) return; failed = true; hero.draw = orig.draw; hero.recolor = orig.recolor; cv.remove(); note.remove(); ro.disconnect();
    try { renderer.dispose(); } catch (e) { /* ignore */ }
  };
  cv.addEventListener('webglcontextlost', ev => { ev.preventDefault(); fallback(); });

  const sz = { w: 0, h: 0 };
  const size3d = () => {
    const W = Math.floor(bg.clientWidth), Hh = Math.floor(bg.clientHeight); if (!W || !Hh) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(W, Hh, false); sz.w = W; sz.h = Hh; camera.aspect = W / Hh;
    const wide = W / Hh > 1.5; camera.setViewOffset(W, Hh, -Math.round(W * (wide ? SHX : 0)), -Math.round(Hh * (wide ? SHY : 0.1)), W, Hh); camera.updateProjectionMatrix();   // shifts the picture so the cars sit low-centre, between the panels
  };
  const ro = new ResizeObserver(() => { size3d(); hero.draw(); }); ro.observe(bg);

  const CAMV = new THREE.Vector3(-34, 22, 17), tgt = new THREE.Vector3();
  hero.draw = function () {
    orig.draw.call(this);
    if (failed || !this.vis || !sz.w || !cv.offsetWidth) return;
    const f = this.t / dt, pL = lerp(D.L, f), pE = lerp(D.ego.pos, f), pR = D.rec ? lerp(D.rec.pos, f) : null;
    if (pL === null || pE === null) return;
    const x0 = lerp(camX, f), s = 1.4 * clamp(lerp(camS, f) / 27, 0.9, 2.0) * (camera.aspect < 1.7 ? 1.18 : 1);
    const place = (c, front, z) => { c.g.position.set(front - HALF, 0, z); c.wheels.forEach(w => { w.rotation.z = -front / WR; }); };
    place(lead, pL + CAR, LANE); place(ours, pE, LANE); if (pR !== null) { ghost.g.visible = true; place(ghost, pR, -LANE); } else ghost.g.visible = false;
    const gap = pL - pE; gapBar.visible = gap > 0.3; if (gapBar.visible) { gapBar.scale.x = gap; gapBar.position.x = pE + gap / 2; gapBar.position.z = LANE; }
    const sx = Math.round(x0 / 5) * 5; follow.forEach(o => { o.position.x = sx; });
    const base = Math.floor(x0 / DASH_STEP) * DASH_STEP; dashes.forEach((d, i) => { d.position.x = base + (i - 16) * DASH_STEP; });
    const pb = Math.floor(x0 / PY_STEP) * PY_STEP; pylons.forEach((p, i) => { p.position.x = pb + (i - 4) * PY_STEP; });
    camera.position.set(x0 + CAMV.x * s, CAMV.y * s, CAMV.z * s); tgt.set(x0 + 1, DECK - 0.4, 0); camera.lookAt(tgt);
    renderer.render(scene, camera); frames++;
  };
  /* one clock, and visibility follows the whole band (not only the 2D strip): no frames when the band is off-screen or the tab is hidden */
  hero.io.disconnect(); new IntersectionObserver(es => { hero.vis = es[es.length - 1].isIntersecting; if (hero.vis) { hero.draw(); hero.sched(); } }).observe(bg.parentNode);
  hero.recolor = function () { recolorCars(); this.draw(); };
  recolorCars(); size3d(); hero.draw();
  if (RV.reduced()) { hero.pause(); hero.t = Math.min(60, D.T); hero.frame(true); }
  window.__hero3d = { renderer, scene, camera, hero, fallback, frames: () => frames };
}
main().catch(err => { console.warn('hero3d: 3D background not available', err); });
