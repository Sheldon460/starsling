// WebAudio-synthesised sound effects only: no audio files, no network. The context is
// created lazily on the first user gesture (browsers block it before then) and every call
// is a no-op when sound is off or the context never started, so headless screenshots
// and silent play never break.

let context = null;
let muted = false;
let noiseBuffer = null;

function ensureContext() {
  if (context !== null) return context;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    const length = Math.floor(context.sampleRate * 0.5);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  } catch {
    context = null;
  }
  return context;
}

function tone(freqFrom, freqTo, duration, type, gainValue, when = 0) {
  const ctx = ensureContext();
  if (ctx === null || muted) return;
  try {
    const start = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  } catch {
    // Sound must never take the game down with it.
  }
}

function noise(duration, filterFrom, filterTo, gainValue) {
  const ctx = ensureContext();
  if (ctx === null || muted || noiseBuffer === null) return;
  try {
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrom, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, filterTo), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
    source.stop(start + duration + 0.05);
  } catch {
    // Sound must never take the game down with it.
  }
}

export function createAudio() {
  return {
    /** Call on the first gesture so later sounds are allowed to play. */
    unlock() {
      const ctx = ensureContext();
      if (ctx !== null && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    isMuted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    launch() {
      noise(0.45, 300, 2400, 0.22);
      tone(180, 520, 0.35, 'sine', 0.12);
    },
    collect(combo) {
      const base = 660 + Math.min(combo, 12) * 36;
      tone(base, base, 0.14, 'sine', 0.16);
      tone(base * 1.5, base * 1.5, 0.18, 'sine', 0.12, 0.06);
    },
    assist() {
      tone(880, 1320, 0.22, 'triangle', 0.16);
      tone(1320, 1760, 0.26, 'sine', 0.1, 0.09);
    },
    crash() {
      noise(0.35, 900, 90, 0.3);
      tone(140, 40, 0.4, 'sawtooth', 0.18);
    },
    gameOver() {
      const notes = [392, 311, 262, 196];
      for (let index = 0; index < notes.length; index += 1) {
        tone(notes[index], notes[index], 0.32, 'triangle', 0.14, index * 0.16);
      }
    },
  };
}
