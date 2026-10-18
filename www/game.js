(function () {
'use strict';
const MAXL = 20;
const WR = {
  60: { t: 6.34, who: 'Кристиан Коулман, 2018' },
  100: { t: 9.58, who: 'Усейн Болт, 2009' },
  150: { t: 14.35, who: 'Усейн Болт, 2009' },
  200: { t: 19.19, who: 'Усейн Болт, 2009' }
};
const WR_JUMP = { d: 3.71, who: 'Арне Тервааг, 1968' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const curve = (n, p) => 1 - Math.pow(1 - clamp(n, 0, 1), p);

function statsFor(lv) {
  const np = lv.power / MAXL, ns = lv.speed / MAXL, ne = lv.endur / MAXL;
  return {
    tau: 2.4 - 1.2 * curve(np, 1.4),
    vmax: 6.0 + 6.5 * curve(ns, 1.4),
    tF: 3.4 + 2.1 * ne,
    fade: 0.0215 - 0.0025 * ne,
    cap: 0.42 - 0.07 * ne,
    jump: 1.38 + 2.42 * curve(np, 1.3)
  };
}

function fadeDrop(p, tm) {
  return Math.min(p.cap, p.fade * Math.max(0, tm - p.tF));
}

function simulate(p, dist, rt, eff) {
  const dt = 0.01;
  const xs = [0];
  let t = 0, x = 0, v = 0;
  while (x < dist && t < 90) {
    t += dt;
    if (t >= rt) {
      const tm = t - rt;
      const vT = p.vmax * (1 - fadeDrop(p, tm)) * eff;
      const tau = vT >= v ? p.tau : 1.0;
      v += (vT - v) / tau * dt;
      x += v * dt;
    }
    xs.push(x);
  }
  const n = xs.length;
  const x1 = xs[n - 1], x0 = xs[n - 2];
  const frac = x1 > x0 ? (dist - x0) / (x1 - x0) : 1;
  return { time: (n - 2 + frac) * dt, xs, dt, dist, vEnd: (x1 - x0) / dt };
}

function posAt(sim, t) {
  if (t <= 0) return 0;
  const i = t / sim.dt;
  const n = sim.xs.length;
  if (i >= n - 1) {
    const te = (n - 1) * sim.dt;
    const extra = sim.vEnd * (1 - Math.exp(-1.5 * (t - te))) / 1.5;
    return sim.xs[n - 1] + extra;
  }
  const k = Math.floor(i);
  const f = i - k;
  return sim.xs[k] * (1 - f) + sim.xs[k + 1] * f;
}

const ghostCache = {};
function ghostSim(dist) {
  if (ghostCache[dist]) return ghostCache[dist];
  const base = statsFor({ power: MAXL, speed: MAXL, endur: MAXL });
  const target = WR[dist].t;
  let lo = 8, hi = 15;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const s = simulate(Object.assign({}, base, { vmax: mid }), dist, 0.146, 1);
    if (s.time > target) lo = mid; else hi = mid;
  }
  const sim = simulate(Object.assign({}, base, { vmax: hi }), dist, 0.146, 1);
  ghostCache[dist] = sim;
  return sim;
}

function idealTime(lv, dist) {
  return simulate(statsFor(lv), dist, 0.2, 1).time;
}

class Sprinter {
  constructor(p) {
    this.p = p;
    this.reset();
  }
  reset() {
    this.x = 0;
    this.v = 0;
    this.tm = 0;
    this.started = false;
    this.live = true;
    this.steps = 0;
    this.lastTap = -1;
    this.interval = 0;
  }
  fStar() {
    return 3.3 + 0.1 * this.v;
  }
  tap(now) {
    if (!this.started) {
      this.started = true;
    } else {
      const iv = now - this.lastTap;
      if (iv < 0.04) return { ignored: true };
      this.interval = this.interval ? this.interval * 0.5 + iv * 0.5 : iv;
    }
    this.lastTap = now;
    this.steps++;
    return { ignored: false };
  }
  cadence(now) {
    if (this.steps < 3 || !this.interval) return 0;
    const gap = now - this.lastTap;
    let f = 1 / this.interval;
    if (gap > this.interval * 1.5) f = Math.min(f, 1 / gap);
    return f;
  }
  ratio(now) {
    if (this.steps < 3) return 1;
    return this.cadence(now) / this.fStar();
  }
  efficiency(now) {
    if (this.steps < 3) return 1;
    if (now - this.lastTap > 0.75) return 0;
    const r = this.ratio(now);
    if (r > 1.07) return Math.max(0.35, 1 - (r - 1.07) * 1.8);
    if (r >= 0.93) return 1;
    return Math.max(0, 1 - (0.93 - r) * 1.4);
  }
  step(dt, now) {
    if (!this.started) return;
    this.tm += dt;
    const drop = fadeDrop(this.p, this.tm);
    const e = this.live ? this.efficiency(now) : 0;
    const vT = this.p.vmax * (1 - drop) * e;
    const tau = vT >= this.v ? this.p.tau : (this.live ? 1.0 : 0.8);
    this.v += (vT - this.v) / tau * dt;
    if (this.v < 0) this.v = 0;
    this.x += this.v * dt;
  }
}

function jumpDistance(jumpPotential, q, penalty) {
  return Math.max(0.3, jumpPotential * (0.62 + 0.38 * q) - penalty);
}

function swingQuality(p) {
  if (p < 0.8) return p / 0.8;
  if (p <= 0.92) return 1;
  return Math.max(0.35, 1 - (p - 0.92) * 6);
}

function landingPenalty(tapped, diff) {
  if (!tapped) return 0.2;
  return clamp((diff - 0.14) / 0.3, 0, 1) * 0.28;
}

function placeFor(sprintTime, rivalTimes) {
  let place = 1;
  for (const r of rivalTimes) if (r < sprintTime) place++;
  return place;
}

const CAPS = [8, 12, 16, 20];
const START = [0, 4, 6, 8];
const LIFE_MULT = [1, 1.4, 1.9, 2.5];
const RANKS = ['Новичок', 'Любитель', 'Перворазрядник', 'Мастер спорта'];
const BASE_PAY = { 60: 10, 100: 16, 150: 24, 200: 32 };
const PLACE_MULT = [1, 0.75, 0.55, 0.4];
const QUAL = { 100: { d: 60, t: 12.5 }, 150: { d: 100, t: 20.5 }, 200: { d: 150, t: 30 } };
const LEG_BONUS = 1.2;

function upgradeCost(l) {
  return Math.round(40 * Math.pow(1.18, l) / 5) * 5;
}

function racePay(dist, place, pb, clean, life) {
  const placed = BASE_PAY[dist] * PLACE_MULT[place - 1];
  const pbB = pb ? BASE_PAY[dist] * 0.5 : 0;
  const cleanB = clean >= 0.7 ? placed * 0.25 : 0;
  const k = LIFE_MULT[life];
  return { placed, pbB, cleanB, k, total: Math.max(1, Math.round((placed + pbB + cleanB) * k)) };
}

function jumpPay(dist, pb, life) {
  const base = 3 + 2 * dist;
  const pbB = pb ? base * 0.5 : 0;
  const k = LIFE_MULT[life];
  return { base, pbB, k, total: Math.max(1, Math.round((base + pbB) * k)) };
}

function effLv(lv, legs) {
  const b = legs * LEG_BONUS;
  return { power: Math.min(MAXL, lv.power + b), speed: Math.min(MAXL, lv.speed + b), endur: lv.endur };
}

function legsGain(legs, k) {
  return legs + (1 - legs) * k;
}

function ropePay(reps, perfect, pb, life) {
  const base = reps * 0.7 + perfect * 0.3;
  const pbB = pb && reps >= 10 ? base * 0.5 : 0;
  const k = LIFE_MULT[life];
  return { base, pbB, k, total: Math.max(1, Math.round((base + pbB) * k)) };
}


const $ = id => document.getElementById(id);
const LANES = 6, LANE_W = 1.22, TRACK_W = LANES * LANE_W;
const laneX = i => (i - (LANES - 1) / 2) * LANE_W;
const P_LANE = 3, G_LANE = 2, R_LANES = [0, 1, 4];
const DISTS = [60, 100, 150, 200];
const WHO_SHORT = { 60: 'Коулман', 100: 'Болт', 150: 'Болт', 200: 'Болт' };
const STEP = 1 / 120;
const RUN_OFFSET = 0.45;
const FONT_D = '"Exo 2", "Arial Narrow", Impact, sans-serif';
const RIVAL_SHIRTS = [0x4f8cff, 0x3ddc97, 0xb77bff];
const SKINS = [0xe0ac84, 0xc68a62, 0x8d5a3b, 0xf1c9a5];
const LOCK_SVG = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
const KEY = 'sprint.v2';

function defaults() {
  return { life: 0, legs: 0, ropeBest: 0, ropePb: 0, lv: { power: 0, speed: 0, endur: 0 }, coins: 0, unlocked: [60], pb: {}, best: {}, jumpPb: 0, jumpBest: 0, wr: {}, sound: true, runs: 0, helped: false, legend: false, stam: 1, stamT: 0, faints: 0 };
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.lv) {
      const d = defaults();
      return Object.assign(d, s, { lv: Object.assign(d.lv, s.lv) });
    }
  } catch (e) {}
  return defaults();
}
let save = loadSave();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {}
}
const NEED = { 60: 0.2, 100: 0.35, 150: 0.55, 200: 0.75 };
const JUMP_COST = 0.08;
const ROPE_COST = 0.011;
const erNow = () => clamp(effNow().endur / MAXL, 0, 1);
const recSec = () => 75 - 25 * erNow();
function stamNow() {
  const s = typeof save.stam === 'number' ? save.stam : 1;
  const t0 = save.stamT || Date.now();
  return clamp(s + (Date.now() - t0) / 1000 / recSec(), 0, 1);
}
function stamSet(v) {
  save.stam = clamp(v, 0, 1);
  save.stamT = Date.now();
}
function renderStam() {
  const el = $('stam');
  if (!el) return;
  const s = stamNow();
  $('stamTxt').textContent = s >= 0.995 ? 'Силы полные' : 'Силы ' + Math.round(s * 100) + '% · ещё ' + Math.ceil((1 - s) * recSec()) + ' с';
  $('stamBar').style.width = (s * 100).toFixed(0) + '%';
  el.className = 'stam' + (s < 0.35 ? ' low' : s < 0.7 ? ' mid' : '');
}
setInterval(() => { if (mode === 'home') renderStam(); }, 500);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
} catch (e) {
  renderer = null;
}

let actx = null;
function audio() {
  if (!save.sound) return null;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { actx = null; }
  return actx;
}
function beep(f, d, type, g) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), n = a.createGain();
  o.type = type || 'sine';
  o.frequency.value = f;
  n.gain.setValueAtTime(g || 0.15, a.currentTime);
  n.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
  o.connect(n);
  n.connect(a.destination);
  o.start();
  o.stop(a.currentTime + d + 0.02);
}
function gunshot() {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.25);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = a.createBufferSource(), n = a.createGain();
  s.buffer = buf;
  n.gain.value = 0.5;
  s.connect(n);
  n.connect(a.destination);
  s.start();
  beep(120, 0.18, 'sine', 0.4);
}

const FX = { e: 0, pu: 0, fl: 0, beatT: 0, breathT: 0, ring: null, ringGain: null, nbuf: null, prof: null };
function fxRoll() {
  const r = Math.random;
  const k = r();
  FX.prof = {
    sev: k < 0.3 ? 0.5 : k < 0.75 ? 0.85 : 1.25,
    vig: 0.4 + r() * 0.9,
    noise: r() < 0.75 ? r() * 1.3 : 0.1,
    grey: r() < 0.5 ? 0.3 + r() * 0.7 : 0,
    blur: r() < 0.4 ? 0.3 + r() * 0.7 : 0,
    wob: r() < 0.6 ? 0.3 + r() * 0.9 : 0,
    flick: r() < 0.5 ? 0.3 + r() * 0.7 : 0,
    ringHz: 6200 + r() * 2800,
    onset: 0.6 + r() * 0.9
  };
}
function fxNoise(a) {
  if (FX.nbuf) return FX.nbuf;
  const len = a.sampleRate * 2;
  FX.nbuf = a.createBuffer(1, len, a.sampleRate);
  const d = FX.nbuf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return FX.nbuf;
}
function fxThump(a, t, g, f0, f1, d) {
  const chest = a.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = 240;
  chest.Q.value = 0.7;
  chest.connect(a.destination);
  const o = a.createOscillator(), og = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + d);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(g, t + 0.008);
  og.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.5);
  o.connect(og);
  og.connect(chest);
  o.start(t);
  o.stop(t + d * 1.5 + 0.05);
  const s = a.createBufferSource(), sf = a.createBiquadFilter(), sg = a.createGain();
  s.buffer = fxNoise(a);
  sf.type = 'lowpass';
  sf.frequency.value = 180;
  sg.gain.setValueAtTime(g * 1.4, t);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  s.connect(sf);
  sf.connect(sg);
  sg.connect(chest);
  s.start(t, Math.random() * 1.5);
  s.stop(t + 0.08);
}
function fxHeart(e) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  const g = 0.22 + e * 0.6;
  fxThump(a, t, g, 78, 42, 0.14);
  fxThump(a, t + 0.3 - e * 0.1, g * 0.6, 92, 54, 0.1);
}
function fxBreathLoad() {
  const a = audio();
  if (!a || FX.bbuf || FX.bload) return;
  FX.bload = true;
  const bin = atob(BREATH_B64), u = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
  a.decodeAudioData(u.buffer, buf => { FX.bbuf = buf; }, () => {});
}
function fxBreathStop() {
  if (!FX.bsrc) return;
  const s = FX.bsrc, g = FX.bgain;
  try { g.gain.setTargetAtTime(0, actx.currentTime, 0.25); } catch (e) {}
  setTimeout(() => { try { s.stop(); } catch (e) {} }, 1200);
  FX.bsrc = null;
  FX.bgain = null;
}
function fxBreath(e) {
  const a = audio();
  if (!a) return;
  fxBreathLoad();
  if (!FX.bbuf) return;
  if (!FX.bsrc) {
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = FX.bbuf;
    s.loop = true;
    g.gain.value = 0;
    const sh = a.createBiquadFilter();
    sh.type = 'highshelf';
    sh.frequency.value = 1500;
    sh.gain.value = 3;
    s.connect(sh);
    sh.connect(g);
    g.connect(a.destination);
    s.start(0, Math.random() * 2);
    FX.bsrc = s;
    FX.bgain = g;
  }
  FX.bsrc.playbackRate.setTargetAtTime(0.92 + e * 0.22, a.currentTime, 0.4);
  FX.bgain.gain.setTargetAtTime(Math.min(1, 0.08 + e * 0.9), a.currentTime, 0.4);
}
function fxRing(e) {
  const a = audio();
  if (!a) return;
  if (!FX.ring) {
    FX.ring = a.createOscillator();
    FX.ringGain = a.createGain();
    FX.ring.type = 'sine';
    FX.ring.frequency.value = FX.prof ? FX.prof.ringHz : 7400;
    FX.ringGain.gain.value = 0;
    FX.ring.connect(FX.ringGain);
    FX.ringGain.connect(a.destination);
    FX.ring.start();
  }
  FX.ringGain.gain.setTargetAtTime(e > 0.5 ? (e - 0.5) * 0.07 : 0, a.currentTime, 0.3);
}
function fxStopRing() {
  if (!FX.ring) return;
  const o = FX.ring;
  try { FX.ringGain.gain.setTargetAtTime(0, actx.currentTime, 0.35); } catch (e) {}
  setTimeout(() => { try { o.stop(); } catch (e) {} }, 1800);
  FX.ring = null;
  FX.ringGain = null;
}
function fxReset() {
  $('blk').style.opacity = '0';
  FX.e = 0;
  FX.pu = 0;
  FX.fl = 0;
  FX.beatT = 0;
  FX.breathT = 0;
  const fx = $('fx');
  fx.style.opacity = '0';
  $('gl').style.transform = '';
  $('gl').style.filter = '';
  fxStopRing();
  fxBreathStop();
}
function fxUpdate(dt, nowS, target) {
  const P = FX.prof || { sev: 0.85, vig: 1, noise: 1, grey: 0, blur: 0, wob: 0, flick: 0, onset: 1 };
  FX.e += (target - FX.e) * Math.min(1, dt * (target > FX.e ? 0.9 * P.onset : 0.35));
  const e = clamp(FX.e * P.sev, 0, 1.1);
  FX.pu = Math.max(0, FX.pu - dt * 5);
  FX.fl = Math.max(0, FX.fl - dt * 3.5);
  if (P.flick > 0 && e > 0.45 && Math.random() < dt * P.flick * e * 0.5) FX.fl = 1;
  if (e > 0.12 && nowS >= FX.beatT) {
    FX.beatT = nowS + 60 / (68 + e * 110);
    FX.pu = 1;
    fxHeart(e);
  }
  if (e > 0.15) fxBreath(e);
  else if (FX.bsrc) fxBreathStop();
  if (e > 0.5 || FX.ring) fxRing(e);
  const fx = $('fx');
  fx.style.setProperty('--e', clamp(e * P.vig, 0, 1).toFixed(3));
  fx.style.setProperty('--n', clamp(e * P.noise, 0, 1.2).toFixed(3));
  fx.style.setProperty('--pu', FX.pu.toFixed(2));
  fx.style.setProperty('--fl', FX.fl.toFixed(2));
  fx.style.opacity = e > 0.03 ? '1' : '0';
  const gl = $('gl');
  const parts = [];
  if (P.grey > 0 && e > 0.2) parts.push('grayscale(' + clamp(e * P.grey * 0.9, 0, 0.95).toFixed(2) + ')');
  if (P.blur > 0 && e > 0.3) parts.push('blur(' + (e * P.blur * 2.2).toFixed(1) + 'px)');
  gl.style.filter = parts.join(' ');
  if (e > 0.1) {
    const rot = Math.sin(nowS * 1.3) * 0.9 * e * P.wob;
    const sc = 1 + 0.014 * e * FX.pu + (P.wob > 0 ? 0.03 * e : 0);
    gl.style.transform = 'rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(4) + ')';
  } else {
    gl.style.transform = '';
  }
}

let scene, camera, worldTrack, worldJump, actors, maxAniso = 1;
const cam = { pos: null, tgt: null, dPos: null, dTgt: null, k: 6 };

function init3d() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);
  scene.fog = new THREE.Fog(0x0a1020, 30, 85);
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x28331f, 0.65));
  const sun = new THREE.DirectionalLight(0xfff0d6, 0.6);
  sun.position.set(-5, 18, 9);
  scene.add(sun);
  worldTrack = new THREE.Group();
  worldJump = new THREE.Group();
  actors = new THREE.Group();
  worldTrack.add(actors);
  scene.add(worldTrack, worldJump);
  worldJump.visible = false;
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  cam.pos = new THREE.Vector3(0, 3, 10);
  cam.tgt = new THREE.Vector3(0, 0, 0);
  cam.dPos = cam.pos.clone();
  cam.dTgt = cam.tgt.clone();
  resize();
}
function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = maxAniso;
  return t;
}
function flat(w, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function labelMat(text, w, h, fg, stroke, font) {
  const t = canvasTex(w, h, c => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font;
    if (stroke) {
      c.lineWidth = stroke.w;
      c.strokeStyle = stroke.c;
      c.lineJoin = 'round';
      c.strokeText(text, w / 2, h / 2);
    }
    c.fillStyle = fg;
    c.fillText(text, w / 2, h / 2);
  });
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
}
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}
function clearGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    disposeGroup(c);
  }
}
function tartanTexture(lines, repY, h) {
  const t = canvasTex(512, 512, (c, w, hh) => {
    c.fillStyle = '#c24a30';
    c.fillRect(0, 0, w, hh);
    for (let i = 0; i < 5200; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,190,150,0.10)' : 'rgba(70,10,0,0.12)';
      c.fillRect(Math.random() * w, Math.random() * hh, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    c.fillStyle = 'rgba(60,10,0,0.45)';
    c.fillRect(0, 0, w, 3);
    if (lines) {
      c.fillStyle = '#f4f1ea';
      for (let i = 0; i <= LANES; i++) {
        const x = i * w / LANES;
        c.fillRect(Math.min(Math.max(x - 4, 0), w - 8), 0, 8, hh);
      }
    }
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, repY);
  return t;
}

let trackGroup = null, trackDist = 0;
function buildTrack(dist) {
  if (trackGroup && trackDist === dist) return;
  if (trackGroup) {
    worldTrack.remove(trackGroup);
    disposeGroup(trackGroup);
  }
  trackDist = dist;
  const g = new THREE.Group();
  trackGroup = g;
  const nearZ = 12, farZ = -(dist + 28), len = nearZ - farZ, cz = (nearZ + farZ) / 2;
  g.add(flat(TRACK_W, len, new THREE.MeshBasicMaterial({ map: tartanTexture(true, len / 5) }), 0, 0, cz));
  const apronMat = new THREE.MeshBasicMaterial({ color: 0x22314f });
  [-1, 1].forEach(s => g.add(flat(2.2, len, apronMat, s * (TRACK_W / 2 + 1.1), 0.001, cz)));
  g.add(flat(220, len + 80, new THREE.MeshBasicMaterial({ color: 0x14281f }), 0, -0.03, cz));
  const white = new THREE.MeshBasicMaterial({ color: 0xf4f1ea });
  g.add(flat(TRACK_W, 0.1, white, 0, 0.012, 0));
  const check = canvasTex(256, 32, (c, w, h) => {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) {
      c.fillStyle = (i + r) % 2 ? '#f4f1ea' : '#10141f';
      c.fillRect(i * 16, r * 16, 16, 16);
    }
  });
  g.add(flat(TRACK_W, 0.6, new THREE.MeshBasicMaterial({ map: check }), 0, 0.012, -dist));
  const markCache = {};
  for (let m = 10; m <= dist; m += 10) {
    const txt = String(m);
    if (!markCache[txt]) markCache[txt] = labelMat(txt, 128, 64, '#dfe7f5', null, '700 54px ' + FONT_D);
    [-1, 1].forEach(s => g.add(flat(1.2, 0.6, markCache[txt], s * (TRACK_W / 2 + 1.1), 0.01, -m - 0.5)));
  }
  const boardTex = canvasTex(512, 64, (c, w, h) => {
    c.fillStyle = '#1b2a48';
    c.fillRect(0, 0, w, h);
    ['#e2553a', '#f3c34f', '#46d39a', '#5aa9ff'].forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(i * 128 + 10, 20, 108, 26);
    });
  });
  boardTex.wrapS = boardTex.wrapT = THREE.RepeatWrapping;
  boardTex.repeat.set(len / 4, 1);
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex });
  [-1, 1].forEach(s => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, len), boardMat);
    b.position.set(s * (TRACK_W / 2 + 2.3), 0.45, cz);
    g.add(b);
  });
  const crowd = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#10182b';
    c.fillRect(0, 0, w, h);
    const cols = ['#c0553f', '#d9b25a', '#4f8cff', '#8fd0b0', '#d8dce6', '#9a7bd6', '#5b6785'];
    for (let i = 0; i < 520; i++) {
      c.fillStyle = cols[(Math.random() * cols.length) | 0];
      c.beginPath();
      c.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 0, 6.283);
      c.fill();
    }
  });
  crowd.wrapS = crowd.wrapT = THREE.RepeatWrapping;
  crowd.repeat.set(2, len / 6);
  const crowdMat = new THREE.MeshBasicMaterial({ map: crowd });
  [-1, 1].forEach(s => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 11.4, 4.04, cz);
    pivot.rotation.z = s * 0.55;
    pivot.add(flat(12, len, crowdMat, 0, 0, 0));
    g.add(pivot);
  });
  const blockMat = new THREE.MeshBasicMaterial({ color: 0x222a3d });
  const blockGeo = new THREE.BoxGeometry(0.24, 0.12, 0.34);
  for (let i = 0; i < LANES; i++) {
    [0.22, 0.85].forEach(z => {
      const b = new THREE.Mesh(blockGeo, blockMat);
      b.position.set(laneX(i), 0.06, z);
      g.add(b);
    });
  }
  const post = new THREE.CylinderGeometry(0.1, 0.1, 4.6, 8);
  const postMat = new THREE.MeshBasicMaterial({ color: 0xdfe5f2 });
  [-1, 1].forEach(s => {
    const p = new THREE.Mesh(post, postMat);
    p.position.set(s * (TRACK_W / 2 + 0.5), 2.3, -dist);
    g.add(p);
  });
  const face = new THREE.MeshBasicMaterial({
    map: canvasTex(512, 96, (c, w, h) => {
      c.fillStyle = '#e2553a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff';
      c.font = '700 74px ' + FONT_D;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('ФИНИШ', w / 2, h / 2 + 3);
    })
  });
  const side = new THREE.MeshBasicMaterial({ color: 0x10141f });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 1.4, 0.6, 0.15), [side, side, side, side, face, face]);
  banner.position.set(0, 4.7, -dist);
  g.add(banner);
  worldTrack.add(g);
}

function part(mat, sx, sy, sz, x, y, z, geom) {
  const m = new THREE.Mesh(geom || BOX, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}
let BOX = null, SPH = null, CIRC = null;
function makeRunner(o) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let skinM, shirtM, shortsM, shoeM;
  if (o.ghost) {
    skinM = shirtM = shortsM = shoeM = new THREE.MeshBasicMaterial({ color: 0xf3c34f, transparent: true, opacity: 0.45, depthWrite: false });
  } else {
    skinM = new THREE.MeshLambertMaterial({ color: o.skin || 0xe0ac84 });
    shirtM = new THREE.MeshLambertMaterial({ color: o.shirt });
    shortsM = new THREE.MeshLambertMaterial({ color: 0x151b2c });
    shoeM = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  }
  const torso = new THREE.Group();
  torso.position.set(0, 0.9, 0);
  body.add(torso);
  torso.add(part(shirtM, 0.46, 0.62, 0.26, 0, 0.33, 0));
  torso.add(part(skinM, 0.13, 0.13, 0.13, 0, 0.82, 0, SPH));
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.3, 0.56, 0);
  armR.position.set(0.3, 0.56, 0);
  armL.add(part(skinM, 0.1, 0.55, 0.1, 0, -0.27, 0));
  armR.add(part(skinM, 0.1, 0.55, 0.1, 0, -0.27, 0));
  torso.add(armL, armR);
  body.add(part(shortsM, 0.44, 0.22, 0.27, 0, 0.86, 0));
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.11, 0.9, 0);
  legR.position.set(0.11, 0.9, 0);
  [legL, legR].forEach(l => {
    l.add(part(skinM, 0.15, 0.85, 0.15, 0, -0.43, 0));
    l.add(part(shoeM, 0.17, 0.08, 0.28, 0, -0.84, -0.05));
    body.add(l);
  });
  if (!o.ghost) {
    const sh = new THREE.Mesh(CIRC, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.015;
    root.add(sh);
  }
  return { root, body, torso, armL, armR, legL, legR, phase: 0 };
}
function poseRunner(r, phase, v, mode) {
  if (mode === 'crouch') {
    r.body.position.y = -0.2;
    r.torso.rotation.x = -1.05;
    r.armL.rotation.x = 0.9;
    r.armR.rotation.x = 0.9;
    r.legL.rotation.x = 0.55;
    r.legR.rotation.x = -0.5;
  } else if (mode === 'stand') {
    r.body.position.y = 0;
    r.torso.rotation.x = -0.04;
    r.armL.rotation.x = 0;
    r.armR.rotation.x = 0;
    r.legL.rotation.x = 0;
    r.legR.rotation.x = 0;
  } else if (mode === 'swing') {
    r.body.position.y = -0.3;
    r.torso.rotation.x = -0.7;
    r.armL.rotation.x = -1.3;
    r.armR.rotation.x = -1.3;
    r.legL.rotation.x = 0.55;
    r.legR.rotation.x = 0.55;
  } else if (mode === 'air') {
    r.body.position.y = 0;
    r.torso.rotation.x = -0.35;
    r.armL.rotation.x = 2.5;
    r.armR.rotation.x = 2.5;
    r.legL.rotation.x = 1.0;
    r.legR.rotation.x = 1.0;
  } else if (mode === 'land') {
    r.body.position.y = -0.32;
    r.torso.rotation.x = -0.9;
    r.armL.rotation.x = 1.2;
    r.armR.rotation.x = 1.2;
    r.legL.rotation.x = 0.9;
    r.legR.rotation.x = 0.9;
  } else {
    const sp = clamp(v / 9, 0, 1);
    const sw = v > 0.15 ? 0.35 + 0.8 * sp : 0;
    const s = Math.sin(phase);
    r.body.position.y = -0.2 * (1 - clamp(v / 5, 0, 1));
    r.torso.rotation.x = -(0.3 + 0.75 * (1 - sp));
    r.legL.rotation.x = s * sw;
    r.legR.rotation.x = -s * sw;
    r.armL.rotation.x = -s * sw * 1.15;
    r.armR.rotation.x = s * sw * 1.15;
  }
}

function camUpdate(dt) {
  const a = 1 - Math.exp(-dt * cam.k);
  cam.pos.lerp(cam.dPos, a);
  cam.tgt.lerp(cam.dTgt, a);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.tgt);
}

let mode = 'home', selDist = 60, hero = null, homeT = 0;

function setActors(list) {
  clearGroup(actors);
  list.forEach(r => actors.add(r.root));
}
function enterHome() {
  mode = 'home';
  fxReset();
  worldTrack.visible = true;
  worldJump.visible = false;
  buildTrack(selDist);
  hero = makeRunner({ shirt: 0xe2553a, skin: SKINS[0] });
  hero.root.position.set(laneX(P_LANE), 0, RUN_OFFSET);
  poseRunner(hero, 0, 0, 'crouch');
  setActors([hero]);
  cam.k = 3;
  show('home');
  renderHome();
}
function homeCamTarget() {
  const x = laneX(P_LANE);
  cam.dPos.set(x + 3.1 + Math.sin(homeT * 0.35) * 0.4, 1.5, 4.6);
  cam.dTgt.set(x - 0.1, -0.2, -0.3);
}

const screens = ['home', 'train', 'race', 'result', 'jump', 'help', 'rope'];
function show(n) {
  screens.forEach(s => { $('s-' + s).hidden = (s !== n); });
}

const capNow = () => CAPS[save.life];
const effNow = () => effLv(save.lv, save.legs);
const effOf = lv => effLv(lv, save.legs);
const allMaxed = () => save.lv.power >= capNow() && save.lv.speed >= capNow() && save.lv.endur >= capNow();
function canBuyAny() {
  return ['power', 'speed', 'endur'].some(k => save.lv[k] < capNow() && save.coins >= upgradeCost(save.lv[k]));
}
function qualHint(d) {
  const q = QUAL[d];
  return 'Чтобы открыть ' + d + ' м, пробеги ' + q.d + ' м быстрее ' + q.t.toFixed(1) + ' с.';
}
function renderHome() {
  const el = $('dists');
  el.innerHTML = '';
  DISTS.forEach(d => {
    const open = save.unlocked.indexOf(d) >= 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dist' + (d === selDist ? ' sel' : '') + (open ? '' : ' lock');
    const pb = save.pb[d];
    b.innerHTML = '<b>' + d + '<small>м</small></b><span>' + (open ? (pb ? pb.toFixed(2) + ' с' : 'не бегал') : 'закрыто') + '</span>' + (open ? '' : LOCK_SVG);
    b.addEventListener('click', () => {
      if (!open) {
        $('distHint').textContent = qualHint(d);
        return;
      }
      selDist = d;
      buildTrack(d);
      hero.root.position.set(laneX(P_LANE), 0, RUN_OFFSET);
      renderHome();
    });
    el.appendChild(b);
  });
  const nextLocked = DISTS.find(d => save.unlocked.indexOf(d) < 0);
  $('distHint').textContent = save.runs === 0 ? 'Начни с 60 м. Быстрые забеги открывают новые дистанции.' : (nextLocked ? qualHint(nextLocked) : '');
  $('goDist').textContent = selDist + ' м';
  renderStam();
  $('lifeTxt').textContent = (save.legend ? 'Легенда спринта' : RANKS[save.life]) + ' · жизнь ' + (save.life + 1) + ' из 4';
  $('coinTxt').textContent = save.coins + ' М';
  $('xpBadge').textContent = canBuyAny() ? 'можно улучшить' : save.coins + ' М';
  $('jumpBadge').textContent = save.jumpBest ? 'рекорд ' + save.jumpBest.toFixed(2) + ' м' : 'качает ноги';
  $('ropeBadge').textContent = save.ropeBest ? 'рекорд ' + save.ropeBest : 'качает ноги';
  $('sndBtn').textContent = 'Звук: ' + (save.sound ? 'вкл' : 'выкл');
  let h = '<thead><tr><th></th><th>Твой</th><th>Мировой</th></tr></thead><tbody>';
  DISTS.forEach(d => {
    h += '<tr><th>' + d + ' м</th><td>' + (save.best[d] ? save.best[d].toFixed(2) + ' с' : '—') + '</td><td class="wr">' + WR[d].t.toFixed(2) + ' с<small>' + (save.wr[d] ? 'побит' : WHO_SHORT[d]) + '</small></td></tr>';
  });
  h += '<tr><th>Прыжок</th><td>' + (save.jumpBest ? save.jumpBest.toFixed(2) + ' м' : '—') + '</td><td class="wr">' + WR_JUMP.d.toFixed(2) + ' м<small>' + (save.wr.j ? 'побит' : 'Тервааг') + '</small></td></tr></tbody>';
  $('recTable').innerHTML = h;
}

const TRAIN_DEFS = [
  { key: 'power', name: 'Сила ног', lines: s => [
    ['Прыжок с места', s.jump.toFixed(2) + ' м'],
    ['Выход на максимум', (s.tau * 2.3).toFixed(1) + ' с']
  ] },
  { key: 'speed', name: 'Макс. скорость', lines: s => [
    ['Пик скорости', (s.vmax * 3.6).toFixed(1) + ' км/ч']
  ] },
  { key: 'endur', name: 'Выносливость', lines: s => [
    ['Держишь максимум', s.tF.toFixed(1) + ' с'],
    ['Потеря скорости за 20 с', Math.round(fadeDrop(s, 20) * 100) + ' %']
  ] }
];
let resetArmed = 0, rebirthArmed = 0, reborn = false;
function renderTrain() {
  $('trXp').textContent = save.coins;
  const cap = capNow();
  let h = '';
  if (reborn) {
    h += '<div class="banner gold">Новая жизнь. Потолок прокачки вырос до ' + cap + ', монет идёт ×' + LIFE_MULT[save.life] + '.</div>';
  }
  h += '<div class="tcard life"><header><h3>' + (save.legend ? 'Легенда спринта' : RANKS[save.life]) + '</h3><span class="lv">жизнь ' + (save.life + 1) + ' из 4</span></header><div class="tnote">Потолок прокачки сейчас: ур. ' + cap + (save.life < 3 ? ', после перерождения ' + CAPS[save.life + 1] + '.' : '. Это максимум.') + ' Монет за забег ×' + LIFE_MULT[save.life] + '.</div></div>';
  TRAIN_DEFS.forEach(def => {
    const lvl = save.lv[def.key];
    const max = lvl >= cap;
    const now = statsFor(effNow());
    const nextLv = Object.assign({}, save.lv);
    nextLv[def.key] = Math.min(MAXL, lvl + 1);
    const nxt = statsFor(effOf(nextLv));
    const a = def.lines(now), b = def.lines(nxt);
    let segs = '';
    for (let i = 0; i < cap; i++) segs += '<i class="' + (i < lvl ? 'on' : '') + '"></i>';
    let rows = '';
    a.forEach((row, i) => {
      rows += '<div><span>' + row[0] + '</span><b>' + row[1] + (max ? '' : ' <i>→ ' + b[i][1] + '</i>') + '</b></div>';
    });
    const cost = upgradeCost(lvl);
    const can = !max && save.coins >= cost;
    h += '<div class="tcard"><header><h3>' + def.name + '</h3><span class="lv">ур. ' + lvl + ' из ' + cap + '</span></header><div class="segs" style="grid-template-columns:repeat(' + cap + ',1fr)">' + segs + '</div><div class="eff">' + rows + '</div>';
    if (max) h += '<button class="btn plain" disabled type="button">Потолок</button>';
    else h += '<button class="btn primary" data-key="' + def.key + '" type="button"' + (can ? '' : ' disabled') + '>УЛУЧШИТЬ · ' + cost + ' М</button>';
    if (!max && !can) h += '<div class="tnote">Не хватает ' + (cost - save.coins) + ' М. Монеты дают забеги и прыжки.</div>';
    h += '</div>';
  });
  let lg = '';
  for (let i = 0; i < 10; i++) lg += '<i class="' + (i < Math.floor(save.legs * 10 + 0.001) ? 'on' : '') + '"></i>';
  h += '<div class="tcard"><header><h3>Форма ног</h3><span class="lv">' + Math.round(save.legs * 100) + ' %</span></header><div class="legbar">' + lg + '</div><div class="tnote">Прыжок с места и скакалка подтягивают ноги: сейчас +' + (save.legs * LEG_BONUS).toFixed(1) + ' ур. к силе и скорости бега. Чем ближе к 100 %, тем медленнее растёт.</div></div>';
  if (allMaxed() && save.life < 3) {
    const n = save.life + 1;
    h += '<div class="tcard life"><header><h3>Перерождение</h3><span class="lv">' + save.life + ' из 3</span></header><div class="tnote">Всё прокачано до потолка. Перерождение сбросит уровни до ' + START[n] + ', но поднимет потолок до ' + CAPS[n] + ' и монет за забег станет ×' + LIFE_MULT[n] + '. Рекорды, открытые дистанции и монеты остаются.</div><button class="btn primary" id="rebirthBtn" type="button">' + (rebirthArmed ? 'ТОЧНО РОДИТЬСЯ ЗАНОВО?' : 'ПЕРЕРОДИТЬСЯ') + '</button></div>';
  } else if (save.life < 3) {
    h += '<div class="tcard"><header><h3>Перерождение</h3><span class="lv">закрыто</span></header><div class="tnote">Прокачай всё до ур. ' + cap + ', тогда можно переродиться. Мировые рекорды откроются после трёх перерождений.</div></div>';
  } else {
    let list = '';
    DISTS.forEach(d => { list += '<div class="' + (save.wr[d] ? 'ok' : '') + '"><span>' + d + ' м</span><span>' + (save.wr[d] ? 'побит' : WR[d].t.toFixed(2)) + '</span></div>'; });
    list += '<div class="' + (save.wr.j ? 'ok' : '') + '"><span>Прыжок</span><span>' + (save.wr.j ? 'побит' : WR_JUMP.d.toFixed(2)) + '</span></div>';
    h += '<div class="tcard life"><header><h3>Охота за рекордами</h3><span class="lv">' + Object.keys(save.wr).length + ' из 5</span></header><div class="tnote">' + (save.legend ? 'Все рекорды мира побиты. Ты легенда.' : allMaxed() ? 'Ты на максимуме. Теперь рекорд реально побить, но нужен почти идеальный темп и реакция.' : 'Прокачай всё до ур. 20, иначе рекорд не достать.') + '</div><div class="wrlist">' + list + '</div></div>';
  }
  h += '<div class="tcard"><header><h3>Потенциал</h3><span class="lv">идеальный бег</span></header><table class="pot"><thead><tr><th></th><th>Сейчас</th><th>Рекорд</th></tr></thead><tbody>';
  DISTS.forEach(d => {
    const tt = idealTime(effNow(), d);
    h += '<tr><th>' + d + ' м</th><td class="' + (tt < WR[d].t ? 'ok' : '') + '">' + tt.toFixed(2) + ' с</td><td class="dim">' + WR[d].t.toFixed(2) + ' с</td></tr>';
  });
  h += '</tbody></table><div class="tnote">Время при безупречном темпе и реакции 0.20 с. В реальном забеге оно хуже.</div></div>';
  h += '<button class="reset" id="resetBtn" type="button">' + (resetArmed ? 'Точно сбросить весь прогресс?' : 'Сбросить прогресс') + '</button>';
  $('trBody').innerHTML = h;
}
$('trBody').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'resetBtn') {
    if (!resetArmed) {
      resetArmed = Date.now();
      renderTrain();
      setTimeout(() => { if (resetArmed) { resetArmed = 0; if (!$('s-train').hidden) renderTrain(); } }, 3500);
    } else {
      save = defaults();
      persist();
      resetArmed = 0;
      reborn = false;
      selDist = 60;
      buildTrack(60);
      renderTrain();
    }
    return;
  }
  if (t.id === 'rebirthBtn') {
    if (!rebirthArmed) {
      rebirthArmed = Date.now();
      renderTrain();
      setTimeout(() => { if (rebirthArmed) { rebirthArmed = 0; if (!$('s-train').hidden) renderTrain(); } }, 3500);
    } else if (allMaxed() && save.life < 3) {
      rebirthArmed = 0;
      save.life++;
      const s = START[save.life];
      save.lv = { power: s, speed: s, endur: s };
      save.pb = {};
      save.jumpPb = 0;
      reborn = true;
      persist();
      beep(660, 0.25, 'triangle', 0.15);
      renderTrain();
      $('trBody').scrollTop = 0;
    }
    return;
  }
  const key = t.getAttribute('data-key');
  if (!key) return;
  const lvl = save.lv[key], cost = upgradeCost(lvl);
  if (lvl >= capNow() || save.coins < cost) return;
  save.coins -= cost;
  save.lv[key] = lvl + 1;
  reborn = false;
  persist();
  beep(520, 0.12, 'triangle', 0.12);
  renderTrain();
});

const race = { state: 'idle', dist: 60, token: 0, acc: 0, rtEff: 0, tGun: 0, timer: 0, gunAt: 0, finishT: 0, me: null, ghost: null, rivals: [], ghostSim: null };
let sprinter = null, hintUntil = 0;

function setCall(text, cls) {
  const el = $('call');
  el.textContent = text;
  el.className = 'call ' + (cls || '');
  void el.offsetWidth;
  el.classList.add('pop');
}
function rivalLevels(avg, mult) {
  const base = avg * mult + 2;
  const pick = () => clamp(Math.round(base + (Math.random() * 2 - 1)), 0, MAXL);
  return { power: pick(), speed: pick(), endur: pick() };
}
function startRace(dist) {
  if (!renderer) return;
  fxReset();
  fxRoll();
  race.token++;
  race.dist = dist;
  mode = 'race';
  worldTrack.visible = true;
  worldJump.visible = false;
  buildTrack(dist);
  const me = makeRunner({ shirt: 0xe2553a, skin: SKINS[0] });
  const ghost = makeRunner({ ghost: true });
  const ev = effNow();
  const avg = (ev.power + ev.speed + ev.endur) / 3;
  const mults = [0.85, 1.0, 1.2];
  const skins = SKINS.slice(1).sort(() => Math.random() - 0.5);
  const rivals = R_LANES.map((lane, i) => {
    const runner = makeRunner({ shirt: RIVAL_SHIRTS[i], skin: skins[i % skins.length] });
    const st = statsFor(rivalLevels(avg, mults[i]));
    const rt = 0.17 + Math.random() * 0.14;
    const sim = simulate(st, dist, rt, 0.9 + Math.random() * 0.08);
    runner.root.position.set(laneX(lane), 0, RUN_OFFSET);
    return { runner, sim, rt, lane };
  });
  me.root.position.set(laneX(P_LANE), 0, RUN_OFFSET);
  ghost.root.position.set(laneX(G_LANE), 0, RUN_OFFSET);
  setActors([me, ghost].concat(rivals.map(r => r.runner)));
  race.me = me;
  race.ghost = ghost;
  race.rivals = rivals;
  race.ghostSim = ghostSim(dist);
  const pst = Object.assign({}, statsFor(effNow()));
  race.s0 = stamNow();
  race.need = NEED[dist] * (1 - 0.45 * erNow());
  race.faint = false;
  race.slowT = 0;
  if (race.s0 < race.need) pst.vmax *= 0.8 + 0.2 * (race.s0 / race.need);
  stamSet(race.s0 - race.need);
  sprinter = new Sprinter(pst);
  race.early = false;
  race.cleanT = 0;
  race.totT = 0;
  race.beat = 0;
  race.beatN = 0;
  $('ap').style.transform = '';
  $('ap').style.opacity = '';
  race.state = 'count0';
  race.timer = 1.6;
  race.acc = 0;
  race.rtEff = 0;
  hintUntil = 0;
  poseRunner(me, 0, 0, 'crouch');
  poseRunner(ghost, 0, 0, 'crouch');
  rivals.forEach(r => poseRunner(r.runner, 0, 0, 'crouch'));
  cam.k = 3;
  $('clock').textContent = '0.00';
  $('speed').textContent = '0.0';
  $('left').textContent = dist + ' м до финиша';
  $('gdelta').textContent = '';
  $('gdelta').className = '';
  $('tip').textContent = race.s0 < race.need ? 'Ты не восстановился. Можешь упасть в обморок посреди дистанции.' : 'Жди выстрел. Потом жми кнопку в такт зелёному кольцу, метка должна быть в зелёной зоне.';
  $('tempoHint').textContent = 'темп';
  $('mk').className = 'mk';
  $('mk').style.left = '50%';
  ['pgR0', 'pgR1', 'pgR2', 'pgG', 'pgMe'].forEach(id => { $(id).style.left = '0%'; });
  setCall('НА СТАРТ', '');
  show('race');
}
function pulse() {
  const el = $('pad');
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 90);
}
function raceTap(nowS) {
  if (mode !== 'race') return;
  const st = race.state;
  pulse();
  if (st === 'count1') {
    if (!race.early) {
      race.early = true;
      setCall('РАНО! +0.2 с', 'bad');
      beep(200, 0.2, 'sawtooth', 0.1);
    }
    return;
  }
  if (st !== 'run') return;
  if (!sprinter.started) {
    const rt = nowS - race.tGun;
    if (rt < 0.1) race.early = true;
    race.rtEff = Math.max(0.11, rt - 0.08) + (race.early ? 0.2 : 0);
  }
  sprinter.tap(nowS);
}
function vOf(sim, t) {
  return (posAt(sim, t) - posAt(sim, t - 0.06)) / 0.06;
}
function moveAuto(r, sim, rt, t, dt) {
  const x = posAt(sim, t), v = t > 0 ? vOf(sim, t) : 0;
  r.root.position.z = -x + RUN_OFFSET;
  const started = t >= rt;
  if (started) r.phase += dt * Math.PI * (3.3 + 0.1 * v);
  poseRunner(r, r.phase, v, started ? 'run' : 'crouch');
  return x;
}
function raceTick(dt, nowS) {
  if (race.state === 'count0') {
    race.timer -= dt;
    if (race.timer <= 0) {
      race.state = 'count1';
      race.gunAt = nowS + 1.1 + Math.random() * 1.5;
      setCall('ВНИМАНИЕ', 'warn');
      beep(660, 0.18, 'square', 0.12);
    }
  } else if (race.state === 'count1' && nowS >= race.gunAt) {
    race.state = 'run';
    race.tGun = nowS;
    setCall('МАРШ!', 'go');
    $('tip').textContent = '';
    gunshot();
    const tok = race.token;
    setTimeout(() => { if (tok === race.token && race.state === 'run') $('call').textContent = ''; }, 700);
  }
  const live = race.state === 'run' || race.state === 'finished' || race.state === 'faint';
  const tReal = live ? nowS - race.tGun : -1;
  let fxTarget = 0;
  if (race.state === 'run' && sprinter.started) {
    const raw = clamp((fadeDrop(sprinter.p, sprinter.tm) - 0.06) / 0.26, 0, 1);
    fxTarget = raw * (1 - 0.6 * clamp(effNow().endur / MAXL, 0, 1));
    const f = sprinter.x / race.dist;
    if (race.s0 < race.need) {
      const lim = race.s0 / race.need;
      fxTarget = Math.max(fxTarget, clamp((1 - lim) * 0.5 + (f / Math.max(lim, 0.02)) * 0.6, 0, 1));
      if (f >= lim) doFaint('stam');
    }
    if (race.state === 'run' && sprinter.tm > 4) {
      race.slowT = sprinter.v < 2.0 ? race.slowT + dt : 0;
      fxTarget = Math.max(fxTarget, clamp(race.slowT / 3.5, 0, 1) * 0.9);
      if (race.slowT >= 3.5) doFaint('slow');
    }
  }
  if (race.state === 'faint') fxTarget = 1;
  fxUpdate(dt, nowS, fxTarget);
  if (live) {
    race.acc = Math.min(race.acc + dt, 0.1);
    while (race.acc >= STEP) {
      sprinter.step(STEP, nowS);
      race.acc -= STEP;
      if (race.state === 'run' && sprinter.x >= race.dist) onFinish();
    }
  }
  const me = race.me;
  me.root.position.z = -sprinter.x + RUN_OFFSET;
  const running = sprinter.started;
  if (running) me.phase += dt * Math.PI * (3.3 + 0.1 * sprinter.v);
  const pm = !running ? 'crouch' : ((race.state === 'finished' || race.state === 'faint') && sprinter.v < 0.6 ? 'stand' : 'run');
  if (race.state === 'faint') {
    const k = Math.min(1, (nowS - race.faintAt) / 0.7);
    me.root.rotation.x = -1.45 * k * k;
    me.root.position.y = 0.06 * k;
  }
  poseRunner(me, me.phase, sprinter.v, pm);
  const gx = moveAuto(race.ghost, race.ghostSim, 0.146, tReal, dt);
  const rx = race.rivals.map(r => moveAuto(r.runner, r.sim, r.rt, tReal, dt));
  const px = sprinter.x;
  cam.k = Math.min(8, cam.k + dt * 2);
  cam.dPos.set(0.3, 13.5 + Math.min(sprinter.v, 12) * 0.1, -px + RUN_OFFSET + 9.2);
  cam.dTgt.set(0.3, 0.3, -px + RUN_OFFSET - 6.5);
  if (race.state === 'dq') return;
  let clockV;
  if (race.state === 'finished') clockV = race.finishT;
  else if (sprinter.started) clockV = race.rtEff + sprinter.tm;
  else clockV = Math.max(0, tReal - 0.08);
  $('clock').textContent = clockV.toFixed(2);
  $('speed').textContent = (sprinter.v * 3.6).toFixed(1);
  const left = Math.max(0, race.dist - px);
  $('left').textContent = race.state === 'finished' ? 'Финиш' : Math.ceil(left) + ' м до финиша';
  const pct = x => clamp(x / race.dist * 100, 0, 100) + '%';
  $('pgMe').style.left = pct(px);
  $('pgG').style.left = pct(gx);
  rx.forEach((x, i) => { $('pgR' + i).style.left = pct(x); });
  if (live) {
    const dx = gx - px;
    const gd = $('gdelta');
    if (dx > 0.05) {
      gd.textContent = 'Рекорд впереди на ' + dx.toFixed(1) + ' м';
      gd.className = 'behind';
    } else {
      gd.textContent = 'Ты быстрее рекорда на ' + Math.max(0, -dx).toFixed(1) + ' м';
      gd.className = 'ahead';
    }
  }
  if (race.state === 'run') {
    const ratio = sprinter.ratio(nowS);
    const dev = Math.abs(ratio - 1);
    const mk = $('mk');
    mk.style.left = clamp(50 + (ratio - 1) * 125, 1.5, 98.5) + '%';
    mk.className = 'mk' + (dev <= 0.07 ? '' : dev <= 0.16 ? ' warn' : ' bad');
    if (nowS > hintUntil) {
      $('tempoHint').textContent = !sprinter.started ? 'жми!' : (sprinter.steps < 3 ? 'темп' : (ratio > 1.07 ? 'медленнее' : ratio < 0.93 ? 'быстрее' : 'идеально'));
    }
    if (sprinter.steps >= 3) {
      race.totT += dt;
      if (dev <= 0.07) race.cleanT += dt;
    }
    race.beat += dt * sprinter.fStar();
    const ph = race.beat % 1;
    const ap = $('ap');
    ap.style.transform = 'scale(' + (1 + 1.3 * (1 - ph)).toFixed(3) + ')';
    ap.style.opacity = (0.2 + 0.7 * ph).toFixed(2);
    if (Math.floor(race.beat) !== race.beatN) {
      race.beatN = Math.floor(race.beat);
      if (save.sound) beep(520, 0.025, 'square', 0.02);
    }
  }
}
function doFaint(why) {
  if (race.state !== 'run') return;
  race.state = 'faint';
  race.faintAt = performance.now() / 1000;
  race.faintWhy = why;
  race.faintX = sprinter.x;
  sprinter.live = false;
  setCall('ОБМОРОК', 'bad');
  stamSet(0.05);
  save.faints = (save.faints || 0) + 1;
  persist();
  $('blk').style.opacity = '0.96';
  const tok = race.token;
  setTimeout(() => { if (tok === race.token && mode === 'race') showFaint(); }, 2300);
}
function showFaint() {
  show('result');
  $('blk').style.opacity = '0';
  $('resKicker').textContent = 'Забег ' + race.dist + ' м';
  $('resTitle').textContent = 'Обморок';
  $('resTimeWrap').hidden = true;
  $('resBanners').innerHTML = '<div class="banner bad">' + (race.faintWhy === 'slow' ? 'Слишком медленно: организм не потянул, и ты упал.' : 'Ты не успел восстановиться после прошлой нагрузки и не добежал.') + '</div>';
  $('resRows').innerHTML = rowsHtml([
    ['Пробежал', Math.round(race.faintX) + ' из ' + race.dist + ' м'],
    ['Силы', 'вернутся примерно через ' + Math.ceil((1 - stamNow()) * recSec()) + ' с'],
    ['Монеты', '+0 М', 'gold']
  ]);
}
function onFinish() {
  const over = sprinter.x - race.dist;
  const tmC = sprinter.tm - over / Math.max(sprinter.v, 0.5);
  race.finishT = race.rtEff + tmC;
  race.state = 'finished';
  stamSet(Math.max(0, stamNow() - race.need * 0.35 * clamp(fadeDrop(sprinter.p, sprinter.tm) / 0.3, 0, 1)));
  sprinter.live = false;
  const res = settle();
  setCall('ФИНИШ', 'go');
  beep(880, 0.25, 'triangle', 0.15);
  const tok = race.token;
  setTimeout(() => { if (tok === race.token && mode === 'race') showResult(res); }, 1500);
}
function checkLegend() {
  if (DISTS.every(d => save.wr[d]) && save.wr.j && !save.legend) {
    save.legend = true;
    return true;
  }
  return false;
}
function settle() {
  const d = race.dist, T = race.finishT;
  const place = placeFor(T, race.rivals.map(r => r.sim.time));
  const prev = save.pb[d];
  const pb = !prev || T < prev;
  if (pb) save.pb[d] = T;
  if (!save.best[d] || T < save.best[d]) save.best[d] = T;
  const clean = race.cleanT / Math.max(0.1, race.totT);
  const pay = racePay(d, place, pb, clean, save.life);
  save.coins += pay.total;
  save.runs++;
  const unlocked = [];
  DISTS.forEach(n => {
    const q = QUAL[n];
    if (q && q.d === d && T <= q.t && save.unlocked.indexOf(n) < 0) {
      save.unlocked.push(n);
      unlocked.push(n);
    }
  });
  const beat = T < WR[d].t;
  const wr = beat && save.life === 3;
  if (wr) save.wr[d] = true;
  const legend = wr ? checkLegend() : false;
  persist();
  return { T, place, pb, prev, pay, clean, unlocked, wr, legend, notYet: beat && !wr, rt: race.rtEff, early: race.early };
}
function rowsHtml(list) {
  return list.map(r => '<div><dt>' + r[0] + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + r[1] + '</dd></div>').join('');
}
function showResult(res) {
  show('result');
  const d = race.dist;
  $('resKicker').textContent = 'Забег ' + d + ' м';
  $('resTimeWrap').hidden = false;
  $('resTitle').textContent = res.place + ' место из 4';
  $('resTime').textContent = res.T.toFixed(2);
  let banners = '';
  if (res.legend) banners += '<div class="banner gold">Все рекорды мира побиты. Ты легенда спринта.</div>';
  else if (res.wr) banners += '<div class="banner gold">Мировой рекорд побит: ' + res.T.toFixed(2) + ' против ' + WR[d].t.toFixed(2) + ' с</div>';
  else if (res.notYet) banners += '<div class="banner">Быстрее рекорда мира, но он засчитывается только в четвёртой жизни.</div>';
  res.unlocked.forEach(n => { banners += '<div class="banner">Открыта дистанция ' + n + ' м</div>'; });
  if (res.pb && res.prev) banners += '<div class="banner">Личный рекорд жизни: быстрее на ' + (res.prev - res.T).toFixed(2) + ' с</div>';
  if (res.early) banners += '<div class="banner bad">Ранний старт: +0.20 с</div>';
  $('resBanners').innerHTML = banners;
  const gap = res.T - WR[d].t;
  const p = res.pay;
  const rows = [
    ['Реакция на выстрел', res.rt.toFixed(2) + ' с'],
    ['Чистый темп', Math.round(res.clean * 100) + ' %'],
    ['За ' + res.place + ' место', '+' + p.placed.toFixed(0)]
  ];
  if (p.pbB) rows.push(['Личный рекорд', '+' + p.pbB.toFixed(0)]);
  if (p.cleanB) rows.push(['Чистый темп 70%+', '+' + p.cleanB.toFixed(0)]);
  rows.push(['Бонус жизни', '×' + p.k]);
  rows.push(['Монеты', '+' + p.total + ' М', 'gold']);
  rows.push(['Мировой рекорд', WR[d].t.toFixed(2) + ' с (' + (gap > 0 ? '+' : '') + gap.toFixed(2) + ')']);
  $('resRows').innerHTML = rowsHtml(rows);
}

const J = { phase: 'idle', t: 0, q: 0, dair: 0, air: 0, tapped: false, tapDiff: 0, lt: 0, pen: 0, dist: 0, runner: null, ring: null, target: null, marks: null, pbMarks: null };
function meterP(t) {
  return 1 - Math.abs(((t / 1.2) % 2) - 1);
}
function buildJump() {
  const g = worldJump;
  g.add(flat(60, 80, new THREE.MeshBasicMaterial({ color: 0x14281f }), 0, -0.03, -14));
  g.add(flat(2.6, 10, new THREE.MeshBasicMaterial({ map: tartanTexture(false, 2) }), 0, 0, 5.2));
  g.add(flat(2.6, 0.2, new THREE.MeshBasicMaterial({ color: 0xf4f1ea }), 0, 0.012, 0));
  const sand = canvasTex(256, 768, (c, w, h) => {
    c.fillStyle = '#d8bf8a';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,200,0.25)' : 'rgba(120,90,40,0.18)';
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    for (let d = 1; d <= 6.5; d += 0.25) {
      const y = (6.6 - d) * 128;
      const whole = Math.abs(d - Math.round(d)) < 0.01;
      const half = Math.abs(d * 2 - Math.round(d * 2)) < 0.01;
      c.fillStyle = whole ? 'rgba(90,64,24,0.6)' : half ? 'rgba(90,64,24,0.38)' : 'rgba(90,64,24,0.2)';
      c.fillRect(0, y - (whole ? 2 : 1), w, whole ? 4 : 2);
      if (whole) {
        c.fillStyle = '#6b4c1c';
        c.font = '700 34px ' + FONT_D;
        c.textAlign = 'left';
        c.textBaseline = 'bottom';
        c.fillText(Math.round(d) + ' м', 10, y - 6);
      }
    }
  });
  g.add(flat(3.0, 6.0, new THREE.MeshBasicMaterial({ map: sand }), 0, 0.005, -3.6));
  const curb = new THREE.MeshBasicMaterial({ color: 0xcfd6e6 });
  [-1, 1].forEach(s => g.add(flat(0.1, 6.0, curb, s * 1.55, 0.006, -3.6)));
  const wrLine = new THREE.MeshBasicMaterial({ color: 0xff5b5b });
  g.add(flat(3.0, 0.06, wrLine, 0, 0.014, -WR_JUMP.d));
  g.add(flat(3.0, 0.43, labelMat('МИРОВОЙ РЕКОРД 3.71 м', 768, 110, '#ff5b5b', { w: 8, c: 'rgba(60,30,10,0.85)' }, '700 54px ' + FONT_D), 0, 0.016, -WR_JUMP.d + 0.3));
  J.runner = makeRunner({ shirt: 0xe2553a, skin: SKINS[0] });
  g.add(J.runner.root);
  const ringGeo = new THREE.RingGeometry(0.46, 0.5, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf3c34f, transparent: true, opacity: 0.95, depthWrite: false });
  J.ring = new THREE.Mesh(ringGeo, ringMat);
  J.ring.rotation.x = -Math.PI / 2;
  J.ring.visible = false;
  J.target = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  J.target.rotation.x = -Math.PI / 2;
  J.target.visible = false;
  g.add(J.ring, J.target);
  J.marks = new THREE.Group();
  J.pbMarks = new THREE.Group();
  g.add(J.marks, J.pbMarks);
}
function updatePbMarker() {
  clearGroup(J.pbMarks);
  if (!save.jumpBest) return;
  J.pbMarks.add(flat(3.0, 0.05, new THREE.MeshBasicMaterial({ color: 0xf3c34f }), 0, 0.013, -save.jumpBest));
  J.pbMarks.add(flat(3.0, 0.43, labelMat('ТВОЙ РЕКОРД ' + save.jumpBest.toFixed(2) + ' м', 768, 110, '#f3c34f', { w: 8, c: 'rgba(60,30,10,0.85)' }, '700 54px ' + FONT_D), 0, 0.016, -save.jumpBest + 0.26));
}
function jumpInfo() {
  $('jmInfo').innerHTML = '<span>Твой рекорд <b>' + (save.jumpBest ? save.jumpBest.toFixed(2) + ' м' : '—') + '</b></span><span>Мировой <b>' + WR_JUMP.d.toFixed(2) + ' м</b></span>';
}
function enterJump() {
  if (!renderer) return;
  fxReset();
  mode = 'jump';
  worldTrack.visible = false;
  worldJump.visible = true;
  cam.k = 3;
  cam.dPos.set(0, 7.6, 3.0);
  cam.dTgt.set(0, 0, -3.0);
  show('jump');
  jumpInfo();
  updatePbMarker();
  jumpReset();
}
function jumpReset() {
  J.phase = 'idle';
  J.t = 0;
  clearGroup(J.marks);
  J.ring.visible = false;
  J.target.visible = false;
  J.runner.root.position.set(0, 0, 0);
  poseRunner(J.runner, 0, 0, 'stand');
  $('meter').hidden = true;
  $('jmResult').hidden = true;
  $('blk').style.opacity = '0';
  $('jmBtnText').textContent = 'ПРИСЕСТЬ';
  $('jmHelp').textContent = 'Присядь, потом жми «Прыжок», когда метка в зелёной зоне. В ней сила максимальная, правее она падает.';
}
function jumpFaint() {
  J.phase = 'done';
  stamSet(0.05);
  save.faints = (save.faints || 0) + 1;
  persist();
  $('meter').hidden = true;
  $('blk').style.opacity = '0.9';
  $('jmDist').textContent = '0.00';
  $('jmBanners').innerHTML = '<div class="banner bad">Не хватило сил: ты упал в обморок.</div>';
  $('jmRows').innerHTML = rowsHtml([
    ['Силы', 'вернутся через ' + Math.ceil((1 - stamNow()) * recSec()) + ' с'],
    ['Монеты', '+0 М', 'gold']
  ]);
  $('jmResult').hidden = false;
  $('jmHelp').textContent = '';
  $('jmBtnText').textContent = 'ЕЩЁ РАЗ';
}
function jumpPress() {
  if (J.phase === 'idle') {
    const s0 = stamNow();
    if (s0 < 0.08) {
      jumpFaint();
      return;
    }
    J.sf = 0.7 + 0.3 * clamp(s0 / 0.5, 0, 1);
    stamSet(s0 - JUMP_COST * (1 - 0.4 * erNow()));
    J.phase = 'swing';
    J.t = 0;
    $('meter').hidden = false;
    $('jmBtnText').textContent = 'ПРЫЖОК!';
    $('jmHelp').textContent = 'Метка в зелёной зоне — жми.';
    beep(440, 0.08, 'triangle', 0.1);
  } else if (J.phase === 'swing') {
    const p = meterP(J.t);
    J.q = swingQuality(p);
    J.dair = jumpDistance(statsFor(effNow()).jump, J.q, 0) * (J.sf || 1);
    J.air = 0.5 + 0.12 * J.dair;
    J.t = 0;
    J.phase = 'air';
    J.tapped = false;
    J.ring.position.set(0, 0.02, -J.dair);
    J.target.position.set(0, 0.02, -J.dair);
    J.ring.visible = true;
    J.target.visible = true;
    $('meter').hidden = true;
    $('jmBtnText').textContent = 'ПРИЗЕМЛЕНИЕ';
    $('jmHelp').textContent = 'Жми, когда кольцо сожмётся в белый круг.';
    beep(300, 0.1, 'sine', 0.12);
  } else if (J.phase === 'air') {
    if (!J.tapped) {
      J.tapped = true;
      J.tapDiff = Math.abs(J.t - J.air);
    }
  } else if (J.phase === 'done') {
    jumpReset();
  }
}
function finishJump() {
  J.pen = landingPenalty(J.tapped, J.tapDiff);
  J.dist = jumpDistance(statsFor(effNow()).jump, J.q, J.pen) * (J.sf || 1);
  J.phase = 'land';
  J.lt = 0;
  $('jmBtnText').textContent = '...';
}
function jumpDone() {
  J.phase = 'done';
  const d = J.dist;
  const legsBefore = save.legs;
  save.legs = legsGain(save.legs, 0.03 * clamp(d / statsFor(effNow()).jump, 0.3, 1));
  const pb = d > save.jumpBest;
  const prev = save.jumpBest;
  if (pb) save.jumpBest = d;
  const lifePb = d > save.jumpPb;
  if (lifePb) save.jumpPb = d;
  const pay = jumpPay(d, lifePb, save.life);
  save.coins += pay.total;
  let legend = false;
  const wrj = d >= WR_JUMP.d && save.life === 3;
  if (wrj) {
    save.wr.j = true;
    legend = checkLegend();
  }
  persist();
  J.marks.add(flat(3.0, 0.07, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.02, -d));
  J.marks.add(flat(0.05, d, new THREE.MeshBasicMaterial({ color: 0xffffff }), -1.2, 0.02, -d / 2));
  J.marks.add(flat(1.8, 0.5, labelMat(d.toFixed(2) + ' м', 256, 100, '#ffffff', { w: 9, c: 'rgba(30,20,10,0.9)' }, '700 72px ' + FONT_D), 0, 0.022, -d - 0.32));
  $('jmDist').textContent = d.toFixed(2);
  const cm = Math.round(J.pen * 100);
  const land = J.pen < 0.06 ? 'Чистое приземление' : J.pen < 0.18 ? 'Не удержал равновесие: −' + cm + ' см' : 'Упал назад: −' + cm + ' см';
  let banners = '';
  if (legend) banners += '<div class="banner gold">Все рекорды мира побиты. Ты легенда спринта.</div>';
  else if (d >= WR_JUMP.d) banners += '<div class="banner gold">Мировой рекорд побит</div>';
  else if (pb && prev) banners += '<div class="banner">Личный рекорд: +' + ((d - prev) * 100).toFixed(0) + ' см</div>';
  $('jmBanners').innerHTML = banners;
  $('jmRows').innerHTML = rowsHtml([
    ['Сила замаха', Math.round(J.q * 100) + ' %'],
    ['Приземление', land],
    ['Силы', Math.round(stamNow() * 100) + ' %'],
    ['До мирового рекорда', (WR_JUMP.d - d).toFixed(2) + ' м', 'gold'],
    ['Форма ног', '+' + ((save.legs - legsBefore) * 100).toFixed(1) + ' % (всего ' + Math.round(save.legs * 100) + ' %)'],
    ['Монеты', '+' + pay.total + ' М', 'gold']
  ]);
  $('jmResult').hidden = false;
  $('jmHelp').textContent = '';
  $('jmBtnText').textContent = 'ЕЩЁ РАЗ';
  jumpInfo();
  updatePbMarker();
}
function jumpTick(dt) {
  const r = J.runner;
  if (J.phase === 'idle') {
    poseRunner(r, 0, 0, 'stand');
    r.body.position.y = Math.sin(performance.now() / 600) * 0.012;
  } else if (J.phase === 'swing') {
    J.t += dt;
    $('mmk').style.left = (meterP(J.t) * 100) + '%';
    poseRunner(r, 0, 0, 'swing');
  } else if (J.phase === 'air') {
    J.t += dt;
    const s = clamp(J.t / J.air, 0, 1);
    const H = 0.35 + 0.12 * J.dair;
    r.root.position.set(0, 0, -J.dair * s);
    poseRunner(r, 0, 0, s < 0.82 ? 'air' : 'land');
    r.body.position.y = H * 4 * s * (1 - s) + (s < 0.82 ? 0 : -0.1);
    const sc = 2.2 - 1.2 * s;
    J.ring.scale.set(sc, sc, sc);
    if (J.t >= J.air && (J.tapped || J.t >= J.air + 0.35)) finishJump();
  } else if (J.phase === 'land') {
    J.lt += dt;
    const e = clamp(J.lt / 0.25, 0, 1);
    r.root.position.set(0, 0, -J.dair + J.pen * e);
    poseRunner(r, 0, 0, 'land');
    if (J.pen > 0.18) r.torso.rotation.x = 0.35 * e;
    if (J.lt > 0.7) jumpDone();
  }
}

function tick(ms) {
  requestAnimationFrame(tick);
  if (!renderer) return;
  const dt = Math.min(0.1, (ms - tick.last) / 1000);
  tick.last = ms;
  const nowS = performance.now() / 1000;
  if (mode === 'race') raceTick(dt, nowS);
  else if (mode === 'jump') jumpTick(dt);
  else if (mode === 'rope') {
    ropeTick(dt);
    homeT += dt;
    homeCamTarget();
    if (hero) hero.body.position.y = -0.2 + Math.sin(homeT * 2.2) * 0.012;
  } else {
    homeT += dt;
    homeCamTarget();
    if (hero) hero.body.position.y = -0.2 + Math.sin(homeT * 2.2) * 0.012;
  }
  camUpdate(dt);
  renderer.render(scene, camera);
}
tick.last = performance.now();

const padEl = $('pad');
padEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  raceTap(performance.now() / 1000);
});
padEl.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (mode === 'race') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyF' || e.code === 'KeyJ') {
      e.preventDefault();
      raceTap(performance.now() / 1000);
    }
  } else if (mode === 'jump' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    jumpPress();
  } else if (mode === 'rope' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    ropePress();
  }
});
let helpStart = false;
function openHelp(start) {
  helpStart = start;
  $('hpGoText').textContent = start ? 'ПОНЯТНО, БЕЖИМ' : 'ПОНЯТНО';
  show('help');
}
$('helpBtn').addEventListener('click', () => openHelp(false));
$('hpBack').addEventListener('click', () => { renderHome(); show('home'); });
$('hpGo').addEventListener('click', () => {
  save.helped = true;
  persist();
  if (helpStart) { audio(); startRace(selDist); } else { renderHome(); show('home'); }
});
$('goBtn').addEventListener('click', () => {
  audio();
  if (!save.helped) { openHelp(true); return; }
  startRace(selDist);
});
$('toTrain').addEventListener('click', () => {
  resetArmed = 0;
  rebirthArmed = 0;
  renderTrain();
  show('train');
});
$('trBack').addEventListener('click', () => {
  resetArmed = 0;
  rebirthArmed = 0;
  reborn = false;
  renderHome();
  show('home');
});
$('toJump').addEventListener('click', () => {
  audio();
  enterJump();
});
$('jmBack').addEventListener('click', () => {
  enterHome();
});
$('jmBtn').addEventListener('click', jumpPress);
$('resAgain').addEventListener('click', () => {
  audio();
  startRace(race.dist);
});
$('resMenu').addEventListener('click', () => {
  race.token++;
  selDist = race.dist;
  enterHome();
});
$('sndBtn').addEventListener('click', () => {
  save.sound = !save.sound;
  persist();
  if (save.sound) audio();
  $('sndBtn').textContent = 'Звук: ' + (save.sound ? 'вкл' : 'выкл');
});

const RP = { phase: 'idle', t: 0, p: 0, reps: 0, perfect: 0, streak: 0, bestStreak: 0, lives: 3, tapT: -9, msg: '', msgT: -9, msgGood: true, cv: null, ctx: null, w: 320, h: 230, dpr: 1, res: null, cool: 0 };
const ROPE_LEN = 45;
function ropeOmega(t) {
  return 0.85 + 0.85 * Math.min(1, t / 35);
}
function ropeInfo() {
  $('rpInfo').innerHTML = '<span>Рекорд <b>' + (save.ropeBest ? save.ropeBest + ' прыжков' : '—') + '</b></span><span>Форма ног <b>' + Math.round(save.legs * 100) + ' %</b></span>';
}
function ropeSize() {
  const cv = $('rpCv');
  RP.cv = cv;
  RP.dpr = Math.min(2, window.devicePixelRatio || 1);
  RP.w = Math.max(200, cv.clientWidth || 320);
  RP.h = Math.max(150, cv.clientHeight || 230);
  cv.width = Math.round(RP.w * RP.dpr);
  cv.height = Math.round(RP.h * RP.dpr);
  RP.ctx = cv.getContext('2d');
}
function enterRope() {
  enterHome();
  mode = 'rope';
  show('rope');
  ropeReset();
}
function ropeReset() {
  RP.phase = 'idle';
  RP.t = 0;
  RP.p = 0.1;
  RP.reps = 0;
  RP.perfect = 0;
  RP.streak = 0;
  RP.bestStreak = 0;
  RP.lives = 3;
  RP.tapT = -9;
  RP.msg = '';
  RP.res = null;
  $('rpResult').hidden = true;
  $('rpBox').hidden = false;
  $('rpBtnText').textContent = 'НАЧАТЬ';
  $('rpHelp').textContent = 'Жми «Прыжок», когда скакалка идёт вниз к ногам. Пока ты в воздухе, жать бесполезно. 3 касания и конец.';
  ropeHud();
  ropeInfo();
  ropeSize();
  ropeDraw();
}
function ropeHud() {
  $('rpStreak').textContent = RP.streak;
  $('rpReps').textContent = RP.reps;
  $('rpLives').textContent = RP.lives;
}
function ropePress() {
  if (RP.phase === 'idle') {
    const s0 = stamNow();
    if (s0 < 0.1) {
      RP.phase = 'done';
      RP.cool = 0.8;
      stamSet(0.05);
      save.faints = (save.faints || 0) + 1;
      persist();
      $('rpBig').textContent = 0;
      $('rpBanners').innerHTML = '<div class="banner bad">Не хватило сил: ты упал в обморок.</div>';
      $('rpRows').innerHTML = rowsHtml([['Силы', 'вернутся через ' + Math.ceil((1 - stamNow()) * recSec()) + ' с'], ['Монеты', '+0 М', 'gold']]);
      $('rpBox').hidden = true;
      $('rpResult').hidden = false;
      $('rpHelp').textContent = '';
      $('rpBtnText').textContent = 'ЕЩЁ РАЗ';
      return;
    }
    RP.sNow = s0;
    RP.faint = false;
    RP.phase = 'run';
    RP.t = 0;
    RP.p = 0.1;
    $('rpBtnText').textContent = 'ПРЫЖОК!';
    $('rpHelp').textContent = '';
  } else if (RP.phase === 'run') {
    if (RP.t - RP.tapT >= 0.5) {
      RP.tapT = RP.t;
      beep(420, 0.05, 'triangle', 0.08);
    }
  } else if (RP.phase === 'done') {
    if (RP.cool > 0) return;
    ropeReset();
  }
}
function ropeOnPass() {
  const d = RP.t - RP.tapT;
  if (d >= 0.05 && d <= 0.4) {
    RP.reps++;
    RP.streak++;
    RP.bestStreak = Math.max(RP.bestStreak, RP.streak);
    if (Math.abs(d - 0.225) <= 0.06) {
      RP.perfect++;
      RP.msg = 'ИДЕАЛЬНО';
    } else {
      RP.msg = 'ХОРОШО';
    }
    RP.msgGood = true;
    beep(660, 0.06, 'sine', 0.08);
  } else {
    RP.lives--;
    RP.streak = 0;
    RP.msg = d < 0.05 ? 'ПОЗДНО' : 'РАНО';
    RP.msgGood = false;
    beep(180, 0.18, 'sawtooth', 0.1);
  }
  RP.msgT = RP.t;
  RP.sNow -= ROPE_COST * (1 - 0.4 * erNow());
  if (RP.sNow <= 0) {
    RP.faint = true;
    RP.lives = 0;
  }
  ropeHud();
}
function ropeTick(dt) {
  if (RP.cool > 0) RP.cool -= dt;
  if (RP.phase === 'run') {
    RP.t += dt;
    const p0 = RP.p;
    RP.p += ropeOmega(RP.t) * dt;
    if (Math.floor(RP.p) > Math.floor(p0)) ropeOnPass();
    if (RP.lives <= 0 || RP.t >= ROPE_LEN) ropeFinish();
  }
  if (!$('rpBox').hidden) ropeDraw();
}
function ropeFinish() {
  RP.phase = 'done';
  RP.cool = 0.8;
  stamSet(RP.faint ? 0.05 : Math.max(0.05, RP.sNow));
  if (RP.faint) {
    save.faints = (save.faints || 0) + 1;
  }
  const reps = RP.reps;
  const perf = reps ? RP.perfect / reps : 0;
  const legsBefore = save.legs;
  save.legs = legsGain(save.legs, 0.06 * clamp(reps / 35, 0.1, 1) * (0.7 + 0.3 * perf));
  const pb = reps > save.ropePb;
  if (pb) save.ropePb = reps;
  const best = reps > save.ropeBest;
  const prev = save.ropeBest;
  if (best) save.ropeBest = reps;
  const pay = ropePay(reps, RP.perfect, pb && reps > 0, save.life);
  save.coins += pay.total;
  persist();
  $('rpBig').textContent = reps;
  let b = '';
  if (RP.faint) b += '<div class="banner bad">Силы кончились: ты упал в обморок.</div>';
  if (best && prev) b += '<div class="banner">Новый рекорд: +' + (reps - prev) + '</div>';
  $('rpBanners').innerHTML = b;
  $('rpRows').innerHTML = rowsHtml([
    ['Идеальных', RP.perfect + ' из ' + reps],
    ['Лучшая серия', RP.bestStreak],
    ['Силы', Math.round(stamNow() * 100) + ' %'],
    ['Форма ног', '+' + ((save.legs - legsBefore) * 100).toFixed(1) + ' % (всего ' + Math.round(save.legs * 100) + ' %)'],
    ['Монеты', '+' + pay.total + ' М', 'gold']
  ]);
  $('rpBox').hidden = true;
  $('rpResult').hidden = false;
  $('rpHelp').textContent = '';
  $('rpBtnText').textContent = 'ЕЩЁ РАЗ';
  ropeInfo();
}
function ropeDraw() {
  const c = RP.ctx;
  if (!c) return;
  const W = RP.w, H = RP.h, dpr = RP.dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const gy = H - 24;
  const cx = W / 2;
  const u = RP.t - RP.tapT;
  const h = (RP.phase === 'run' && u >= 0 && u <= 0.45) ? 62 * Math.sin(Math.PI * u / 0.45) : 0;
  c.fillStyle = '#26365a';
  c.fillRect(0, gy, W, H - gy);
  c.fillStyle = '#3b4f7c';
  c.fillRect(0, gy, W, 3);
  const hy = gy - 80 - h * 0.3;
  const hx = 74;
  const ph = RP.p % 1;
  const ctrl = hy + 2 * ((gy - 2) - hy) * Math.cos(2 * Math.PI * ph);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#d9b27a';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(cx - hx, hy);
  c.quadraticCurveTo(cx, ctrl, cx + hx, hy);
  c.stroke();
  c.strokeStyle = '#c68a5b';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(cx - 13, gy - 112 - h);
  c.lineTo(cx - hx, hy);
  c.moveTo(cx + 13, gy - 112 - h);
  c.lineTo(cx + hx, hy);
  c.stroke();
  c.strokeStyle = '#1b2742';
  c.lineWidth = 8;
  c.beginPath();
  c.moveTo(cx - 6, gy - 64 - h);
  c.lineTo(cx - 8, gy - 8 - h);
  c.moveTo(cx + 6, gy - 64 - h);
  c.lineTo(cx + 8, gy - 8 - h);
  c.stroke();
  c.fillStyle = '#e2553a';
  c.fillRect(cx - 14, gy - 118 - h, 28, 56);
  c.fillStyle = '#c68a5b';
  c.beginPath();
  c.arc(cx, gy - 134 - h, 13, 0, Math.PI * 2);
  c.fill();
  if (RP.msg && RP.t - RP.msgT < 0.6) {
    c.font = '700 26px "Exo 2", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = RP.msgGood ? '#46d39a' : '#ff5b5b';
    c.fillText(RP.msg, cx, 60);
  }
  if (RP.phase === 'run') {
    c.fillStyle = 'rgba(255,255,255,.14)';
    c.fillRect(12, H - 14, W - 24, 4);
    c.fillStyle = '#46d39a';
    c.fillRect(12, H - 14, (W - 24) * clamp(RP.t / ROPE_LEN, 0, 1), 4);
  }
}
const rpBtn = $('rpBtn');
rpBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  audio();
  ropePress();
});
rpBtn.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });
$('rpBack').addEventListener('click', () => { enterHome(); });
$('toRope').addEventListener('click', () => {
  audio();
  enterRope();
});

function boot() {
  if (renderer) {
    BOX = new THREE.BoxGeometry(1, 1, 1);
    SPH = new THREE.SphereGeometry(1, 14, 10);
    CIRC = new THREE.CircleGeometry(0.5, 16);
    init3d();
    buildJump();
    enterHome();
    tick.last = performance.now();
    requestAnimationFrame(tick);
  } else {
    $('nogl').hidden = false;
    $('goBtn').disabled = true;
    $('toJump').disabled = true;
    $('toRope').disabled = true;
    renderHome();
  }
}
if (document.fonts && document.fonts.load) {
  Promise.race([
    document.fonts.load('700 40px "Exo 2"').catch(() => 0),
    new Promise(r => setTimeout(r, 1500))
  ]).then(boot);
} else {
  boot();
}
window.addEventListener('pagehide', persist);
})();
