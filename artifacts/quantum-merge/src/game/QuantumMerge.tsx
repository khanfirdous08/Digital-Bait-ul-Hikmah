import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";
import { getAudio } from "./audio";
import { store } from "./store";
import { checkAchievements, onAchievementUnlocked, type AchievementDef } from "./achievements";
import {
  StartScreen, PauseMenu, SettingsPanel, AchievementsPanel,
  DailyRewardPopup, ContinueScreen, GameOverFinal,
  AchievementToast, Overlay,
} from "./overlays";

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
const CONTINUE_SECS = 5;

const LEVEL_DATA = [
  { score: 0,     gravity: 1.8, cooldown: 380 },
  { score: 400,   gravity: 1.9, cooldown: 360 },
  { score: 1000,  gravity: 2.0, cooldown: 340 },
  { score: 2200,  gravity: 2.1, cooldown: 320 },
  { score: 4000,  gravity: 2.2, cooldown: 305 },
  { score: 7000,  gravity: 2.3, cooldown: 290 },
  { score: 12000, gravity: 2.4, cooldown: 275 },
  { score: 20000, gravity: 2.5, cooldown: 260 },
  { score: 32000, gravity: 2.6, cooldown: 245 },
  { score: 50000, gravity: 2.8, cooldown: 225 },
];

function getLevel(score: number) {
  let lvl = 0;
  for (let i = 1; i < LEVEL_DATA.length; i++) {
    if (score >= LEVEL_DATA[i].score) lvl = i;
  }
  return lvl; // 0-based index
}

// ─── Types ────────────────────────────────────────────────────────────────────
type GamePhase = "start" | "daily" | "playing" | "continue" | "gameover";
type OverlayMode = "none" | "pause" | "settings" | "achievements";

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

interface GameState {
  engine: Matter.Engine;
  cubes: CubeBody[];
  sparks: Spark[];
  floatTexts: FloatText[];
  mergeAnims: MergeAnim[];
  aimX: number;
  curLevel: number;
  nxtLevel: number;
  canDrop: boolean;
  lastDropTime: number;
  score: number;
  combo: number;
  comboTimer: number;
  phase: GamePhase;
  paused: boolean;
  continueUsed: boolean;
  continueCountdown: number;
  gameLevel: number;
  shake: number; shakeX: number; shakeY: number;
  bgPulse: number; screenFlash: number; screenFlashColor: string;
  gameOverTimer: number; gameOverShake: number;
  levelUpFlash: number;
  animFrame: number;
  isMobile: boolean;
  maxSparks: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutElastic = (t: number) => t === 0 || t === 1 ? t :
  Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function pickLevel(): number {
  const r = Math.random();
  if (r < 0.44) return 0;
  if (r < 0.74) return 1;
  if (r < 0.88) return 2;
  if (r < 0.96) return 3;
  return 4;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function makeWall(x: number, y: number, w: number, h: number) {
  return Matter.Bodies.rectangle(x, y, w, h, {
    isStatic: true, label: "wall",
    restitution: 0.05, friction: 0.9,
    collisionFilter: { category: 0x0002, mask: 0x0001 },
  });
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function QuantumMerge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gRef = useRef<GameState | null>(null);

  const [phase, setPhase] = useState<GamePhase>("start");
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => store.get("highScore"));
  const [combo, setCombo] = useState(0);
  const [gameLevel, setGameLevel] = useState(1);
  const [nextLvl, setNextLvl] = useState(0);
  const [curLvl, setCurLvl] = useState(0);
  const [scale, setScale] = useState(1);
  const [settings, setSettings] = useState(() => store.get("settings"));
  const [toasts, setToasts] = useState<AchievementDef[]>([]);
  const [continueCountdown, setContinueCountdown] = useState(CONTINUE_SECS);
  const [dailyInfo, setDailyInfo] = useState<{ streak: number; coins: number } | null>(null);
  const [coins, setCoins] = useState(() => store.get("coins"));

  // ── Adaptive scaling ─────────────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const s = Math.min(window.innerWidth / GW, window.innerHeight / GH, 1.5);
      setScale(Math.max(0.4, s));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Achievement listener ──────────────────────────────────────────────────────
  useEffect(() => {
    return onAchievementUnlocked(({ def }) => {
      setToasts(prev => [...prev, def]);
      try { getAudio().playAchievement(); } catch {}
    });
  }, []);

  // ── ESC to pause ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const g = gRef.current;
        if (!g || g.phase !== "playing") return;
        g.paused = !g.paused;
        setOverlay(g.paused ? "pause" : "none");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Settings sync ─────────────────────────────────────────────────────────────
  const applySettings = useCallback((s: typeof settings) => {
    store.update(d => { d.settings = s; });
    setSettings(s);
    try {
      const audio = getAudio();
      audio.setMusicVol(s.musicOn ? 1 : 0);
      audio.setSfxVol(s.sfxOn ? 1 : 0);
    } catch {}
  }, []);

  // ── Spark spawner ─────────────────────────────────────────────────────────────
  const spawnFX = useCallback((x: number, y: number, level: number) => {
    const g = gRef.current; if (!g) return;
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW[level];
    const mobile = g.isMobile;
    const count = mobile ? 12 + level * 3 : 22 + level * 6;

    if (g.sparks.length > g.maxSparks) g.sparks.splice(0, g.sparks.length - g.maxSparks + 20);

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + rnd(-0.25, 0.25);
      const speed = rnd(3, 9 + level * 1.8);
      g.sparks.push({ type: "dot", x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, maxLife: rnd(0.4, 0.9 + level * 0.08), color, glow, size: rnd(2, 5 + level * 0.4) });
    }
    const rings = mobile ? 1 : 2 + Math.floor(level / 2);
    for (let ring = 0; ring < rings; ring++) {
      g.sparks.push({ type: "ring", x, y, vx: 0, vy: 0, life: 1, maxLife: 0.5 + ring * 0.12, color, glow, size: 0, radius: 0, maxRadius: CUBE_SIZES[level] * (1.8 + ring * 1.2) });
    }
    if (!mobile) {
      for (let i = 0; i < 8 + level * 2; i++) {
        const angle = rnd(0, Math.PI * 2);
        const speed = rnd(5, 15 + level * 2);
        g.sparks.push({ type: "line", x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, maxLife: rnd(0.2, 0.5), color, glow, size: rnd(1, 3), angle, length: rnd(6, 20 + level * 3) });
      }
    }
    for (let i = 0; i < (mobile ? 5 : 10); i++) {
      const angle = rnd(0, Math.PI * 2);
      g.sparks.push({ type: "dot", x: x + rnd(-12, 12), y: y + rnd(-12, 12), vx: Math.cos(angle) * rnd(1, 4), vy: Math.sin(angle) * rnd(1, 4) - 1, life: 1, maxLife: rnd(0.6, 1.2), color: "#fff", glow: "rgba(255,255,255,0.9)", size: rnd(1.5, 3.5) });
    }

    g.bgPulse = Math.min(g.bgPulse + 0.4 + level * 0.15, 1.5);
    g.screenFlash = Math.min(0.07 + level * 0.04, 0.35);
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
      restitution: 0.15, friction: 0.6, frictionAir: 0.018,
      density: 0.0015 + newLevel * 0.0003, label: "cube",
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

    spawnFX(mx, my, newLevel);

    const basePoints = CUBE_SCORES[newLevel];
    const comboMult = Math.max(1, g.combo);
    const points = basePoints * comboMult;
    g.score += points;
    g.combo = Math.min(g.combo + 1, 12);
    g.comboTimer = 2.8;

    const shakeBase = 5 + newLevel * 3;
    g.shake = Math.min(shakeBase * (g.combo > 3 ? 1.5 : 1), 24);

    if (g.combo > 1) {
      addFloat(mx, my - 30, `+${points.toLocaleString()}`, CUBE_COLORS[newLevel], true);
      addFloat(mx, my - 56, `⚡ x${g.combo} COMBO`, "#ffe600", false);
      if (settings.sfxOn) getAudio().playCombo(g.combo);
    } else {
      addFloat(mx, my - 24, `+${points.toLocaleString()}`, CUBE_COLORS[newLevel]);
    }
    if (settings.sfxOn) getAudio().playMerge(newLevel);

    // Level progression
    const newGameLevel = getLevel(g.score);
    if (newGameLevel > g.gameLevel) {
      g.gameLevel = newGameLevel;
      const ld = LEVEL_DATA[newGameLevel];
      g.engine.gravity.y = ld.gravity;
      g.levelUpFlash = 1.0;
      addFloat(GW / 2, GH / 2 - 60, `LEVEL ${newGameLevel + 1}`, "#ffe600", true);
      setGameLevel(newGameLevel + 1);
    }

    // Achievements
    checkAchievements({ merged: true, mergedLevel: newLevel, combo: g.combo, score: g.score });

    // Update React state
    const hs = store.get("highScore");
    if (g.score > hs) {
      store.update(d => { d.highScore = g.score; d.maxLevelReached = Math.max(d.maxLevelReached, newLevel); });
      setHighScore(g.score);
    }
    setScore(g.score);
    setCombo(g.combo);
  }, [spawnFX, addFloat, settings.sfxOn]);

  // ── Collision setup ───────────────────────────────────────────────────────────
  const setupCollisions = useCallback((engine: Matter.Engine) => {
    Matter.Events.on(engine, "collisionStart", (event) => {
      const g = gRef.current;
      if (!g || g.phase !== "playing" || g.paused) return;
      const now = performance.now();
      for (const pair of event.pairs) {
        const a = pair.bodyA as CubeBody;
        const b = pair.bodyB as CubeBody;
        if (
          a.label === "cube" && b.label === "cube" &&
          a.cubeLevel === b.cubeLevel &&
          !a.merging && !b.merging &&
          a.cubeLevel !== undefined && a.cubeLevel < MAX_LEVEL &&
          (now - (a.spawnTime ?? 0)) > 250 && (now - (b.spawnTime ?? 0)) > 250
        ) {
          a.merging = true; b.merging = true;
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
    if (!g || !g.canDrop || g.phase !== "playing" || g.paused) return;
    const now = performance.now();
    const cooldown = LEVEL_DATA[g.gameLevel]?.cooldown ?? 380;
    if (now - g.lastDropTime < cooldown) return;

    const level = g.curLevel;
    const size = CUBE_SIZES[level];
    const x = Math.max(size + WALL_T + 2, Math.min(GW - size - WALL_T - 2, g.aimX));

    const cube = Matter.Bodies.rectangle(x, DROP_Y - size - 2, size * 2, size * 2, {
      restitution: 0.15, friction: 0.6, frictionAir: 0.018, density: 0.0015, label: "cube",
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
    if (settings.sfxOn) getAudio().playDrop(level);
    setTimeout(() => { if (gRef.current) gRef.current.canDrop = true; }, 200);
    g.curLevel = g.nxtLevel;
    g.nxtLevel = pickLevel();
    setCurLvl(g.curLevel);
    setNextLvl(g.nxtLevel);
  }, [settings.sfxOn]);

  // ── Game over trigger ─────────────────────────────────────────────────────────
  const triggerGameOver = useCallback(() => {
    const g = gRef.current; if (!g) return;
    g.phase = "continue";
    g.continueCountdown = CONTINUE_SECS;
    g.gameOverTimer = 0;
    g.gameOverShake = 28;
    if (settings.sfxOn) getAudio().playGameOver();
    setPhase("continue");
    setContinueCountdown(CONTINUE_SECS);

    store.update(d => {
      d.totalGames++;
      if (g.score > d.highScore) d.highScore = g.score;
    });
    checkAchievements({ games: store.get("totalGames") });
    setHighScore(store.get("highScore"));
  }, [settings.sfxOn]);

  const checkGameOver = useCallback(() => {
    const g = gRef.current;
    if (!g || g.phase !== "playing" || g.paused) return;
    const now = performance.now();
    for (const cube of g.cubes) {
      if ((now - (cube.spawnTime ?? 0)) < 900) continue;
      if (cube.position.y - CUBE_SIZES[cube.cubeLevel ?? 0] < GAMEOVER_Y) {
        triggerGameOver();
        return;
      }
    }
  }, [triggerGameOver]);

  // ── Continue mechanic ────────────────────────────────────────────────────────
  const doContinue = useCallback(() => {
    const g = gRef.current; if (!g || g.continueUsed) return;
    g.continueUsed = true;
    // Remove cubes in top 40% of play area
    const cutoff = GH * 0.4;
    const toRemove = g.cubes.filter(c => c.position.y - CUBE_SIZES[c.cubeLevel ?? 0] < cutoff);
    for (const c of toRemove) {
      spawnFX(c.position.x, c.position.y, c.cubeLevel ?? 0);
      Matter.World.remove(g.engine.world, c);
    }
    g.cubes = g.cubes.filter(c => !toRemove.includes(c));
    g.phase = "playing";
    g.shake = 0;
    setPhase("playing");
  }, [spawnFX]);

  const endGame = useCallback(() => {
    const g = gRef.current; if (!g) return;
    g.phase = "gameover";
    setPhase("gameover");
  }, []);

  // ── Start / restart ───────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const g = gRef.current; if (!g) return;
    getAudio().resume();
    if (settings.musicOn) getAudio().startMusic();
    else getAudio().stopMusic();

    for (const cube of g.cubes) Matter.World.remove(g.engine.world, cube);
    g.cubes = []; g.sparks = []; g.floatTexts = []; g.mergeAnims = [];
    g.score = 0; g.combo = 0; g.comboTimer = 0;
    g.phase = "playing"; g.paused = false;
    g.continueUsed = false; g.continueCountdown = CONTINUE_SECS;
    g.canDrop = true; g.lastDropTime = 0;
    g.shake = 0; g.bgPulse = 0; g.screenFlash = 0;
    g.gameOverTimer = 0; g.gameOverShake = 0; g.levelUpFlash = 0;
    g.gameLevel = 0;
    g.engine.gravity.y = LEVEL_DATA[0].gravity;
    g.curLevel = pickLevel(); g.nxtLevel = pickLevel();
    g.aimX = GW / 2;

    setPhase("playing"); setOverlay("none");
    setScore(0); setCombo(0); setGameLevel(1);
    setCurLvl(g.curLevel); setNextLvl(g.nxtLevel);
  }, [settings.musicOn]);

  // ── Drawing ───────────────────────────────────────────────────────────────────
  const drawBg = useCallback((ctx: CanvasRenderingContext2D, t: number, bgPulse: number) => {
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, GW, GH);

    const gridSize = 38;
    const scroll = (t * 18) % gridSize;
    const alpha = 0.05 + bgPulse * 0.1;
    ctx.strokeStyle = `rgba(0,140,255,${alpha})`;
    ctx.lineWidth = 1;
    for (let x = (scroll % gridSize) - gridSize; x < GW + gridSize; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GH); ctx.stroke();
    }
    for (let y = scroll - gridSize; y < GH + gridSize; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GW, y); ctx.stroke();
    }

    for (let y = 0; y < GH; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.022 + 0.006 * Math.sin(y * 0.15 + t * 1.5)})`;
      ctx.fillRect(0, y, GW, 1);
    }

    const ambients = ["rgba(0,229,255", "rgba(255,0,222", "rgba(0,255,140"];
    for (let i = 0; i < 3; i++) {
      const gx = GW * (0.25 + i * 0.25);
      const gy = GH * (0.5 + 0.3 * Math.sin(t * 0.4 + i * 2.1));
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 80 + bgPulse * 40);
      const a = (0.03 + bgPulse * 0.06).toFixed(3);
      gr.addColorStop(0, `${ambients[i]},${a})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, GW, GH);
    }
  }, []);

  const drawCube = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number,
    level: number, t: number, alpha = 1, scale = 1, isMobile = false) => {
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW[level];
    const r = Math.max(4, s * 0.14);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.8 + level * 1.3);
    const isRainbow = level === MAX_LEVEL;
    const shadowCap = isMobile ? 10 : 30;

    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale); ctx.globalAlpha = alpha;

    ctx.shadowColor = isRainbow ? `hsl(${(t * 55) % 360},100%,65%)` : glow;
    ctx.shadowBlur = Math.min(22 + pulse * 14, shadowCap);

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
    roundRect(ctx, -s, -s, s * 2, s * 2, r); ctx.fill();

    ctx.strokeStyle = isRainbow ? `hsl(${((t * 55) + 180) % 360},100%,80%)` : color;
    ctx.lineWidth = 1.5 + pulse * 0.6;
    ctx.shadowBlur = Math.min(12 + pulse * 8, shadowCap * 0.6);
    roundRect(ctx, -s, -s, s * 2, s * 2, r); ctx.stroke();

    ctx.shadowBlur = 0;
    const ig = ctx.createLinearGradient(-s * 0.6, -s * 0.6, s * 0.3, s * 0.3);
    ig.addColorStop(0, "rgba(255,255,255,0.26)");
    ig.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = ig;
    roundRect(ctx, -s * 0.62, -s * 0.62, s * 1.24, s * 1.24, r * 0.6); ctx.fill();

    ctx.shadowColor = isRainbow ? "#fff" : glow;
    ctx.shadowBlur = Math.min(6 + pulse * 4, 12);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, Math.floor(s * 0.4))}px 'Courier New',monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(CUBE_NAMES[level], 0, 0);
    ctx.restore();
  }, []);

  const drawTrail = useCallback((ctx: CanvasRenderingContext2D, cube: CubeBody, dt: number, isMobile: boolean) => {
    if (isMobile || !cube.trail) return;
    const speed = Math.sqrt(cube.velocity.x ** 2 + cube.velocity.y ** 2);
    const lastX = cube.lastTrailX ?? cube.position.x;
    const lastY = cube.lastTrailY ?? cube.position.y;
    if (speed > 2 && (Math.abs(cube.position.x - lastX) > 3 || Math.abs(cube.position.y - lastY) > 3)) {
      cube.trail.push({ x: cube.position.x, y: cube.position.y, life: 1 });
      cube.lastTrailX = cube.position.x;
      cube.lastTrailY = cube.position.y;
    }
    if (cube.trail.length > 10) cube.trail.shift();
    const level = cube.cubeLevel ?? 0;
    const color = CUBE_COLORS[level];
    const size = CUBE_SIZES[level];
    cube.trail.forEach((pt, i) => {
      pt.life = Math.max(0, pt.life - dt * 3);
      const alpha = pt.life * 0.22 * (i / cube.trail!.length);
      if (alpha < 0.01) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color; ctx.shadowBlur = 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size * 0.3 * pt.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    cube.trail = cube.trail.filter(p => p.life > 0);
  }, []);

  const drawSparks = useCallback((ctx: CanvasRenderingContext2D, dt: number, isMobile: boolean) => {
    const g = gRef.current; if (!g) return;
    const shadowCap = isMobile ? 8 : 14;
    const kept: Spark[] = [];
    for (const sp of g.sparks) {
      sp.life -= dt / sp.maxLife;
      if (sp.life <= 0) continue;
      kept.push(sp);
      const a = Math.max(0, sp.life);
      ctx.save(); ctx.globalAlpha = a;
      if (sp.type === "ring") {
        const prog = 1 - sp.life;
        const r = (sp.maxRadius ?? 60) * prog;
        ctx.shadowColor = sp.glow; ctx.shadowBlur = shadowCap;
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = (1 - prog) * 4 + 0.5;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (sp.type === "line") {
        sp.x += sp.vx; sp.y += sp.vy;
        sp.vx *= 0.88; sp.vy *= 0.88; sp.vy += 0.1;
        const len = (sp.length ?? 10) * sp.life;
        ctx.shadowColor = sp.glow; ctx.shadowBlur = shadowCap * 0.6;
        ctx.strokeStyle = sp.color; ctx.lineWidth = sp.size * sp.life;
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - Math.cos(sp.angle ?? 0) * len, sp.y - Math.sin(sp.angle ?? 0) * len);
        ctx.stroke();
      } else {
        sp.x += sp.vx; sp.y += sp.vy;
        sp.vy += 0.12; sp.vx *= 0.97;
        ctx.shadowColor = sp.glow; ctx.shadowBlur = shadowCap;
        ctx.fillStyle = sp.color;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.size * Math.max(0.1, sp.life), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    g.sparks = kept;
  }, []);

  const drawFloats = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const g = gRef.current; if (!g) return;
    const kept: FloatText[] = [];
    for (const ft of g.floatTexts) {
      ft.life -= dt / ft.maxLife;
      if (ft.life <= 0) continue;
      kept.push(ft);
      ft.y += ft.vy;
      const a = ft.life < 0.3 ? ft.life / 0.3 : 1;
      const sc = ft.scale * (ft.life > 0.85 ? easeOutBack(1 - (ft.life - 0.85) / 0.15) : 1);
      ctx.save();
      ctx.globalAlpha = a; ctx.translate(ft.x, ft.y); ctx.scale(sc, sc);
      ctx.shadowColor = ft.color; ctx.shadowBlur = 14;
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.scale > 1 ? 16 : 13}px 'Courier New',monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }
    g.floatTexts = kept;
  }, []);

  const getMergeScale = useCallback((id: number, anims: MergeAnim[], now: number) => {
    const anim = anims.find(a => a.id === id);
    if (!anim) return 1;
    const t = (now - anim.startTime) / 380;
    return t >= 1 ? 1 : easeOutElastic(t);
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, g: GameState, t: number) => {
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.5);

    // Drop zone
    ctx.save();
    ctx.fillStyle = "rgba(0,229,255,0.04)"; ctx.fillRect(0, 0, GW, DROP_Y);
    ctx.strokeStyle = "rgba(0,229,255,0.42)"; ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 5]); ctx.lineDashOffset = -t * 18;
    ctx.beginPath(); ctx.moveTo(0, DROP_Y); ctx.lineTo(GW, DROP_Y); ctx.stroke();
    ctx.setLineDash([]);

    // Danger zone
    ctx.fillStyle = `rgba(255,40,40,${0.05 + pulse * 0.04})`; ctx.fillRect(0, 0, GW, GAMEOVER_Y);
    ctx.strokeStyle = `rgba(255,60,60,${0.45 + pulse * 0.3})`; ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t * 28;
    ctx.beginPath(); ctx.moveTo(0, GAMEOVER_Y); ctx.lineTo(GW, GAMEOVER_Y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,80,80,${0.5 + pulse * 0.3})`;
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText("⚠ DANGER", 6, GAMEOVER_Y - 2);
    ctx.restore();

    // Score / best panel
    ctx.save();
    ctx.fillStyle = "rgba(5,8,20,0.78)";
    roundRect(ctx, 0, 0, GW, 52, 0); ctx.fill();

    ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#00e5ff";
    ctx.font = "bold 9px 'Courier New',monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("SCORE", 12, 7);
    ctx.fillStyle = "#fff"; ctx.shadowBlur = 8;
    ctx.font = "bold 24px 'Courier New',monospace";
    ctx.fillText(g.score.toLocaleString(), 12, 20);

    ctx.shadowColor = "#ff00de"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff00de";
    ctx.font = "bold 9px 'Courier New',monospace";
    ctx.textAlign = "right";
    ctx.fillText("BEST", GW - 12, 7);
    ctx.fillStyle = "#fff"; ctx.shadowBlur = 8;
    ctx.font = "bold 20px 'Courier New',monospace";
    ctx.fillText(Math.max(g.score, store.get("highScore")).toLocaleString(), GW - 12, 20);

    // Combo bar
    if (g.combo > 1) {
      const cb = g.comboTimer / 2.8;
      ctx.shadowColor = "#ffe600"; ctx.shadowBlur = 20;
      ctx.fillStyle = "#ffe600";
      ctx.font = `bold ${11 + Math.min(g.combo, 6)}px 'Courier New',monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`⚡ x${g.combo} COMBO`, GW / 2, 10);
      ctx.shadowBlur = 4;
      const bw = 90, bh = 4, bx = GW / 2 - bw / 2, by = 30;
      ctx.fillStyle = "rgba(255,230,0,0.12)";
      roundRect(ctx, bx, by, bw, bh, 2); ctx.fill();
      ctx.fillStyle = `rgba(255,230,0,${0.6 + pulse * 0.3})`;
      roundRect(ctx, bx, by, bw * cb, bh, 2); ctx.fill();
    }
    ctx.restore();

    // Level badge (bottom left)
    ctx.save();
    const lv = g.gameLevel + 1;
    ctx.fillStyle = "rgba(5,8,20,0.7)";
    roundRect(ctx, 8, GH - 44, 62, 36, 6); ctx.fill();
    ctx.strokeStyle = "rgba(255,230,0,0.25)"; ctx.lineWidth = 1;
    roundRect(ctx, 8, GH - 44, 62, 36, 6); ctx.stroke();
    ctx.shadowColor = "#ffe600"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#ffe600";
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("LEVEL", 39, GH - 40);
    ctx.font = "bold 18px 'Courier New',monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(String(lv), 39, GH - 20);
    ctx.restore();

    // Pause button (bottom right)
    ctx.save();
    ctx.fillStyle = "rgba(5,8,20,0.6)";
    roundRect(ctx, GW - 44, GH - 44, 36, 36, 6); ctx.fill();
    ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(0,229,255,0.7)";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⏸", GW - 26, GH - 26);
    ctx.restore();

    // Next cube preview
    const nx = GW - 34, ny = DROP_Y + 32;
    ctx.save();
    ctx.fillStyle = "rgba(5,8,20,0.7)";
    roundRect(ctx, nx - 30, ny - 32, 60, 68, 6); ctx.fill();
    ctx.strokeStyle = "rgba(0,229,255,0.2)"; ctx.lineWidth = 1;
    roundRect(ctx, nx - 30, ny - 32, 60, 68, 6); ctx.stroke();
    ctx.fillStyle = "rgba(0,229,255,0.5)";
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("NEXT", nx, ny - 28);
    const ns = Math.min(CUBE_SIZES[g.nxtLevel], 20);
    drawCube(ctx, nx, ny + 10, ns, 0, g.nxtLevel, t, 1, 1, false);
    ctx.restore();
  }, [drawCube]);

  // ── Main effect (engine + loop) ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const isMobile = window.innerWidth < 600 || "ontouchstart" in window;
    const maxSparks = isMobile ? 100 : 220;

    const engine = Matter.Engine.create({
      gravity: { y: LEVEL_DATA[0].gravity },
      positionIterations: isMobile ? 6 : 8,
      velocityIterations: isMobile ? 4 : 6,
    });
    const wt = WALL_T;
    Matter.World.add(engine.world, [
      makeWall(GW / 2, GH + wt / 2, GW + wt * 2, wt),
      makeWall(-wt / 2, GH / 2, wt, GH * 3),
      makeWall(GW + wt / 2, GH / 2, wt, GH * 3),
    ]);

    const initLvl = pickLevel();
    const g: GameState = {
      engine, isMobile, maxSparks,
      cubes: [], sparks: [], floatTexts: [], mergeAnims: [],
      aimX: GW / 2, curLevel: initLvl, nxtLevel: pickLevel(),
      canDrop: true, lastDropTime: 0,
      score: 0, combo: 0, comboTimer: 0,
      phase: "start", paused: false,
      continueUsed: false, continueCountdown: CONTINUE_SECS,
      gameLevel: 0,
      shake: 0, shakeX: 0, shakeY: 0,
      bgPulse: 0, screenFlash: 0, screenFlashColor: "#fff",
      gameOverTimer: 0, gameOverShake: 0, levelUpFlash: 0,
      animFrame: 0,
    };
    gRef.current = g;
    setupCollisions(engine);
    setCurLvl(initLvl); setNextLvl(g.nxtLevel);

    // Check daily reward on mount
    const daily = store.checkDailyReward();
    if (daily.eligible) {
      setDailyInfo({ streak: daily.streak, coins: daily.coins });
      setCoins(store.get("coins"));
      setPhase("daily");
    }

    const FIXED_DT = 1000 / 60;
    let lastTime = performance.now();
    let accumulator = 0;

    function loop(now: number) {
      const elapsed = Math.min(now - lastTime, 50);
      lastTime = now;
      const t = now / 1000;
      const g = gRef.current; if (!g) return;
      const ctx = canvas!.getContext("2d"); if (!ctx) return;
      const dt = elapsed / 1000;

      // Physics (skip when paused)
      if (!g.paused) {
        accumulator += elapsed;
        while (accumulator >= FIXED_DT) {
          Matter.Engine.update(g.engine, FIXED_DT);
          accumulator -= FIXED_DT;
        }
      }

      // Game logic
      if (g.phase === "playing" && !g.paused) {
        if (g.comboTimer > 0) {
          g.comboTimer -= dt;
          if (g.comboTimer <= 0) { g.combo = 0; setCombo(0); }
        }
        checkGameOver();
      }

      if (g.phase === "continue") {
        g.continueCountdown -= dt;
        setContinueCountdown(g.continueCountdown);
        if (g.continueCountdown <= 0) endGame();
      }

      // Screen shake
      if (g.shake > 0 || g.gameOverShake > 0) {
        const si = Math.max(g.shake, g.gameOverShake);
        g.shakeX = rnd(-si, si); g.shakeY = rnd(-si * 0.6, si * 0.6);
        g.shake = lerp(g.shake, 0, 0.22);
        g.gameOverShake = lerp(g.gameOverShake, 0, 0.1);
        if (g.shake < 0.2) g.shake = 0;
        if (g.gameOverShake < 0.3) g.gameOverShake = 0;
      } else { g.shakeX = 0; g.shakeY = 0; }

      g.bgPulse = lerp(g.bgPulse, 0, 0.04);
      g.screenFlash = lerp(g.screenFlash, 0, 0.12);
      g.levelUpFlash = lerp(g.levelUpFlash, 0, 0.05);
      const now2 = performance.now();
      g.mergeAnims = g.mergeAnims.filter(a => now2 - a.startTime < 600);

      // ── Render ────────────────────────────────────────────────────────────────
      canvas!.width = GW; canvas!.height = GH;
      ctx.save();
      ctx.translate(g.shakeX, g.shakeY);

      drawBg(ctx, t, g.bgPulse);

      // Trails
      for (const cube of g.cubes) drawTrail(ctx, cube, dt, g.isMobile);

      // Cubes
      const isGO = g.phase === "continue" || g.phase === "gameover";
      for (const cube of g.cubes) {
        const ms = getMergeScale(cube.id, g.mergeAnims, now2);
        const level = cube.cubeLevel ?? 0;
        const flashAlpha = isGO ? (0.5 + 0.5 * Math.sin(g.gameOverTimer * 18)) : 1;
        g.gameOverTimer += dt * (isGO ? 1 : 0);
        drawCube(ctx, cube.position.x, cube.position.y, CUBE_SIZES[level], cube.angle, level, t, flashAlpha, ms, g.isMobile);
        if (isGO && flashAlpha > 0.5) {
          ctx.save();
          ctx.translate(cube.position.x, cube.position.y); ctx.scale(ms, ms);
          ctx.globalAlpha = (1 - flashAlpha) * 0.6;
          ctx.shadowColor = "#ff2222"; ctx.shadowBlur = 18;
          ctx.fillStyle = "#ff2222";
          roundRect(ctx, -CUBE_SIZES[level], -CUBE_SIZES[level], CUBE_SIZES[level] * 2, CUBE_SIZES[level] * 2, CUBE_SIZES[level] * 0.14);
          ctx.fill();
          ctx.restore();
        }
      }

      drawSparks(ctx, dt, g.isMobile);
      drawFloats(ctx, dt);

      // Ghost + drop line + HUD
      if (g.phase === "playing" && !g.paused) {
        const s = CUBE_SIZES[g.curLevel];
        const gx = Math.max(s + WALL_T + 2, Math.min(GW - s - WALL_T - 2, g.aimX));
        const gy = DROP_Y - s - 2;
        const gpulse = 0.5 + 0.5 * Math.sin(t * 5);

        ctx.save();
        ctx.globalAlpha = 0.42 + gpulse * 0.18;
        ctx.shadowColor = CUBE_GLOW[g.curLevel]; ctx.shadowBlur = 14;
        ctx.strokeStyle = CUBE_COLORS[g.curLevel]; ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 22;
        roundRect(ctx, gx - s, gy - s, s * 2, s * 2, Math.max(4, s * 0.14)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(8, Math.floor(s * 0.4))}px 'Courier New',monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.shadowBlur = 8;
        ctx.fillText(CUBE_NAMES[g.curLevel], gx, gy);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = CUBE_COLORS[g.curLevel];
        ctx.globalAlpha = 0.07 + gpulse * 0.05; ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]); ctx.lineDashOffset = t * 12;
        ctx.beginPath(); ctx.moveTo(gx, DROP_Y); ctx.lineTo(gx, GH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        drawHUD(ctx, g, t);
      }

      // Level up flash overlay
      if (g.levelUpFlash > 0.01) {
        ctx.save();
        ctx.globalAlpha = g.levelUpFlash * 0.18;
        ctx.fillStyle = "#ffe600";
        ctx.fillRect(0, 0, GW, GH);
        ctx.restore();
      }

      // Screen flash
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
        try { getAudio().stopMusic(); } catch {}
      }
      gRef.current = null;
    };
  }, [setupCollisions, drawBg, drawCube, drawTrail, drawSparks, drawFloats, drawHUD, getMergeScale, checkGameOver, endGame]);

  // ── Input ─────────────────────────────────────────────────────────────────────
  const updateAim = useCallback((clientX: number) => {
    const g = gRef.current; if (!g || g.phase !== "playing" || g.paused) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    g.aimX = (clientX - rect.left) * (GW / rect.width);
  }, []);

  const handlePauseBtn = useCallback((clientX: number, clientY: number) => {
    const g = gRef.current;
    if (!g || g.phase !== "playing" || g.paused) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const gx = (clientX - rect.left) * (GW / rect.width);
    const gy = (clientY - rect.top) * (GH / rect.height);
    // Pause button region: bottom-right (GW-44 to GW-8, GH-44 to GH-8)
    if (gx >= GW - 46 && gx <= GW - 8 && gy >= GH - 46 && gy <= GH - 8) {
      g.paused = true;
      setOverlay("pause");
      return true;
    }
    return false;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gRef.current; if (!g) return;
    getAudio().resume();
    if (handlePauseBtn(e.clientX, e.clientY)) return;
    updateAim(e.clientX);
    if (g.phase === "playing" && !g.paused) dropCube();
  }, [updateAim, dropCube, handlePauseBtn]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    updateAim(e.clientX);
  }, [updateAim]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    updateAim(e.touches[0].clientX);
  }, [updateAim]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const g = gRef.current; if (!g) return;
    getAudio().resume();
    const touch = e.changedTouches[0];
    if (handlePauseBtn(touch.clientX, touch.clientY)) return;
    updateAim(touch.clientX);
    if (g.phase === "playing" && !g.paused) dropCube();
  }, [updateAim, dropCube, handlePauseBtn]);

  // ── Overlay actions ───────────────────────────────────────────────────────────
  const resume = useCallback(() => {
    const g = gRef.current; if (!g) return;
    g.paused = false;
    setOverlay("none");
  }, []);

  const restartFromPause = useCallback(() => {
    setOverlay("none");
    startGame();
  }, [startGame]);

  const showSettings = useCallback(() => setOverlay("settings"), []);
  const showAchievements = useCallback(() => setOverlay("achievements"), []);
  const backFromSettings = useCallback(() => setOverlay(phase === "start" ? "none" : "pause"), [phase]);
  const backFromAchievements = useCallback(() => setOverlay(phase === "start" ? "none" : "pause"), [phase]);

  const handleSettingsChange = useCallback((s: typeof settings) => {
    applySettings(s);
    if (gRef.current?.phase === "playing") {
      if (s.musicOn) getAudio().startMusic();
      else getAudio().stopMusic();
    }
  }, [applySettings]);

  const handleStartSettings = useCallback(() => setOverlay("settings"), []);
  const handleStartAchievements = useCallback(() => setOverlay("achievements"), []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#030609",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      {/* Game container — fixed game-pixel size, scaled by CSS */}
      <div style={{
        position: "relative",
        width: GW, height: GH,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        flexShrink: 0,
      }}>
        <canvas
          ref={canvasRef}
          width={GW} height={GH}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            width: GW, height: GH,
            display: "block",
            cursor: phase === "playing" ? "crosshair" : "default",
            borderRadius: 8,
            border: "1px solid rgba(0,229,255,0.18)",
            boxShadow: "0 0 60px rgba(0,229,255,0.1), 0 0 120px rgba(0,100,255,0.05)",
            touchAction: "none",
          }}
        />

        {/* Overlays */}
        {phase === "daily" && (
          <Overlay>
            <DailyRewardPopup
              streak={dailyInfo?.streak ?? 1}
              coins={dailyInfo?.coins ?? 50}
              onClaim={() => {
                try { getAudio().playDailyReward(); } catch {}
                setPhase("start");
              }}
            />
          </Overlay>
        )}

        {phase === "start" && overlay === "none" && (
          <Overlay>
            <StartScreen
              highScore={highScore} coins={coins}
              onStart={startGame}
              onSettings={handleStartSettings}
              onAchievements={handleStartAchievements}
            />
          </Overlay>
        )}

        {phase === "continue" && overlay === "none" && (
          <Overlay>
            <ContinueScreen
              countdown={continueCountdown}
              onContinue={doContinue}
              onEnd={endGame}
            />
          </Overlay>
        )}

        {phase === "gameover" && overlay === "none" && (
          <Overlay>
            <GameOverFinal
              score={score} highScore={highScore}
              onRestart={startGame}
              onAchievements={showAchievements}
            />
          </Overlay>
        )}

        {overlay === "pause" && (
          <Overlay>
            <PauseMenu
              onResume={resume}
              onRestart={restartFromPause}
              onSettings={showSettings}
              onAchievements={showAchievements}
            />
          </Overlay>
        )}

        {overlay === "settings" && (
          <Overlay>
            <SettingsPanel settings={settings} onChange={handleSettingsChange} onBack={backFromSettings} />
          </Overlay>
        )}

        {overlay === "achievements" && (
          <Overlay>
            <AchievementsPanel onBack={backFromAchievements} />
          </Overlay>
        )}

        {/* Achievement toasts */}
        {toasts.length > 0 && (
          <AchievementToast def={toasts[0]} onDone={() => setToasts(prev => prev.slice(1))} />
        )}

        {/* Evolution guide sidebar */}
        <div style={{
          position: "absolute", right: -72, top: "50%",
          transform: "translateY(-50%)",
          display: "flex", flexDirection: "column", gap: 5,
          pointerEvents: "none",
        }}>
          {CUBE_NAMES.map((name, i) => {
            const isActive = i === curLvl;
            const done = i < curLvl;
            return (
              <div key={name} style={{
                display: "flex", alignItems: "center", gap: 6,
                opacity: isActive ? 1 : done ? 0.65 : 0.22,
                transform: isActive ? "scale(1.08)" : "scale(1)",
                transition: "all 0.3s",
              }}>
                <div style={{
                  width: 9, height: 9, background: CUBE_COLORS[i], borderRadius: 1,
                  boxShadow: isActive ? `0 0 10px ${CUBE_GLOW[i]}` : "none",
                }} />
                <span style={{ color: CUBE_COLORS[i], fontSize: 9, whiteSpace: "nowrap", fontFamily: "'Courier New',monospace", textShadow: isActive ? `0 0 6px ${CUBE_COLORS[i]}` : "none" }}>{name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
