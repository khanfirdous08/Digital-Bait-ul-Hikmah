import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";

// ─── Constants ────────────────────────────────────────────────────────────────
const CUBE_NAMES = ["Spark", "Pulse", "Nova", "Plasma", "Quantum", "Singularity"];
const CUBE_COLORS = ["#00e5ff", "#ff00de", "#ffe600", "#ff6a00", "#00ff8c", "#ffffff"];
const CUBE_GLOW = [
  "rgba(0,229,255,0.95)", "rgba(255,0,222,0.95)", "rgba(255,230,0,0.95)",
  "rgba(255,106,0,0.95)", "rgba(0,255,140,0.95)", "rgba(255,255,255,1.0)",
];
const CUBE_SIZES = [22, 30, 40, 52, 65, 82];
const CUBE_SCORES = [10, 30, 100, 300, 1000, 5000];
const MAX_LEVEL = 5;
const WALL_T = 20;
const DROP_Y = 80;
const GAMEOVER_Y = DROP_Y + 20;
const GW = 380;
const GH = 620;

// ─── Audio engine ─────────────────────────────────────────────────────────────
function createAudio() {
  try {
    const ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    function playDrop(level: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(master);
      osc.type = "sine";
      osc.frequency.setValueAtTime(300 + level * 80, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180 + level * 40, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12);
    }

    const NOTE_FREQS = [261.6, 329.6, 392, 523.2, 659.3, 880, 1046.5, 1318.5];
    function playMerge(level: number) {
      const notes = level === 0 ? [0, 4] : level === 1 ? [0, 4, 7] : level === 2 ? [0, 4, 7, 12] :
        level === 3 ? [0, 3, 7, 10] : level === 4 ? [0, 4, 7, 11, 14] : [0, 4, 7, 10, 14, 17];
      const base = NOTE_FREQS[Math.min(level, NOTE_FREQS.length - 1)];
      notes.forEach((semitone, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(master);
        osc.type = i === 0 ? "triangle" : "sine";
        const freq = base * Math.pow(2, semitone / 12);
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        const vol = 0.35 - i * 0.04;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45 + level * 0.05);
        osc.start(ctx.currentTime + i * 0.008);
        osc.stop(ctx.currentTime + 0.5 + level * 0.05);
      });
      if (level >= 3) {
        const noise = ctx.createOscillator();
        const ng = ctx.createGain();
        noise.connect(ng); ng.connect(master);
        noise.type = "sawtooth";
        noise.frequency.setValueAtTime(80 + level * 20, ctx.currentTime);
        noise.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
        ng.gain.setValueAtTime(0.15, ctx.currentTime);
        ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        noise.start(ctx.currentTime); noise.stop(ctx.currentTime + 0.15);
      }
    }

    function playCombo(combo: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(master);
      osc.type = "square";
      const f = 400 + combo * 80;
      osc.frequency.setValueAtTime(f, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(f * 1.5, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
    }

    function playGameOver() {
      [440, 370, 311, 261.6, 220, 185, 155].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(master);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.25);
      });
    }

    function resume() { if (ctx.state === "suspended") ctx.resume(); }
    return { playDrop, playMerge, playCombo, playGameOver, resume };
  } catch {
    const noop = () => {};
    return { playDrop: noop, playMerge: noop, playCombo: noop, playGameOver: noop, resume: noop };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
type GamePhase = "start" | "playing" | "gameover";

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  color: string; glow: string; size: number;
  type: "dot" | "ring" | "line";
  radius?: number; maxRadius?: number;
  angle?: number; length?: number;
}

interface FloatText {
  x: number; y: number; text: string; color: string;
  life: number; maxLife: number; vy: number; scale: number;
}

interface TrailPoint { x: number; y: number; life: number; }

interface MergeAnim { id: number; startTime: number; }

interface CubeBody extends Matter.Body {
  cubeLevel?: number;
  merging?: boolean;
  spawnTime?: number;
  trail?: TrailPoint[];
  lastTrailX?: number;
  lastTrailY?: number;
}

type AudioSystem = ReturnType<typeof createAudio>;

interface GameState {
  engine: Matter.Engine;
  cubes: CubeBody[];
  sparks: Spark[];
  floatTexts: FloatText[];
  mergeAnims: MergeAnim[];
  aimX: number;
  currentLevel: number;
  nextLevel: number;
  canDrop: boolean;
  lastDropTime: number;
  score: number;
  highScore: number;
  combo: number;
  comboTimer: number;
  phase: GamePhase;
  shake: number;
  shakeX: number;
  shakeY: number;
  bgPulse: number;
  screenFlash: number;
  screenFlashColor: string;
  gameOverTimer: number;
  gameOverShake: number;
  animFrame: number;
  audio: AudioSystem;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutElastic = (t: number) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
};

function pickLevel(): number {
  const r = Math.random();
  if (r < 0.44) return 0;
  if (r < 0.74) return 1;
  if (r < 0.88) return 2;
  if (r < 0.96) return 3;
  return 4;
}

// ─── Rounded rect path helper ─────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function QuantumMerge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gRef = useRef<GameState | null>(null);

  const [phase, setPhase] = useState<GamePhase>("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try { return parseInt(localStorage.getItem("qm_hs") || "0"); } catch { return 0; }
  });
  const [combo, setCombo] = useState(0);
  const [nextLvl, setNextLvl] = useState(0);
  const [curLvl, setCurLvl] = useState(0);
  const [mergedLevel, setMergedLevel] = useState<number | null>(null);

  // ── Spawn sparks ─────────────────────────────────────────────────────────────
  const spawnMergeFX = useCallback((x: number, y: number, level: number) => {
    const g = gRef.current; if (!g) return;
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW[level];
    const count = 20 + level * 6;

    // Radial sparks
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + rnd(-0.2, 0.2);
      const speed = rnd(3, 8 + level * 1.5);
      g.sparks.push({
        type: "dot", x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, maxLife: rnd(0.4, 0.9 + level * 0.07),
        color, glow, size: rnd(2, 4.5 + level * 0.3),
      });
    }

    // Shockwave rings
    for (let ring = 0; ring < 2 + Math.floor(level / 2); ring++) {
      g.sparks.push({
        type: "ring", x, y, vx: 0, vy: 0,
        life: 1, maxLife: 0.5 + ring * 0.12,
        color, glow, size: 0,
        radius: 0, maxRadius: CUBE_SIZES[level] * (1.8 + ring * 1.2),
      });
    }

    // Line sparks
    for (let i = 0; i < 8 + level * 2; i++) {
      const angle = rnd(0, Math.PI * 2);
      const speed = rnd(5, 14 + level * 2);
      g.sparks.push({
        type: "line", x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, maxLife: rnd(0.2, 0.5),
        color, glow, size: rnd(1, 3),
        angle, length: rnd(6, 18 + level * 3),
      });
    }

    // White core sparks
    for (let i = 0; i < 10; i++) {
      const angle = rnd(0, Math.PI * 2);
      const speed = rnd(1, 4);
      g.sparks.push({
        type: "dot", x: x + rnd(-10, 10), y: y + rnd(-10, 10),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1,
        life: 1, maxLife: rnd(0.6, 1.2),
        color: "#ffffff", glow: "rgba(255,255,255,0.9)",
        size: rnd(1.5, 3.5),
      });
    }

    // Background pulse
    g.bgPulse = Math.min(g.bgPulse + 0.4 + level * 0.15, 1.5);
    g.screenFlash = Math.min(0.08 + level * 0.04, 0.4);
    g.screenFlashColor = color;
  }, []);

  const addFloat = useCallback((x: number, y: number, text: string, color: string, big = false) => {
    const g = gRef.current; if (!g) return;
    g.floatTexts.push({ x, y, text, color, life: 1, maxLife: big ? 1.4 : 1.0, vy: big ? -1.8 : -1.2, scale: big ? 1.4 : 1 });
  }, []);

  // ── Do merge ─────────────────────────────────────────────────────────────────
  const doMerge = useCallback((bodyA: CubeBody, bodyB: CubeBody) => {
    const g = gRef.current; if (!g) return;
    const level = bodyA.cubeLevel ?? 0;
    if (level >= MAX_LEVEL) return;

    const mx = (bodyA.position.x + bodyB.position.x) / 2;
    const my = (bodyA.position.y + bodyB.position.y) / 2;

    Matter.World.remove(g.engine.world, bodyA);
    Matter.World.remove(g.engine.world, bodyB);
    g.cubes = g.cubes.filter(c => c !== bodyA && c !== bodyB);

    const newLevel = level + 1;
    const size = CUBE_SIZES[newLevel];
    const vx = ((bodyA.velocity.x + bodyB.velocity.x) / 2) * 0.3;
    const vy = ((bodyA.velocity.y + bodyB.velocity.y) / 2) * 0.3;

    const newCube = Matter.Bodies.rectangle(mx, my, size * 2, size * 2, {
      restitution: 0.15,
      friction: 0.6,
      frictionAir: 0.018,
      density: 0.0015 + newLevel * 0.0003,
      label: "cube",
      collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 },
    }) as CubeBody;
    newCube.cubeLevel = newLevel;
    newCube.merging = false;
    newCube.spawnTime = performance.now();
    newCube.trail = [];

    Matter.Body.setVelocity(newCube, { x: vx, y: vy });
    Matter.World.add(g.engine.world, newCube);
    g.cubes.push(newCube);
    g.mergeAnims.push({ id: newCube.id, startTime: performance.now() });

    spawnMergeFX(mx, my, newLevel);

    const basePoints = CUBE_SCORES[newLevel];
    const comboMult = g.combo > 1 ? g.combo : 1;
    const points = basePoints * comboMult;
    g.score += points;

    g.combo = Math.min(g.combo + 1, 12);
    g.comboTimer = 2.8;

    const shakeBase = 5 + newLevel * 3;
    g.shake = Math.min(shakeBase * (g.combo > 3 ? 1.5 : 1), 24);

    if (g.combo > 1) {
      addFloat(mx, my - 30, `+${points.toLocaleString()}`, CUBE_COLORS[newLevel], true);
      addFloat(mx, my - 55, `⚡ x${g.combo} COMBO`, "#ffe600", false);
      g.audio.playCombo(g.combo);
    } else {
      addFloat(mx, my - 24, `+${points.toLocaleString()}`, CUBE_COLORS[newLevel]);
    }
    g.audio.playMerge(newLevel);

    setScore(g.score);
    setCombo(g.combo);
    setMergedLevel(newLevel);
    setTimeout(() => setMergedLevel(null), 600);
  }, [spawnMergeFX, addFloat]);

  // ── Collision setup ───────────────────────────────────────────────────────────
  const setupCollisions = useCallback((engine: Matter.Engine) => {
    Matter.Events.on(engine, "collisionStart", (event) => {
      const g = gRef.current;
      if (!g || g.phase !== "playing") return;
      const now = performance.now();

      for (const pair of event.pairs) {
        const a = pair.bodyA as CubeBody;
        const b = pair.bodyB as CubeBody;
        if (
          a.label === "cube" && b.label === "cube" &&
          a.cubeLevel === b.cubeLevel &&
          !a.merging && !b.merging &&
          a.cubeLevel !== undefined && a.cubeLevel < MAX_LEVEL &&
          (now - (a.spawnTime ?? 0)) > 250 &&
          (now - (b.spawnTime ?? 0)) > 250
        ) {
          a.merging = true;
          b.merging = true;
          const idA = a.id, idB = b.id;
          setTimeout(() => {
            const g2 = gRef.current;
            if (!g2 || g2.phase !== "playing") return;
            const ca = g2.cubes.find(c => c.id === idA) as CubeBody | undefined;
            const cb = g2.cubes.find(c => c.id === idB) as CubeBody | undefined;
            if (ca && cb) doMerge(ca, cb);
          }, 40);
        }
      }
    });
  }, [doMerge]);

  // ── Drop cube ─────────────────────────────────────────────────────────────────
  const dropCube = useCallback(() => {
    const g = gRef.current;
    if (!g || !g.canDrop || g.phase !== "playing") return;
    const now = performance.now();
    if (now - g.lastDropTime < 380) return;

    const level = g.currentLevel;
    const size = CUBE_SIZES[level];
    const x = Math.max(size + WALL_T + 2, Math.min(GW - size - WALL_T - 2, g.aimX));

    const cube = Matter.Bodies.rectangle(x, DROP_Y - size - 2, size * 2, size * 2, {
      restitution: 0.15,
      friction: 0.6,
      frictionAir: 0.018,
      density: 0.0015,
      label: "cube",
      collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 },
    }) as CubeBody;
    cube.cubeLevel = level;
    cube.merging = false;
    cube.spawnTime = now;
    cube.trail = [];

    Matter.Body.setVelocity(cube, { x: 0, y: 1 });
    Matter.World.add(g.engine.world, cube);
    g.cubes.push(cube);

    g.lastDropTime = now;
    g.canDrop = false;
    g.audio.playDrop(level);

    setTimeout(() => { if (gRef.current) gRef.current.canDrop = true; }, 280);

    g.currentLevel = g.nextLevel;
    g.nextLevel = pickLevel();
    setCurLvl(g.currentLevel);
    setNextLvl(g.nextLevel);
  }, []);

  // ── Game over check ───────────────────────────────────────────────────────────
  const checkGameOver = useCallback(() => {
    const g = gRef.current;
    if (!g || g.phase !== "playing") return;
    const now = performance.now();
    for (const cube of g.cubes) {
      if ((now - (cube.spawnTime ?? 0)) < 900) continue;
      if (cube.position.y - CUBE_SIZES[cube.cubeLevel ?? 0] < GAMEOVER_Y) {
        g.phase = "gameover";
        g.gameOverTimer = 0;
        g.gameOverShake = 30;
        g.audio.playGameOver();
        if (g.score > g.highScore) {
          g.highScore = g.score;
          try { localStorage.setItem("qm_hs", String(g.score)); } catch {}
          setHighScore(g.score);
        }
        setPhase("gameover");
        return;
      }
    }
  }, []);

  // ── Draw helpers ──────────────────────────────────────────────────────────────
  const drawBg = useCallback((ctx: CanvasRenderingContext2D, t: number, bgPulse: number) => {
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, GW, GH);

    // Animated grid
    const gridSize = 38;
    const scroll = (t * 18) % gridSize;
    const pulseAlpha = 0.05 + bgPulse * 0.12;
    ctx.strokeStyle = `rgba(0,140,255,${pulseAlpha})`;
    ctx.lineWidth = 1;
    for (let x = (scroll % gridSize) - gridSize; x < GW + gridSize; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GH); ctx.stroke();
    }
    for (let y = scroll - gridSize; y < GH + gridSize; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GW, y); ctx.stroke();
    }

    // Scanlines
    for (let y = 0; y < GH; y += 2) {
      const a = 0.025 + 0.008 * Math.sin(y * 0.15 + t * 1.5);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, y, GW, 1);
    }

    // Ambient glow points
    const ambientColors = ["rgba(0,229,255", "rgba(255,0,222", "rgba(0,255,140"];
    for (let i = 0; i < 3; i++) {
      const gx = GW * (0.25 + i * 0.25);
      const gy = GH * (0.5 + 0.3 * Math.sin(t * 0.4 + i * 2.1));
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 80 + bgPulse * 40);
      const a = 0.03 + bgPulse * 0.06;
      gr.addColorStop(0, `${ambientColors[i]},${a.toFixed(3)})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, GW, GH);
    }
  }, []);

  const drawCubeShape = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number,
    level: number, t: number, alpha = 1, scale = 1) => {
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW[level];
    const r = Math.max(4, s * 0.14);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.8 + level * 1.3);
    const isRainbow = level === MAX_LEVEL;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    // Outer glow halo
    if (isRainbow) {
      const hue = (t * 55) % 360;
      ctx.shadowColor = `hsl(${hue},100%,65%)`;
    } else {
      ctx.shadowColor = glow;
    }
    ctx.shadowBlur = 22 + pulse * 14;

    // Fill
    if (isRainbow) {
      const h1 = (t * 55) % 360;
      const gr = ctx.createLinearGradient(-s, -s, s, s);
      gr.addColorStop(0, `hsl(${h1},100%,70%)`);
      gr.addColorStop(0.5, `hsl(${(h1 + 120) % 360},100%,70%)`);
      gr.addColorStop(1, `hsl(${(h1 + 240) % 360},100%,70%)`);
      ctx.fillStyle = gr;
    } else {
      const gr = ctx.createRadialGradient(-s * 0.2, -s * 0.2, 0, 0, 0, s * 1.6);
      gr.addColorStop(0, color + "ff");
      gr.addColorStop(0.5, color + "dd");
      gr.addColorStop(1, color + "33");
      ctx.fillStyle = gr;
    }
    roundRect(ctx, -s, -s, s * 2, s * 2, r);
    ctx.fill();

    // Border
    ctx.strokeStyle = isRainbow ? `hsl(${((t * 55) + 180) % 360},100%,80%)` : color;
    ctx.lineWidth = 1.5 + pulse * 0.6;
    ctx.shadowBlur = 12 + pulse * 8;
    roundRect(ctx, -s, -s, s * 2, s * 2, r);
    ctx.stroke();

    // Inner highlight
    ctx.shadowBlur = 0;
    const ig = ctx.createLinearGradient(-s * 0.6, -s * 0.6, s * 0.3, s * 0.3);
    ig.addColorStop(0, "rgba(255,255,255,0.28)");
    ig.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = ig;
    roundRect(ctx, -s * 0.62, -s * 0.62, s * 1.24, s * 1.24, r * 0.6);
    ctx.fill();

    // Label
    ctx.shadowColor = isRainbow ? "#fff" : glow;
    ctx.shadowBlur = 6 + pulse * 4;
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, Math.floor(s * 0.4))}px 'Courier New',monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CUBE_NAMES[level], 0, 0);

    ctx.restore();
  }, []);

  const drawTrail = useCallback((ctx: CanvasRenderingContext2D, cube: CubeBody, dt: number) => {
    if (!cube.trail) return;
    const now = performance.now();

    // Add trail point if moved enough
    const lastX = cube.lastTrailX ?? cube.position.x;
    const lastY = cube.lastTrailY ?? cube.position.y;
    const vy = cube.velocity.y;
    const speed = Math.sqrt(cube.velocity.x ** 2 + vy ** 2);
    if (speed > 2 && (Math.abs(cube.position.x - lastX) > 3 || Math.abs(cube.position.y - lastY) > 3)) {
      cube.trail.push({ x: cube.position.x, y: cube.position.y, life: 1 });
      cube.lastTrailX = cube.position.x;
      cube.lastTrailY = cube.position.y;
    }
    if (cube.trail.length > 12) cube.trail.shift();

    // Draw trail
    const level = cube.cubeLevel ?? 0;
    const color = CUBE_COLORS[level];
    const size = CUBE_SIZES[level];
    for (let i = 0; i < cube.trail.length - 1; i++) {
      const pt = cube.trail[i];
      pt.life = Math.max(0, pt.life - dt * 3);
      const alpha = pt.life * 0.25 * (i / cube.trail.length);
      if (alpha < 0.01) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size * 0.3 * pt.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    cube.trail = cube.trail.filter(p => p.life > 0);
  }, []);

  const drawSparks = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const g = gRef.current; if (!g) return;
    const toKeep: Spark[] = [];
    for (const sp of g.sparks) {
      sp.life -= dt / sp.maxLife;
      if (sp.life <= 0) continue;
      toKeep.push(sp);

      const a = Math.max(0, sp.life);
      ctx.save();
      ctx.globalAlpha = a;

      if (sp.type === "ring") {
        const progress = 1 - sp.life;
        const r = (sp.maxRadius ?? 60) * progress;
        ctx.shadowColor = sp.glow;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = (1 - progress) * 4 + 0.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (sp.type === "line") {
        sp.x += sp.vx; sp.y += sp.vy;
        sp.vx *= 0.88; sp.vy *= 0.88; sp.vy += 0.1;
        const len = (sp.length ?? 10) * sp.life;
        ctx.shadowColor = sp.glow;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = sp.size * sp.life;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - Math.cos(sp.angle ?? 0) * len, sp.y - Math.sin(sp.angle ?? 0) * len);
        ctx.stroke();
      } else {
        sp.x += sp.vx; sp.y += sp.vy;
        sp.vy += 0.12; sp.vx *= 0.97;
        ctx.shadowColor = sp.glow;
        ctx.shadowBlur = 10;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size * Math.max(0.1, sp.life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    g.sparks = toKeep;
  }, []);

  const drawFloats = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const g = gRef.current; if (!g) return;
    const toKeep: FloatText[] = [];
    for (const ft of g.floatTexts) {
      ft.life -= dt / ft.maxLife;
      if (ft.life <= 0) continue;
      toKeep.push(ft);
      ft.y += ft.vy;

      const a = ft.life < 0.3 ? ft.life / 0.3 : 1;
      const sc = ft.scale * (ft.life > 0.85 ? easeOutBack(1 - (ft.life - 0.85) / 0.15) : 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(ft.x, ft.y);
      ctx.scale(sc, sc);
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.scale > 1 ? 16 : 13}px 'Courier New',monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }
    g.floatTexts = toKeep;
  }, []);

  const getMergeScale = useCallback((id: number, anims: MergeAnim[], now: number): number => {
    const anim = anims.find(a => a.id === id);
    if (!anim) return 1;
    const elapsed = (now - anim.startTime) / 1000;
    const dur = 0.38;
    if (elapsed >= dur) return 1;
    return easeOutElastic(elapsed / dur);
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, g: GameState, t: number) => {
    // Drop zone bar
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, GW, 0);
    grad.addColorStop(0, "rgba(0,229,255,0.03)");
    grad.addColorStop(0.5, "rgba(0,229,255,0.08)");
    grad.addColorStop(1, "rgba(0,229,255,0.03)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GW, DROP_Y);

    // Separator line
    ctx.strokeStyle = "rgba(0,229,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 5]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath(); ctx.moveTo(0, DROP_Y); ctx.lineTo(GW, DROP_Y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Danger zone
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.5);
    ctx.fillStyle = `rgba(255,40,40,${0.06 + pulse * 0.04})`;
    ctx.fillRect(0, 0, GW, GAMEOVER_Y);
    ctx.strokeStyle = `rgba(255,60,60,${0.5 + pulse * 0.3})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 28;
    ctx.beginPath(); ctx.moveTo(0, GAMEOVER_Y); ctx.lineTo(GW, GAMEOVER_Y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,80,80,${0.5 + pulse * 0.3})`;
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText("⚠ DANGER", 6, GAMEOVER_Y - 2);
    ctx.restore();

    // Score panel (top)
    ctx.save();
    ctx.fillStyle = "rgba(5,8,20,0.75)";
    roundRect(ctx, 0, 0, GW, 52, 0);
    ctx.fill();

    // Score
    ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#00e5ff";
    ctx.font = "bold 10px 'Courier New',monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("SCORE", 12, 7);
    ctx.fillStyle = "#ffffff"; ctx.shadowBlur = 8;
    ctx.font = "bold 24px 'Courier New',monospace";
    ctx.fillText(g.score.toLocaleString(), 12, 20);

    // Best
    ctx.shadowColor = "#ff00de"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#ff00de";
    ctx.font = "bold 10px 'Courier New',monospace";
    ctx.textAlign = "right";
    ctx.fillText("BEST", GW - 12, 7);
    ctx.fillStyle = "#ffffff"; ctx.shadowBlur = 8;
    ctx.font = "bold 20px 'Courier New',monospace";
    ctx.fillText(Math.max(g.score, g.highScore).toLocaleString(), GW - 12, 20);

    // Combo bar
    if (g.combo > 1) {
      const cb = g.comboTimer / 2.8;
      const cx = GW / 2;
      ctx.shadowColor = "#ffe600"; ctx.shadowBlur = 22;
      ctx.fillStyle = "#ffe600";
      ctx.font = `bold ${12 + Math.min(g.combo, 6)}px 'Courier New',monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`⚡ x${g.combo} COMBO`, cx, 10);
      // Timer bar
      ctx.shadowBlur = 4;
      const bw = 100, bh = 4;
      ctx.fillStyle = "rgba(255,230,0,0.15)";
      roundRect(ctx, cx - bw / 2, 30, bw, bh, 2); ctx.fill();
      ctx.fillStyle = `rgba(255,230,0,${0.6 + pulse * 0.3})`;
      roundRect(ctx, cx - bw / 2, 30, bw * cb, bh, 2); ctx.fill();
    }
    ctx.restore();

    // NEXT cube panel
    const nx = GW - 34, ny = DROP_Y + 32;
    ctx.save();
    ctx.fillStyle = "rgba(5,8,20,0.7)";
    roundRect(ctx, nx - 30, ny - 32, 60, 68, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,229,255,0.2)";
    ctx.lineWidth = 1;
    roundRect(ctx, nx - 30, ny - 32, 60, 68, 6);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,229,255,0.55)";
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("NEXT", nx, ny - 28);

    const ns = Math.min(CUBE_SIZES[g.nextLevel], 20);
    drawCubeShape(ctx, nx, ny + 10, ns, 0, g.nextLevel, t, 1, 1);
    ctx.restore();
  }, [drawCubeShape]);

  // ── Start / restart ───────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const g = gRef.current; if (!g) return;
    g.audio.resume();
    for (const cube of g.cubes) Matter.World.remove(g.engine.world, cube);
    g.cubes = []; g.sparks = []; g.floatTexts = []; g.mergeAnims = [];
    g.score = 0; g.combo = 0; g.comboTimer = 0;
    g.phase = "playing"; g.canDrop = true; g.lastDropTime = 0;
    g.shake = 0; g.bgPulse = 0; g.screenFlash = 0;
    g.gameOverTimer = 0; g.gameOverShake = 0;
    g.currentLevel = pickLevel(); g.nextLevel = pickLevel();
    g.aimX = GW / 2;
    setPhase("playing"); setScore(0); setCombo(0);
    setCurLvl(g.currentLevel); setNextLvl(g.nextLevel);
  }, []);

  // ── Main effect (engine + loop) ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;

    const engine = Matter.Engine.create({ gravity: { y: 1.8 }, positionIterations: 8, velocityIterations: 6 });
    const w = GW, h = GH, wt = WALL_T;
    const floor = Matter.Bodies.rectangle(w / 2, h + wt / 2, w + wt * 2, wt, {
      isStatic: true, label: "wall", restitution: 0.1, friction: 0.9,
      collisionFilter: { category: 0x0002, mask: 0x0001 },
    });
    const wallL = Matter.Bodies.rectangle(-wt / 2, h / 2, wt, h * 3, {
      isStatic: true, label: "wall", restitution: 0.05, friction: 0.9,
      collisionFilter: { category: 0x0002, mask: 0x0001 },
    });
    const wallR = Matter.Bodies.rectangle(w + wt / 2, h / 2, wt, h * 3, {
      isStatic: true, label: "wall", restitution: 0.05, friction: 0.9,
      collisionFilter: { category: 0x0002, mask: 0x0001 },
    });
    Matter.World.add(engine.world, [floor, wallL, wallR]);

    const audio = createAudio();
    const initLevel = pickLevel();
    const g: GameState = {
      engine, audio,
      cubes: [], sparks: [], floatTexts: [], mergeAnims: [],
      aimX: w / 2, currentLevel: initLevel, nextLevel: pickLevel(),
      canDrop: true, lastDropTime: 0,
      score: 0, highScore: 0, combo: 0, comboTimer: 0,
      phase: "start",
      shake: 0, shakeX: 0, shakeY: 0,
      bgPulse: 0, screenFlash: 0, screenFlashColor: "#fff",
      gameOverTimer: 0, gameOverShake: 0,
      animFrame: 0,
    };
    try { g.highScore = parseInt(localStorage.getItem("qm_hs") || "0"); } catch {}
    gRef.current = g;
    setupCollisions(engine);
    setCurLvl(initLevel); setNextLvl(g.nextLevel);

    const FIXED_DT = 1000 / 60;
    let lastTime = performance.now();
    let accumulator = 0;

    function loop(now: number) {
      const elapsed = Math.min(now - lastTime, 50);
      lastTime = now;
      accumulator += elapsed;
      const t = now / 1000;

      const g = gRef.current; if (!g) return;
      const ctx = canvas!.getContext("2d"); if (!ctx) return;

      // Fixed physics steps
      while (accumulator >= FIXED_DT) {
        Matter.Engine.update(g.engine, FIXED_DT);
        accumulator -= FIXED_DT;
      }

      const dt = elapsed / 1000;

      // Update game logic
      if (g.phase === "playing") {
        if (g.comboTimer > 0) {
          g.comboTimer -= dt;
          if (g.comboTimer <= 0) { g.combo = 0; setCombo(0); }
        }
        checkGameOver();
      }

      if (g.phase === "gameover") {
        g.gameOverTimer += dt;
        if (g.gameOverShake > 0) {
          g.gameOverShake = lerp(g.gameOverShake, 0, 0.15);
          if (g.gameOverShake < 0.3) g.gameOverShake = 0;
        }
      }

      // Screen shake
      if (g.shake > 0 || g.gameOverShake > 0) {
        const si = Math.max(g.shake, g.gameOverShake);
        g.shakeX = rnd(-si, si);
        g.shakeY = rnd(-si * 0.6, si * 0.6);
        g.shake = lerp(g.shake, 0, 0.22);
        if (g.shake < 0.2) g.shake = 0;
      } else { g.shakeX = 0; g.shakeY = 0; }

      g.bgPulse = lerp(g.bgPulse, 0, 0.04);
      g.screenFlash = lerp(g.screenFlash, 0, 0.12);

      // Clean stale mergeAnims
      const now2 = performance.now();
      g.mergeAnims = g.mergeAnims.filter(a => now2 - a.startTime < 600);

      // ── Render ────────────────────────────────────────────────────────────────
      canvas!.width = GW; canvas!.height = GH;
      ctx.save();
      ctx.translate(g.shakeX, g.shakeY);

      drawBg(ctx, t, g.bgPulse);

      // Trails (draw before cubes)
      for (const cube of g.cubes) drawTrail(ctx, cube, dt);

      // Cubes
      for (const cube of g.cubes) {
        const scale = getMergeScale(cube.id, g.mergeAnims, now2);
        const level = cube.cubeLevel ?? 0;
        // Flashing red during game over
        const isGameOver = g.phase === "gameover";
        const flashAlpha = isGameOver ? (0.5 + 0.5 * Math.sin(g.gameOverTimer * 18)) : 1;
        drawCubeShape(ctx, cube.position.x, cube.position.y, CUBE_SIZES[level],
          cube.angle, level, t, flashAlpha, scale);
        if (isGameOver && flashAlpha > 0.5) {
          ctx.save();
          ctx.translate(cube.position.x, cube.position.y);
          ctx.scale(scale, scale);
          ctx.globalAlpha = (1 - flashAlpha) * 0.6;
          ctx.shadowColor = "#ff2222";
          ctx.shadowBlur = 20;
          ctx.fillStyle = "#ff2222";
          roundRect(ctx, -CUBE_SIZES[level], -CUBE_SIZES[level], CUBE_SIZES[level] * 2, CUBE_SIZES[level] * 2, CUBE_SIZES[level] * 0.14);
          ctx.fill();
          ctx.restore();
        }
      }

      drawSparks(ctx, dt);
      drawFloats(ctx, dt);

      if (g.phase === "playing") {
        // Ghost cube
        const s = CUBE_SIZES[g.currentLevel];
        const gx = Math.max(s + WALL_T + 2, Math.min(GW - s - WALL_T - 2, g.aimX));
        const gy = DROP_Y - s - 2;
        const gpulse = 0.5 + 0.5 * Math.sin(t * 5);
        ctx.save();
        ctx.globalAlpha = 0.45 + gpulse * 0.18;
        ctx.shadowColor = CUBE_GLOW[g.currentLevel];
        ctx.shadowBlur = 14;
        ctx.strokeStyle = CUBE_COLORS[g.currentLevel];
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t * 22;
        roundRect(ctx, gx - s, gy - s, s * 2, s * 2, Math.max(4, s * 0.14));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(8, Math.floor(s * 0.4))}px 'Courier New',monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowBlur = 8;
        ctx.fillText(CUBE_NAMES[g.currentLevel], gx, gy);
        ctx.restore();

        // Drop line
        ctx.save();
        ctx.strokeStyle = CUBE_COLORS[g.currentLevel];
        ctx.globalAlpha = 0.08 + gpulse * 0.06;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = t * 12;
        ctx.beginPath();
        ctx.moveTo(gx, DROP_Y);
        ctx.lineTo(gx, GH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        drawHUD(ctx, g, t);
      }

      // Screen flash overlay
      if (g.screenFlash > 0.005) {
        ctx.save();
        ctx.globalAlpha = g.screenFlash;
        ctx.fillStyle = g.screenFlashColor;
        ctx.fillRect(0, 0, GW, GH);
        ctx.restore();
      }

      ctx.restore();
      g.animFrame = requestAnimationFrame(loop);
    }

    g.animFrame = requestAnimationFrame(loop);
    return () => {
      if (gRef.current) {
        cancelAnimationFrame(gRef.current.animFrame);
        Matter.Engine.clear(gRef.current.engine);
        Matter.World.clear(gRef.current.engine.world, false);
      }
      gRef.current = null;
    };
  }, [setupCollisions, drawBg, drawCubeShape, drawTrail, drawSparks, drawFloats, drawHUD, getMergeScale, checkGameOver]);

  // ── Input handlers ────────────────────────────────────────────────────────────
  const updateAim = useCallback((clientX: number, canvas: HTMLCanvasElement) => {
    const g = gRef.current; if (!g || g.phase !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    g.aimX = (clientX - rect.left) * (GW / rect.width);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    updateAim(e.clientX, e.currentTarget);
  }, [updateAim]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gRef.current;
    if (!g) return;
    g.audio.resume();
    updateAim(e.clientX, e.currentTarget);
    if (g.phase === "playing") dropCube();
  }, [updateAim, dropCube]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    updateAim(e.touches[0].clientX, e.currentTarget);
  }, [updateAim]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const g = gRef.current; if (!g) return;
    g.audio.resume();
    updateAim(e.changedTouches[0].clientX, e.currentTarget);
    if (g.phase === "playing") dropCube();
  }, [updateAim, dropCube]);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "#030609",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden", position: "relative",
      fontFamily: "'Courier New',monospace",
    }}>
      <div style={{
        position: "relative",
        width: GW, height: GH,
        maxWidth: "95vw", maxHeight: "95vh",
        aspectRatio: `${GW}/${GH}`,
      }}>
        <canvas
          ref={canvasRef}
          width={GW} height={GH}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            width: "100%", height: "100%",
            display: "block",
            cursor: phase === "playing" ? "crosshair" : "default",
            borderRadius: 8,
            border: "1px solid rgba(0,229,255,0.2)",
            boxShadow: "0 0 50px rgba(0,229,255,0.12), 0 0 100px rgba(0,100,255,0.06)",
            touchAction: "none",
          }}
        />

        {phase === "start" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(3,6,9,0.93)", borderRadius: 8 }}>
            <StartScreen highScore={highScore} onStart={startGame} />
          </div>
        )}

        {phase === "gameover" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(3,6,9,0.88)", borderRadius: 8 }}>
            <GameOverScreen score={score} highScore={highScore} onRestart={startGame} />
          </div>
        )}

        {phase === "playing" && mergedLevel !== null && (
          <MergeFlash level={mergedLevel} />
        )}
      </div>

      <EvolutionGuide currentLevel={curLvl} score={score} />
    </div>
  );
}

// ─── MergeFlash overlay ───────────────────────────────────────────────────────
function MergeFlash({ level }: { level: number }) {
  return (
    <div style={{
      position: "absolute", inset: 0, borderRadius: 8,
      pointerEvents: "none",
      background: `radial-gradient(ellipse at center, ${CUBE_COLORS[level]}18 0%, transparent 70%)`,
      animation: "flashIn 0.5s ease-out forwards",
    }} />
  );
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function NeonBtn({ children, onClick, color = "#00e5ff" }: { children: React.ReactNode; onClick: () => void; color?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? `${color}14` : "transparent",
        border: `2px solid ${color}`,
        color,
        fontFamily: "'Courier New',monospace",
        fontWeight: "bold",
        fontSize: 16,
        padding: "12px 44px",
        cursor: "pointer",
        borderRadius: 4,
        boxShadow: hov ? `0 0 30px ${color}90` : `0 0 16px ${color}50`,
        textShadow: `0 0 10px ${color}`,
        letterSpacing: "0.1em",
        transition: "all 0.12s",
        outline: "none",
      }}
    >{children}</button>
  );
}

function StartScreen({ highScore, onStart }: { highScore: number; onStart: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: 28, textAlign: "center", width: "100%" }}>
      <div>
        <div style={{ color: "#00e5ff", fontSize: 13, letterSpacing: "0.25em", textShadow: "0 0 12px rgba(0,229,255,0.8)", marginBottom: 4 }}>
          ◈ QUANTUM ◈
        </div>
        <div style={{ color: "#ff00de", fontSize: 48, fontWeight: "bold", letterSpacing: "0.06em", lineHeight: 1, textShadow: "0 0 20px rgba(255,0,222,0.85), 0 0 40px rgba(255,0,222,0.4)" }}>
          MERGE
        </div>
      </div>

      <div style={{ background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.18)", borderRadius: 8, padding: "14px 22px", maxWidth: 270 }}>
        <p style={{ color: "#99bbdd", fontSize: 12, margin: 0, lineHeight: 1.7 }}>
          Drop cubes into the field.<br />
          <span style={{ color: "#ffe600" }}>Match identical cubes</span> to merge them<br />
          into higher quantum forms.<br />
          Aim for <span style={{ color: "#fff", textShadow: "0 0 8px #fff" }}>SINGULARITY</span>.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        {CUBE_NAMES.map((n, i) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 12, height: 12, background: CUBE_COLORS[i], borderRadius: 2, boxShadow: `0 0 8px ${CUBE_GLOW[i]}`, flexShrink: 0 }} />
            <span style={{ color: CUBE_COLORS[i], fontSize: 11, textShadow: `0 0 6px ${CUBE_COLORS[i]}` }}>{n}</span>
            {i < CUBE_NAMES.length - 1 && <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>→</span>}
          </div>
        ))}
      </div>

      {highScore > 0 && (
        <div style={{ color: "#ff00de", fontSize: 12, textShadow: "0 0 10px rgba(255,0,222,0.8)" }}>
          BEST: {highScore.toLocaleString()}
        </div>
      )}

      <NeonBtn onClick={onStart}>▶ INITIALIZE</NeonBtn>
      <div style={{ color: "rgba(80,120,160,0.5)", fontSize: 10 }}>CLICK / TAP TO DROP CUBES</div>
    </div>
  );
}

function GameOverScreen({ score, highScore, onRestart }: { score: number; highScore: number; onRestart: () => void }) {
  const isNew = score >= highScore && score > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 200); return () => clearTimeout(t); }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: 28, textAlign: "center",
      opacity: visible ? 1 : 0, transition: "opacity 0.4s",
    }}>
      <div style={{ color: "#ff3333", fontSize: 30, fontWeight: "bold", letterSpacing: "0.1em", textShadow: "0 0 20px rgba(255,50,50,0.9), 0 0 40px rgba(255,50,50,0.4)" }}>
        SYSTEM COLLAPSE
      </div>

      <div style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,50,50,0.25)", borderRadius: 8, padding: "18px 36px" }}>
        <div style={{ color: "rgba(120,160,200,0.65)", fontSize: 11, marginBottom: 6 }}>FINAL SCORE</div>
        <div style={{ color: "#00e5ff", fontSize: 40, fontWeight: "bold", textShadow: "0 0 18px rgba(0,229,255,0.85)", lineHeight: 1 }}>
          {score.toLocaleString()}
        </div>
        {isNew && (
          <div style={{ color: "#ffe600", fontSize: 13, fontWeight: "bold", textShadow: "0 0 12px rgba(255,230,0,0.9)", marginTop: 8 }}>
            ★ NEW RECORD ★
          </div>
        )}
        {!isNew && highScore > 0 && (
          <div style={{ color: "rgba(130,170,210,0.5)", fontSize: 11, marginTop: 8 }}>BEST: {highScore.toLocaleString()}</div>
        )}
      </div>

      <NeonBtn onClick={onRestart}>↺ REBOOT</NeonBtn>
    </div>
  );
}

function EvolutionGuide({ currentLevel, score }: { currentLevel: number; score: number }) {
  return (
    <div style={{
      position: "fixed", right: 10, top: "50%", transform: "translateY(-50%)",
      display: "flex", flexDirection: "column", gap: 5, pointerEvents: "none",
    }}>
      {CUBE_NAMES.map((name, i) => {
        const isActive = i === currentLevel;
        const done = i < currentLevel;
        return (
          <div key={name} style={{
            display: "flex", alignItems: "center", gap: 6,
            opacity: isActive ? 1 : done ? 0.65 : 0.22,
            transform: isActive ? "scale(1.08)" : "scale(1)",
            transition: "all 0.3s",
          }}>
            <div style={{
              width: 9, height: 9,
              background: CUBE_COLORS[i],
              boxShadow: isActive ? `0 0 12px ${CUBE_GLOW[i]}, 0 0 4px ${CUBE_COLORS[i]}` : "none",
              borderRadius: 1,
            }} />
            <span style={{
              color: CUBE_COLORS[i], fontSize: 9, whiteSpace: "nowrap",
              textShadow: isActive ? `0 0 8px ${CUBE_COLORS[i]}` : "none",
            }}>{name}</span>
          </div>
        );
      })}
    </div>
  );
}
