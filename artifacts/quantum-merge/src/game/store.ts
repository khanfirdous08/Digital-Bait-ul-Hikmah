// ─── Persistent game store ────────────────────────────────────────────────────
const KEY = "qm2";

export interface Settings {
  musicOn: boolean;
  sfxOn: boolean;
}

export interface AchievementState {
  firstMerge: boolean;
  novaReached: boolean;
  quantumReached: boolean;
  singularityReached: boolean;
  comboKing: boolean;
  scoreMaster: boolean;
  tenGames: boolean;
}

export interface StoreData {
  highScore: number;
  totalGames: number;
  maxLevelReached: number;
  settings: Settings;
  achievements: AchievementState;
  lastDailyTs: number;     // timestamp of last daily claim
  dailyStreak: number;
  coins: number;
}

const DEFAULTS: StoreData = {
  highScore: 0,
  totalGames: 0,
  maxLevelReached: 0,
  settings: { musicOn: true, sfxOn: true },
  achievements: {
    firstMerge: false,
    novaReached: false,
    quantumReached: false,
    singularityReached: false,
    comboKing: false,
    scoreMaster: false,
    tenGames: false,
  },
  lastDailyTs: 0,
  dailyStreak: 0,
  coins: 0,
};

function load(): StoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      ...DEFAULTS,
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
      achievements: { ...DEFAULTS.achievements, ...(parsed.achievements ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(data: StoreData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

class Store {
  private data: StoreData;
  constructor() { this.data = load(); }

  get<K extends keyof StoreData>(k: K): StoreData[K] { return this.data[k]; }

  update(fn: (d: StoreData) => void) {
    fn(this.data);
    save(this.data);
  }

  checkDailyReward(): { eligible: boolean; streak: number; coins: number } {
    const now = Date.now();
    const last = this.data.lastDailyTs;
    const oneDayMs = 86400000;
    const isNewDay = now - last > oneDayMs;
    if (!isNewDay) return { eligible: false, streak: this.data.dailyStreak, coins: 0 };

    const isStreak = now - last < oneDayMs * 2; // within 48h = kept streak
    const newStreak = isStreak ? this.data.dailyStreak + 1 : 1;
    const coinsReward = Math.min(newStreak * 50, 500);

    this.update(d => {
      d.lastDailyTs = now;
      d.dailyStreak = newStreak;
      d.coins += coinsReward;
    });
    return { eligible: true, streak: newStreak, coins: coinsReward };
  }
}

export const store = new Store();
