/* =========================================================================
   DUBAI ROYALE — a battle royale built from scratch (original assets/names).
   Single-file-friendly game logic. Third-person shooter, bots, loot, storm.
   ========================================================================= */

// ---------------------------------------------------------------------------
// RANKS (Dubai-themed). Bot difficulty & count scale with rank tier.
// ---------------------------------------------------------------------------
const RANKS = [
  { name: "Desert Wanderer", min: 0,    color: "#9c8a6a", botHealth: 60,  botAcc: 0.20, botReact: 1.1, botCount: 4 },
  { name: "Falcon Scout",    min: 300,  color: "#8fb3a8", botHealth: 75,  botAcc: 0.30, botReact: 0.9, botCount: 5 },
  { name: "Marina Guard",    min: 700,  color: "#1F8A82", botHealth: 90,  botAcc: 0.40, botReact: 0.75,botCount: 6 },
  { name: "Souk Champion",   min: 1300, color: "#C1622D", botHealth: 105, botAcc: 0.50, botReact: 0.6, botCount: 7 },
  { name: "Burj Elite",      min: 2100, color: "#D4A94C", botHealth: 120, botAcc: 0.62, botReact: 0.48,botCount: 8 },
  { name: "Golden Sheikh",   min: 3200, color: "#F0C868", botHealth: 140, botAcc: 0.75, botReact: 0.35,botCount: 9 },
];
function rankForPoints(pts) {
  let r = RANKS[0];
  for (const rk of RANKS) if (pts >= rk.min) r = rk;
  return r;
}
function nextRank(pts) {
  for (const rk of RANKS) if (pts < rk.min) return rk;
  return null;
}
function loadRankData() {
  try {
    const raw = localStorage.getItem("dubaiRoyaleRank");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { points: 0, matches: 0, wins: 0 };
}
function saveRankData(d) {
  try { localStorage.setItem("dubaiRoyaleRank", JSON.stringify(d)); } catch (e) {}
}
let rankData = loadRankData();

// ---------------------------------------------------------------------------
// WEAPONS & ITEMS (Dubai-flavored renames of familiar BR archetypes)
// ---------------------------------------------------------------------------
const WEAPONS = {
  khanjar: { name: "Khanjar SMG", dmg: 9,  fireDelay: 0.10, spread: 0.045, mag: 30, reserveMax: 150, range: 55,  zoomFov: null, reloadTime: 1.3 },
  falcon:  { name: "Falcon Rifle", dmg: 19, fireDelay: 0.22, spread: 0.018, mag: 24, reserveMax: 96,  range: 90,  zoomFov: 45,   reloadTime: 1.8 },
  sniper:  { name: "Desert Sniper", dmg: 62, fireDelay: 1.1,  spread: 0.003, mag: 5,  reserveMax: 25,  range: 200, zoomFov: 20,   reloadTime: 2.3 },
};
const ITEM_TYPES = ["labanJug", "datesBar", "cloak", "falconRifle", "desertSniper", "khanjarAmmo"];

// ---------------------------------------------------------------------------
// GLOBAL GAME STATE
// ---------------------------------------------------------------------------
const MAP_RADIUS = 210;
const STORM_PHASES = [
  { time: 28, radius: 210 },
  { time: 22, radius: 140 },
  { time: 20, radius: 85  },
  { time: 18, radius: 45  },
  { time: 16, radius: 16  },
  { time: 999,radius: 3   },
];
const STORM_DMG = 3.2;

let scene, camera, renderer, clock;
let ground, waterMesh;
let player, playerYawObj, playerPitchObj; // hierarchy: playerYawObj(rotates Y) -> mesh + pitch pivot for camera
let obstacles = []; // {x,z,halfW,halfD, mesh}
let bots = [];
let lootCrates = [];
let particles = [];
let damageNumbers = [];
let beaconLights = []; // pulsing red aviation lights on towers
let composer = null, bloomPass = null, fxaaPass = null;
let stormCenter = new THREE.Vector3(0, 0, 0);
let stormRadius = MAP_RADIUS;
let stormPhaseIdx = 0;
let stormPhaseTimer = STORM_PHASES[0].time;
let gameRunning = false;
let matchClock = 0;
let killCount = 0;
let damageDealt = 0;
let placement = 1;

// match phase: "bus" (flying in) -> "freefall" -> "parachute" -> "combat"
let phase = "combat";
let busGroup, busProgress = 0, busStart, busEnd;
let chuteGroup;

let keys = {};
let mouseDown = false;
let aiming = false;
let pointerLocked = false;
let yaw = 0, pitch = 0;
let velocityY = 0;
let onGround = true;

let currentWeaponKey = "khanjar";
let inventory = { khanjar: { mag: 30, reserve: 60, unlocked: true }, falcon: null, sniper: null };
let health = 100, shield = 0, wallCharges = 3, maxWallCharges = 3;
let wallRegenTimer = 0;
let fireTimer = 0;
let reloading = false, reloadTimer = 0;
let healOverTime = 0; // remaining laban-jug heal ticks
let nearestCrate = null;

const raycaster = new THREE.Raycaster();

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function init() {
  try {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x2b3f5c, 0.0016);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);

    const canvas = document.getElementById("gameCanvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
    }

    clock = new THREE.Clock();

    initTextures();
    buildSky();
    buildGround();
    buildLandmarks();
    buildPlayer();
    buildBattleBus();
    buildParachute();
    spawnLootCrates(42);
    spawnBotsForMatch();
    setupPostProcessing();

    window.addEventListener("resize", onResize);
    setupInput();

    updateRankUI();
    animate();
  } catch (err) {
    showErrorBanner(err);
    document.getElementById("loading").textContent = "Failed to load — see error below.";
  }
}

// Bloom is what makes bright things (sun, beacons, loot beams, lit windows)
// actually feel bright. If the CDN scripts didn't load we just skip it rather
// than crash — the game still renders, it just looks flatter.
function setupPostProcessing() {
  if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass) {
    console.warn("Post-processing unavailable — rendering without bloom.");
    return;
  }
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));

  bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55,  // strength — subtle; too high and it turns into fog
    0.5,   // radius
    0.82   // threshold: only genuinely bright pixels bloom
  );
  composer.addPass(bloomPass);

  if (THREE.ShaderPass && THREE.FXAAShader) {
    fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
    updateFxaaResolution();
    composer.addPass(fxaaPass);
  }
  composer.setSize(window.innerWidth, window.innerHeight);
}

function updateFxaaResolution() {
  if (!fxaaPass) return;
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms["resolution"].value.set(
    1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr)
  );
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
  updateFxaaResolution();
}

// ---------------------------------------------------------------------------
// PROCEDURAL TEXTURE LIBRARY
// Flat colors are what make primitives read as "boxes". Giving every surface
// grain, panel lines, and a matching normal map is most of the visual gap.
// ---------------------------------------------------------------------------
function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

// Derives a normal map from a texture's brightness, so bumps catch the light.
function normalFromCanvas(srcCanvas, strength) {
  const size = srcCanvas.width;
  const sctx = srcCanvas.getContext("2d");
  const src = sctx.getImageData(0, 0, size, size).data;
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const octx = out.getContext("2d");
  const img = octx.createImageData(size, size);

  const lum = (x, y) => {
    const xi = (x + size) % size, yi = (y + size) % size;
    const i = (yi * size + xi) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
      const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
      // pack normal vector into RGB
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i]     = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(out);
}

function wrapTex(tex, rx, ry) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  return tex;
}

// --- sand: fine grain + subtle dune banding
function sandTextures() {
  const c = makeCanvas(256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#C9A15C";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const v = 150 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v | 0},${(v * 0.78) | 0},${(v * 0.46) | 0},0.35)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(120,92,52,${0.03 + Math.random() * 0.05})`;
    ctx.lineWidth = 2 + Math.random() * 6;
    ctx.beginPath();
    const y = Math.random() * 256;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + (Math.random() - 0.5) * 30, 170, y + (Math.random() - 0.5) * 30, 256, y);
    ctx.stroke();
  }
  return { map: new THREE.CanvasTexture(c), normal: normalFromCanvas(c, 1.6) };
}

// --- concrete: mottled grey with pitting and stains
function concreteTextures() {
  const c = makeCanvas(256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#9a958b";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v * 0.96) | 0},${0.12 + Math.random() * 0.3})`;
    const r = Math.random() * 5;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(80,78,72,${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 60, 12 + Math.random() * 40);
  }
  return { map: new THREE.CanvasTexture(c), normal: normalFromCanvas(c, 2.2) };
}

// --- brushed metal: horizontal streaks
function metalTextures(base) {
  const c = makeCanvas(256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = base || "#8d9299";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.09})`;
    ctx.lineWidth = Math.random() * 1.3;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 256, y);
    ctx.lineTo(Math.random() * 256, y);
    ctx.stroke();
  }
  return { map: new THREE.CanvasTexture(c), normal: normalFromCanvas(c, 0.7) };
}

// --- glass curtain wall: mullions + per-pane tint variance + lit windows
function curtainWallTextures(baseColor, litChance) {
  const c = makeCanvas(256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);
  const cols = 8, rows = 16;
  const pw = 256 / cols, ph = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (Math.random() < (litChance || 0)) {
        ctx.fillStyle = `rgba(255,214,140,${0.35 + Math.random() * 0.45})`;
      } else {
        const t = Math.random() * 0.16;
        ctx.fillStyle = `rgba(255,255,255,${t})`;
      }
      ctx.fillRect(x * pw + 1.5, y * ph + 1.5, pw - 3, ph - 3);
    }
  }
  // mullions (the frames) — dark recessed lines
  ctx.strokeStyle = "rgba(20,26,34,0.85)";
  ctx.lineWidth = 3;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath(); ctx.moveTo(x * pw, 0); ctx.lineTo(x * pw, 256); ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * ph); ctx.lineTo(256, y * ph); ctx.stroke();
  }
  return { map: new THREE.CanvasTexture(c), normal: normalFromCanvas(c, 3.4) };
}

// cache so we build each texture once, not per-mesh
const TEX = {};
function initTextures() {
  TEX.sand = sandTextures();
  TEX.concrete = concreteTextures();
  TEX.metal = metalTextures("#8d9299");
  TEX.goldMetal = metalTextures("#b9963f");
  TEX.glassBlue = curtainWallTextures("#3E6E8E", 0.18);
  TEX.glassPale = curtainWallTextures("#b9bfc4", 0.12);
}

// ---------------------------------------------------------------------------
// SKY / LIGHTING
// ---------------------------------------------------------------------------
// Soft blobby clouds from layered radial gradients — cheap, but reads far
// better than a flat gradient once bloom catches the bright edges.
function drawCloudBand(ctx, w, h, yCenter, count, alpha) {
  for (let i = 0; i < count; i++) {
    const cx = Math.random() * w;
    const cy = yCenter + (Math.random() - 0.5) * h * 0.10;
    const r = w * (0.02 + Math.random() * 0.05);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = 200 + Math.random() * 55;
    g.addColorStop(0, `rgba(${warm | 0},${(warm * 0.86) | 0},${(warm * 0.76) | 0},${alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * (1.5 + Math.random()), r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildSky() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, "#071120");
  grad.addColorStop(0.32, "#20365c");
  grad.addColorStop(0.55, "#5c6f92");
  grad.addColorStop(0.74, "#c9764f");
  grad.addColorStop(0.88, "#e8a962");
  grad.addColorStop(1.00, "#f6d79a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  drawCloudBand(ctx, W, H, H * 0.42, 30, 0.10);
  drawCloudBand(ctx, W, H, H * 0.58, 40, 0.16);
  drawCloudBand(ctx, W, H, H * 0.70, 34, 0.22);

  const tex = new THREE.CanvasTexture(c);
  const skyGeo = new THREE.SphereGeometry(600, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // sun disc + glow; bloom bleeds this into the sky
  const sunCanvas = makeCanvas(128);
  const sctx = sunCanvas.getContext("2d");
  const sg = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  sg.addColorStop(0, "rgba(255,246,214,1)");
  sg.addColorStop(0.25, "rgba(255,210,130,0.85)");
  sg.addColorStop(1, "rgba(255,180,90,0)");
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(sunCanvas), transparent: true, depthWrite: false, fog: false
  }));
  sunSprite.scale.set(140, 140, 1);
  sunSprite.position.set(300, 190, -420);
  scene.add(sunSprite);

  const hemi = new THREE.HemisphereLight(0xf0d9b5, 0x2a3550, 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffdca8, 2.1);
  sun.position.set(120, 160, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x5a7ba8, 0.4);
  fill.position.set(-100, 80, 100);
  scene.add(fill);
}

// ---------------------------------------------------------------------------
// GROUND
// ---------------------------------------------------------------------------
function buildGround() {
  const map = wrapTex(TEX.sand.map.clone(), 60, 60);
  const nrm = wrapTex(TEX.sand.normal.clone(), 60, 60);
  map.needsUpdate = nrm.needsUpdate = true;

  // Slightly displaced vertices so the desert isn't a perfectly flat disc —
  // gentle dunes give the light something to actually shade.
  const geo = new THREE.CircleGeometry(MAP_RADIUS + 40, 160);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.hypot(x, y);
    if (d > 4) {
      const dune = Math.sin(x * 0.021) * Math.cos(y * 0.017) * 1.5
                 + Math.sin(x * 0.006 + y * 0.008) * 2.2;
      pos.setZ(i, dune * Math.min(1, (d - 4) / 30));
    }
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map, normalMap: nrm, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.98, metalness: 0.0
  });
  ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a6a86, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.92
  });
  waterMesh = new THREE.Mesh(new THREE.CircleGeometry(560, 64), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.6;
  scene.add(waterMesh);
}

// ---------------------------------------------------------------------------
// LANDMARKS — five named zones players will recognize from callouts
// ---------------------------------------------------------------------------
const ZONES = [
  { name: "Burj Khalifa",   x: 0,    z: 0,    color: 0xC9C2B4 },
  { name: "Marina Docks",   x: 135,  z: 64,   color: 0x3E6E8E },
  { name: "Old Souk",       x: -128, z: 88,   color: 0xB5773C },
  { name: "Desert Camp",    x: -96,  z: -136, color: 0xD9B98A },
  { name: "Palm Point",     x: 112,  z: -120, color: 0x3E8E5E },
  { name: "Burj Al Arab",   x: 56,   z: 136,  color: 0xEAF3F7 },
];

function addObstacleBox(mesh, x, z, halfW, halfD) {
  obstacles.push({ x, z, halfW, halfD, mesh });
}

// A tower built from several stacked pieces with ledges, a recessed lit ground
// floor, and roof clutter. Same primitives — just many more of them, which is
// exactly how Roblox games get their density.
function buildDetailedTower(x, z, w, h, texSet, opts) {
  opts = opts || {};
  const g = new THREE.Group();

  const bodyMap = wrapTex(texSet.map.clone(), Math.max(1, w / 6), Math.max(2, h / 7));
  const bodyNrm = wrapTex(texSet.normal.clone(), Math.max(1, w / 6), Math.max(2, h / 7));
  bodyMap.needsUpdate = bodyNrm.needsUpdate = true;
  const bodyMat = new THREE.MeshStandardMaterial({
    map: bodyMap, normalMap: bodyNrm, normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.22, metalness: 0.55,
  });

  const trimMap = wrapTex(TEX.concrete.map.clone(), 2, 1);
  const trimNrm = wrapTex(TEX.concrete.normal.clone(), 2, 1);
  trimMap.needsUpdate = trimNrm.needsUpdate = true;
  const trimMat = new THREE.MeshStandardMaterial({
    map: trimMap, normalMap: trimNrm, roughness: 0.9, metalness: 0.05, color: 0xb9b4a8
  });

  // ground floor: slightly inset + warm lobby glow
  const gfH = 5;
  const gf = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, gfH, w * 0.92), bodyMat);
  gf.position.y = gfH / 2;
  gf.castShadow = gf.receiveShadow = true;
  g.add(gf);

  const lobbyMat = new THREE.MeshStandardMaterial({
    color: 0xffd08a, emissive: 0xffb457, emissiveIntensity: 0.9, roughness: 0.4
  });
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 2.2, w * 0.2), lobbyMat);
  lobby.position.set(0, 1.6, w * 0.46);
  g.add(lobby);

  // main shaft split into segments, each capped by a protruding ledge
  const segs = Math.max(2, Math.round(h / 12));
  const segH = (h - gfH) / segs;
  let y = gfH;
  for (let i = 0; i < segs; i++) {
    const taper = opts.taper ? 1 - (i / segs) * opts.taper : 1;
    const sw = w * taper;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(sw, segH, sw), bodyMat);
    seg.position.y = y + segH / 2;
    seg.castShadow = seg.receiveShadow = true;
    g.add(seg);

    const ledge = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.7, 0.45, sw + 0.7), trimMat);
    ledge.position.y = y + segH;
    ledge.castShadow = ledge.receiveShadow = true;
    g.add(ledge);

    y += segH;
  }

  const topW = w * (opts.taper ? 1 - opts.taper : 1);

  // roof: parapet, mechanical box, aerial + red aviation light
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(topW + 0.9, 1.1, topW + 0.9), trimMat);
  parapet.position.y = y + 0.55;
  parapet.castShadow = true;
  g.add(parapet);

  const mech = new THREE.Mesh(new THREE.BoxGeometry(topW * 0.45, 2.2, topW * 0.45),
    new THREE.MeshStandardMaterial({ map: TEX.metal.map, roughness: 0.6, metalness: 0.8 }));
  mech.position.set(topW * 0.15, y + 2.2, -topW * 0.12);
  mech.castShadow = true;
  g.add(mech);

  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 }));
  aerial.position.set(-topW * 0.2, y + 4, topW * 0.15);
  g.add(aerial);

  const avLight = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  avLight.position.set(-topW * 0.2, y + 7.2, topW * 0.15);
  g.add(avLight);
  beaconLights.push(avLight);

  g.position.set(x, 0, z);
  scene.add(g);
  addObstacleBox(g, x, z, w / 2, w / 2);
  return g;
}

function buildLandmarks() {
  // Burj Khalifa — tapering setback tiers, textured curtain wall, ringed ledges,
  // then a long antenna mast with a pulsing beacon.
  const spireMap = wrapTex(TEX.glassPale.map.clone(), 3, 9);
  const spireNrm = wrapTex(TEX.glassPale.normal.clone(), 3, 9);
  spireMap.needsUpdate = spireNrm.needsUpdate = true;
  const spireMat = new THREE.MeshStandardMaterial({
    map: spireMap, normalMap: spireNrm, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.18, metalness: 0.6
  });
  const ringMat = new THREE.MeshStandardMaterial({
    map: TEX.metal.map, roughness: 0.45, metalness: 0.85, color: 0xd8d2c4
  });
  const baseMat = new THREE.MeshStandardMaterial({
    map: wrapTex(TEX.concrete.map.clone(), 3, 1), normalMap: wrapTex(TEX.concrete.normal.clone(), 3, 1),
    roughness: 0.92, metalness: 0.04
  });

  const tiers = [ { h: 40, w: 7 }, { h: 34, w: 5.6 }, { h: 28, w: 4.4 }, { h: 22, w: 3.2 }, { h: 16, w: 2 } ];
  let y = 0;
  tiers.forEach(t => {
    // 3 offset wings per tier gives the Burj's Y-shaped footprint silhouette
    for (let wing = 0; wing < 3; wing++) {
      const ang = (wing / 3) * Math.PI * 2;
      const off = t.w * 0.22;
      const geo = new THREE.CylinderGeometry(t.w * 0.34, t.w * 0.4, t.h, 6);
      const m = new THREE.Mesh(geo, spireMat);
      m.position.set(Math.cos(ang) * off, y + t.h / 2, Math.sin(ang) * off);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(t.w * 0.4, t.w * 0.46, t.h, 12), spireMat);
    core.position.set(0, y + t.h / 2, 0);
    core.castShadow = core.receiveShadow = true;
    scene.add(core);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(t.w * 0.62, 0.18, 6, 20), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, y, 0);
    ring.castShadow = true;
    scene.add(ring);
    y += t.h;
  });
  const topOfTiers = y;

  const antennaMat = new THREE.MeshStandardMaterial({
    map: TEX.metal.map, roughness: 0.35, metalness: 0.9, color: 0xd8d2c4
  });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 22, 8), antennaMat);
  antenna.position.set(0, topOfTiers + 11, 0);
  antenna.castShadow = true;
  scene.add(antenna);
  const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xE4483C }));
  topBeacon.position.set(0, topOfTiers + 22, 0);
  scene.add(topBeacon);
  beaconLights.push(topBeacon);

  const base = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 16), baseMat);
  base.position.set(0, 3, 0);
  base.castShadow = base.receiveShadow = true;
  scene.add(base);
  addObstacleBox(base, 0, 0, 9, 9);

  // Marina Docks — proper detailed towers with ledges, lobbies and roof clutter
  const marinaTowers = [[136,64,12,32],[152,88,10,42],[120,96,11,26],[160,48,9,36],[128,44,8,22]];
  marinaTowers.forEach(([x,z,w,h], i) => {
    buildDetailedTower(x, z, w, h, i % 2 ? TEX.glassPale : TEX.glassBlue, { taper: 0.12 });
  });

  // Old Souk — small domed huts + market stalls
  const soukMat = new THREE.MeshStandardMaterial({ color: 0xB5773C, roughness: 0.9 });
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xD8A857, roughness: 0.6 });
  const soukHuts = [[-128,88],[-112,104],[-144,67],[-152,109],[-104,77]];
  soukHuts.forEach(([x,z]) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8), soukMat);
    body.position.set(x, 3, z);
    body.castShadow = body.receiveShadow = true;
    scene.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 12, 8, 0, Math.PI*2, 0, Math.PI/2), domeMat);
    dome.position.set(x, 6, z);
    dome.castShadow = true;
    scene.add(dome);
    addObstacleBox(body, x, z, 4, 4);
  });

  // Desert Camp — tents
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xD9B98A, roughness: 1 });
  const tentStripe = new THREE.MeshStandardMaterial({ color: 0x8B3A2E, roughness: 1 });
  const tents = [[-96,-136],[-77,-147],[-112,-112],[-61,-125]];
  tents.forEach(([x,z], i) => {
    const mat = i % 2 === 0 ? tentMat : tentStripe;
    const geo = new THREE.ConeGeometry(5, 6, 6);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 3, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    addObstacleBox(m, x, z, 3.5, 3.5);
  });

  // Palm Point — small palm trees
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3E8E5E, roughness: 0.8 });
  const palmSpots = [[112,-120],[128,-104],[96,-136],[136,-128],[104,-152]];
  palmSpots.forEach(([x,z]) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 8, 6), trunkMat);
    trunk.position.set(x, 4, z);
    trunk.castShadow = true;
    scene.add(trunk);
    for (let a = 0; a < 5; a++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 4), leafMat);
      leaf.position.set(x + Math.cos(a) * 1.2, 8.2, z + Math.sin(a) * 1.2);
      leaf.rotation.z = Math.PI / 2.4;
      leaf.rotation.y = a;
      scene.add(leaf);
    }
    addObstacleBox(trunk, x, z, 0.9, 0.9);
  });

  buildBurjAlArab();

  // zone name sprites (simple canvas-text billboards)
  ZONES.forEach(z => makeLabel(z.name, z.x, 14, z.z));
}

// Burj Al Arab — iconic sail silhouette on its own artificial island,
// connected to the mainland by a short causeway.
function buildBurjAlArab() {
  const zx = 56, zz = 136;

  const islandMat = new THREE.MeshStandardMaterial({ color: 0xD9C79A, roughness: 1 });
  const island = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 1.2, 24), islandMat);
  island.position.set(zx, 0.6, zz);
  island.receiveShadow = true;
  scene.add(island);

  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xC9A15C, roughness: 1 });
  const bridgeLen = Math.hypot(zx, zz) * 0.45;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 1, bridgeLen), bridgeMat);
  bridge.position.set(zx * 0.6, 0.5, zz * 0.6);
  bridge.rotation.y = Math.atan2(zx, zz);
  bridge.receiveShadow = true;
  scene.add(bridge);

  // sail: stacked tapering panels that curve forward like the real building
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xEAF3F7, roughness: 0.2, metalness: 0.35,
    emissive: 0x224466, emissiveIntensity: 0.15
  });
  const segs = 13;
  const segH = 6.5;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const width = 18 * (1 - t * 0.85);
    const depth = 4 * (1 - t * 0.5);
    const curveOffset = Math.sin(t * Math.PI * 0.5) * 9;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, segH, depth), sailMat);
    seg.position.set(zx, 3 + i * segH * 0.92, zz - 7 + curveOffset);
    seg.castShadow = seg.receiveShadow = true;
    scene.add(seg);
    if (i === 0) addObstacleBox(seg, zx, zz, width / 2, depth / 2 + 2);
  }

  const helipad = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.4, 16),
    new THREE.MeshStandardMaterial({ color: 0xE4483C, roughness: 0.6 }));
  helipad.position.set(zx + 7, segH * 7, zz - 2);
  helipad.castShadow = true;
  scene.add(helipad);

  const mastTopY = 3 + segs * segH * 0.92 + 4;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x333333 }));
  mast.position.set(zx, mastTopY, zz + 2);
  scene.add(mast);
  const beaconTop = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xE4483C }));
  beaconTop.position.set(zx, mastTopY + 3.2, zz + 2);
  scene.add(beaconTop);
}

function makeLabel(text, x, y, z) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.font = "bold 46px Orbitron, sans-serif";
  ctx.fillStyle = "rgba(240,200,104,0.95)";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(text.toUpperCase(), 256, 60);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 5, 1);
  sprite.position.set(x, y, z);
  scene.add(sprite);
}

// ---------------------------------------------------------------------------
// PLAYER (third-person humanoid built from primitives)
// ---------------------------------------------------------------------------
// Three.js r128 doesn't have CapsuleGeometry (added in r142), so we fake a
// capsule with a cylinder + two sphere caps, grouped so it still behaves
// like a single object for positioning/animation.
function makeLimb(radius, length, material) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  cyl.castShadow = true;
  g.add(cyl);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material);
  capTop.position.y = length / 2;
  capTop.castShadow = true;
  g.add(capTop);
  const capBottom = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material);
  capBottom.position.y = -length / 2;
  capBottom.castShadow = true;
  g.add(capBottom);
  return g;
}

function makeHumanoid(bodyColor, headColor) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.6 });
  const limbMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });

  const torso = makeLimb(0.42, 0.9, bodyMat);
  torso.position.y = 1.1;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), headMat);
  head.position.y = 1.85;
  head.castShadow = true;
  g.add(head);

  // ghutra-style head wrap accent
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 12), new THREE.MeshStandardMaterial({ color: 0xF2E8D5 }));
  wrap.rotation.x = Math.PI / 2;
  wrap.position.y = 1.95;
  g.add(wrap);

  const armL = makeLimb(0.13, 0.7, limbMat); armL.position.set(-0.55, 1.15, 0); g.add(armL);
  const armR = makeLimb(0.13, 0.7, limbMat); armR.position.set(0.55, 1.15, 0); g.add(armR);

  const legL = makeLimb(0.15, 0.75, limbMat); legL.position.set(-0.22, 0.4, 0); g.add(legL);
  const legR = makeLimb(0.15, 0.75, limbMat); legR.position.set(0.22, 0.4, 0); g.add(legR);

  g.userData.parts = { torso, head, armL, armR, legL, legR };
  return g;
}

function buildPlayer() {
  playerYawObj = new THREE.Group();
  playerYawObj.position.set(0, 0, 20);
  scene.add(playerYawObj);

  player = makeHumanoid(0x2E4C6D, 0xC98A5B);
  playerYawObj.add(player);

  // camera pitch pivot sits at head height, camera dollies back on Z
  playerPitchObj = new THREE.Object3D();
  playerPitchObj.position.set(0, 1.7, 0);
  playerYawObj.add(playerPitchObj);
}

function randomBotColors() {
  const palette = [0x8B3A2E, 0x3E6E8E, 0x5B7A3A, 0x7A4B8B, 0xB5773C, 0x2E6B5E];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------------------------------------------------------------------------
// BOTS
// ---------------------------------------------------------------------------
function spawnBotsForMatch() {
  bots.forEach(b => scene.remove(b.group));
  bots = [];
  const rank = rankForPoints(rankData.points);
  const count = rank.botCount;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 60 + Math.random() * 120;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const group = makeHumanoid(randomBotColors(), 0xC98A5B);
    group.position.set(x, 0, z);
    scene.add(group);
    bots.push({
      group,
      health: rank.botHealth,
      maxHealth: rank.botHealth,
      accuracy: rank.botAcc,
      reactTime: rank.botReact,
      alive: true,
      state: "wander",
      target: new THREE.Vector3(x, 0, z),
      fireTimer: Math.random() * rank.botReact,
      retarget: 0,
      weaponRange: 45 + Math.random() * 20,
    });
  }
}

function botDistanceToPlayer(bot) {
  return bot.group.position.distanceTo(playerYawObj.position);
}

function hasLineOfSight(fromPos, toPos) {
  const dir = new THREE.Vector3().subVectors(toPos, fromPos);
  const dist = dir.length();
  dir.normalize();
  raycaster.set(fromPos, dir);
  raycaster.far = dist;
  const meshes = obstacles.map(o => o.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length === 0;
}

function updateBots(delta) {
  const alive = bots.filter(b => b.alive);
  for (const bot of alive) {
    const distToPlayer = botDistanceToPlayer(bot);
    const eyePos = bot.group.position.clone().add(new THREE.Vector3(0, 1.7, 0));
    const playerEye = playerYawObj.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const canSeePlayer = distToPlayer < 75 && hasLineOfSight(eyePos, playerEye);

    // storm avoidance takes priority
    const distFromCenter = bot.group.position.distanceTo(stormCenter);
    if (distFromCenter > stormRadius - 3) {
      bot.state = "flee_storm";
    } else if (canSeePlayer && distToPlayer < bot.weaponRange) {
      bot.state = "engage";
    } else if (canSeePlayer) {
      bot.state = "approach";
    } else if (bot.state !== "wander" || bot.retarget <= 0) {
      bot.state = "wander";
    }

    let moveDir = null;
    if (bot.state === "flee_storm") {
      moveDir = new THREE.Vector3().subVectors(stormCenter, bot.group.position).normalize();
    } else if (bot.state === "approach") {
      moveDir = new THREE.Vector3().subVectors(playerYawObj.position, bot.group.position).normalize();
    } else if (bot.state === "engage") {
      // strafe a bit while shooting
      const toPlayer = new THREE.Vector3().subVectors(playerYawObj.position, bot.group.position).normalize();
      const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);
      moveDir = strafe.multiplyScalar(Math.sin(matchClock * 1.5 + bot.reactTime * 10) > 0 ? 1 : -1);
      bot.group.lookAt(playerYawObj.position.x, bot.group.position.y, playerYawObj.position.z);
    } else if (bot.state === "wander") {
      bot.retarget -= delta;
      if (bot.retarget <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 20;
        bot.target = bot.group.position.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
        bot.retarget = 3 + Math.random() * 3;
      }
      moveDir = new THREE.Vector3().subVectors(bot.target, bot.group.position);
      if (moveDir.length() < 1) moveDir = null; else moveDir.normalize();
    }

    if (moveDir) {
      const speed = bot.state === "engage" ? 3 : 4.2;
      const newPos = bot.group.position.clone().addScaledVector(moveDir, speed * delta);
      if (!collidesObstacle(newPos.x, newPos.z, 0.6)) {
        bot.group.position.copy(newPos);
      }
      if (bot.state !== "engage") bot.group.lookAt(bot.group.position.x + moveDir.x, bot.group.position.y, bot.group.position.z + moveDir.z);
    }

    // shooting
    if (bot.state === "engage") {
      bot.fireTimer -= delta;
      if (bot.fireTimer <= 0) {
        bot.fireTimer = bot.reactTime + Math.random() * 0.4;
        const hitRoll = Math.random();
        if (hitRoll < bot.accuracy) {
          const dmg = 6 + Math.random() * 10;
          applyDamageToPlayer(dmg);
          pushKillfeed(`A rival hit you for ${dmg | 0}`, true);
        } else {
          pushKillfeed(`Shots whiz past you`, true, true);
        }
      }
    }

    // storm damage
    if (distFromCenter > stormRadius) {
      bot.health -= STORM_DMG * delta;
    }
    if (bot.health <= 0) {
      bot.alive = false;
      scene.remove(bot.group);
      killCount++;
      pushKillfeed(`You eliminated a rival! (${aliveBotsCount()} remaining)`);
    }
  }
}

function aliveBotsCount() {
  return bots.filter(b => b.alive).length;
}

// ---------------------------------------------------------------------------
// COLLISION helpers
// ---------------------------------------------------------------------------
function collidesObstacle(x, z, radius) {
  for (const o of obstacles) {
    if (Math.abs(x - o.x) < o.halfW + radius && Math.abs(z - o.z) < o.halfD + radius) return true;
  }
  return Math.hypot(x, z) > MAP_RADIUS - 2;
}

// ---------------------------------------------------------------------------
// LOOT CRATES
// ---------------------------------------------------------------------------
function latticeCrateTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#8a6a2a";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(240,200,104,0.9)";
  ctx.lineWidth = 2;
  for (let i = -64; i < 64; i += 12) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
const crateTex = () => latticeCrateTexture();

function spawnLootCrates(count) {
  const mat = new THREE.MeshStandardMaterial({
    map: crateTex(), roughness: 0.55, emissive: 0x8a6a25, emissiveIntensity: 0.35
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xF0C868, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false
  });
  for (let i = 0; i < count; i++) {
    let x, z, tries = 0;
    do {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (MAP_RADIUS - 20);
      x = Math.cos(angle) * dist; z = Math.sin(angle) * dist;
      tries++;
    } while (collidesObstacle(x, z, 2) && tries < 20);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 1.7), mat);
    mesh.position.set(x, 0.75, z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.rotation.y = Math.random() * Math.PI;
    scene.add(mesh);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.06, 16, 8, 1, true), beamMat.clone());
    beam.position.set(x, 8.5, z);
    scene.add(beam);

    lootCrates.push({ mesh, beam, x, z, opened: false, item: rollLootItem(), spin: Math.random() * Math.PI * 2 });
  }
}

function rollLootItem() {
  return ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
}

function updateLootCrateAnim(delta) {
  for (const crate of lootCrates) {
    if (crate.opened) continue;
    crate.spin += delta * 1.2;
    crate.mesh.rotation.y = crate.spin;
    crate.mesh.position.y = 0.75 + Math.sin(crate.spin * 1.6) * 0.12;
    crate.beam.material.opacity = 0.28 + Math.sin(crate.spin * 2.4) * 0.12;
  }
}

function updateLootProximity() {
  let closest = null, closestDist = 3.6;
  for (const crate of lootCrates) {
    if (crate.opened) continue;
    const d = Math.hypot(crate.x - playerYawObj.position.x, crate.z - playerYawObj.position.z);
    if (d < closestDist) { closest = crate; closestDist = d; }
  }
  nearestCrate = closest;
  const prompt = document.getElementById("interactPrompt");
  if (nearestCrate) {
    prompt.style.display = "block";
    prompt.textContent = `Press E to open crate`;
  } else {
    prompt.style.display = "none";
  }
}

function openCrate(crate) {
  crate.opened = true;
  scene.remove(crate.mesh);
  scene.remove(crate.beam);
  grantItem(crate.item);
  spawnBurst(crate.x, 1.2, crate.z, 0xF0C868);
}

function showItemBanner(text) {
  const banner = document.getElementById("itemBanner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove("show");
  void banner.offsetWidth; // restart animation
  banner.classList.add("show");
}

function grantItem(type) {
  switch (type) {
    case "labanJug":
      healOverTime += 100;
      pushKillfeed("Looted a Laban Jug — healing over time");
      showItemBanner("LABAN JUG ACQUIRED");
      break;
    case "datesBar":
      health = Math.min(100, health + 25);
      pushKillfeed("Looted a Dates Bar — +25 health");
      showItemBanner("DATES BAR ACQUIRED (+25 HP)");
      break;
    case "cloak":
      shield = Math.min(100, shield + 50);
      pushKillfeed("Looted a Desert Cloak — +50 shield");
      showItemBanner("DESERT CLOAK ACQUIRED (+50 SHIELD)");
      break;
    case "falconRifle":
      if (!inventory.falcon) inventory.falcon = { mag: WEAPONS.falcon.mag, reserve: 48, unlocked: true };
      else inventory.falcon.reserve = Math.min(WEAPONS.falcon.reserveMax, inventory.falcon.reserve + 48);
      pushKillfeed("Looted a Falcon Rifle");
      showItemBanner("FALCON RIFLE ACQUIRED — PRESS 2");
      break;
    case "desertSniper":
      if (!inventory.sniper) inventory.sniper = { mag: WEAPONS.sniper.mag, reserve: 10, unlocked: true };
      else inventory.sniper.reserve = Math.min(WEAPONS.sniper.reserveMax, inventory.sniper.reserve + 10);
      pushKillfeed("Looted a Desert Sniper w/ Falcon Scope");
      showItemBanner("DESERT SNIPER ACQUIRED — PRESS 3");
      break;
    case "khanjarAmmo":
      inventory.khanjar.reserve = Math.min(WEAPONS.khanjar.reserveMax, inventory.khanjar.reserve + 60);
      pushKillfeed("Looted Khanjar ammo");
      showItemBanner("KHANJAR AMMO +60");
      break;
  }
  updateHudBars();
}

// ---------------------------------------------------------------------------
// PARTICLES (simple burst for hits / crate opens)
// ---------------------------------------------------------------------------
function spawnBurst(x, y, z, color) {
  const geo = new THREE.SphereGeometry(0.08, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    const vel = new THREE.Vector3((Math.random()-0.5)*4, Math.random()*4, (Math.random()-0.5)*4);
    scene.add(m);
    particles.push({ mesh: m, vel, life: 0.6 });
  }
}
function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= delta;
    p.vel.y -= 9 * delta;
    p.mesh.position.addScaledVector(p.vel, delta);
    if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------
function setupInput() {
  window.addEventListener("keydown", e => {
    keys[e.code] = true;
    if (e.code === "Digit1") switchWeapon("khanjar");
    if (e.code === "Digit2" && inventory.falcon) switchWeapon("falcon");
    if (e.code === "Digit3" && inventory.sniper) switchWeapon("sniper");
    if (e.code === "KeyE" && nearestCrate && phase === "combat") openCrate(nearestCrate);
    if (e.code === "KeyQ" && phase === "combat") placeWall();
    if (e.code === "KeyR" && phase === "combat") startReload();
    if (e.code === "Space" && phase === "bus") ejectFromBus();
    if (e.code === "Space" && phase === "freefall") deployChute();
  });
  window.addEventListener("keyup", e => keys[e.code] = false);

  const canvas = document.getElementById("gameCanvas");
  canvas.addEventListener("click", () => {
    if (!pointerLocked && gameRunning) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener("mousemove", e => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-0.6, Math.min(0.9, pitch));
  });
  canvas.addEventListener("mousedown", e => {
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener("mouseup", e => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
}

function switchWeapon(key) {
  currentWeaponKey = key;
  updateHudBars();
}

// ---------------------------------------------------------------------------
// BUILDING (sand walls)
// ---------------------------------------------------------------------------
function placeWall() {
  if (wallCharges < 1) return;
  wallCharges -= 1;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-1);
  const pos = playerYawObj.position.clone().addScaledVector(forward, 3);
  const mat = new THREE.MeshStandardMaterial({ color: 0xD9B98A, roughness: 1 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 0.4), mat);
  wall.position.set(pos.x, 1.2, pos.z);
  wall.rotation.y = yaw;
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
  const halfW = Math.abs(Math.cos(yaw)) * 1.5 + 0.2;
  const halfD = Math.abs(Math.sin(yaw)) * 1.5 + 0.2;
  addObstacleBox(wall, pos.x, pos.z, halfW, halfD);
  updateHudBars();
}

// ---------------------------------------------------------------------------
// COMBAT
// ---------------------------------------------------------------------------
function currentAmmo() {
  const inv = inventory[currentWeaponKey];
  return inv ? inv.ammo : 0;
}

function shoot() {
  if (phase !== "combat") return;
  const wep = WEAPONS[currentWeaponKey];
  const inv = inventory[currentWeaponKey];
  if (!inv || !inv.unlocked) return;
  if (reloading) return;
  if (inv.mag <= 0) { startReload(); return; }
  if (fireTimer > 0) return;
  fireTimer = wep.fireDelay;
  inv.mag -= 1;

  const dir = camera.getWorldDirection(new THREE.Vector3());
  dir.x += (Math.random() - 0.5) * wep.spread;
  dir.y += (Math.random() - 0.5) * wep.spread;
  dir.z += (Math.random() - 0.5) * wep.spread;
  dir.normalize();

  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = wep.range;

  const botMeshes = bots.filter(b => b.alive).map(b => b.group);
  const hits = raycaster.intersectObjects(botMeshes, true);
  const obstHits = raycaster.intersectObjects(obstacles.map(o => o.mesh), false);

  if (hits.length && (!obstHits.length || hits[0].distance < obstHits[0].distance)) {
    let root = hits[0].object;
    while (root.parent && !bots.find(b => b.group === root)) root = root.parent;
    const bot = bots.find(b => b.group === root);
    if (bot) {
      bot.health -= wep.dmg;
      damageDealt += wep.dmg;
      spawnBurst(hits[0].point.x, hits[0].point.y, hits[0].point.z, 0xE4483C);
      spawnDamageNumber(hits[0].point.x, hits[0].point.y + 0.3, hits[0].point.z, wep.dmg, false);
      flashCrosshair();
    }
  } else {
    spawnBurst(origin.x + dir.x * 10, origin.y + dir.y * 10, origin.z + dir.z * 10, 0xF2E8D5);
  }
  updateHudBars();
}

function startReload() {
  const inv = inventory[currentWeaponKey];
  const wep = WEAPONS[currentWeaponKey];
  if (!inv || !inv.unlocked || reloading) return;
  if (inv.mag >= wep.mag || inv.reserve <= 0) return;
  reloading = true;
  reloadTimer = wep.reloadTime;
  updateHudBars();
}

function finishReload() {
  const inv = inventory[currentWeaponKey];
  const wep = WEAPONS[currentWeaponKey];
  const needed = wep.mag - inv.mag;
  const take = Math.min(needed, inv.reserve);
  inv.mag += take;
  inv.reserve -= take;
  reloading = false;
  updateHudBars();
}

function flashCrosshair() {
  const ch = document.getElementById("crosshair");
  ch.classList.add("hit");
  setTimeout(() => ch.classList.remove("hit"), 100);
}

function applyDamageToPlayer(dmg) {
  if (shield > 0) {
    const absorbed = Math.min(shield, dmg);
    shield -= absorbed;
    dmg -= absorbed;
  }
  health -= dmg;
  const headPos = playerYawObj.position.clone().add(new THREE.Vector3(0, 2.1, 0));
  spawnDamageNumber(headPos.x, headPos.y, headPos.z, dmg, true);
  updateHudBars();
  if (health <= 0 && gameRunning) endMatch(false);
}

// ---------------------------------------------------------------------------
// BATTLE BUS / SKYDIVE INTRO
// ---------------------------------------------------------------------------
function buildBattleBus() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xD4A94C, roughness: 0.4, metalness: 0.4 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1F8A82, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 12, 10), bodyMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4, 10), bodyMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 8;
  g.add(nose);
  const finL = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 5), finMat);
  finL.position.set(-4, 0, 4.5);
  g.add(finL);
  const finR = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 5), finMat);
  finR.position.set(-4, 0, -4.5);
  g.add(finR);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 0.3), finMat);
  tailFin.position.set(-5, 2.5, 0);
  g.add(tailFin);
  g.visible = false;
  scene.add(g);
  busGroup = g;
}

function buildParachute() {
  const g = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xC1622D, roughness: 0.7, side: THREE.DoubleSide });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), canopyMat);
  canopy.position.y = 3.4;
  g.add(canopy);
  g.visible = false;
  scene.add(g);
  chuteGroup = g;
}

function startBusIntro() {
  const angle = Math.random() * Math.PI * 2;
  const r = MAP_RADIUS + 60;
  busStart = new THREE.Vector3(Math.cos(angle) * r, 100, Math.sin(angle) * r);
  busEnd = new THREE.Vector3(-busStart.x * 0.6, 100, -busStart.z * 0.6);
  busProgress = 0;
  phase = "bus";
  busGroup.visible = true;
  chuteGroup.visible = false;
  playerYawObj.position.copy(busStart);
  yaw = Math.atan2(busEnd.x - busStart.x, busEnd.z - busStart.z);
}

function updateBusPhase(delta) {
  busProgress += delta / 22; // ~22 seconds to cross the map
  const pos = busStart.clone().lerp(busEnd, Math.min(1, busProgress));
  busGroup.position.copy(pos);
  busGroup.rotation.y = yaw;
  playerYawObj.position.copy(pos);
  playerYawObj.rotation.y = yaw;
  player.visible = false; // rider is inside the bus
  if (busProgress >= 1) ejectFromBus();
}

function ejectFromBus() {
  if (phase !== "bus") return;
  busGroup.visible = false;
  player.visible = true;
  phase = "freefall";
  velocityY = -2;
}

function updateFreefallPhase(delta) {
  velocityY -= 18 * delta;
  velocityY = Math.max(velocityY, -30);
  const horizSpeed = 9;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  let move = new THREE.Vector3();
  if (keys["KeyW"]) move.add(forward);
  if (keys["KeyS"]) move.sub(forward);
  if (keys["KeyA"]) move.sub(right);
  if (keys["KeyD"]) move.add(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(horizSpeed * delta);
  playerYawObj.position.x += move.x;
  playerYawObj.position.z += move.z;
  playerYawObj.position.y += velocityY * delta;
  playerYawObj.rotation.y = yaw;
  if (playerYawObj.position.y <= 55) deployChute();
}

function deployChute() {
  if (phase !== "freefall") return;
  phase = "parachute";
  chuteGroup.visible = true;
  velocityY = -6;
}

function updateParachutePhase(delta) {
  velocityY = Math.max(velocityY - 2 * delta, -6);
  const horizSpeed = 7;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  let move = new THREE.Vector3();
  if (keys["KeyW"]) move.add(forward);
  if (keys["KeyS"]) move.sub(forward);
  if (keys["KeyA"]) move.sub(right);
  if (keys["KeyD"]) move.add(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(horizSpeed * delta);
  playerYawObj.position.x += move.x;
  playerYawObj.position.z += move.z;
  playerYawObj.position.y += velocityY * delta;
  playerYawObj.rotation.y = yaw;
  chuteGroup.position.set(playerYawObj.position.x, playerYawObj.position.y + 3.2, playerYawObj.position.z);
  if (playerYawObj.position.y <= 0) {
    playerYawObj.position.y = 0;
    velocityY = 0;
    onGround = true;
    chuteGroup.visible = false;
    phase = "combat";
    updateHudBars();
  }
}

function updatePhasePrompt() {
  const el = document.getElementById("phasePrompt");
  if (!el) return;
  if (phase === "bus") {
    el.style.display = "block";
    el.textContent = `Press SPACE to jump! (Altitude ${Math.round(playerYawObj.position.y)}m)`;
  } else if (phase === "freefall") {
    el.style.display = "block";
    el.textContent = `Press SPACE to open parachute — Altitude ${Math.round(playerYawObj.position.y)}m`;
  } else if (phase === "parachute") {
    el.style.display = "block";
    el.textContent = `Steer with A/D — Altitude ${Math.round(playerYawObj.position.y)}m`;
  } else {
    el.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// MOVEMENT
// ---------------------------------------------------------------------------
function updateMovement(delta) {
  const speed = (keys["ShiftLeft"] || keys["ShiftRight"] ? 7.5 : 4.5) * (aiming ? 0.55 : 1);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  let move = new THREE.Vector3();
  if (keys["KeyW"]) move.add(forward);
  if (keys["KeyS"]) move.sub(forward);
  if (keys["KeyA"]) move.sub(right);
  if (keys["KeyD"]) move.add(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * delta);

  const newX = playerYawObj.position.x + move.x;
  const newZ = playerYawObj.position.z + move.z;
  if (!collidesObstacle(newX, playerYawObj.position.z, 0.5)) playerYawObj.position.x = newX;
  if (!collidesObstacle(playerYawObj.position.x, newZ, 0.5)) playerYawObj.position.z = newZ;

  // jump / gravity
  if (keys["Space"] && onGround) { velocityY = 4.6; onGround = false; }
  velocityY -= 12 * delta;
  playerYawObj.position.y += velocityY * delta;
  if (playerYawObj.position.y <= 0) { playerYawObj.position.y = 0; velocityY = 0; onGround = true; }

  playerYawObj.rotation.y = yaw;

  // simple walk animation
  const parts = player.userData.parts;
  const moving = move.lengthSq() > 0;
  const t = performance.now() * 0.012;
  if (moving) {
    parts.legL.rotation.x = Math.sin(t) * 0.5;
    parts.legR.rotation.x = -Math.sin(t) * 0.5;
    parts.armL.rotation.x = -Math.sin(t) * 0.4;
    parts.armR.rotation.x = Math.sin(t) * 0.4;
  } else {
    parts.legL.rotation.x *= 0.8; parts.legR.rotation.x *= 0.8;
    parts.armL.rotation.x *= 0.8; parts.armR.rotation.x *= 0.8;
  }
}

function updateCamera() {
  const wep = WEAPONS[currentWeaponKey];
  const targetFov = aiming && wep.zoomFov ? wep.zoomFov : 70;
  camera.fov += (targetFov - camera.fov) * 0.15;
  camera.updateProjectionMatrix();

  const dist = aiming ? 2.4 : 5.2;
  const height = aiming ? 1.9 : 2.4;
  const offset = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    height - pitch * 3.5,
    Math.cos(yaw) * Math.cos(pitch) * dist
  );
  const camPos = playerYawObj.position.clone().add(offset);
  camPos.y = Math.max(camPos.y, 0.6);
  camera.position.lerp(camPos, 0.35);

  const lookTarget = playerYawObj.position.clone().add(new THREE.Vector3(0, 1.6 - pitch * 6, 0));
  camera.lookAt(lookTarget);
}

// ---------------------------------------------------------------------------
// STORM
// ---------------------------------------------------------------------------
function updateStorm(delta) {
  stormPhaseTimer -= delta;
  if (stormPhaseTimer <= 0 && stormPhaseIdx < STORM_PHASES.length - 1) {
    stormPhaseIdx++;
    stormPhaseTimer = STORM_PHASES[stormPhaseIdx].time;
  }
  const targetRadius = STORM_PHASES[stormPhaseIdx].radius;
  stormRadius += (targetRadius - stormRadius) * Math.min(1, delta * 0.15);

  const distFromCenter = Math.hypot(playerYawObj.position.x - stormCenter.x, playerYawObj.position.z - stormCenter.z);
  if (distFromCenter > stormRadius) {
    applyDamageToPlayer(STORM_DMG * delta);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function pushKillfeed(text, danger, subtle) {
  const feed = document.getElementById("killfeed");
  const el = document.createElement("div");
  el.className = "killItem";
  if (danger) el.style.borderLeftColor = "var(--red)";
  if (subtle) el.style.opacity = "0.75";
  el.textContent = text;
  feed.appendChild(el);
  setTimeout(() => el.remove(), 3800);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
}

function updateHudBars() {
  document.getElementById("healthFill").style.width = Math.max(0, health) + "%";
  document.getElementById("shieldFill").style.width = Math.max(0, shield) + "%";
  document.getElementById("wallFill").style.width = (wallCharges / maxWallCharges * 100) + "%";
  const wep = WEAPONS[currentWeaponKey];
  const inv = inventory[currentWeaponKey];
  document.getElementById("weaponName").textContent = wep.name;
  if (!inv || !inv.unlocked) {
    document.getElementById("ammoCount").textContent = "--";
  } else if (reloading) {
    document.getElementById("ammoCount").textContent = "RELOADING…";
  } else {
    document.getElementById("ammoCount").textContent = `${inv.mag} / ${inv.reserve}`;
  }
  document.getElementById("playersLeft").textContent = (aliveBotsCount() + 1) + " ALIVE";
  const rank = rankForPoints(rankData.points);
  document.getElementById("rankBadgeMini").textContent = rank.name.toUpperCase();
}

function updateStormTimerUI() {
  const secs = Math.max(0, Math.ceil(stormPhaseTimer));
  const m = Math.floor(secs / 60), s = secs % 60;
  document.getElementById("stormTimer").textContent = `${m}:${s.toString().padStart(2,"0")}`;
}

// minimap
function drawMinimap() {
  const canvas = document.getElementById("minimap");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(20,35,55,0.6)";
  ctx.fillRect(0, 0, W, H);

  const scale = (W / 2) / (MAP_RADIUS + 20);
  const cx = W / 2, cy = H / 2;

  // storm circle
  ctx.beginPath();
  ctx.arc(cx, cy, stormRadius * scale, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(228,72,60,0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // zones
  ctx.fillStyle = "rgba(212,169,76,0.7)";
  ZONES.forEach(z => {
    ctx.beginPath();
    ctx.arc(cx + z.x * scale, cy + z.z * scale, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // player
  const px = cx + playerYawObj.position.x * scale;
  const pz = cy + playerYawObj.position.z * scale;
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(yaw);
  ctx.fillStyle = "#F0C868";
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// RANK UI (start screen)
// ---------------------------------------------------------------------------
function updateRankUI() {
  const rank = rankForPoints(rankData.points);
  const next = nextRank(rankData.points);
  document.getElementById("rankIcon").textContent = rank.name[0];
  document.getElementById("rankIcon").style.color = rank.color;
  document.getElementById("rankIcon").style.borderColor = rank.color;
  document.getElementById("rankNameText").textContent = rank.name;
  document.getElementById("rankPointsText").textContent = next
    ? `${rankData.points} pts · ${next.min - rankData.points} to ${next.name}`
    : `${rankData.points} pts · Top Rank`;
  const span = next ? next.min - rank.min : 1;
  const prog = next ? ((rankData.points - rank.min) / span) * 100 : 100;
  document.getElementById("rankFillBar").style.width = prog + "%";
}

// ---------------------------------------------------------------------------
// MATCH FLOW
// ---------------------------------------------------------------------------
function resetMatchState() {
  health = 100; shield = 0; wallCharges = maxWallCharges;
  inventory = { khanjar: { mag: 30, reserve: 60, unlocked: true }, falcon: null, sniper: null };
  currentWeaponKey = "khanjar";
  reloading = false; reloadTimer = 0;
  healOverTime = 0;
  killCount = 0; damageDealt = 0; matchClock = 0;
  stormPhaseIdx = 0; stormPhaseTimer = STORM_PHASES[0].time; stormRadius = MAP_RADIUS;
  pitch = 0;
  onGround = false;

  lootCrates.forEach(c => { if (!c.opened) { scene.remove(c.mesh); scene.remove(c.beam); } });
  lootCrates = [];
  spawnLootCrates(42);
  spawnBotsForMatch();
  updateHudBars();
  startBusIntro();
}

function startMatch() {
  resetMatchState();
  document.getElementById("startScreen").classList.add("hidden");
  document.getElementById("endScreen").classList.add("hidden");
  document.getElementById("hud").classList.add("active");
  gameRunning = true;
  document.getElementById("gameCanvas").requestPointerLock();
}

function endMatch(won) {
  gameRunning = false;
  document.exitPointerLock();
  placement = won ? 1 : aliveBotsCount() + 1;

  // rank points
  let delta = killCount * 20 + (won ? 150 : 0) - (won ? 0 : Math.max(0, 30 - matchClock));
  delta = Math.max(delta, won ? 60 : -40);
  rankData.points = Math.max(0, rankData.points + delta);
  rankData.matches += 1;
  if (won) rankData.wins += 1;
  saveRankData(rankData);

  document.getElementById("hud").classList.remove("active");
  const endTitle = document.getElementById("endTitle");
  endTitle.textContent = won ? "DUBAI ROYALE #1" : "ELIMINATED";
  endTitle.className = won ? "win" : "lose";
  document.getElementById("endSub").textContent = won
    ? "You claimed the Emirate. Victory!"
    : `Placed #${placement} of ${bots.length + 1}`;

  document.getElementById("statPlacement").textContent = "#" + placement;
  document.getElementById("statKills").textContent = killCount;
  document.getElementById("statDamage").textContent = Math.round(damageDealt);
  const mm = Math.floor(matchClock / 60), ss = Math.floor(matchClock % 60);
  document.getElementById("statTime").textContent = `${mm}:${ss.toString().padStart(2,"0")}`;

  const sign = delta >= 0 ? "+" : "";
  document.getElementById("rankChange").textContent = `${sign}${delta} rank points`;

  document.getElementById("endScreen").classList.remove("hidden");
  updateRankUI();
}

document.getElementById("dropBtn").addEventListener("click", startMatch);
document.getElementById("playAgainBtn").addEventListener("click", startMatch);

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.08);

  try {
    if (gameRunning) {
      if (phase === "bus") {
        updateBusPhase(delta);
      } else if (phase === "freefall") {
        updateFreefallPhase(delta);
      } else if (phase === "parachute") {
        updateParachutePhase(delta);
      } else if (phase === "combat") {
        matchClock += delta;
        updateMovement(delta);
        updateBots(delta);
        updateStorm(delta);
        updateLootProximity();

        if (fireTimer > 0) fireTimer -= delta;
        if (reloading) {
          reloadTimer -= delta;
          if (reloadTimer <= 0) finishReload();
        }
        if (mouseDown) shoot();

        if (healOverTime > 0) {
          const tick = Math.min(healOverTime, 18 * delta);
          health = Math.min(100, health + tick);
          healOverTime -= tick;
          updateHudBars();
        }
        if (wallCharges < maxWallCharges) {
          wallRegenTimer += delta;
          if (wallRegenTimer > 6) { wallCharges++; wallRegenTimer = 0; updateHudBars(); }
        }

        if (aliveBotsCount() === 0) endMatch(true);
      }

      updateCamera();
      updateParticles(delta);
      updateDamageNumbers(delta);
      updateLootCrateAnim(delta);
      updateStormTimerUI();
      drawMinimap();
      updatePhasePrompt();
    }
    updateBeacons();
  } catch (err) {
    showErrorBanner(err);
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// slow red pulse on tower aviation lights — cheap, but adds a lot of life
function updateBeacons() {
  const t = performance.now() * 0.0016;
  const pulse = 0.35 + Math.abs(Math.sin(t)) * 0.65;
  for (const b of beaconLights) {
    b.material.color.setRGB(pulse, pulse * 0.16, pulse * 0.13);
    const s = 0.85 + pulse * 0.35;
    b.scale.setScalar(s);
  }
}

// If a bug throws mid-frame, we still want the game to keep rendering instead
// of silently freezing forever — this shows the actual error on-screen so it
// can be reported and fixed, instead of just staring at a dead frame.
function showErrorBanner(err) {
  let el = document.getElementById("errBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "errBanner";
    el.style.cssText = "position:fixed;bottom:10px;left:10px;right:10px;z-index:99999;"
      + "background:rgba(160,20,20,0.92);color:#fff;padding:10px 14px;border-radius:6px;"
      + "font-family:monospace;font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap;";
    document.body.appendChild(el);
  }
  const msg = (err && err.stack) ? err.stack : String(err);
  el.textContent = "Game error (screenshot this and send it back): " + msg;
}

// boot
window.addEventListener("load", () => {
  document.getElementById("loading").textContent = "Ready.";
  init();
});
