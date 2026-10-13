/* NEON RIVALS: Two-Player Battle Racing — vanilla JS, no dependencies. */
(() => {
'use strict';

// ============================================================
// Config
// ============================================================
const W = 1280, H = 720, TAU = Math.PI * 2;
const HW = 44;            // track half-width (px)
const CAR_R = 11;         // car collision radius
const LAPS = 3;
const NCP = 6;            // checkpoints per lap (the finish line is the last one)
const DT = 1 / 120;       // fixed physics step
const STEP = 6;           // spacing of centerline samples (px)

const ACC = 450, BRAKE = 620, REV_ACC = 190, DRAG = 1.3, GRIP = 7, TURN = 3.1;
const BOOST_MULT = 1.45, ROCKET_SPEED = 600, MAX_PARTICLES = 900;

const PLAYERS = [
  { name: 'PLAYER 1', tag: 'P1', color: '#ff2bd6', rgb: '255,43,214',
    keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, use: ['ShiftLeft', 'KeyQ'] },
  { name: 'PLAYER 2', tag: 'P2', color: '#19e3ff', rgb: '25,227,255',
    keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }, use: ['Enter', 'NumpadEnter'] },
];

const ITEMS = {
  turbo:   { icon: '⚡', name: 'TURBO' },
  oil:     { icon: '🛢️', name: 'OIL SLICK' },
  rocket:  { icon: '🚀', name: 'ROCKET' },
  shield:  { icon: '🛡️', name: 'SHIELD' },
  reverse: { icon: '🔄', name: 'REVERSE' },
};
const ITEM_KEYS = Object.keys(ITEMS);

// Closed circuit, driven clockwise. Smoothed with a Catmull-Rom spline.
const CTRL = [
  [420, 160], [760, 158], [1050, 165], [1185, 250], [1180, 420], [1185, 560],
  [1090, 655], [930, 640], [850, 540], [860, 400], [770, 310], [650, 330],
  [590, 440], [600, 560], [500, 650], [300, 655], [140, 610], [90, 460],
  [95, 290], [190, 170],
];
// Placement along the lap as [fraction of lap, lateral offset].
const BOX_AT = [0.09, 0.27, 0.46, 0.65, 0.84];
const OBSTACLES_AT = [[0.18, 24], [0.36, -24], [0.55, 24], [0.575, -24], [0.74, -24]];

// ============================================================
// Helpers
// ============================================================
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const fmtTime = t => {
  if (!isFinite(t)) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};

// ============================================================
// Track
// ============================================================
const track = buildTrack();

function buildTrack() {
  const n = CTRL.length, dense = [];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      dense.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  // Resample to uniform arc-length spacing so a sample index is a distance.
  const L = dense.length, cum = [0];
  for (let i = 0; i < L; i++) {
    const a = dense[i], b = dense[(i + 1) % L];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[L], M = Math.round(total / STEP), step = total / M;
  const x = new Float64Array(M), y = new Float64Array(M), tx = new Float64Array(M), ty = new Float64Array(M);
  for (let i = 0, j = 0; i < M; i++) {
    const d = i * step;
    while (cum[j + 1] < d) j++;
    const a = dense[j], b = dense[(j + 1) % L], t = (d - cum[j]) / (cum[j + 1] - cum[j]);
    x[i] = a[0] + (b[0] - a[0]) * t;
    y[i] = a[1] + (b[1] - a[1]) * t;
  }
  for (let i = 0; i < M; i++) {
    const a = (i - 1 + M) % M, b = (i + 1) % M;
    const dx = x[b] - x[a], dy = y[b] - y[a], len = Math.hypot(dx, dy);
    tx[i] = dx / len; ty[i] = dy / len;
  }
  return { M, x, y, tx, ty, length: total };
}

const wrapI = i => ((i % track.M) + track.M) % track.M;

// Point on the track at fractional sample index s, shifted sideways by off.
const tp = { x: 0, y: 0, tx: 0, ty: 0 };
function trackPoint(s, off) {
  const M = track.M;
  s = ((s % M) + M) % M;
  const i = Math.floor(s) % M, j = (i + 1) % M, t = s - Math.floor(s);
  const tx = track.tx[i] + (track.tx[j] - track.tx[i]) * t;
  const ty = track.ty[i] + (track.ty[j] - track.ty[i]) * t;
  tp.x = track.x[i] + (track.x[j] - track.x[i]) * t - ty * off;
  tp.y = track.y[i] + (track.y[j] - track.y[i]) * t + tx * off;
  tp.tx = tx; tp.ty = ty;
  return tp;
}

// Closest point on the centerline. With a hint (the car's last index) only the
// nearby stretch is searched, which keeps each car locked to its own piece of road.
const near = { s: 0, x: 0, y: 0, d: 0 };
function nearest(px, py, hint) {
  const M = track.M, X = track.x, Y = track.y;
  let bi = 0, bd = Infinity;
  if (hint < 0) {
    for (let i = 0; i < M; i++) {
      const d = (X[i] - px) * (X[i] - px) + (Y[i] - py) * (Y[i] - py);
      if (d < bd) { bd = d; bi = i; }
    }
  } else {
    const h = Math.round(hint);
    for (let k = -30; k <= 30; k++) {
      const i = wrapI(h + k);
      const d = (X[i] - px) * (X[i] - px) + (Y[i] - py) * (Y[i] - py);
      if (d < bd) { bd = d; bi = i; }
    }
  }
  let bs = bi, bx = X[bi], by = Y[bi];
  for (let o = -1; o <= 0; o++) {
    const a = wrapI(bi + o), b = (a + 1) % M;
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    const t = clamp(((px - X[a]) * dx + (py - Y[a]) * dy) / (dx * dx + dy * dy), 0, 1);
    const cx = X[a] + dx * t, cy = Y[a] + dy * t;
    const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (d <= bd) { bd = d; bs = a + t; bx = cx; by = cy; }
  }
  near.s = bs >= M ? bs - M : bs;
  near.x = bx; near.y = by; near.d = Math.sqrt(bd);
  return near;
}

// ============================================================
// Audio (Web Audio API, everything synthesised)
// ============================================================
const audio = { ctx: null, master: null, noiseBuf: null, engines: [], muted: false };
try { audio.muted = localStorage.getItem('neonRivalsMuted') === '1'; } catch (e) { /* storage unavailable */ }

function initAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ac = new AC();
    audio.master = ac.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.6;
    audio.master.connect(ac.destination);
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    audio.noiseBuf = buf;
    for (let i = 0; i < 2; i++) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 60;
      f.type = 'lowpass'; f.frequency.value = 480;
      g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(audio.master);
      o.start();
      audio.engines.push({ o, g });
    }
    audio.ctx = ac;
  } catch (e) { audio.ctx = null; }
}

function tone(freq, dur, type, vol, slideTo, delay) {
  const ac = audio.ctx;
  if (!ac || audio.muted) return;
  const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol, cutoff, delay) {
  const ac = audio.ctx;
  if (!ac || audio.muted) return;
  const t = ac.currentTime + (delay || 0), src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = audio.noiseBuf;
  f.type = 'lowpass'; f.frequency.value = cutoff || 1500;
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(audio.master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

const sfx = {
  click: () => tone(520, 0.05, 'square', 0.08),
  count: () => tone(440, 0.16, 'square', 0.16),
  go: () => { tone(880, 0.45, 'square', 0.18); tone(1320, 0.45, 'sawtooth', 0.08); },
  pickup: () => { tone(660, 0.08, 'triangle', 0.16); tone(990, 0.12, 'triangle', 0.16, 0, 0.07); },
  turbo: () => { tone(180, 0.55, 'sawtooth', 0.14, 950); noise(0.5, 0.12, 2500); },
  oilDrop: () => tone(220, 0.25, 'sine', 0.2, 70),
  oilHit: () => { tone(500, 0.5, 'sawtooth', 0.1, 90); noise(0.3, 0.1, 700); },
  rocket: () => { noise(0.45, 0.2, 3000); tone(300, 0.4, 'sawtooth', 0.1, 1300); },
  explode: () => { noise(0.7, 0.4, 600); tone(130, 0.5, 'sine', 0.3, 35); },
  shieldOn: () => tone(520, 0.3, 'sine', 0.16, 1040),
  shieldBreak: () => { tone(1000, 0.3, 'triangle', 0.16, 180); noise(0.15, 0.12, 4000); },
  reverse: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 480 : 720, 0.09, 'square', 0.11, 0, i * 0.09); },
  bump: () => noise(0.1, 0.22, 900),
  wall: () => noise(0.07, 0.12, 1800),
  checkpoint: () => tone(1250, 0.06, 'sine', 0.07),
  lap: () => { tone(784, 0.1, 'square', 0.13); tone(1046, 0.18, 'square', 0.13, 0, 0.1); },
  finalLap: () => { for (let i = 0; i < 3; i++) tone(988, 0.1, 'square', 0.14, 0, i * 0.13); },
  win: () => { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 0.7 : 0.16, 'square', 0.15, 0, i * 0.14)); },
};

function updateEngines() {
  if (!audio.ctx) return;
  const on = state === 'race' && !paused, t = audio.ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const c = cars[i], e = audio.engines[i];
    e.g.gain.setTargetAtTime(on ? 0.045 + Math.min(0.05, c.speed / 7000) : 0, t, 0.06);
    e.o.frequency.setTargetAtTime(52 + c.speed * 0.42 + i * 7 + (c.boostT > 0 ? 45 : 0), t, 0.06);
  }
}

function toggleMute() {
  audio.muted = !audio.muted;
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.6;
  try { localStorage.setItem('neonRivalsMuted', audio.muted ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  refreshMuteUi();
}
function refreshMuteUi() {
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
  $('btn-menu-mute').textContent = 'SOUND: ' + (audio.muted ? 'OFF' : 'ON');
}

// ============================================================
// Game state
// ============================================================
let state = 'menu';        // menu | countdown | race | finished
let paused = false;
let simT = 0, raceT = 0, cdT = 0, cdN = 4;
let timeScale = 1, slowT = 0, finishRealT = 0, victoryShown = false, fireworkT = 0;
let winner = null, shake = 0, finalLapCalled = false;

const keys = Object.create(null);
const inp = { throttle: 0, steer: 0 };
const cars = [makeCar(0), makeCar(1)];
const boxes = [], obstacles = [], slicks = [], rockets = [], parts = [], floats = [], cpFlashes = [];

for (const f of BOX_AT) {
  for (const off of [-21, 21]) {
    trackPoint(f * track.M, off);
    boxes.push({ x: tp.x, y: tp.y, cool: 0, phase: Math.random() * TAU });
  }
}
for (const [f, off] of OBSTACLES_AT) {
  trackPoint(f * track.M, off);
  obstacles.push({ x: tp.x, y: tp.y, r: 9 });
}

function makeCar(id) {
  return {
    id, p: PLAYERS[id], x: 0, y: 0, vx: 0, vy: 0, a: 0, speed: 0, slip: 0, throttle: 0,
    s: 0, prog: 0, lap: 0, cp: 0, lapStart: 0, bestLap: Infinity, wrongT: 0,
    item: null, boostT: 0, shieldT: 0, reverseT: 0, oilT: 0, spinT: 0, spinDir: 1,
    ai: false, aiUseT: 0, hitCd: 0, trail: [], skid: null,
  };
}

function resetWorld(ai) {
  const startS = -8;
  cars.forEach((c, i) => {
    trackPoint(startS, i === 0 ? -20 : 20);
    Object.assign(c, makeCar(i), { x: tp.x, y: tp.y, a: Math.atan2(tp.ty, tp.tx), ai });
    c.s = nearest(c.x, c.y, -1).s;
    c.prog = startS;
  });
  slicks.length = rockets.length = parts.length = floats.length = cpFlashes.length = 0;
  boxes.forEach(b => { b.cool = 0; });
  for (const k in keys) keys[k] = false;
  simT = raceT = cdT = 0; cdN = 4;
  timeScale = 1; slowT = 0; finishRealT = 0; victoryShown = false; fireworkT = 0;
  winner = null; shake = 0; finalLapCalled = false; paused = false;
  if (marksCtx) marksCtx.clearRect(0, 0, W, H);
}

function setState(s) {
  state = s;
  stage.dataset.state = s;
}

function startRace() {
  resetWorld(false);
  setState('countdown');
  ['menu', 'instructions', 'pause', 'victory'].forEach(id => $(id).classList.add('hidden'));
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function toMenu() {
  resetWorld(true);
  setState('menu');
  ['instructions', 'pause', 'victory'].forEach(id => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
}

function togglePause() {
  if (state !== 'race' && state !== 'countdown') return;
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
}

function finish(c) {
  winner = c;
  setState('finished');
  cars.forEach(k => { k.ai = true; k.item = null; });
  timeScale = 0.3; slowT = 1.5; finishRealT = 0; victoryShown = false;
  shake = 10;
  sfx.win();
  explode(c.x, c.y, c.p.rgb, 50, 320);
}

function showVictory() {
  victoryShown = true;
  const v = $('victory');
  v.classList.remove('hidden', 'p1', 'p2');
  v.classList.add(winner.id === 0 ? 'p1' : 'p2');
  $('winner-text').textContent = winner.p.name + ' WINS!';
  $('winner-stats').textContent = 'RACE TIME ' + fmtTime(raceT) +
    '  •  BEST LAP  P1 ' + fmtTime(cars[0].bestLap) + '  /  P2 ' + fmtTime(cars[1].bestLap);
}

// ============================================================
// Input
// ============================================================
function readInput(c) {
  if (c.ai) { autopilot(c); return; }
  const k = c.p.keys;
  inp.throttle = (keys[k.up] ? 1 : 0) - (keys[k.down] ? 1 : 0);
  inp.steer = (keys[k.right] ? 1 : 0) - (keys[k.left] ? 1 : 0);
}

// Simple centerline follower: drives the attract mode and the victory lap.
function autopilot(c) {
  trackPoint(c.s + 11 + c.speed * 0.035, c.id === 0 ? -10 : 10);
  const diff = angDiff(Math.atan2(tp.y - c.y, tp.x - c.x), c.a);
  inp.steer = clamp(diff * 3, -1, 1);
  inp.throttle = Math.abs(diff) > 0.55 && c.speed > 190 ? -1 : 1;
  if (c.item && state === 'menu') {
    c.aiUseT -= DT;
    if (c.aiUseT <= 0) useItem(c);
  }
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'NumpadEnter']);

window.addEventListener('keydown', e => {
  const racing = state === 'race' || state === 'countdown';
  // Stops arrows scrolling the page and Enter "clicking" a focused button mid-race.
  if (racing && !paused && GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (state === 'race' && !paused) {
    for (const c of cars) if (!c.ai && c.p.use.includes(e.code)) useItem(c);
  }
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if ((state === 'race' || state === 'countdown') && !paused) togglePause();
});

// ============================================================
// Physics
// ============================================================
function moveCar(c, dt) {
  readInput(c);
  let th = inp.throttle, st = inp.steer;
  if (c.reverseT > 0) st = -st;
  if (c.spinT > 0) { c.a += c.spinDir * 13 * dt; th = 0; st = 0; }

  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  let vf = c.vx * fx + c.vy * fy;       // speed along the car's nose
  let vl = -c.vx * fy + c.vy * fx;      // sideways slip
  if (th > 0) vf += ACC * (c.boostT > 0 ? BOOST_MULT : 1) * th * dt;
  else if (th < 0) vf -= (vf > 15 ? BRAKE : REV_ACC) * dt;
  vf *= Math.exp(-DRAG * dt);
  vl *= Math.exp(-(c.spinT > 0 ? 2.5 : c.oilT > 0 ? 0.5 : GRIP) * dt);

  if (c.oilT > 0) st = st * 0.35 + Math.sin(simT * 17 + c.id * 3) * 0.55;
  c.a += st * TURN * Math.min(1, Math.abs(vf) / 110) * (vf < 0 ? -1 : 1) * dt;

  c.vx = fx * vf - fy * vl;
  c.vy = fy * vf + fx * vl;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.speed = Math.hypot(c.vx, c.vy);
  c.slip = vl;
  c.throttle = th;

  c.boostT = Math.max(0, c.boostT - dt);
  c.shieldT = Math.max(0, c.shieldT - dt);
  c.reverseT = Math.max(0, c.reverseT - dt);
  c.oilT = Math.max(0, c.oilT - dt);
  c.spinT = Math.max(0, c.spinT - dt);
  c.hitCd = Math.max(0, c.hitCd - dt);
}

function collideCars() {
  const a = cars[0], b = cars[1];
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = CAR_R * 2 + 2;
  if (d >= min || d === 0) return;
  const nx = dx / d, ny = dy / d, push = (min - d) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    const j = -rel * 0.9;   // equal masses, slightly inelastic
    a.vx -= nx * j; a.vy -= ny * j;
    b.vx += nx * j; b.vy += ny * j;
    if (rel < -50 && a.hitCd <= 0) {
      a.hitCd = 0.15;
      sparks((a.x + b.x) / 2, (a.y + b.y) / 2, 10, '255,255,255');
      shake = Math.max(shake, 3);
      sfx.bump();
    }
  }
}

function collideObstacles(c) {
  for (const o of obstacles) {
    const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy), min = o.r + CAR_R;
    if (d >= min || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    c.x = o.x + nx * min; c.y = o.y + ny * min;
    const vn = c.vx * nx + c.vy * ny;
    if (vn < 0) {
      c.vx -= 1.5 * vn * nx; c.vy -= 1.5 * vn * ny;
      if (vn < -60 && c.hitCd <= 0) {
        c.hitCd = 0.15;
        sparks(o.x + nx * o.r, o.y + ny * o.r, 8, '255,216,74');
        sfx.bump();
      }
    }
  }
}

// Keeps the car inside the road and advances its lap progress.
function constrainToTrack(c) {
  nearest(c.x, c.y, c.s);
  const lim = HW - CAR_R;
  if (near.d > lim) {
    const nx = (c.x - near.x) / near.d, ny = (c.y - near.y) / near.d;
    c.x = near.x + nx * lim; c.y = near.y + ny * lim;
    const vn = c.vx * nx + c.vy * ny;
    if (vn > 0) {
      c.vx -= 1.35 * vn * nx; c.vy -= 1.35 * vn * ny;
      c.vx *= 0.992; c.vy *= 0.992;   // scraping costs speed
      if (vn > 70 && c.hitCd <= 0) {
        c.hitCd = 0.12;
        sparks(c.x + nx * CAR_R, c.y + ny * CAR_R, 6, c.p.rgb);
        sfx.wall();
      }
    }
  }
  let ds = near.s - c.s;
  if (ds > track.M / 2) ds -= track.M;
  if (ds < -track.M / 2) ds += track.M;
  c.prog += ds;
  c.s = near.s;
}

// Progress is continuous distance along the lap, so checkpoints can only be
// reached in order and reversing over the line gains nothing.
function checkProgress(c, dt) {
  const M = track.M;
  const forward = c.vx * track.tx[Math.floor(c.s) % M] + c.vy * track.ty[Math.floor(c.s) % M];
  c.wrongT = forward < -40 ? c.wrongT + dt : 0;

  if (c.prog < c.lap * M + (c.cp + 1) * M / NCP) return false;
  c.cp++;
  cpFlashes.push({ s: (c.cp % NCP) * M / NCP, rgb: c.p.rgb, life: 0.6 });
  if (c.cp < NCP) { sfx.checkpoint(); return false; }
  c.cp = 0;
  c.lap++;
  c.bestLap = Math.min(c.bestLap, raceT - c.lapStart);
  c.lapStart = raceT;
  if (c.lap >= LAPS) return true;
  if (c.lap === LAPS - 1 && !finalLapCalled) {
    finalLapCalled = true;
    announce('FINAL LAP');
    sfx.finalLap();
  } else sfx.lap();
  floatText(c.x, c.y - 24, 'LAP ' + (c.lap + 1), c.p.rgb);
  return false;
}

// ============================================================
// Power-ups
// ============================================================
function giveItem(c) {
  c.item = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
  c.aiUseT = rand(0.5, 2.5);
  floatText(c.x, c.y - 24, ITEMS[c.item].icon + ' ' + ITEMS[c.item].name, c.p.rgb);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * TAU, v = rand(60, 200);
    addPart('glow', c.x, c.y, Math.cos(a) * v, Math.sin(a) * v, rand(0.3, 0.6), 3, '255,216,74');
  }
  sfx.pickup();
}

// Returns false when the target's shield absorbed the attack.
function attack(t) {
  if (t.shieldT <= 0) return true;
  t.shieldT = 0;
  floatText(t.x, t.y - 24, 'BLOCKED!', '180,255,255');
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU;
    addPart('spark', t.x + Math.cos(a) * 18, t.y + Math.sin(a) * 18, Math.cos(a) * 220, Math.sin(a) * 220, 0.4, 2, '180,255,255');
  }
  sfx.shieldBreak();
  return false;
}

function useItem(c) {
  const it = c.item;
  if (!it) return;
  c.item = null;
  const foe = cars[1 - c.id], fx = Math.cos(c.a), fy = Math.sin(c.a);
  if (it === 'turbo') {
    c.boostT = 2.2;
    c.vx += fx * 120; c.vy += fy * 120;
    sfx.turbo();
  } else if (it === 'oil') {
    if (slicks.length >= 8) slicks.shift();
    slicks.push({ x: c.x - fx * 30, y: c.y - fy * 30, r: 19, owner: c, arm: 0.6, life: 25, rot: Math.random() * TAU });
    sfx.oilDrop();
  } else if (it === 'rocket') {
    rockets.push({ x: c.x + fx * 20, y: c.y + fy * 20, a: c.a, owner: c, target: foe, life: 3.5 });
    sfx.rocket();
  } else if (it === 'shield') {
    c.shieldT = 12;
    sfx.shieldOn();
  } else if (it === 'reverse') {
    sfx.reverse();
    if (attack(foe)) {
      foe.reverseT = 4.5;
      floatText(foe.x, foe.y - 24, '🔄 REVERSED!', '168,85,255');
    }
  }
}

function updateItems(dt) {
  for (const b of boxes) {
    b.cool = Math.max(0, b.cool - dt);
    if (b.cool > 0) continue;
    for (const c of cars) {
      if (!c.item && Math.hypot(c.x - b.x, c.y - b.y) < 22) { b.cool = 4; giveItem(c); break; }
    }
  }

  for (let i = slicks.length - 1; i >= 0; i--) {
    const s = slicks[i];
    s.arm = Math.max(0, s.arm - dt);
    s.life -= dt;
    let gone = s.life <= 0;
    for (const c of cars) {
      if (gone || (c === s.owner && s.arm > 0)) continue;
      if (Math.hypot(c.x - s.x, c.y - s.y) > s.r + CAR_R - 5) continue;
      gone = true;
      if (attack(c)) {
        c.oilT = 1.5;
        c.a += rand(-0.5, 0.5);
        floatText(c.x, c.y - 24, 'SLIPPING!', '168,85,255');
        sfx.oilHit();
      }
    }
    if (gone) slicks.splice(i, 1);
  }

  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i], t = r.target;
    r.life -= dt;
    // Turns much harder up close, otherwise it would orbit a nearby target forever.
    const turn = (Math.hypot(t.x - r.x, t.y - r.y) < 120 ? 16 : 4.5) * dt;
    r.a += clamp(angDiff(Math.atan2(t.y - r.y, t.x - r.x), r.a), -turn, turn);
    r.x += Math.cos(r.a) * ROCKET_SPEED * dt;
    r.y += Math.sin(r.a) * ROCKET_SPEED * dt;
    if (Math.random() < 90 * dt) addPart('glow', r.x, r.y, rand(-20, 20), rand(-20, 20), 0.35, 4, '255,160,60');
    const hit = Math.hypot(t.x - r.x, t.y - r.y) < CAR_R + 9;
    if (hit && attack(t)) {
      t.spinT = 1.0;
      t.spinDir = Math.random() < 0.5 ? -1 : 1;
      t.vx *= 0.25; t.vy *= 0.25;
      t.boostT = 0;
      floatText(t.x, t.y - 24, 'HIT!', '255,160,60');
    }
    if (hit || r.life <= 0) {
      explode(r.x, r.y, '255,160,60', hit ? 36 : 12, hit ? 260 : 120);
      if (hit) { shake = Math.max(shake, 8); sfx.explode(); }
      rockets.splice(i, 1);
    }
  }
}

// ============================================================
// Particles & effects
// ============================================================
function addPart(type, x, y, vx, vy, life, size, rgb) {
  if (parts.length >= MAX_PARTICLES) return;
  parts.push({ type, x, y, vx, vy, life, max: life, size, rgb, rot: Math.random() * TAU });
}

function sparks(x, y, n, rgb) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = rand(80, 320);
    addPart('spark', x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.15, 0.4), 2, rgb);
  }
}

function explode(x, y, rgb, n, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = rand(0.2, 1) * power;
    addPart(i % 3 ? 'glow' : 'spark', x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.3, 0.9), rand(3, 7), i % 4 ? rgb : '255,255,255');
  }
  for (let i = 0; i < n / 4; i++) addPart('smoke', x, y, rand(-50, 50), rand(-50, 50), rand(0.6, 1.2), rand(6, 10), '');
}

function floatText(x, y, text, rgb) {
  floats.push({ x, y, text, rgb, life: 1.3 });
}

function announce(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;   // restart the CSS animation
  b.classList.add('show');
}

function showCount(text) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('pop');
  el.classList.toggle('go', text === 'GO!');
  void el.offsetWidth;
  el.classList.add('pop');
}

function emitCarFx(c, dt) {
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  const rx = c.x - fx * 12, ry = c.y - fy * 12;

  if ((simT * 120 | 0) % 2 === 0) {
    c.trail.push(rx, ry);
    if (c.trail.length > 56) c.trail.splice(0, 2);
  }

  const drifting = Math.abs(c.slip) > 75 && c.speed > 110;
  const w1x = rx + fy * 6, w1y = ry - fx * 6, w2x = rx - fy * 6, w2y = ry + fx * 6;
  if (drifting || c.spinT > 0 || c.oilT > 0) {
    if (Math.random() < 50 * dt) addPart('smoke', rx + rand(-5, 5), ry + rand(-5, 5), c.vx * 0.15 + rand(-15, 15), c.vy * 0.15 + rand(-15, 15), rand(0.4, 0.8), rand(4, 7), '');
    if (c.skid && marksCtx) {
      marksCtx.strokeStyle = 'rgba(' + c.p.rgb + ',0.22)';
      marksCtx.lineWidth = 2.5;
      marksCtx.beginPath();
      marksCtx.moveTo(c.skid[0], c.skid[1]); marksCtx.lineTo(w1x, w1y);
      marksCtx.moveTo(c.skid[2], c.skid[3]); marksCtx.lineTo(w2x, w2y);
      marksCtx.stroke();
    }
    c.skid = [w1x, w1y, w2x, w2y];
  } else c.skid = null;

  if (c.boostT > 0) {
    for (let i = 0; i < 2; i++) addPart('glow', rx, ry, -fx * rand(60, 160) + rand(-30, 30), -fy * rand(60, 160) + rand(-30, 30), rand(0.2, 0.45), rand(3, 6), Math.random() < 0.5 ? '255,216,74' : c.p.rgb);
  } else if (c.throttle > 0 && Math.random() < 30 * dt) {
    addPart('glow', rx, ry, -fx * 40 + rand(-12, 12), -fy * 40 + rand(-12, 12), 0.3, 2.5, c.p.rgb);
  }
}

function updateEffects(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'confetti') { p.vy += 160 * dt; p.rot += 6 * dt; p.vx *= 1 - 0.8 * dt; }
    else { p.vx *= 1 - 2.2 * dt; p.vy *= 1 - 2.2 * dt; }
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    floats[i].life -= dt; floats[i].y -= 28 * dt;
    if (floats[i].life <= 0) floats.splice(i, 1);
  }
  for (let i = cpFlashes.length - 1; i >= 0; i--) {
    cpFlashes[i].life -= dt;
    if (cpFlashes[i].life <= 0) cpFlashes.splice(i, 1);
  }
  shake = Math.max(0, shake - 30 * dt);

  if (state === 'finished') {
    fireworkT -= dt;
    if (fireworkT <= 0) {
      fireworkT = rand(0.08, 0.2);
      const palette = [winner.p.rgb, '255,216,74', '255,255,255'];
      explode(rand(150, W - 150), rand(120, H - 160), palette[Math.floor(Math.random() * 3)], 26, 260);
      for (let i = 0; i < 10; i++) addPart('confetti', rand(0, W), -10, rand(-60, 60), rand(60, 180), rand(2, 3.5), rand(4, 8), palette[i % 3]);
    }
  }
}

// ============================================================
// Simulation step
// ============================================================
function step(dt) {
  simT += dt;

  if (state === 'countdown') {
    cdT += dt;
    const n = 3 - Math.floor(cdT / 0.85);
    if (n !== cdN) {
      cdN = n;
      if (n > 0) { showCount(String(n)); sfx.count(); }
      else { showCount('GO!'); sfx.go(); setState('race'); }
    }
  }

  if (state !== 'countdown') {
    if (state === 'race') raceT += dt;
    for (const c of cars) moveCar(c, dt);
    collideCars();
    let first = null;
    for (const c of cars) {
      collideObstacles(c);
      constrainToTrack(c);
      if (state === 'race' && checkProgress(c, dt) && (!first || c.prog > first.prog)) first = c;
    }
    if (first) finish(first);
    updateItems(dt);
  }

  for (const c of cars) emitCarFx(c, dt);
  updateEffects(dt);
}

// ============================================================
// Rendering
// ============================================================
const stage = $('stage');
const canvas = $('game');
const ctx = canvas.getContext('2d');
let RS = 0;                       // render scale (device px per design px)
let trackLayer = null, marksLayer = null, marksCtx = null;

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function tracePath(c) {
  c.beginPath();
  c.moveTo(track.x[0], track.y[0]);
  for (let i = 1; i < track.M; i++) c.lineTo(track.x[i], track.y[i]);
  c.closePath();
}

// The static scenery is drawn once to an offscreen canvas. The road is the
// centerline stroked 2*HW wide, so the picture matches the collision test exactly.
function buildLayers() {
  trackLayer = document.createElement('canvas');
  trackLayer.width = canvas.width; trackLayer.height = canvas.height;
  const c = trackLayer.getContext('2d');
  c.setTransform(RS, 0, 0, RS, 0, 0);

  const bg = c.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 800);
  bg.addColorStop(0, '#140b30'); bg.addColorStop(1, '#05040c');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);

  c.strokeStyle = 'rgba(120,80,255,0.13)'; c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= W; x += 40) { c.moveTo(x, 0); c.lineTo(x, H); }
  for (let y = 0; y <= H; y += 40) { c.moveTo(0, y); c.lineTo(W, y); }
  c.stroke();

  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    c.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,43,214' : '25,227,255') + ',' + (0.15 + rnd() * 0.35).toFixed(2) + ')';
    c.fillRect(rnd() * W, rnd() * H, 2, 2);
  }

  const edge = c.createLinearGradient(0, 0, W, H);
  edge.addColorStop(0, '#ff2bd6'); edge.addColorStop(0.5, '#a855ff'); edge.addColorStop(1, '#19e3ff');
  c.lineJoin = 'round'; c.lineCap = 'round';
  tracePath(c);
  c.strokeStyle = edge;
  c.globalAlpha = 0.22; c.lineWidth = HW * 2 + 34; c.shadowColor = '#a855ff'; c.shadowBlur = 40 * RS; c.stroke();
  c.globalAlpha = 1; c.lineWidth = HW * 2 + 12; c.shadowBlur = 22 * RS; c.stroke();
  c.shadowBlur = 0;
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = HW * 2 + 4; c.stroke();
  c.strokeStyle = '#0c0a1d'; c.lineWidth = HW * 2; c.stroke();
  c.strokeStyle = 'rgba(40,30,90,0.35)'; c.lineWidth = HW * 2 - 30; c.stroke();

  // Direction chevrons
  c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 3;
  for (let i = 20; i < track.M - 10; i += 28) {
    trackPoint(i, 0);
    c.save(); c.translate(tp.x, tp.y); c.rotate(Math.atan2(tp.ty, tp.tx));
    c.beginPath(); c.moveTo(-6, -10); c.lineTo(4, 0); c.lineTo(-6, 10); c.stroke();
    c.restore();
  }

  // Checkpoint gates
  c.lineCap = 'butt';
  for (let k = 1; k < NCP; k++) {
    trackPoint(k * track.M / NCP, 0);
    c.save(); c.translate(tp.x, tp.y); c.rotate(Math.atan2(tp.ty, tp.tx));
    c.strokeStyle = 'rgba(25,227,255,0.35)'; c.lineWidth = 3; c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(0, -HW); c.lineTo(0, HW); c.stroke();
    c.restore();
  }

  // Start / finish line and grid slots
  trackPoint(0, 0);
  c.save(); c.translate(tp.x, tp.y); c.rotate(Math.atan2(tp.ty, tp.tx));
  for (let r = 0; r < 11; r++) for (let col = 0; col < 2; col++) {
    c.fillStyle = (r + col) % 2 ? '#f4f4ff' : '#15122b';
    c.fillRect(col * 8 - 8, -HW + r * 8, 8, 8);
  }
  c.restore();
  cars.forEach((car, i) => {
    trackPoint(-8, i === 0 ? -20 : 20);
    c.save(); c.translate(tp.x, tp.y); c.rotate(Math.atan2(tp.ty, tp.tx));
    c.strokeStyle = 'rgba(' + car.p.rgb + ',0.5)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-18, -12); c.lineTo(18, -12); c.lineTo(18, 12); c.lineTo(-18, 12); c.stroke();
    c.restore();
  });

  marksLayer = document.createElement('canvas');
  marksLayer.width = canvas.width; marksLayer.height = canvas.height;
  marksCtx = marksLayer.getContext('2d');
  marksCtx.setTransform(RS, 0, 0, RS, 0, 0);
  marksCtx.lineCap = 'round';
}

function resize() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  const rs = clamp(s * (window.devicePixelRatio || 1), 0.5, 2);
  if (!trackLayer || Math.abs(rs - RS) > 0.01) {
    RS = rs;
    canvas.width = Math.round(W * RS);
    canvas.height = Math.round(H * RS);
    buildLayers();
  }
}

function drawTrail(c) {
  const t = c.trail, n = t.length / 2;
  if (n < 2) return;
  const boost = c.boostT > 0;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    ctx.strokeStyle = 'rgba(' + (boost ? '255,216,74' : c.p.rgb) + ',' + (k * k * (boost ? 0.8 : 0.5)).toFixed(3) + ')';
    ctx.lineWidth = 2 + k * (boost ? 9 : 6);
    ctx.beginPath();
    ctx.moveTo(t[i * 2 - 2], t[i * 2 - 1]);
    ctx.lineTo(t[i * 2], t[i * 2 + 1]);
    ctx.stroke();
  }
}

function drawCar(c) {
  const col = c.p.color, rgb = c.p.rgb;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);

  // Underglow and headlight beams
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(' + rgb + ',0.22)';
  ctx.beginPath(); ctx.ellipse(0, 0, 25, 16, 0, 0, TAU); ctx.fill();
  const beam = ctx.createLinearGradient(12, 0, 80, 0);
  beam.addColorStop(0, 'rgba(255,255,220,0.22)'); beam.addColorStop(1, 'rgba(255,255,220,0)');
  ctx.fillStyle = beam;
  ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(80, -24); ctx.lineTo(80, 24); ctx.lineTo(12, 5); ctx.fill();
  if (c.boostT > 0) {
    const len = 16 + Math.random() * 14;
    ctx.fillStyle = 'rgba(255,216,74,0.9)';
    ctx.beginPath(); ctx.moveTo(-13, -5); ctx.lineTo(-13 - len, 0); ctx.lineTo(-13, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(-13, -2.5); ctx.lineTo(-13 - len * 0.55, 0); ctx.lineTo(-13, 2.5); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#05050a';
  ctx.fillRect(-11, -9, 7, 3); ctx.fillRect(-11, 6, 7, 3);
  ctx.fillRect(5, -9, 6, 3); ctx.fillRect(5, 6, 6, 3);

  ctx.shadowColor = col; ctx.shadowBlur = 14 * RS;
  ctx.fillStyle = col;
  rr(ctx, -14, -7, 28, 14, 4); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(-13, -1.2, 26, 2.4);
  ctx.fillStyle = '#0a0a18';
  rr(ctx, -7, -5, 12, 10, 3); ctx.fill();
  ctx.fillStyle = '#ffffe0';
  ctx.fillRect(12, -6, 2, 3); ctx.fillRect(12, 3, 2, 3);
  ctx.fillStyle = '#ff3355';
  ctx.fillRect(-14, -6, 1.5, 3); ctx.fillRect(-14, 3, 1.5, 3);
  ctx.restore();

  if (c.shieldT > 0) {
    const pulse = 20 + Math.sin(simT * 8) * 1.5;
    // Blinks during the last two seconds
    if (c.shieldT > 2 || Math.sin(simT * 30) > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(160,255,255,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, pulse, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(25,227,255,0.14)'; ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (c.reverseT > 0) {
    ctx.strokeStyle = 'rgba(168,85,255,0.95)'; ctx.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const a = -simT * 7 + i * Math.PI;
      ctx.beginPath(); ctx.arc(c.x, c.y, 24, a, a + 2.1); ctx.stroke();
    }
  }
  if (state === 'countdown' || (state === 'race' && raceT < 2.5)) {
    ctx.font = 'italic 900 15px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = col;
    ctx.fillText(c.p.tag, c.x, c.y - 22);
  }
}

function drawParticles(additive) {
  for (const p of parts) {
    const k = p.life / p.max;
    if (p.type === 'smoke') {
      if (additive) continue;
      ctx.fillStyle = 'rgba(170,170,210,' + (k * 0.3).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - k) * 2), 0, TAU); ctx.fill();
    } else if (p.type === 'confetti') {
      if (additive) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(' + p.rgb + ',' + Math.min(1, k * 3).toFixed(3) + ')';
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else if (!additive) {
      continue;
    } else if (p.type === 'glow') {
      ctx.fillStyle = 'rgba(' + p.rgb + ',' + k.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k + 0.5, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(' + p.rgb + ',' + k.toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
    }
  }
}

function render() {
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(trackLayer, 0, 0, W, H);
  if (shake > 0.1) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  ctx.drawImage(marksLayer, 0, 0, W, H);

  // Checkpoint flashes
  ctx.lineCap = 'butt';
  for (const f of cpFlashes) {
    trackPoint(f.s, 0);
    ctx.strokeStyle = 'rgba(' + f.rgb + ',' + (f.life / 0.6).toFixed(3) + ')';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(tp.x + tp.ty * HW, tp.y - tp.tx * HW);
    ctx.lineTo(tp.x - tp.ty * HW, tp.y + tp.tx * HW);
    ctx.stroke();
  }

  // Oil slicks
  for (const s of slicks) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    ctx.fillStyle = 'rgba(4,3,10,0.92)';
    ctx.beginPath(); ctx.ellipse(0, 0, s.r, s.r * 0.75, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s.r * 0.5, s.r * 0.3, s.r * 0.5, s.r * 0.4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(168,85,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, s.r * 0.7, s.r * 0.45, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,255,170,0.45)';
    ctx.beginPath(); ctx.ellipse(-2, 1, s.r * 0.4, s.r * 0.22, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // Obstacles
  for (const o of obstacles) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,216,74,' + (0.16 + Math.sin(simT * 5 + o.x) * 0.06).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 8, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1a1206';
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r - 1, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, TAU); ctx.fill();
  }

  // Power-up boxes
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of boxes) {
    if (b.cool > 0) continue;
    const bob = 1 + Math.sin(simT * 4 + b.phase) * 0.1, hue = (simT * 90 + b.phase * 57) % 360;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'hsla(' + hue + ',100%,60%,0.2)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 19 * bob, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(simT * 1.5 + b.phase); ctx.scale(bob, bob);
    ctx.fillStyle = 'rgba(12,10,29,0.9)';
    ctx.strokeStyle = 'hsl(' + hue + ',100%,65%)'; ctx.lineWidth = 2.5;
    rr(ctx, -10, -10, 20, 20, 4); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '900 15px Arial, sans-serif';
    ctx.fillText('?', b.x, b.y + 1);
  }
  ctx.textBaseline = 'alphabetic';

  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (const c of cars) drawTrail(c);
  ctx.globalCompositeOperation = 'source-over';
  drawParticles(false);
  for (const c of cars) drawCar(c);

  // Rockets
  for (const r of rockets) {
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,160,60,0.35)';
    ctx.beginPath(); ctx.arc(-4, 0, 12, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -4); ctx.lineTo(-6, 4); ctx.fill();
    ctx.fillStyle = r.owner.p.color;
    ctx.fillRect(-9, -5, 4, 10);
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'lighter';
  drawParticles(true);
  ctx.globalCompositeOperation = 'source-over';

  ctx.font = 'italic 900 15px Arial, sans-serif';
  ctx.textAlign = 'center';
  for (const f of floats) {
    const a = Math.min(1, f.life * 2).toFixed(3);
    ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = 'rgba(' + f.rgb + ',' + a + ')';
    ctx.fillText(f.text, f.x, f.y);
  }
}

// ============================================================
// HUD
// ============================================================
const hudEls = [0, 1].map(i => ({
  pos: $('p' + (i + 1) + '-pos'), lap: $('p' + (i + 1) + '-lap'),
  item: $('p' + (i + 1) + '-item'), status: $('p' + (i + 1) + '-status'),
}));
const timerEl = $('timer');
const hudCache = new Map();
function setText(el, v) {
  if (hudCache.get(el) === v) return;
  hudCache.set(el, v);
  el.textContent = v;
}

function updateHud() {
  if (state === 'menu') return;
  const lead = winner ? winner.id : (cars[0].prog >= cars[1].prog ? 0 : 1);
  cars.forEach((c, i) => {
    const el = hudEls[i];
    setText(el.pos, lead === i ? '1ST' : '2ND');
    el.pos.classList.toggle('lead', lead === i);
    setText(el.lap, String(Math.min(c.lap + 1, LAPS)));
    setText(el.item, c.item ? ITEMS[c.item].icon : '');
    el.item.classList.toggle('has', !!c.item);
    setText(el.status,
      state !== 'race' ? '' :
      c.spinT > 0 ? 'SPUN OUT!' :
      c.reverseT > 0 ? 'CONTROLS REVERSED!' :
      c.oilT > 0 ? 'SLIPPING!' :
      c.wrongT > 0.8 ? 'WRONG WAY!' :
      c.boostT > 0 ? 'TURBO!' :
      c.shieldT > 0 ? 'SHIELD ACTIVE' : '');
  });
  setText(timerEl, fmtTime(raceT));
}

// ============================================================
// Main loop
// ============================================================
let lastT = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const fdt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;

  if (!paused) {
    if (slowT > 0) { slowT -= fdt; if (slowT <= 0) timeScale = 1; }
    if (state === 'finished' && !victoryShown) {
      finishRealT += fdt;
      if (finishRealT > 1.2) showVictory();
    }
    acc += fdt * timeScale;
    let n = 0;
    while (acc >= DT && n < 8) { step(DT); acc -= DT; n++; }
    if (n === 8) acc = 0;
  }
  render();
  updateHud();
  updateEngines();
}

// ============================================================
// UI wiring
// ============================================================
function onClick(id, fn) {
  $(id).addEventListener('click', e => {
    e.currentTarget.blur();
    initAudio();
    sfx.click();
    fn();
  });
}
onClick('btn-play', startRace);
onClick('btn-how', () => $('instructions').classList.remove('hidden'));
onClick('btn-back', () => $('instructions').classList.add('hidden'));
onClick('btn-menu-mute', toggleMute);
onClick('btn-mute', toggleMute);
onClick('btn-pause', togglePause);
onClick('btn-resume', togglePause);
onClick('btn-restart', startRace);
onClick('btn-pause-restart', startRace);
onClick('btn-rematch', startRace);
onClick('btn-pause-menu', toMenu);
onClick('btn-victory-menu', toMenu);

window.addEventListener('resize', resize);
resize();
refreshMuteUi();
toMenu();
requestAnimationFrame(frame);

})();
