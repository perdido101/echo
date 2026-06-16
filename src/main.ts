/**
 * ECHO — survive the board as it fills with replays of your own past moves.
 *
 * You are one glowing tile on an 8×8 grid. Every move you make is recorded.
 * After a short delay, "echoes" — translucent ghosts of your past self —
 * begin retracing the exact path you walked. More echoes spawn over time and
 * the board tightens. Step onto any echo and it's game over. Survive.
 *
 * Vanilla TypeScript + Canvas2D. No frameworks. All visuals drawn here, all
 * sound synthesized in audio.ts.
 */

import { SoundEngine } from './audio';

/* ============================================================================
 * CONFIG — ALL gameplay tuning lives here. Tweak feel without hunting.
 * ==========================================================================*/
export const CONFIG = {
  // --- Board ---
  GRID_SIZE: 8, // board is GRID_SIZE × GRID_SIZE cells

  // --- Echo behaviour (the core mechanic) ---
  ECHO_DELAY: 5, // moves before the FIRST echo spawns; it then trails you by this many moves forever
  ECHO_SPAWN_INTERVAL: 12, // starting gap (in moves) between additional echo spawns
  ECHO_SPAWN_FLOOR: 5, // the interval never shrinks below this many moves
  ECHO_INTERVAL_STEP: 1, // interval shrinks by this each time an echo spawns (difficulty ramp)
  ECHO_LIFESPAN: 40, // moves an echo lives before fading out & despawning (0 = lives forever).
  //                    A finite lifespan caps how many echoes share the board at once
  //                    (steady state ≈ ECHO_LIFESPAN / spawn interval), which is what makes an
  //                    endless run possible. Set to 0 for the original "board fills up" mode.
  ECHO_FADEOUT: 12, // over how many of its final moves an echo fades to nothing before despawning

  // --- Feel / animation ---
  TWEEN_MS: 120, // tile move animation duration (ms), eased-out — never instant snapping

  // --- Echo appearance (afterimage trail = the brand) ---
  ECHO_MAX_OPACITY: 0.6, // opacity of the NEWEST echo (brightest)
  ECHO_FADE: 0.74, // each progressively-older echo multiplies opacity by this
  ECHO_MIN_OPACITY: 0.12, // floor so the oldest echoes stay faintly visible

  // --- Colours ---
  BG: '#0a0a1a', // near-black indigo background
  PLAYER_CORE: '#aef9ff', // bright cyan-white player core
  CELL_BORDER: 'rgba(255,255,255,0.06)', // very faint cell borders
  GOAL_CORE: '#ffd479', // warm gold goal tile — distinct from cyan player/echoes
  GOAL_POINTS: 1, // points awarded per goal collected

  // --- Misc visuals ---
  CELL_ROUND: 0.22, // corner radius as a fraction of cell size
  TILE_INSET: 0.14, // gap around a tile inside its cell (fraction of cell size)
  TRAIL: true, // draw a faint motion-blur streak behind moving tiles
  SWIPE_THRESHOLD: 24, // px a touch must travel to register as a swipe
} as const;

/* ============================================================================
 * Types
 * ==========================================================================*/
type Cell = { x: number; y: number };
type Dir = 'up' | 'down' | 'left' | 'right';

/** A drawable tile that smoothly tweens from a `from` cell to its logical `cell`. */
interface Tile {
  cell: Cell; // logical (collision) position = the tween target
  fx: number; // tween-start x in cell coords (fractional, for smooth re-targeting)
  fy: number; // tween-start y in cell coords
  t0: number; // timestamp (ms) the current tween started
}

interface Echo extends Tile {
  delay: number; // how many moves this echo trails the player (== its spawn tick)
}

const DIRS: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/* ============================================================================
 * DOM references
 * ==========================================================================*/
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const muteEl = document.getElementById('mute')!;
const hintEl = document.getElementById('hint')!;
const overEl = document.getElementById('over')!;
const finalEl = document.getElementById('final')!;
const bestFinalEl = document.getElementById('bestFinal')!;
const newbestEl = document.getElementById('newbest')!;
const helpBtnEl = document.getElementById('help-btn')!;
const helpEl = document.getElementById('help')!;

const sound = new SoundEngine();
const BEST_KEY = 'echo-best-v2'; // bumped: score now comes from collecting goals

/* ============================================================================
 * Game state
 * ==========================================================================*/
const center = Math.floor(CONFIG.GRID_SIZE / 2);

let player: Tile;
let echoes: Echo[];
let positionHistory: Cell[]; // positionHistory[k] = player cell AFTER k moves (index 0 = start)
let tick: number; // number of moves the player has made
let spawnInterval: number; // current (ramping) spawn interval
let nextSpawnTick: number; // tick at which the next echo will spawn
let score: number;
let best: number = Number(localStorage.getItem(BEST_KEY) || 0);
let gameOver: boolean;
let hintActive: boolean;
let deathFade: number; // 0..1 board dim/desaturate progress on death
let goal: Cell; // the collectible goal tile — reaching it scores points

function startGame(): void {
  player = makeTile(center, center);
  echoes = [];
  positionHistory = [{ x: center, y: center }];
  tick = 0;
  spawnInterval = CONFIG.ECHO_SPAWN_INTERVAL;
  nextSpawnTick = CONFIG.ECHO_DELAY; // first echo appears after ECHO_DELAY moves
  score = 0;
  gameOver = false;
  deathFade = 0;
  hintActive = score === 0; // hint shows until the first move
  hintEl.classList.remove('gone');
  overEl.classList.remove('show');
  newbestEl.classList.remove('flash');
  scoreEl.textContent = '0';
  spawnGoal();
}

/** Place the goal on a random empty cell (avoiding the player and echoes). */
function spawnGoal(): void {
  const size = CONFIG.GRID_SIZE;
  for (let attempt = 0; attempt < 60; attempt++) {
    const c: Cell = { x: (Math.random() * size) | 0, y: (Math.random() * size) | 0 };
    if (c.x === player.cell.x && c.y === player.cell.y) continue;
    if (echoes.some((e) => e.cell.x === c.x && e.cell.y === c.y)) continue;
    goal = c;
    return;
  }
  // Fallback (board nearly full): any cell that isn't the player's.
  goal = { x: (player.cell.x + 1) % size, y: player.cell.y };
}

function makeTile(x: number, y: number): Tile {
  return { cell: { x, y }, fx: x, fy: y, t0: performance.now() };
}

/* ============================================================================
 * Core mechanic — a single "tick" resolves a player move.
 *
 * COLLISION ORDER (defined explicitly so deaths feel fair & predictable):
 *   1. Resolve the PLAYER move first (ignore moves into the outer wall).
 *   2. ADVANCE every echo by replaying the player's historical move at
 *      index (tick - echo.delay).
 *   3. SPAWN a new echo if one is due (it appears at the start cell).
 *   4. CHECK OVERLAP: if the player now shares a cell with ANY echo -> death.
 *   5. If the player survived AND landed on the goal, collect it (+points) and
 *      respawn a new goal. Surviving alone scores nothing.
 * ==========================================================================*/
function tryMove(dir: Dir): void {
  if (gameOver) return;

  const d = DIRS[dir];
  const target: Cell = { x: player.cell.x + d.x, y: player.cell.y + d.y };

  // (1) Moves into the outer wall are ignored — no wrap, no sliding, no tick.
  if (target.x < 0 || target.x >= CONFIG.GRID_SIZE || target.y < 0 || target.y >= CONFIG.GRID_SIZE) {
    return;
  }

  const now = performance.now();

  // Fade the first-run hint permanently after the very first move.
  if (hintActive) {
    hintActive = false;
    hintEl.classList.add('gone');
  }

  // (1 cont.) Apply the player move and record history.
  retarget(player, target, now);
  player.cell = target;
  positionHistory.push({ x: target.x, y: target.y });
  tick++;

  // (2) Advance every existing echo to its new historical position.
  for (const e of echoes) {
    const past = positionHistory[tick - e.delay];
    if (past) {
      retarget(e, past, now);
      e.cell = { x: past.x, y: past.y };
    }
  }

  // (3) Spawn a new echo if due. Its delay == current tick, so it starts at
  //     the original start cell and trails the player by `tick` moves.
  if (tick >= nextSpawnTick) {
    const start = positionHistory[0];
    echoes.push({
      cell: { x: start.x, y: start.y },
      fx: start.x,
      fy: start.y,
      t0: now,
      delay: tick,
    });
    // Difficulty ramp: tighten the interval, down to the floor.
    spawnInterval = Math.max(CONFIG.ECHO_SPAWN_FLOOR, spawnInterval - CONFIG.ECHO_INTERVAL_STEP);
    nextSpawnTick = tick + spawnInterval;
    sound.echoSpawn();
  }

  // (4) Despawn echoes that have outlived ECHO_LIFESPAN. This caps how many
  //     echoes can crowd the board at once, so a skilled run can go forever.
  //     (an echo's age == tick - delay, since its delay equals its spawn tick.)
  if (CONFIG.ECHO_LIFESPAN > 0) {
    echoes = echoes.filter((e) => tick - e.delay < CONFIG.ECHO_LIFESPAN);
  }

  // (5) Overlap check — you die if you LAND on an echo, OR if you and an echo
  //     swap cells (cross straight through each other) this tick. The swap case
  //     is what makes echoes that trail you by an odd number of moves a real
  //     threat too — without it, grid "checkerboard parity" means they could
  //     never share your cell and were effectively harmless.
  const playerNew = player.cell; // cell the player just moved to
  const playerPrev = positionHistory[tick - 1]; // cell the player came from
  for (const e of echoes) {
    const en = e.cell; // echo's new cell this tick
    // Direct overlap: stepped onto an echo.
    if (en.x === playerNew.x && en.y === playerNew.y) {
      die();
      return;
    }
    // Pass-through: player moved A->B while this echo moved B->A.
    const ep = positionHistory[tick - 1 - e.delay]; // echo's previous cell
    if (
      ep &&
      ep.x === playerNew.x &&
      ep.y === playerNew.y &&
      en.x === playerPrev.x &&
      en.y === playerPrev.y
    ) {
      die();
      return;
    }
  }

  // (6) Survived. Score only comes from collecting goals (not from surviving),
  //     so camping a safe loop earns nothing — you must chase the goal.
  if (player.cell.x === goal.x && player.cell.y === goal.y) {
    score += CONFIG.GOAL_POINTS;
    scoreEl.textContent = String(score);
    sound.collect();
    spawnGoal();
  } else {
    sound.blip();
  }
}

/** Re-aim a tile's tween from its CURRENT rendered position (smooth on rapid input). */
function retarget(t: Tile, _target: Cell, now: number): void {
  const cur = renderCoords(t, now);
  t.fx = cur.x;
  t.fy = cur.y;
  t.t0 = now;
}

function die(): void {
  gameOver = true;
  sound.death();
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    newbestEl.classList.add('flash');
  }
  finalEl.textContent = String(score);
  bestFinalEl.textContent = `BEST ${best}`;
  // Small delay so the board dim animation reads before the panel.
  setTimeout(() => overEl.classList.add('show'), 220);
}

/* ============================================================================
 * Rendering
 * ==========================================================================*/
let W = 0;
let H = 0;
let dpr = 1;
let boardPx = 0; // board side length in CSS px
let cellPx = 0; // one cell side length in CSS px
let originX = 0; // top-left of board in CSS px
let originY = 0;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Square board centered, leaving margin for HUD top/bottom.
  const margin = Math.min(W, H) * 0.08;
  boardPx = Math.min(W - margin * 2, H - margin * 2, 720);
  cellPx = boardPx / CONFIG.GRID_SIZE;
  originX = (W - boardPx) / 2;
  originY = (H - boardPx) / 2;
}

const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);

/** Current rendered position of a tile in cell coords (fractional), eased. */
function renderCoords(t: Tile, now: number): { x: number; y: number } {
  const p = Math.min(1, (now - t.t0) / CONFIG.TWEEN_MS);
  const e = easeOut(p);
  return {
    x: t.fx + (t.cell.x - t.fx) * e,
    y: t.fy + (t.cell.y - t.fy) * e,
  };
}

/** Center pixel of a fractional cell coordinate. */
function cellCenterPx(cx: number, cy: number): { px: number; py: number } {
  return {
    px: originX + (cx + 0.5) * cellPx,
    py: originY + (cy + 0.5) * cellPx,
  };
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the faint 8×8 grid of rounded cells. */
function drawGrid(): void {
  const inset = cellPx * 0.04;
  const r = cellPx * CONFIG.CELL_ROUND;
  ctx.lineWidth = 1;
  ctx.strokeStyle = CONFIG.CELL_BORDER;
  for (let gy = 0; gy < CONFIG.GRID_SIZE; gy++) {
    for (let gx = 0; gx < CONFIG.GRID_SIZE; gx++) {
      const x = originX + gx * cellPx + inset;
      const y = originY + gy * cellPx + inset;
      roundRect(x, y, cellPx - inset * 2, cellPx - inset * 2, r);
      ctx.stroke();
    }
  }
}

/**
 * Draw a glowing rounded tile.
 * @param desat 0 = full colour (player), 1 = most desaturated (oldest echo)
 */
function drawTile(cx: number, cy: number, alpha: number, glow: number, desat: number): void {
  const { px, py } = cellCenterPx(cx, cy);
  const size = cellPx * (1 - CONFIG.TILE_INSET * 2);
  const half = size / 2;
  const r = size * CONFIG.CELL_ROUND;

  // Colourblind-safe: player vs echoes differ by brightness/bloom, not hue.
  // Fade from cyan -> muted slate as echoes age (desat).
  const core = lerpColor([174, 249, 255], [120, 140, 175], desat);
  const edge = lerpColor([90, 200, 235], [70, 85, 115], desat);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft bloom via shadow.
  ctx.shadowColor = `rgba(${core[0]},${core[1]},${core[2]},${0.9 * glow})`;
  ctx.shadowBlur = cellPx * 0.7 * glow;

  // Radial gradient body for a glowing core.
  const grad = ctx.createRadialGradient(px, py, 1, px, py, half * 1.15);
  grad.addColorStop(0, `rgb(${core[0]},${core[1]},${core[2]})`);
  grad.addColorStop(0.6, `rgb(${edge[0]},${edge[1]},${edge[2]})`);
  grad.addColorStop(1, `rgba(${edge[0]},${edge[1]},${edge[2]},0.35)`);
  ctx.fillStyle = grad;

  roundRect(px - half, py - half, size, size, r);
  ctx.fill();
  ctx.restore();
}

/** Tasteful motion-blur streak behind a moving tile. */
function drawTrail(t: Tile, now: number, alpha: number, desat: number): void {
  if (!CONFIG.TRAIL) return;
  const p = Math.min(1, (now - t.t0) / CONFIG.TWEEN_MS);
  if (p >= 1) return; // only while moving
  const cur = renderCoords(t, now);
  const a = cellCenterPx(t.fx, t.fy);
  const b = cellCenterPx(cur.x, cur.y);
  const core = lerpColor([174, 249, 255], [120, 140, 175], desat);

  ctx.save();
  ctx.globalAlpha = alpha * 0.35 * (1 - p);
  ctx.strokeStyle = `rgb(${core[0]},${core[1]},${core[2]})`;
  ctx.lineCap = 'round';
  ctx.lineWidth = cellPx * (1 - CONFIG.TILE_INSET * 2) * 0.55;
  ctx.shadowColor = `rgba(${core[0]},${core[1]},${core[2]},0.5)`;
  ctx.shadowBlur = cellPx * 0.4;
  ctx.beginPath();
  ctx.moveTo(a.px, a.py);
  ctx.lineTo(b.px, b.py);
  ctx.stroke();
  ctx.restore();
}

function lerpColor(a: number[], b: number[], t: number): number[] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Draw the goal as a pulsing gold ring + bright core. Distinct from the player
 * and echoes by SHAPE (ring) and ANIMATION as well as colour, so it reads
 * clearly even for colourblind players.
 */
function drawGoal(now: number, fade: number): void {
  const { px, py } = cellCenterPx(goal.x, goal.y);
  const base = cellPx * (1 - CONFIG.TILE_INSET * 2) * 0.5;
  const pulse = 0.5 + 0.5 * Math.sin(now / 320); // 0..1 gentle pulse

  ctx.save();
  ctx.shadowColor = 'rgba(255,212,121,0.9)';
  ctx.shadowBlur = cellPx * 0.5;

  // Pulsing ring.
  ctx.strokeStyle = CONFIG.GOAL_CORE;
  ctx.lineWidth = Math.max(2, cellPx * 0.07);
  ctx.globalAlpha = fade * (0.5 + pulse * 0.5);
  ctx.beginPath();
  ctx.arc(px, py, base * (0.62 + pulse * 0.26), 0, Math.PI * 2);
  ctx.stroke();

  // Bright core.
  ctx.globalAlpha = fade;
  const grad = ctx.createRadialGradient(px, py, 1, px, py, base * 0.5);
  grad.addColorStop(0, '#fff4d6');
  grad.addColorStop(1, 'rgba(255,212,121,0.12)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py, base * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function frame(now: number): void {
  // Background.
  ctx.fillStyle = CONFIG.BG;
  ctx.fillRect(0, 0, W, H);

  // On death, gradually dim + desaturate the whole board.
  if (gameOver) deathFade = Math.min(1, deathFade + 0.04);

  drawGrid();

  // Draw echoes oldest-first so the brightest (newest) sits on top.
  // Newest echo = brightest; each older one is more transparent + desaturated.
  const n = echoes.length;
  for (let i = 0; i < n; i++) {
    const e = echoes[i];
    const rank = n - 1 - i; // 0 = newest
    let alpha = CONFIG.ECHO_MAX_OPACITY * Math.pow(CONFIG.ECHO_FADE, rank);
    alpha = Math.max(CONFIG.ECHO_MIN_OPACITY, alpha);
    // Fade out over the final ECHO_FADEOUT moves of the echo's lifespan.
    if (CONFIG.ECHO_LIFESPAN > 0) {
      const remaining = CONFIG.ECHO_LIFESPAN - (tick - e.delay);
      alpha *= Math.max(0, Math.min(1, remaining / CONFIG.ECHO_FADEOUT));
    }
    const desat = Math.min(1, rank * 0.16); // older -> more slate-grey
    const c = renderCoords(e, now);
    drawTrail(e, now, alpha * (gameOver ? 1 - deathFade * 0.7 : 1), desat);
    drawTile(c.x, c.y, alpha * (gameOver ? 1 - deathFade * 0.7 : 1), 0.5 - desat * 0.3, desat);
  }

  // Goal tile (drawn above echoes so it stays readable as the objective).
  drawGoal(now, gameOver ? 1 - deathFade * 0.6 : 1);

  // Player on top with the strongest bloom.
  const pc = renderCoords(player, now);
  const playerAlpha = gameOver ? 1 - deathFade * 0.6 : 1;
  drawTrail(player, now, playerAlpha, 0);
  drawTile(pc.x, pc.y, playerAlpha, 1, 0);

  requestAnimationFrame(frame);
}

/* ============================================================================
 * Input — arrow keys + WASD on desktop, swipe on touch.
 * ==========================================================================*/
let helpOpen = false;

function setHelp(open: boolean): void {
  helpOpen = open;
  helpEl.classList.toggle('show', open);
}

function handleDir(dir: Dir): void {
  if (helpOpen) return; // ignore moves while the how-to-play panel is open
  sound.resume(); // first gesture unlocks audio
  tryMove(dir);
}

function restart(): void {
  sound.resume();
  startGame();
}

window.addEventListener('keydown', (ev) => {
  switch (ev.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      ev.preventDefault();
      handleDir('up');
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      ev.preventDefault();
      handleDir('down');
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      ev.preventDefault();
      handleDir('left');
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      ev.preventDefault();
      handleDir('right');
      break;
    case ' ':
    case 'Enter':
      ev.preventDefault();
      if (helpOpen) setHelp(false);
      else if (gameOver) restart();
      break;
    case 'm':
    case 'M':
      updateMuteUI(sound.toggleMute());
      break;
    case 'h':
    case 'H':
    case '?':
      setHelp(!helpOpen);
      break;
    case 'Escape':
      if (helpOpen) setHelp(false);
      break;
  }
});

// Touch swipe handling.
let touchStart: { x: number; y: number } | null = null;
canvas.addEventListener(
  'touchstart',
  (ev) => {
    const t = ev.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  },
  { passive: true },
);
canvas.addEventListener(
  'touchend',
  (ev) => {
    if (!touchStart) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;

    if (gameOver) {
      restart();
      return;
    }
    if (Math.abs(dx) < CONFIG.SWIPE_THRESHOLD && Math.abs(dy) < CONFIG.SWIPE_THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      handleDir(dx > 0 ? 'right' : 'left');
    } else {
      handleDir(dy > 0 ? 'down' : 'up');
    }
  },
  { passive: true },
);

// Tap to restart on game-over screen (covers non-swipe taps too).
overEl.addEventListener('click', () => {
  if (gameOver) restart();
});

// Mute toggle.
function updateMuteUI(muted: boolean): void {
  muteEl.textContent = muted ? '♪̸' : '♪';
  muteEl.style.opacity = muted ? '0.3' : '0.5';
  muteEl.title = muted ? 'Unmute (M)' : 'Mute (M)';
}
muteEl.addEventListener('click', () => {
  sound.resume();
  updateMuteUI(sound.toggleMute());
});

// How-to-play panel: button opens it, tapping the panel closes it.
helpBtnEl.addEventListener('click', () => setHelp(true));
helpEl.addEventListener('click', () => setHelp(false));

window.addEventListener('resize', resize);

/* ============================================================================
 * Boot
 * ==========================================================================*/
resize();
updateMuteUI(sound.muted);
startGame();
requestAnimationFrame(frame);

// Register the service worker for offline / installable PWA play.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is best-effort; ignore failures */
    });
  });
}
