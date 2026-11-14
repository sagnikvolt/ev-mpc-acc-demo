/* Home page: 3D replay of the hero window (stored data only). ES module, loaded on / only.
   It takes over the hero Road view from road.js: same controls, same time base, same ev:scrub link with the chart; only the drawing changes.
   Positions: lead = integral of lead speed (road.js: D.L), every follower sits at lead position minus its own gap, cars are 4.5 m long.
   If three.js or WebGL is unavailable, nothing changes and the 2D strip from road.js stays. */
const THREE_URL = window.__THREE_URL || 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const CAR = 4.5, HALF = CAR / 2, WR = 0.36, LANE = 1.75;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = v => v !== null && v !== undefined && Number.isFinite(v);
function lerp(arr, f) {
  const n = arr.length, i0 = clamp(Math.floor(f), 0, n - 1), i1 = Math.min(i0 + 1, n - 1), a = arr[i0], b = arr[i1], u = clamp(f - i0, 0, 1);
  if (fin(a) && fin(b)) return a + (b - a) * u; return fin(a) ? a : (fin(b) ? b : null);
}

async function main() {
  const RV = window.RoadView, hero = RV && RV.hero, D = hero && hero.data;
  if (!hero || !D || D.multi) return;
  const hostCv = hero.host.querySelector('.rv-cv'), cv2d = hero.cv; if (!hostCv) return;
  let THREE;
  try { THREE = await import(THREE_URL); } catch (err) { return; }
  const H = JSON.parse(document.getElementById('hero-data').textContent);
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
    const card = new THREE.Color(css('--card')), text = new THREE.Color(css('--text')), t3 = new THREE.Color(css('--text3')), acc = new THREE.Color(css('--accent'));
    const mix = k => card.clone().lerp(text, k), d = isDark();
    return { card, text, t3, acc, ground: mix(d ? 0.02 : 0.025), grid: mix(d ? 0.16 : 0.13), road: mix(d ? 0.2 : 0.15), kerb: mix(0.34), dash: mix(d ? 0.62 : 0.55), pylon: mix(d ? 0.38 : 0.34), dark: d };
  };
  let P = palette();

  const scene = new THREE.Scene();
  scene.background = P.card.clone(); scene.fog = new THREE.Fog(P.card.clone(), 55, 150);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x777788, 1.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-14, 26, 18); scene.add(sun);

  /* ---------- scenery that follows the camera along the road ---------- */
  const world = new THREE.Group(); scene.add(world);
  const follow = [];   // objects whose x tracks the camera, snapped to 5 m so the grid never swims
  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0 }, o || {}));
  const matGround = std(P.ground.clone()), matRoad = std(P.road.clone(), { roughness: 0.95 }), matKerb = std(P.kerb.clone()), matDash = std(P.dash.clone()), matPylon = std(P.pylon.clone());
  const add = o => { world.add(o); follow.push(o); return o; };
  add(new THREE.Mesh(new THREE.PlaneGeometry(500, 160).rotateX(-Math.PI / 2), matGround)).position.y = -0.02;
  const gp = []; for (let x = -250; x <= 250; x += 5) gp.push(x, 0, -80, x, 0, 80); for (let z = -80; z <= 80; z += 5) gp.push(-250, 0, z, 250, 0, z);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  const matGrid = new THREE.LineBasicMaterial({ color: P.grid.clone() }); add(new THREE.LineSegments(gg, matGrid)).position.y = -0.01;   // 5 m cells, fades to the background through the fog
  add(new THREE.Mesh(new THREE.BoxGeometry(500, 0.1, 2 * LANE + 0.6), matRoad)).position.y = -0.05;
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(500, 0.22, 0.28), matKerb)).position.set(0, 0.06, s * (LANE + 0.45));
  const DASH_STEP = 9, dashes = []; for (let i = 0; i < 40; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 0.14), matDash); d.position.y = 0.01; world.add(d); dashes.push(d); }
  const PY_STEP = 48, pylons = [];
  function pylon() {
    const g = new THREE.Group(), leg = (z, tilt) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 13, 6), matPylon); m.position.set(0, 6.5, z); m.rotation.x = tilt; g.add(m); };
    leg(-0.55, 0.075); leg(0.55, -0.075);
    for (const [y, w] of [[12.2, 4.4], [9.6, 3.4]]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, w), matPylon); a.position.y = y; g.add(a); }
    return g;
  }
  for (let i = 0; i < 6; i++) { const p = pylon(); p.position.z = -(LANE + 6.5); world.add(p); pylons.push(p); }
  const matWire = new THREE.LineBasicMaterial({ color: P.pylon.clone(), transparent: true, opacity: 0.6 });
  for (const [y, z] of [[12.2, -2.2], [12.2, 2.2], [9.6, -1.7], [9.6, 1.7]]) add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-250, y, z - (LANE + 6.5)), new THREE.Vector3(250, y, z - (LANE + 6.5))]), matWire));

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
    world.add(g); return { g, wheels, mats, kind };
  }
  const lead = makeCar('solid', P.t3), ours = makeCar('solid', P.acc), ghost = makeCar('ghost');
  const gapBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.22), new THREE.MeshBasicMaterial({ color: P.acc.clone(), transparent: true, opacity: 0.7 })); gapBar.position.y = 0.02; world.add(gapBar);
  const recolorCars = () => {
    P = palette(); hemi.intensity = P.dark ? 0.8 : 1.35; sun.intensity = P.dark ? 1.9 : 2.2; scene.background.copy(P.card); scene.fog.color.copy(P.card);
    matGround.color.copy(P.ground); matRoad.color.copy(P.road); matKerb.color.copy(P.kerb); matDash.color.copy(P.dash); matPylon.color.copy(P.pylon); matWire.color.copy(P.pylon); matGrid.color.copy(P.grid);
    lead.mats[0].color.copy(P.t3); lead.mats[1].color.copy(P.t3).multiplyScalar(0.28); ours.mats[0].color.copy(P.acc); ours.mats[1].color.copy(P.acc).multiplyScalar(0.28);
    lead.mats[2].opacity = ours.mats[2].opacity = P.dark ? 0.7 : 0.45; ghost.mats.forEach(m => m.color.copy(P.text)); gapBar.material.color.copy(P.acc);
  };

  /* ---------- camera track: smoothed in data time (deterministic, safe to scrub) ---------- */
  const n = D.n, dt = D.dt, recPos = D.rec ? D.rec.pos : D.ego.pos;
  const cx = [], sp = [];
  for (let i = 0; i < n; i++) { const front = D.L[i] + CAR, rear = Math.min(D.ego.pos[i], recPos[Math.min(i, recPos.length - 1)]) - CAR; cx.push((front + rear) / 2); sp.push(front - rear); }
  const smooth = (a, w) => a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { s += a[j]; c++; } return s / c; });
  const camX = smooth(cx, 8), camS = smooth(sp, 8);

  /* ---------- swap the 2D canvas for the WebGL one ---------- */
  const cv = renderer.domElement; cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Three-dimensional view of the replay: a grey lead car drives along a two-lane road, our teal MPC car follows it, and a white outline shows where the recorded follower was, in the next lane. Everything moves with the time controls below, using stored data of window ' + H.win + '.');
  cv.style.cssText = 'display:block;width:100%;height:100%'; cv2d.hidden = true; cv2d.setAttribute('aria-hidden', 'true'); hostCv.appendChild(cv);
  hostCv.classList.add('rv-3d');
  const hud = document.createElement('div'); hud.className = 'rv-hud mono'; hud.setAttribute('aria-hidden', 'true'); hostCv.appendChild(hud);
  const cap = document.createElement('p'); cap.className = 'rv-cap meta'; cap.textContent = '3D view of window ' + H.win + ' from stored data; cars drawn at 4.5 m, not to scale sideways.';
  const legend = hero.host.querySelector('.rv-leg'); let legTxt = null;
  if (legend) { legend.after(cap); const r = legend.querySelector('.is-rec'); if (r && r.parentNode) { legTxt = document.createTextNode(' (outline, next lane)'); r.parentNode.appendChild(legTxt); } }
  const orig = { draw: hero.draw, layout: hero.layout, recolor: hero.recolor, h: hero.h };
  let failed = false;
  const fallback = () => {
    if (failed) return; failed = true; hero.draw = orig.draw; hero.layout = orig.layout; hero.recolor = orig.recolor; hero.h = orig.h;
    cv.remove(); hud.remove(); cap.remove(); if (legTxt) legTxt.remove(); hostCv.classList.remove('rv-3d'); cv2d.hidden = false; cv2d.removeAttribute('aria-hidden'); hostCv.style.height = orig.h + 'px'; hero.layout();
    try { renderer.dispose(); } catch (e) { /* ignore */ }
  };
  cv.addEventListener('webglcontextlost', ev => { ev.preventDefault(); fallback(); });

  const sz = { w: 0, h: 0 };
  hero.layout = function () {
    const W = Math.floor(hostCv.parentNode.clientWidth); if (!W) return; const Hh = W < 520 ? 240 : 360;
    this.h = Hh; hostCv.style.height = Hh + 'px'; this.W = W; this.dpr = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(W, Hh, false); sz.w = W; sz.h = Hh; camera.aspect = W / Hh; camera.updateProjectionMatrix();
    this.ui(); this.draw();
  };
  hero.recolor = function () { recolorCars(); this.draw(); };
  const mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', () => { recolorCars(); hero.draw(); });

  const CAMV = new THREE.Vector3(-18, 10.2, 20), tgt = new THREE.Vector3(), lastHud = { s: '' };
  let frames = 0;
  hero.draw = function () {
    if (failed || !this.vis || !sz.w) return;
    const f = this.t / dt, pL = lerp(D.L, f), pE = lerp(D.ego.pos, f), pR = D.rec ? lerp(D.rec.pos, f) : null;
    if (pL === null || pE === null) return;
    const x0 = lerp(camX, f), s = clamp(lerp(camS, f) / 27, 0.9, 2.0) * (camera.aspect < 1.7 ? 1.18 : 1);
    const place = (c, front, z) => { c.g.position.set(front - HALF, 0, z); c.wheels.forEach(w => { w.rotation.z = -front / WR; }); };
    place(lead, pL + CAR, LANE); place(ours, pE, LANE); if (pR !== null) { ghost.g.visible = true; place(ghost, pR, -LANE); } else ghost.g.visible = false;
    const gap = pL - pE; gapBar.visible = gap > 0.3; if (gapBar.visible) { gapBar.scale.x = gap; gapBar.position.x = pE + gap / 2; gapBar.position.z = LANE; }
    const sx = Math.round(x0 / 5) * 5; follow.forEach(o => { o.position.x = sx; });
    const base = Math.floor(x0 / DASH_STEP) * DASH_STEP; dashes.forEach((d, i) => { d.position.x = base + (i - 14) * DASH_STEP; });
    const pb = Math.floor(x0 / PY_STEP) * PY_STEP; pylons.forEach((p, i) => { p.position.x = pb + (i - 2) * PY_STEP; });
    camera.position.set(x0 + CAMV.x * s, CAMV.y * s, CAMV.z * s); tgt.set(x0 - 2, 0.9, -0.6); camera.lookAt(tgt);
    renderer.render(scene, camera); frames++;
    const v = lerp(D.lead, f), txt = 't ' + this.t.toFixed(1) + ' s   lead ' + (v === null ? '-' : Math.round(v * 3.6)) + ' km/h   gap ' + gap.toFixed(1) + ' m';
    if (txt !== lastHud.s) { lastHud.s = txt; hud.textContent = txt; }
  };
  recolorCars();
  hero.layout();
  if (RV.reduced()) { hero.pause(); hero.t = Math.min(60, D.T); hero.frame(true); }
  window.__hero3d = { renderer, scene, camera, hero, fallback, frames: () => frames };
}
main().catch(err => { console.warn('hero3d: falling back to the 2D strip', err); });
