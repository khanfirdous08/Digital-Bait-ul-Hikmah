import { useState, useEffect, useRef } from "react";
import { ACHIEVEMENTS, type AchievementDef } from "./achievements";
import { store, type Settings } from "./store";

// ─── Shared UI atoms ──────────────────────────────────────────────────────────
const FONT = "'Courier New', monospace";

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "rgba(4,8,18,0.97)",
      border: "1px solid rgba(0,229,255,0.25)",
      borderRadius: 10,
      padding: "24px 28px",
      boxShadow: "0 0 40px rgba(0,229,255,0.08), inset 0 0 30px rgba(0,0,0,0.4)",
      fontFamily: FONT,
      ...style,
    }}>{children}</div>
  );
}

function NeonBtn({
  children, onClick, color = "#00e5ff", size = 15, wide = false, danger = false,
}: {
  children: React.ReactNode; onClick: () => void; color?: string;
  size?: number; wide?: boolean; danger?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const c = danger ? "#ff4455" : color;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onTouchStart={() => setHov(true)}
      onTouchEnd={() => { setHov(false); onClick(); }}
      style={{
        background: hov ? `${c}18` : "transparent",
        border: `1.5px solid ${c}`,
        color: c,
        fontFamily: FONT,
        fontWeight: "bold",
        fontSize: size,
        padding: wide ? "11px 0" : "10px 28px",
        width: wide ? "100%" : undefined,
        cursor: "pointer",
        borderRadius: 4,
        boxShadow: hov ? `0 0 24px ${c}70` : `0 0 10px ${c}30`,
        textShadow: `0 0 8px ${c}`,
        letterSpacing: "0.08em",
        transition: "all 0.12s",
        outline: "none",
        display: "block",
      }}
    >{children}</button>
  );
}

function Toggle({ label, value, onChange, color = "#00e5ff" }: {
  label: string; value: boolean; onChange: (v: boolean) => void; color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <span style={{ color: "rgba(160,200,230,0.8)", fontSize: 13 }}>{label}</span>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 46, height: 24, borderRadius: 12,
          background: value ? color : "rgba(80,100,130,0.4)",
          border: `1px solid ${value ? color : "rgba(100,130,160,0.3)"}`,
          position: "relative", cursor: "pointer",
          boxShadow: value ? `0 0 12px ${color}60` : "none",
          transition: "all 0.2s",
        }}
      >
        <div style={{
          position: "absolute", top: 3, left: value ? 24 : 3,
          width: 16, height: 16, borderRadius: "50%",
          background: value ? "#fff" : "rgba(160,180,210,0.5)",
          transition: "left 0.2s",
          boxShadow: value ? `0 0 6px ${color}` : "none",
        }} />
      </div>
    </div>
  );
}

function Title({ children, color, size = 22 }: { children: string; color: string; size?: number }) {
  return (
    <div style={{
      color, fontSize: size, fontWeight: "bold", letterSpacing: "0.1em",
      textShadow: `0 0 16px ${color}cc, 0 0 30px ${color}44`,
      textAlign: "center", marginBottom: 20, fontFamily: FONT,
    }}>{children}</div>
  );
}

// ─── Achievement toast ────────────────────────────────────────────────────────
export function AchievementToast({ def, onDone }: { def: AchievementDef; onDone: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); setTimeout(onDone, 400); }, 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: "absolute", bottom: 16, left: "50%",
      transform: `translateX(-50%) translateY(${visible ? 0 : 60}px)`,
      opacity: visible ? 1 : 0,
      transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s",
      background: "rgba(4,8,18,0.96)",
      border: `1px solid ${def.color}60`,
      borderRadius: 8, padding: "10px 18px",
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: `0 0 24px ${def.color}40`,
      pointerEvents: "none", zIndex: 200, whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 22 }}>{def.icon}</span>
      <div>
        <div style={{ color: def.color, fontSize: 10, letterSpacing: "0.12em", fontFamily: FONT, marginBottom: 2 }}>
          ACHIEVEMENT UNLOCKED
        </div>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: "bold", fontFamily: FONT }}>{def.name}</div>
      </div>
    </div>
  );
}

// ─── Pause menu ───────────────────────────────────────────────────────────────
export function PauseMenu({
  onResume, onRestart, onSettings, onAchievements,
}: {
  onResume: () => void; onRestart: () => void;
  onSettings: () => void; onAchievements: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%" }}>
      <Title color="#00e5ff">⏸ PAUSED</Title>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "80%" }}>
        <NeonBtn onClick={onResume} wide>▶ RESUME</NeonBtn>
        <NeonBtn onClick={onSettings} wide color="#ffe600">⚙ SETTINGS</NeonBtn>
        <NeonBtn onClick={onAchievements} wide color="#ff00de">★ ACHIEVEMENTS</NeonBtn>
        <NeonBtn onClick={onRestart} wide danger>↺ RESTART</NeonBtn>
      </div>
    </div>
  );
}

// ─── Settings menu ────────────────────────────────────────────────────────────
export function SettingsPanel({
  settings, onChange, onBack,
}: {
  settings: Settings; onChange: (s: Settings) => void; onBack: () => void;
}) {
  return (
    <div style={{ width: "100%", maxWidth: 260 }}>
      <Title color="#ffe600">⚙ SETTINGS</Title>
      <Toggle label="🎵  Background Music" value={settings.musicOn}
        onChange={v => onChange({ ...settings, musicOn: v })} color="#ffe600" />
      <Toggle label="🔊  Sound Effects" value={settings.sfxOn}
        onChange={v => onChange({ ...settings, sfxOn: v })} color="#00e5ff" />
      <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
        <div style={{ color: "rgba(100,130,160,0.5)", fontSize: 10, fontFamily: FONT, textAlign: "center", marginBottom: 14 }}>
          v2.0 — QUANTUM MERGE
        </div>
        <NeonBtn onClick={onBack} wide color="#00e5ff">← BACK</NeonBtn>
      </div>
    </div>
  );
}

// ─── Achievements panel ───────────────────────────────────────────────────────
export function AchievementsPanel({ onBack }: { onBack: () => void }) {
  const unlocked = store.get("achievements");
  return (
    <div style={{ width: "100%", maxWidth: 300 }}>
      <Title color="#ff00de">★ ACHIEVEMENTS</Title>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {ACHIEVEMENTS.map(a => {
          const done = unlocked[a.id];
          return (
            <div key={a.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              background: done ? `${a.color}10` : "rgba(255,255,255,0.02)",
              border: `1px solid ${done ? a.color + "50" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 6, padding: "8px 12px",
              opacity: done ? 1 : 0.4,
              transition: "all 0.2s",
            }}>
              <span style={{ fontSize: 18, filter: done ? "none" : "grayscale(1)" }}>{a.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: done ? a.color : "#778899", fontSize: 12, fontWeight: "bold", fontFamily: FONT }}>
                  {a.name}
                </div>
                <div style={{ color: "rgba(120,150,180,0.6)", fontSize: 10, fontFamily: FONT }}>{a.desc}</div>
              </div>
              {done && <span style={{ color: a.color, fontSize: 14 }}>✓</span>}
            </div>
          );
        })}
      </div>
      <NeonBtn onClick={onBack} wide color="#ff00de">← BACK</NeonBtn>
    </div>
  );
}

// ─── Daily reward ─────────────────────────────────────────────────────────────
export function DailyRewardPopup({ streak, coins, onClaim }: { streak: number; coins: number; onClaim: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  return (
    <div style={{
      transform: `scale(${visible ? 1 : 0.85})`,
      opacity: visible ? 1 : 0,
      transition: "all 0.35s cubic-bezier(0.34,1.56,0.64,1)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
    }}>
      <div style={{ fontSize: 40 }}>🎁</div>
      <Title color="#ffe600">DAILY REWARD</Title>
      <div style={{ color: "rgba(160,200,230,0.7)", fontSize: 12, fontFamily: FONT, textAlign: "center" }}>
        Day {streak} streak!
      </div>
      <div style={{
        background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.3)",
        borderRadius: 8, padding: "14px 32px", textAlign: "center",
      }}>
        <div style={{ color: "rgba(160,200,230,0.6)", fontSize: 11, fontFamily: FONT, marginBottom: 4 }}>COINS EARNED</div>
        <div style={{
          color: "#ffe600", fontSize: 38, fontWeight: "bold", fontFamily: FONT,
          textShadow: "0 0 20px rgba(255,230,0,0.9)",
        }}>+{coins}</div>
      </div>

      <div style={{ display: "flex", gap: 5 }}>
        {[1, 2, 3, 4, 5, 6, 7].map(d => (
          <div key={d} style={{
            width: 28, height: 28, borderRadius: 4,
            background: d <= streak ? "rgba(255,230,0,0.3)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${d <= streak ? "rgba(255,230,0,0.6)" : "rgba(255,255,255,0.1)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, color: d <= streak ? "#ffe600" : "rgba(100,120,140,0.5)",
            fontFamily: FONT, fontWeight: "bold",
          }}>
            {d <= streak ? "✓" : d}
          </div>
        ))}
      </div>

      <NeonBtn onClick={onClaim} color="#ffe600" wide>CLAIM REWARD</NeonBtn>
    </div>
  );
}

// ─── Continue screen ──────────────────────────────────────────────────────────
export function ContinueScreen({ countdown, onContinue, onEnd }: {
  countdown: number; onContinue: () => void; onEnd: () => void;
}) {
  const pct = countdown / 5;
  const r = 36;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ color: "#ff4455", fontSize: 26, fontWeight: "bold", fontFamily: FONT, letterSpacing: "0.1em", textShadow: "0 0 15px rgba(255,68,85,0.8)" }}>
        SYSTEM COLLAPSE
      </div>

      <div style={{ position: "relative", width: 90, height: 90 }}>
        <svg width={90} height={90} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={45} cy={45} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
          <circle cx={45} cy={45} r={r} fill="none" stroke="#00e5ff" strokeWidth={5}
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.1s linear", filter: "drop-shadow(0 0 6px #00e5ff)" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#00e5ff", fontSize: 28, fontWeight: "bold", fontFamily: FONT,
          textShadow: "0 0 12px rgba(0,229,255,0.8)",
        }}>
          {Math.ceil(countdown)}
        </div>
      </div>

      <NeonBtn onClick={onContinue} color="#00e5ff" size={16} wide>⚡ CONTINUE</NeonBtn>
      <button
        onClick={onEnd}
        style={{
          background: "none", border: "none", color: "rgba(100,130,160,0.5)",
          fontFamily: FONT, fontSize: 11, cursor: "pointer", padding: 4,
        }}
      >end game</button>
    </div>
  );
}

// ─── Game over final ──────────────────────────────────────────────────────────
export function GameOverFinal({ score, highScore, onRestart, onAchievements }: {
  score: number; highScore: number; onRestart: () => void; onAchievements: () => void;
}) {
  const isNew = score > 0 && score >= highScore;
  const [in_, setIn] = useState(false);
  useEffect(() => { setTimeout(() => setIn(true), 80); }, []);

  return (
    <div style={{
      opacity: in_ ? 1 : 0, transform: `translateY(${in_ ? 0 : 10}px)`,
      transition: "all 0.35s ease-out",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
    }}>
      <div style={{ color: "#ff3344", fontSize: 28, fontWeight: "bold", fontFamily: FONT, letterSpacing: "0.1em", textShadow: "0 0 20px rgba(255,50,60,0.85)" }}>
        SYSTEM COLLAPSE
      </div>
      <div style={{
        background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,50,60,0.22)",
        borderRadius: 8, padding: "16px 36px", textAlign: "center",
      }}>
        <div style={{ color: "rgba(120,160,200,0.6)", fontSize: 11, fontFamily: FONT, marginBottom: 4 }}>FINAL SCORE</div>
        <div style={{ color: "#00e5ff", fontSize: 42, fontWeight: "bold", fontFamily: FONT, textShadow: "0 0 18px rgba(0,229,255,0.85)", lineHeight: 1 }}>
          {score.toLocaleString()}
        </div>
        {isNew && (
          <div style={{ color: "#ffe600", fontSize: 13, fontWeight: "bold", fontFamily: FONT, marginTop: 8, textShadow: "0 0 12px rgba(255,230,0,0.9)" }}>
            ★ NEW RECORD ★
          </div>
        )}
        {!isNew && highScore > 0 && (
          <div style={{ color: "rgba(120,160,200,0.45)", fontSize: 11, fontFamily: FONT, marginTop: 8 }}>
            BEST: {highScore.toLocaleString()}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "80%" }}>
        <NeonBtn onClick={onRestart} wide color="#00e5ff" size={16}>↺ REBOOT</NeonBtn>
        <NeonBtn onClick={onAchievements} wide color="#ff00de" size={13}>★ ACHIEVEMENTS</NeonBtn>
      </div>
    </div>
  );
}

// ─── Start screen ─────────────────────────────────────────────────────────────
const CUBE_NAMES = ["Spark", "Pulse", "Nova", "Plasma", "Quantum", "Singularity"];
const CUBE_COLORS = ["#00e5ff", "#ff00de", "#ffe600", "#ff6a00", "#00ff8c", "#ffffff"];

export function StartScreen({ highScore, coins, onStart, onSettings, onAchievements }: {
  highScore: number; coins: number;
  onStart: () => void; onSettings: () => void; onAchievements: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "20px 28px", textAlign: "center", width: "100%" }}>
      <div>
        <div style={{ color: "#00e5ff", fontSize: 12, letterSpacing: "0.28em", textShadow: "0 0 12px rgba(0,229,255,0.8)", marginBottom: 4 }}>◈ QUANTUM ◈</div>
        <div style={{ color: "#ff00de", fontSize: 46, fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1, textShadow: "0 0 22px rgba(255,0,222,0.85), 0 0 45px rgba(255,0,222,0.35)" }}>MERGE</div>
      </div>

      <div style={{ background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 8, padding: "12px 18px", maxWidth: 270 }}>
        <p style={{ color: "#99bbdd", fontSize: 12, margin: 0, lineHeight: 1.7 }}>
          Drop cubes into the field.<br />
          <span style={{ color: "#ffe600" }}>Match identical cubes</span> to merge<br />
          them into higher quantum forms.<br />
          Reach <span style={{ color: "#fff", textShadow: "0 0 8px #fff" }}>SINGULARITY</span> to win.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 12px" }}>
        {CUBE_NAMES.map((n, i) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, background: CUBE_COLORS[i], borderRadius: 2, boxShadow: `0 0 6px ${CUBE_COLORS[i]}` }} />
            <span style={{ color: CUBE_COLORS[i], fontSize: 11 }}>{n}</span>
            {i < 5 && <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>→</span>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: FONT }}>
        {highScore > 0 && (
          <div style={{ color: "#ff00de", textShadow: "0 0 8px rgba(255,0,222,0.7)" }}>
            BEST: {highScore.toLocaleString()}
          </div>
        )}
        {coins > 0 && (
          <div style={{ color: "#ffe600", textShadow: "0 0 8px rgba(255,230,0,0.7)" }}>
            ◆ {coins}
          </div>
        )}
      </div>

      <NeonBtn onClick={onStart} size={16} wide color="#00e5ff">▶ INITIALIZE</NeonBtn>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onSettings} style={{ background: "none", border: "1px solid rgba(255,230,0,0.3)", color: "rgba(255,230,0,0.7)", fontFamily: FONT, fontSize: 11, padding: "6px 14px", borderRadius: 4, cursor: "pointer" }}>⚙ SETTINGS</button>
        <button onClick={onAchievements} style={{ background: "none", border: "1px solid rgba(255,0,222,0.3)", color: "rgba(255,0,222,0.7)", fontFamily: FONT, fontSize: 11, padding: "6px 14px", borderRadius: 4, cursor: "pointer" }}>★ ACHIEVEMENTS</button>
      </div>

      <div style={{ color: "rgba(80,110,140,0.45)", fontSize: 10, fontFamily: FONT }}>CLICK / TAP TO DROP CUBES</div>
    </div>
  );
}

// ─── Generic overlay wrapper ──────────────────────────────────────────────────
export function Overlay({ children, dim = true }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div style={{
      position: "absolute", inset: 0, borderRadius: 8,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: dim ? "rgba(3,6,14,0.91)" : "transparent",
      zIndex: 100,
    }}>
      <Panel style={{ width: "88%", maxHeight: "90%", overflowY: "auto" }}>
        {children}
      </Panel>
    </div>
  );
}
