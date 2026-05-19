// ─── Quantum Merge Audio System ───────────────────────────────────────────────
// Procedural synthwave music + SFX using Web Audio API

type AudioCtx = AudioContext;

interface AudioSystem {
  playDrop(level: number): void;
  playMerge(level: number): void;
  playCombo(n: number): void;
  playGameOver(): void;
  playAchievement(): void;
  playDailyReward(): void;
  startMusic(): void;
  stopMusic(): void;
  resume(): void;
  setMusicVol(v: number): void;
  setSfxVol(v: number): void;
  destroy(): void;
}

// E minor pentatonic — good for synthwave
const E_MINOR_PENTA = [82.41, 98.0, 110.0, 123.47, 146.83, 164.81, 196.0, 220.0, 246.94, 293.66, 329.63];
const BPM = 120;
const STEP_MS = (60000 / BPM) / 4; // 16th note

const BASS_PATTERN = [0, -1, 0, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, 0, -1, -1];
const ARP_PATTERN  = [7, -1, 9, -1, -1, 10, -1, 7, -1, 9, 10, -1, 7, -1, 9, -1];
const KICK_PATTERN = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const SNARE_PATTERN = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const HAT_PATTERN  = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1];

function mk(ctx: AudioCtx): AudioSystem {
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);

  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.28;
  musicBus.connect(masterGain);

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(masterGain);

  // Reverb (convolver sim via delay)
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.18;
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0.3;
  delay.connect(delayFb);
  delayFb.connect(delay);
  delay.connect(musicBus);

  let stepIdx = 0;
  let seqTimeout: ReturnType<typeof setTimeout> | null = null;
  let musicRunning = false;

  function osc(type: OscillatorType, freq: number, dest: AudioNode, startT: number, stopT: number, startVol: number, endVol: number, endT: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(dest);
    o.type = type;
    o.frequency.setValueAtTime(freq, startT);
    g.gain.setValueAtTime(startVol, startT);
    g.gain.exponentialRampToValueAtTime(Math.max(endVol, 0.0001), endT);
    o.start(startT); o.stop(stopT);
  }

  function kick(t: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(musicBus);
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.start(t); o.stop(t + 0.2);
  }

  function snare(t: number) {
    // Noise burst
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass"; hpf.frequency.value = 1800;
    const g = ctx.createGain();
    src.connect(hpf); hpf.connect(g); g.connect(musicBus);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.start(t); src.stop(t + 0.15);
    // Body tone
    osc("triangle", 220, musicBus, t, t + 0.06, 0.2, 0.001, t + 0.06);
  }

  function hihat(t: number, open = false) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass"; hpf.frequency.value = 7000;
    const g = ctx.createGain();
    src.connect(hpf); hpf.connect(g); g.connect(musicBus);
    const dur = open ? 0.12 : 0.04;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur + 0.01);
  }

  function bassNote(freq: number, t: number, dur: number) {
    const o = ctx.createOscillator();
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass"; lpf.frequency.value = 800;
    const g = ctx.createGain();
    o.connect(lpf); lpf.connect(g); g.connect(musicBus);
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.5, t + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.01);
  }

  function arpNote(freq: number, t: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(delay); g.connect(musicBus);
    o.type = "square";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.start(t); o.stop(t + 0.12);
  }

  // Pad chord (plays every 2 bars)
  function padChord(t: number) {
    const freqs = [164.81, 196.0, 220.0, 261.63]; // E3 minor chord
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lpf = ctx.createBiquadFilter();
      lpf.type = "lowpass"; lpf.frequency.value = 1200;
      o.connect(lpf); lpf.connect(g); g.connect(musicBus);
      o.type = "triangle";
      o.frequency.setValueAtTime(f * (1 + i * 0.002), t); // slight detune
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.3);
      g.gain.setValueAtTime(0.06, t + 1.5);
      g.gain.linearRampToValueAtTime(0, t + 2.0);
      o.start(t); o.stop(t + 2.1);
    });
  }

  function step() {
    if (!musicRunning) return;
    const t = ctx.currentTime + 0.02; // slight lookahead
    const stepDur = STEP_MS / 1000;
    const i = stepIdx % 16;

    if (KICK_PATTERN[i]) kick(t);
    if (SNARE_PATTERN[i]) snare(t);
    if (HAT_PATTERN[i]) hihat(t, i === 15);

    const bassIdx = BASS_PATTERN[i];
    if (bassIdx >= 0) bassNote(E_MINOR_PENTA[bassIdx] * 2, t, stepDur * 1.8);

    const arpIdx = ARP_PATTERN[i];
    if (arpIdx >= 0) arpNote(E_MINOR_PENTA[arpIdx] * 4, t);

    // Pad every 32 steps
    if (stepIdx % 32 === 0) padChord(t);

    stepIdx++;
    seqTimeout = setTimeout(step, STEP_MS - 4);
  }

  // ── SFX ──────────────────────────────────────────────────────────────────────
  const NOTE_FREQS = [261.6, 329.6, 392.0, 523.2, 659.3, 880.0, 1046.5, 1318.5];

  function playDrop(level: number) {
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    osc("sine", 300 + level * 70, sfxBus, t, t + 0.14, 0.3, 0.001, t + 0.14);
    osc("sine", 180 + level * 35, sfxBus, t + 0.01, t + 0.14, 0.15, 0.001, t + 0.14);
  }

  function playMerge(level: number) {
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    const base = NOTE_FREQS[Math.min(level, NOTE_FREQS.length - 1)];
    const intervals = [0, 4, 7, 12, 14, 17].slice(0, 2 + level);
    intervals.forEach((semitone, i) => {
      const freq = base * Math.pow(2, semitone / 12);
      const type: OscillatorType = i === 0 ? "triangle" : "sine";
      const vol = 0.32 - i * 0.03;
      osc(type, freq, sfxBus, t + i * 0.01, t + 0.55 + level * 0.06, vol, 0.001, t + 0.55 + level * 0.06);
    });
    if (level >= 3) {
      osc("sawtooth", 80 + level * 18, sfxBus, t, t + 0.18, 0.18, 0.001, t + 0.18);
    }
  }

  function playCombo(n: number) {
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    const f = 380 + n * 90;
    osc("square", f, sfxBus, t, t + 0.1, 0.1, 0.001, t + 0.1);
    osc("square", f * 1.5, sfxBus, t + 0.04, t + 0.1, 0.06, 0.001, t + 0.1);
  }

  function playGameOver() {
    if (ctx.state === "suspended") return;
    [440, 370, 311, 261.6, 220, 185, 155].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.14;
      osc("sawtooth", f, sfxBus, t, t + 0.28, 0.28, 0.001, t + 0.28);
    });
  }

  function playAchievement() {
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    [523.2, 659.3, 783.99, 1046.5].forEach((f, i) => {
      osc("triangle", f, sfxBus, t + i * 0.07, t + i * 0.07 + 0.22, 0.22, 0.001, t + i * 0.07 + 0.22);
    });
  }

  function playDailyReward() {
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    [329.6, 415.3, 523.2, 622.3, 783.99].forEach((f, i) => {
      osc("triangle", f, sfxBus, t + i * 0.06, t + i * 0.06 + 0.3, 0.2, 0.001, t + i * 0.06 + 0.3);
    });
  }

  return {
    playDrop, playMerge, playCombo, playGameOver, playAchievement, playDailyReward,
    startMusic() {
      if (musicRunning) return;
      musicRunning = true;
      stepIdx = 0;
      step();
    },
    stopMusic() {
      musicRunning = false;
      if (seqTimeout) { clearTimeout(seqTimeout); seqTimeout = null; }
    },
    resume() {
      if (ctx.state === "suspended") ctx.resume();
    },
    setMusicVol(v: number) { musicBus.gain.setTargetAtTime(v * 0.28, ctx.currentTime, 0.1); },
    setSfxVol(v: number) { sfxBus.gain.setTargetAtTime(v * 0.9, ctx.currentTime, 0.1); },
    destroy() {
      musicRunning = false;
      if (seqTimeout) clearTimeout(seqTimeout);
      ctx.close();
    },
  };
}

let _instance: AudioSystem | null = null;
let _ctx: AudioCtx | null = null;

export function getAudio(): AudioSystem {
  if (!_instance) {
    _ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    _instance = mk(_ctx);
  }
  return _instance;
}

export type { AudioSystem };
