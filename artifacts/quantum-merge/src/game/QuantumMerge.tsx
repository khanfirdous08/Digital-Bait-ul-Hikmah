import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";

const CUBE_NAMES = ["Spark", "Pulse", "Nova", "Plasma", "Quantum", "Singularity"];
const CUBE_COLORS = ["#00e5ff", "#ff00de", "#ffe600", "#ff6a00", "#00ff8c", "#ffffff"];
const CUBE_GLOW_COLORS = [
  "rgba(0,229,255,0.9)",
  "rgba(255,0,222,0.9)",
  "rgba(255,230,0,0.9)",
  "rgba(255,106,0,0.9)",
  "rgba(0,255,140,0.9)",
  "rgba(255,255,255,1.0)",
];
const CUBE_SIZES = [22, 30, 40, 52, 65, 82];
const CUBE_SCORES = [10, 30, 100, 300, 1000, 5000];
const MAX_LEVEL = 5;

const WALL_THICKNESS = 20;
const DROP_ZONE_HEIGHT = 80;
const GAME_OVER_Y = DROP_ZONE_HEIGHT + 20;
const GAME_CONTAINER_WIDTH = 380;
const GAME_CONTAINER_HEIGHT = 620;

type GamePhase = "start" | "playing" | "gameover";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  glow: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  vy: number;
}

interface CubeBody extends Matter.Body {
  cubeLevel?: number;
  merging?: boolean;
  spawnTime?: number;
}

function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getNextCubeLevel(): number {
  const r = Math.random();
  if (r < 0.45) return 0;
  if (r < 0.75) return 1;
  if (r < 0.88) return 2;
  if (r < 0.96) return 3;
  return 4;
}

export default function QuantumMerge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<{
    engine: Matter.Engine;
    cubes: CubeBody[];
    particles: Particle[];
    floatTexts: FloatText[];
    pendingMerges: Set<number>;
    aimX: number;
    currentCubeLevel: number;
    nextCubeLevel: number;
    canDrop: boolean;
    lastDropTime: number;
    score: number;
    highScore: number;
    combo: number;
    comboTimer: number;
    phase: GamePhase;
    shakeIntensity: number;
    shakeX: number;
    shakeY: number;
    bgOffset: number;
    animFrame: number;
    lastTime: number;
  } | null>(null);

  const [phase, setPhase] = useState<GamePhase>("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try { return parseInt(localStorage.getItem("qm_highscore") || "0"); } catch { return 0; }
  });
  const [combo, setCombo] = useState(0);
  const [nextLevel, setNextLevel] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);

  const spawnParticles = useCallback((x: number, y: number, level: number, count = 18) => {
    const g = gameRef.current;
    if (!g) return;
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW_COLORS[level];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + randomRange(-0.3, 0.3);
      const speed = randomRange(2, 7);
      g.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: randomRange(0.4, 0.9),
        color,
        glow,
        size: randomRange(2, 5),
      });
    }
    for (let i = 0; i < 6; i++) {
      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(0.5, 2.5);
      g.particles.push({
        x: x + randomRange(-20, 20),
        y: y + randomRange(-20, 20),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: randomRange(0.8, 1.5),
        color: "#ffffff",
        glow: "rgba(255,255,255,0.8)",
        size: randomRange(1, 3),
      });
    }
  }, []);

  const addFloatText = useCallback((x: number, y: number, text: string, color: string) => {
    const g = gameRef.current;
    if (!g) return;
    g.floatTexts.push({ x, y, text, color, life: 1, maxLife: 1.2, vy: -1.2 });
  }, []);

  const initEngine = useCallback(() => {
    const engine = Matter.Engine.create({ gravity: { y: 1.6 } });
    const w = GAME_CONTAINER_WIDTH;
    const h = GAME_CONTAINER_HEIGHT;
    const wt = WALL_THICKNESS;

    const floor = Matter.Bodies.rectangle(w / 2, h + wt / 2, w, wt, { isStatic: true, label: "wall" });
    const wallL = Matter.Bodies.rectangle(-wt / 2, h / 2, wt, h, { isStatic: true, label: "wall" });
    const wallR = Matter.Bodies.rectangle(w + wt / 2, h / 2, wt, h, { isStatic: true, label: "wall" });

    Matter.World.add(engine.world, [floor, wallL, wallR]);
    return engine;
  }, []);

  const doMerge = useCallback((bodyA: CubeBody, bodyB: CubeBody) => {
    const g = gameRef.current;
    if (!g) return;
    const level = bodyA.cubeLevel ?? 0;
    if (level >= MAX_LEVEL) return;

    const mx = (bodyA.position.x + bodyB.position.x) / 2;
    const my = (bodyA.position.y + bodyB.position.y) / 2;

    Matter.World.remove(g.engine.world, bodyA);
    Matter.World.remove(g.engine.world, bodyB);
    g.cubes = g.cubes.filter(c => c !== bodyA && c !== bodyB);

    const newLevel = level + 1;
    const size = CUBE_SIZES[newLevel];
    const newCube = Matter.Bodies.rectangle(mx, my, size * 2, size * 2, {
      restitution: 0.2,
      friction: 0.5,
      frictionAir: 0.01,
      density: 0.002,
      label: "cube",
    }) as CubeBody;
    newCube.cubeLevel = newLevel;
    newCube.merging = false;
    newCube.spawnTime = performance.now();
    Matter.World.add(g.engine.world, newCube);
    g.cubes.push(newCube);

    spawnParticles(mx, my, newLevel, 22 + newLevel * 4);

    const points = CUBE_SCORES[newLevel] * Math.max(1, g.combo);
    g.score += points;
    g.combo = Math.min(g.combo + 1, 10);
    g.comboTimer = 3.0;
    g.shakeIntensity = Math.min(8 + newLevel * 2, 20);

    const comboText = g.combo > 1 ? ` x${g.combo} COMBO!` : "";
    addFloatText(mx, my - 20, `+${points}${comboText}`, CUBE_COLORS[newLevel]);

    setScore(g.score);
    setCombo(g.combo);
  }, [spawnParticles, addFloatText]);

  const setupCollisions = useCallback((engine: Matter.Engine) => {
    Matter.Events.on(engine, "collisionStart", (event) => {
      const g = gameRef.current;
      if (!g || g.phase !== "playing") return;

      for (const pair of event.pairs) {
        const a = pair.bodyA as CubeBody;
        const b = pair.bodyB as CubeBody;
        if (
          a.label === "cube" &&
          b.label === "cube" &&
          a.cubeLevel === b.cubeLevel &&
          !a.merging &&
          !b.merging &&
          a.cubeLevel !== undefined &&
          a.cubeLevel < MAX_LEVEL
        ) {
          const now = performance.now();
          const tooNew = 300;
          if ((now - (a.spawnTime ?? 0)) < tooNew || (now - (b.spawnTime ?? 0)) < tooNew) continue;

          a.merging = true;
          b.merging = true;
          const idA = a.id;
          const idB = b.id;

          setTimeout(() => {
            const g2 = gameRef.current;
            if (!g2 || g2.phase !== "playing") return;
            const ca = g2.cubes.find(c => c.id === idA) as CubeBody | undefined;
            const cb = g2.cubes.find(c => c.id === idB) as CubeBody | undefined;
            if (ca && cb) doMerge(ca, cb);
          }, 50);
        }
      }
    });
  }, [doMerge]);

  const dropCube = useCallback(() => {
    const g = gameRef.current;
    if (!g || !g.canDrop || g.phase !== "playing") return;
    const now = performance.now();
    if (now - g.lastDropTime < 500) return;

    const level = g.currentCubeLevel;
    const size = CUBE_SIZES[level];
    const x = Math.max(size + WALL_THICKNESS, Math.min(GAME_CONTAINER_WIDTH - size - WALL_THICKNESS, g.aimX));
    const y = DROP_ZONE_HEIGHT - size;

    const cube = Matter.Bodies.rectangle(x, y, size * 2, size * 2, {
      restitution: 0.2,
      friction: 0.5,
      frictionAir: 0.01,
      density: 0.002,
      label: "cube",
    }) as CubeBody;
    cube.cubeLevel = level;
    cube.merging = false;
    cube.spawnTime = now;

    Matter.World.add(g.engine.world, cube);
    g.cubes.push(cube);
    g.lastDropTime = now;
    g.canDrop = false;

    setTimeout(() => { if (gameRef.current) gameRef.current.canDrop = true; }, 300);

    g.currentCubeLevel = g.nextCubeLevel;
    g.nextCubeLevel = getNextCubeLevel();
    setCurrentLevel(g.currentCubeLevel);
    setNextLevel(g.nextCubeLevel);
  }, []);

  const checkGameOver = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.phase !== "playing") return;
    const now = performance.now();
    for (const cube of g.cubes) {
      if ((now - (cube.spawnTime ?? 0)) < 1000) continue;
      if (cube.position.y - CUBE_SIZES[cube.cubeLevel ?? 0] < GAME_OVER_Y) {
        g.phase = "gameover";
        if (g.score > g.highScore) {
          g.highScore = g.score;
          try { localStorage.setItem("qm_highscore", String(g.score)); } catch {}
          setHighScore(g.score);
        }
        setPhase("gameover");
        return;
      }
    }
  }, []);

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => {
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, w, h);

    const gridSize = 40;
    const offset = (t * 20) % gridSize;
    ctx.strokeStyle = "rgba(0,150,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = -gridSize + (offset % gridSize); x < w + gridSize; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = -gridSize + offset; y < h + gridSize; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    for (let i = 0; i < h; i += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + 0.01 * Math.sin(i * 0.2 + t * 2)})`;
      ctx.fillRect(0, i, w, 1);
    }
  }, []);

  const drawCube = useCallback((ctx: CanvasRenderingContext2D, cube: CubeBody, t: number) => {
    const level = cube.cubeLevel ?? 0;
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW_COLORS[level];
    const size = CUBE_SIZES[level];
    const { x, y } = cube.position;
    const angle = cube.angle;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + cube.id * 0.7);

    if (level === MAX_LEVEL) {
      const hue = (t * 60 + cube.id * 50) % 360;
      ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
    } else {
      ctx.shadowColor = glow;
    }
    ctx.shadowBlur = 18 + pulse * 12;

    const s = size;
    const r = Math.max(4, s * 0.15);

    if (level === MAX_LEVEL) {
      const grad = ctx.createLinearGradient(-s, -s, s, s);
      const h1 = (t * 60) % 360;
      grad.addColorStop(0, `hsl(${h1}, 100%, 70%)`);
      grad.addColorStop(0.5, `hsl(${(h1 + 120) % 360}, 100%, 70%)`);
      grad.addColorStop(1, `hsl(${(h1 + 240) % 360}, 100%, 70%)`);
      ctx.fillStyle = grad;
    } else {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.5);
      grad.addColorStop(0, color + "ff");
      grad.addColorStop(0.6, color + "cc");
      grad.addColorStop(1, color + "44");
      ctx.fillStyle = grad;
    }

    ctx.beginPath();
    ctx.moveTo(-s + r, -s);
    ctx.lineTo(s - r, -s);
    ctx.arcTo(s, -s, s, -s + r, r);
    ctx.lineTo(s, s - r);
    ctx.arcTo(s, s, s - r, s, r);
    ctx.lineTo(-s + r, s);
    ctx.arcTo(-s, s, -s, s - r, r);
    ctx.lineTo(-s, -s + r);
    ctx.arcTo(-s, -s, -s + r, -s, r);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = level === MAX_LEVEL
      ? `hsl(${(t * 60 + 180) % 360}, 100%, 80%)`
      : color;
    ctx.lineWidth = 1.5 + pulse * 0.5;
    ctx.shadowBlur = 10 + pulse * 5;
    ctx.stroke();

    const innerGrad = ctx.createLinearGradient(-s * 0.5, -s * 0.5, s * 0.5, s * 0.5);
    innerGrad.addColorStop(0, "rgba(255,255,255,0.25)");
    innerGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = innerGrad;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-s * 0.6 + r * 0.5, -s * 0.6);
    ctx.lineTo(s * 0.6 - r * 0.5, -s * 0.6);
    ctx.arcTo(s * 0.6, -s * 0.6, s * 0.6, -s * 0.6 + r * 0.5, r * 0.5);
    ctx.lineTo(s * 0.6, s * 0.6 - r * 0.5);
    ctx.arcTo(s * 0.6, s * 0.6, s * 0.6 - r * 0.5, s * 0.6, r * 0.5);
    ctx.lineTo(-s * 0.6 + r * 0.5, s * 0.6);
    ctx.arcTo(-s * 0.6, s * 0.6, -s * 0.6, s * 0.6 - r * 0.5, r * 0.5);
    ctx.lineTo(-s * 0.6, -s * 0.6 + r * 0.5);
    ctx.arcTo(-s * 0.6, -s * 0.6, -s * 0.6 + r * 0.5, -s * 0.6, r * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = glow;
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(9, s * 0.42)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CUBE_NAMES[level], 0, 0);
    ctx.shadowBlur = 0;

    ctx.restore();
  }, []);

  const drawGhostCube = useCallback((ctx: CanvasRenderingContext2D, level: number, aimX: number, t: number) => {
    const size = CUBE_SIZES[level];
    const color = CUBE_COLORS[level];
    const glow = CUBE_GLOW_COLORS[level];
    const x = Math.max(size + WALL_THICKNESS, Math.min(GAME_CONTAINER_WIDTH - size - WALL_THICKNESS, aimX));
    const y = DROP_ZONE_HEIGHT - size;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.5 + pulse * 0.15;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;

    const s = size;
    const r = Math.max(4, s * 0.15);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -t * 20;
    ctx.beginPath();
    ctx.moveTo(-s + r, -s); ctx.lineTo(s - r, -s);
    ctx.arcTo(s, -s, s, -s + r, r); ctx.lineTo(s, s - r);
    ctx.arcTo(s, s, s - r, s, r); ctx.lineTo(-s + r, s);
    ctx.arcTo(-s, s, -s, s - r, r); ctx.lineTo(-s, -s + r);
    ctx.arcTo(-s, -s, -s + r, -s, r);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(9, s * 0.42)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 6;
    ctx.shadowColor = glow;
    ctx.fillText(CUBE_NAMES[level], 0, 0);

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.15 + pulse * 0.1;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.lineDashOffset = t * 15;
    ctx.beginPath();
    ctx.moveTo(x, DROP_ZONE_HEIGHT);
    ctx.lineTo(x, GAME_CONTAINER_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }, []);

  const drawParticles = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const g = gameRef.current;
    if (!g) return;
    g.particles = g.particles.filter(p => p.life > 0);
    for (const p of g.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.vx *= 0.96;
      p.life -= dt / p.maxLife;

      const alpha = Math.max(0, p.life);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, []);

  const drawFloatTexts = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const g = gameRef.current;
    if (!g) return;
    g.floatTexts = g.floatTexts.filter(ft => ft.life > 0);
    for (const ft of g.floatTexts) {
      ft.y += ft.vy;
      ft.life -= dt / ft.maxLife;
      const alpha = Math.min(1, ft.life * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = ft.color;
      ctx.font = `bold 14px 'Courier New', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, g: NonNullable<typeof gameRef.current>, t: number) => {
    const w = GAME_CONTAINER_WIDTH;

    ctx.save();
    ctx.fillStyle = "rgba(0,229,255,0.06)";
    ctx.fillRect(0, 0, w, DROP_ZONE_HEIGHT);
    ctx.strokeStyle = "rgba(0,229,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, DROP_ZONE_HEIGHT);
    ctx.lineTo(w, DROP_ZONE_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(255,50,50,0.12)";
    ctx.fillRect(0, 0, w, GAME_OVER_Y);
    ctx.strokeStyle = "rgba(255,50,50,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -t * 25;
    ctx.beginPath();
    ctx.moveTo(0, GAME_OVER_Y);
    ctx.lineTo(w, GAME_OVER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(255,80,80,${0.4 + pulse * 0.3})`;
    ctx.font = "bold 9px 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("⚠ DANGER ZONE", 6, GAME_OVER_Y - 2);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, w, 55);

    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#00e5ff";
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SCORE", 12, 8);
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText(String(g.score), 12, 22);

    ctx.shadowColor = "#ff00de";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff00de";
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.fillText("BEST", w - 12, 8);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText(String(Math.max(g.score, g.highScore)), w - 12, 22);

    if (g.combo > 1) {
      const comboAlpha = Math.min(1, g.comboTimer);
      ctx.globalAlpha = comboAlpha;
      ctx.shadowColor = "#ffe600";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#ffe600";
      ctx.font = `bold 13px 'Courier New', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`⚡ COMBO x${g.combo}`, w / 2, 12);
    }

    ctx.restore();

    const nextSize = CUBE_SIZES[g.nextCubeLevel];
    const nextX = w - 32;
    const nextY = DROP_ZONE_HEIGHT + 30;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(nextX - 28, nextY - 28, 56, 62);
    ctx.strokeStyle = "rgba(0,229,255,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(nextX - 28, nextY - 28, 56, 62);
    ctx.fillStyle = "rgba(0,229,255,0.5)";
    ctx.font = "bold 8px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("NEXT", nextX, nextY - 18);
    const ns = Math.min(nextSize, 22);
    const nc = CUBE_COLORS[g.nextCubeLevel];
    const ng = CUBE_GLOW_COLORS[g.nextCubeLevel];
    ctx.shadowColor = ng;
    ctx.shadowBlur = 10;
    ctx.fillStyle = nc;
    ctx.fillRect(nextX - ns, nextY - ns + 8, ns * 2, ns * 2);
    ctx.strokeStyle = nc;
    ctx.lineWidth = 1;
    ctx.strokeRect(nextX - ns, nextY - ns + 8, ns * 2, ns * 2);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(6, ns * 0.55)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CUBE_NAMES[g.nextCubeLevel], nextX, nextY + 8);
    ctx.restore();
  }, []);

  const startGame = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;

    for (const cube of g.cubes) {
      Matter.World.remove(g.engine.world, cube);
    }
    g.cubes = [];
    g.particles = [];
    g.floatTexts = [];
    g.score = 0;
    g.combo = 0;
    g.comboTimer = 0;
    g.phase = "playing";
    g.canDrop = true;
    g.lastDropTime = 0;
    g.shakeIntensity = 0;
    g.currentCubeLevel = getNextCubeLevel();
    g.nextCubeLevel = getNextCubeLevel();
    g.aimX = GAME_CONTAINER_WIDTH / 2;

    setPhase("playing");
    setScore(0);
    setCombo(0);
    setCurrentLevel(g.currentCubeLevel);
    setNextLevel(g.nextCubeLevel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = initEngine();
    const g = {
      engine,
      cubes: [] as CubeBody[],
      particles: [] as Particle[],
      floatTexts: [] as FloatText[],
      pendingMerges: new Set<number>(),
      aimX: GAME_CONTAINER_WIDTH / 2,
      currentCubeLevel: getNextCubeLevel(),
      nextCubeLevel: getNextCubeLevel(),
      canDrop: true,
      lastDropTime: 0,
      score: 0,
      highScore: 0,
      combo: 0,
      comboTimer: 0,
      phase: "start" as GamePhase,
      shakeIntensity: 0,
      shakeX: 0,
      shakeY: 0,
      bgOffset: 0,
      animFrame: 0,
      lastTime: 0,
    };
    try {
      g.highScore = parseInt(localStorage.getItem("qm_highscore") || "0");
    } catch {}
    gameRef.current = g;
    setupCollisions(engine);

    setCurrentLevel(g.currentCubeLevel);
    setNextLevel(g.nextCubeLevel);

    let lastTime = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const t = now / 1000;

      if (!gameRef.current) return;
      const g = gameRef.current;
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      Matter.Engine.update(g.engine, Math.min(dt * 1000, 16.667));

      if (g.phase === "playing") {
        if (g.comboTimer > 0) {
          g.comboTimer -= dt;
          if (g.comboTimer <= 0) {
            g.combo = 0;
            setCombo(0);
          }
        }
        if (g.score !== undefined) setScore(g.score);
        checkGameOver();
      }

      if (g.shakeIntensity > 0) {
        g.shakeX = randomRange(-g.shakeIntensity, g.shakeIntensity);
        g.shakeY = randomRange(-g.shakeIntensity * 0.5, g.shakeIntensity * 0.5);
        g.shakeIntensity = lerp(g.shakeIntensity, 0, 0.25);
        if (g.shakeIntensity < 0.3) g.shakeIntensity = 0;
      } else {
        g.shakeX = 0;
        g.shakeY = 0;
      }

      const w = GAME_CONTAINER_WIDTH;
      const h = GAME_CONTAINER_HEIGHT;
      canvas!.width = w;
      canvas!.height = h;

      ctx.save();
      ctx.translate(g.shakeX, g.shakeY);

      drawBackground(ctx, t, w, h);

      for (const cube of g.cubes) {
        drawCube(ctx, cube, t);
      }

      drawParticles(ctx, dt);
      drawFloatTexts(ctx, dt);

      if (g.phase === "playing") {
        drawGhostCube(ctx, g.currentCubeLevel, g.aimX, t);
        drawHUD(ctx, g, t);
      }

      ctx.restore();

      g.animFrame = requestAnimationFrame(loop);
    }

    g.animFrame = requestAnimationFrame(loop);

    return () => {
      if (gameRef.current) {
        cancelAnimationFrame(gameRef.current.animFrame);
        Matter.Engine.clear(gameRef.current.engine);
        Matter.World.clear(gameRef.current.engine.world, false);
      }
      gameRef.current = null;
    };
  }, [initEngine, setupCollisions, drawBackground, drawCube, drawGhostCube, drawParticles, drawFloatTexts, drawHUD, checkGameOver]);

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      const scaleX = ww / GAME_CONTAINER_WIDTH;
      const scaleY = wh / GAME_CONTAINER_HEIGHT;
      scaleRef.current = Math.min(scaleX, scaleY, 1.2);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gameRef.current;
    if (!g || g.phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_CONTAINER_WIDTH / rect.width;
    g.aimX = (e.clientX - rect.left) * scaleX;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gameRef.current;
    if (!g) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_CONTAINER_WIDTH / rect.width;
    if (g.phase === "playing") {
      g.aimX = (e.clientX - rect.left) * scaleX;
      dropCube();
    }
  }, [dropCube]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const g = gameRef.current;
    if (!g || g.phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_CONTAINER_WIDTH / rect.width;
    const touch = e.touches[0];
    g.aimX = (touch.clientX - rect.left) * scaleX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const g = gameRef.current;
    if (!g) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_CONTAINER_WIDTH / rect.width;
    const touch = e.changedTouches[0];
    if (g.phase === "playing") {
      g.aimX = (touch.clientX - rect.left) * scaleX;
      dropCube();
    }
  }, [dropCube]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#050810",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        fontFamily: "'Courier New', monospace",
      }}
    >
      <div
        style={{
          position: "relative",
          width: GAME_CONTAINER_WIDTH,
          height: GAME_CONTAINER_HEIGHT,
          maxWidth: "95vw",
          maxHeight: "95vh",
          aspectRatio: `${GAME_CONTAINER_WIDTH} / ${GAME_CONTAINER_HEIGHT}`,
        }}
      >
        <canvas
          ref={canvasRef}
          width={GAME_CONTAINER_WIDTH}
          height={GAME_CONTAINER_HEIGHT}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: phase === "playing" ? "crosshair" : "default",
            borderRadius: 8,
            border: "1px solid rgba(0,229,255,0.3)",
            boxShadow: "0 0 40px rgba(0,229,255,0.15), 0 0 80px rgba(0,100,255,0.08)",
          }}
        />

        {phase === "start" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(5,8,16,0.92)",
              borderRadius: 8,
            }}
          >
            <StartScreen highScore={highScore} onStart={startGame} />
          </div>
        )}

        {phase === "gameover" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(5,8,16,0.92)",
              borderRadius: 8,
            }}
          >
            <GameOverScreen score={score} highScore={highScore} onRestart={startGame} />
          </div>
        )}
      </div>

      <EvolutionGuide currentLevel={currentLevel} />
    </div>
  );
}

function NeonText({ children, color, size, glow }: { children: string; color: string; size: number; glow?: string }) {
  return (
    <span style={{
      color,
      fontSize: size,
      fontFamily: "'Courier New', monospace",
      fontWeight: "bold",
      textShadow: `0 0 10px ${glow ?? color}, 0 0 20px ${glow ?? color}, 0 0 40px ${glow ?? color}`,
      letterSpacing: "0.05em",
    }}>{children}</span>
  );
}

function StartScreen({ highScore, onStart }: { highScore: number; onStart: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: 24, textAlign: "center",
    }}>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ marginBottom: 4 }}>
          <NeonText color="#00e5ff" size={14} glow="rgba(0,229,255,0.8)">⬡ QUANTUM ⬡</NeonText>
        </div>
        <div>
          <NeonText color="#ff00de" size={42} glow="rgba(255,0,222,0.8)">MERGE</NeonText>
        </div>
      </div>

      <div style={{
        background: "rgba(0,229,255,0.05)",
        border: "1px solid rgba(0,229,255,0.2)",
        borderRadius: 8,
        padding: "12px 20px",
        maxWidth: 280,
      }}>
        <p style={{ color: "#aaccff", fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          Drop glowing cubes into the field.<br />
          Identical cubes <span style={{ color: "#ffe600" }}>merge</span> into higher forms.<br />
          Reach <span style={{ color: "#ffffff", textShadow: "0 0 8px #fff" }}>SINGULARITY</span> to transcend.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        {CUBE_NAMES.map((name, i) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 14, height: 14,
              background: CUBE_COLORS[i],
              boxShadow: `0 0 8px ${CUBE_GLOW_COLORS[i]}`,
              borderRadius: 2,
            }} />
            <span style={{ color: CUBE_COLORS[i], fontSize: 11, fontFamily: "Courier New", textShadow: `0 0 6px ${CUBE_COLORS[i]}` }}>
              {name}
            </span>
            {i < CUBE_NAMES.length - 1 && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>→</span>}
          </div>
        ))}
      </div>

      {highScore > 0 && (
        <p style={{ color: "#ff00de", fontSize: 12, margin: 0, textShadow: "0 0 8px rgba(255,0,222,0.8)" }}>
          BEST: {highScore}
        </p>
      )}

      <button
        onClick={onStart}
        style={{
          background: "transparent",
          border: "2px solid #00e5ff",
          color: "#00e5ff",
          fontFamily: "'Courier New', monospace",
          fontWeight: "bold",
          fontSize: 16,
          padding: "12px 40px",
          cursor: "pointer",
          borderRadius: 4,
          boxShadow: "0 0 20px rgba(0,229,255,0.4), inset 0 0 20px rgba(0,229,255,0.05)",
          textShadow: "0 0 10px rgba(0,229,255,0.8)",
          letterSpacing: "0.1em",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.boxShadow = "0 0 30px rgba(0,229,255,0.7), inset 0 0 30px rgba(0,229,255,0.1)";
          (e.target as HTMLButtonElement).style.background = "rgba(0,229,255,0.08)";
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(0,229,255,0.4), inset 0 0 20px rgba(0,229,255,0.05)";
          (e.target as HTMLButtonElement).style.background = "transparent";
        }}
      >
        ▶ INITIALIZE
      </button>

      <p style={{ color: "rgba(100,150,200,0.5)", fontSize: 10, margin: 0 }}>
        CLICK / TAP TO DROP CUBES
      </p>
    </div>
  );
}

function GameOverScreen({ score, highScore, onRestart }: { score: number; highScore: number; onRestart: () => void }) {
  const isNewBest = score >= highScore;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: 24, textAlign: "center",
    }}>
      <div style={{
        color: "#ff4444",
        fontSize: 32,
        fontFamily: "Courier New",
        fontWeight: "bold",
        textShadow: "0 0 15px rgba(255,68,68,0.9), 0 0 30px rgba(255,68,68,0.5)",
        letterSpacing: "0.1em",
      }}>
        SYSTEM COLLAPSE
      </div>

      <div style={{
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,68,68,0.3)",
        borderRadius: 8,
        padding: "16px 32px",
      }}>
        <div style={{ color: "rgba(150,180,220,0.7)", fontSize: 11, fontFamily: "Courier New", marginBottom: 4 }}>
          FINAL SCORE
        </div>
        <div style={{
          color: "#00e5ff", fontSize: 36, fontFamily: "Courier New", fontWeight: "bold",
          textShadow: "0 0 15px rgba(0,229,255,0.8)",
        }}>
          {score}
        </div>
        {isNewBest && (
          <div style={{
            color: "#ffe600", fontSize: 12, fontFamily: "Courier New",
            textShadow: "0 0 10px rgba(255,230,0,0.8)", marginTop: 4,
          }}>
            ★ NEW RECORD ★
          </div>
        )}
        <div style={{ color: "rgba(150,180,220,0.6)", fontSize: 11, fontFamily: "Courier New", marginTop: 6 }}>
          BEST: {highScore}
        </div>
      </div>

      <button
        onClick={onRestart}
        style={{
          background: "transparent",
          border: "2px solid #00e5ff",
          color: "#00e5ff",
          fontFamily: "'Courier New', monospace",
          fontWeight: "bold",
          fontSize: 15,
          padding: "10px 36px",
          cursor: "pointer",
          borderRadius: 4,
          boxShadow: "0 0 20px rgba(0,229,255,0.4)",
          textShadow: "0 0 10px rgba(0,229,255,0.8)",
          letterSpacing: "0.08em",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.boxShadow = "0 0 30px rgba(0,229,255,0.7)";
          (e.target as HTMLButtonElement).style.background = "rgba(0,229,255,0.08)";
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(0,229,255,0.4)";
          (e.target as HTMLButtonElement).style.background = "transparent";
        }}
      >
        ↺ REBOOT
      </button>
    </div>
  );
}

function EvolutionGuide({ currentLevel }: { currentLevel: number }) {
  return (
    <div style={{
      position: "fixed",
      right: 12,
      top: "50%",
      transform: "translateY(-50%)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      pointerEvents: "none",
    }}>
      {CUBE_NAMES.map((name, i) => {
        const isActive = i === currentLevel;
        const isAchieved = i < currentLevel;
        return (
          <div key={name} style={{
            display: "flex", alignItems: "center", gap: 6,
            opacity: isActive ? 1 : isAchieved ? 0.7 : 0.3,
            transition: "opacity 0.3s",
          }}>
            <div style={{
              width: 8, height: 8,
              background: CUBE_COLORS[i],
              boxShadow: isActive ? `0 0 10px ${CUBE_GLOW_COLORS[i]}` : "none",
              borderRadius: 1,
              flexShrink: 0,
            }} />
            <span style={{
              color: CUBE_COLORS[i],
              fontSize: 9,
              fontFamily: "Courier New",
              textShadow: isActive ? `0 0 6px ${CUBE_COLORS[i]}` : "none",
              whiteSpace: "nowrap",
            }}>
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
