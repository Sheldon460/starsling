// Every tuning number and colour in one place. The playfield is a fixed 1280x720 logical
// area; the renderer scales it to the window, so no rule below depends on screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const LIVES = 3;

/** The comet the player slings. Radius is its hit size; grabRadius is how close a
 * pointer (or the autopilot) must be to catch it mid-flight. */
export const COMET = {
  radius: 10,
  grabRadius: 78,
  /** Pixels of pull-back map to launch speed at this rate. */
  power: 3.4,
  maxPull: 220,
  minPull: 14,
  /** Caught mid-flight when it has slowed below this, or after this many seconds. */
  catchSpeed: 110,
  catchAfter: 4.5,
  invulnerable: 2,
  respawnDelay: 0.9,
  /** Trail points kept for the glowing tail. */
  trail: 26,
};

/** Gravity wells. accel = strength / (dist^2 + soft^2), capped, pulling the comet in. */
export const GRAVITY = {
  planets: 4,
  radiusMin: 46,
  radiusMax: 74,
  strengthMin: 6_000_000,
  strengthMax: 11_000_000,
  maxAccel: 3200,
  /** A pass closer than radius * assistRange (without touching) is a gravity assist. */
  assistRange: 1.9,
  assistPoints: 50,
};

/** Star shards: the points. Combo grows per shard while the chain is unbroken. */
export const SHARD = {
  radius: 13,
  target: 6,
  points: 10,
  comboStep: 5,
  comboCap: 50,
  comboWindow: 4,
  respawn: 0.8,
};

/** Asteroids: drifting hazards. Count and speed grow with elapsed play time. */
export const ASTEROID = {
  radiusMin: 14,
  radiusMax: 26,
  speedMin: 42,
  speedMax: 130,
  speedRamp: 1.6,
  base: 2,
  perSeconds: 22,
  max: 8,
  interval: 2.4,
};

/** Score at which the palette shifts phase: dusk ember -> teal nebula -> violet deep. */
export const PHASES = [0, 300, 800];

/** Three palettes, one per phase. Accent is the phase's signature colour. */
export const PALETTES = [
  {
    name: 'Dusk Ember',
    skyTop: '#160b08',
    skyBottom: '#2e1a10',
    accent: '#f97316',
    accentSoft: '#fb923c',
    shard: '#fbbf24',
    planet: ['#b45309', '#7c2d12', '#9a3412', '#92400e'],
    asteroid: '#78716c',
    text: '#fdeee3',
    muted: '#c9a793',
    comet: '#fff7ed',
  },
  {
    name: 'Teal Nebula',
    skyTop: '#04181d',
    skyBottom: '#0a2e33',
    accent: '#2dd4bf',
    accentSoft: '#5eead4',
    shard: '#fde68a',
    planet: ['#0f766e', '#155e75', '#0e7490', '#115e59'],
    asteroid: '#64748b',
    text: '#e6fffa',
    muted: '#8fd0c5',
    comet: '#f0fdfa',
  },
  {
    name: 'Violet Deep',
    skyTop: '#120a24',
    skyBottom: '#2a1650',
    accent: '#a78bfa',
    accentSoft: '#c4b5fd',
    shard: '#fcd34d',
    planet: ['#6d28d9', '#7c3aed', '#5b21b6', '#4c1d95'],
    asteroid: '#6b7280',
    text: '#f3efff',
    muted: '#b7a6e8',
    comet: '#faf5ff',
  },
];

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'starsling.best';
