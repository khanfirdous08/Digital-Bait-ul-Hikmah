// ─── Achievements ─────────────────────────────────────────────────────────────
import { store, type AchievementState } from "./store";

export interface AchievementDef {
  id: keyof AchievementState;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "firstMerge",        name: "First Fusion",     desc: "Merge two cubes",                icon: "⚡", color: "#00e5ff" },
  { id: "novaReached",       name: "Nova Born",         desc: "Create a Nova cube",             icon: "✦",  color: "#ffe600" },
  { id: "quantumReached",    name: "Quantum State",     desc: "Create a Quantum cube",          icon: "◈",  color: "#00ff8c" },
  { id: "singularityReached",name: "Singularity",       desc: "Create the Singularity cube",    icon: "★",  color: "#ffffff" },
  { id: "comboKing",         name: "Combo King",        desc: "Reach a x5 combo",               icon: "🔥", color: "#ff6a00" },
  { id: "scoreMaster",       name: "Score Master",      desc: "Reach 10,000 points",            icon: "◆",  color: "#ff00de" },
  { id: "tenGames",          name: "Veteran",           desc: "Play 10 games",                  icon: "⬡",  color: "#00e5ff" },
];

export interface UnlockedEvent {
  def: AchievementDef;
}

type Listener = (e: UnlockedEvent) => void;
const listeners: Listener[] = [];

export function onAchievementUnlocked(fn: Listener) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

function unlock(id: keyof AchievementState) {
  const current = store.get("achievements");
  if (current[id]) return; // already unlocked
  store.update(d => { d.achievements[id] = true; });
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (def) listeners.forEach(fn => fn({ def }));
}

export function checkAchievements(params: {
  merged?: boolean;
  mergedLevel?: number;
  combo?: number;
  score?: number;
  games?: number;
}) {
  if (params.merged) unlock("firstMerge");
  if (params.mergedLevel !== undefined) {
    if (params.mergedLevel >= 2) unlock("novaReached");
    if (params.mergedLevel >= 4) unlock("quantumReached");
    if (params.mergedLevel >= 5) unlock("singularityReached");
  }
  if ((params.combo ?? 0) >= 5) unlock("comboKing");
  if ((params.score ?? 0) >= 10000) unlock("scoreMaster");
  if ((params.games ?? 0) >= 10) unlock("tenGames");
}
