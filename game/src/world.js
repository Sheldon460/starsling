// The game's rules and state, with no drawing and no browser in it: the comet, its gravity
// wells, star shards, asteroids, spawning, collisions, score, combo, lives and phases.
// step() advances one fixed step and returns what happened as bit flags, so the caller can
// react (sound, announcements) without the world knowing about screens or sound. The pools
// are allocated once; nothing here allocates after createWorld returns, except the small
// popup list the renderer reads.

import {
  ASTEROID, COMET, FIELD, GRAVITY, LIVES, PHASES, SHARD,
} from './config.js';
import { circlesHit, gravityAt, launchVelocity } from './physics.js';

export const EVENT_LAUNCH = 1;
export const EVENT_COLLECT = 2;
export const EVENT_ASSIST = 4;
export const EVENT_HIT = 8;
export const EVENT_OVER = 16;

/** Comet modes: ready (sitting, waiting for a drag), aim (being pulled back),
 * fly (slung, under gravity), caught (grabbed mid-flight, frozen), dead (waiting to respawn). */
export const MODE_READY = 'ready';
export const MODE_AIM = 'aim';
export const MODE_FLY = 'fly';
export const MODE_CAUGHT = 'caught';
export const MODE_DEAD = 'dead';

const CENTRE = { x: FIELD.width / 2, y: FIELD.height / 2 };
const SHARD_POOL = 12;
const ROCK_POOL = 12;
const VOID_MARGIN = 36;

function farFromPlanets(x, y, planets, clearance) {
  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];
    if (Math.hypot(x - planet.x, y - planet.y) < planet.radius + clearance) return false;
  }
  return true;
}

export function createWorld(random) {
  const planets = [];
  for (let index = 0; index < GRAVITY.planets; index += 1) {
    let x = 0;
    let y = 0;
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt += 1) {
      x = 120 + random() * (FIELD.width - 240);
      y = 110 + random() * (FIELD.height - 220);
      const clearOfCentre = Math.hypot(x - CENTRE.x, y - CENTRE.y) > 170;
      const clearOfOthers = planets.every((other) => Math.hypot(x - other.x, y - other.y) > 280);
      if (clearOfCentre && clearOfOthers) placed = true;
    }
    const radius = GRAVITY.radiusMin + random() * (GRAVITY.radiusMax - GRAVITY.radiusMin);
    const t = (radius - GRAVITY.radiusMin) / (GRAVITY.radiusMax - GRAVITY.radiusMin);
    planets.push({
      x, y, radius,
      strength: GRAVITY.strengthMin + t * (GRAVITY.strengthMax - GRAVITY.strengthMin),
      assisted: false,
    });
  }

  const shards = [];
  for (let index = 0; index < SHARD_POOL; index += 1) {
    shards.push({ active: false, x: 0, y: 0, spin: random() * Math.PI * 2 });
  }
  const rocks = [];
  for (let index = 0; index < ROCK_POOL; index += 1) {
    const verts = [];
    const count = 7 + Math.floor(random() * 3);
    for (let v = 0; v < count; v += 1) verts.push(0.72 + random() * 0.4);
    rocks.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, radius: 0, verts, spin: 0, angle: 0 });
  }

  const comet = {
    x: CENTRE.x, y: CENTRE.y, vx: 0, vy: 0, mode: MODE_READY,
    aimX: CENTRE.x, aimY: CENTRE.y, prevMode: MODE_READY,
    invulnerable: 0, flyTime: 0, respawnTimer: 0, trail: [],
  };
  const popups = [];
  const state = {
    comet, planets, shards, rocks, popups,
    score: 0, best: 0, combo: 0, comboTimer: 0, shardsCollected: 0,
    lives: LIVES, elapsed: 0, phase: 0, shake: 0, flash: 0,
    shardTimer: 0, rockTimer: ASTEROID.interval, assistText: '',
  };

  function reset() {
    comet.x = CENTRE.x;
    comet.y = CENTRE.y;
    comet.vx = 0;
    comet.vy = 0;
    comet.mode = MODE_READY;
    comet.invulnerable = 0;
    comet.flyTime = 0;
    comet.respawnTimer = 0;
    comet.trail.length = 0;
    for (const planet of planets) planet.assisted = false;
    for (const shard of shards) shard.active = false;
    for (const rock of rocks) rock.active = false;
    popups.length = 0;
    state.score = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.shardsCollected = 0;
    state.lives = LIVES;
    state.elapsed = 0;
    state.phase = 0;
    state.shake = 0;
    state.flash = 0;
    state.shardTimer = 0;
    state.rockTimer = ASTEROID.interval;
    state.assistText = '';
    for (let index = 0; index < SHARD.target; index += 1) spawnShard();
  }

  function spawnShard() {
    for (let index = 0; index < shards.length; index += 1) {
      const shard = shards[index];
      if (shard.active) continue;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const x = 50 + random() * (FIELD.width - 100);
        const y = 70 + random() * (FIELD.height - 140);
        if (!farFromPlanets(x, y, planets, SHARD.radius + 34)) continue;
        if (Math.hypot(x - comet.x, y - comet.y) < 90) continue;
        shard.active = true;
        shard.x = x;
        shard.y = y;
        return;
      }
      return;
    }
  }

  function spawnRock() {
    const active = rocks.filter((rock) => rock.active).length;
    const cap = Math.min(
      ASTEROID.max,
      ASTEROID.base + Math.floor(state.elapsed / ASTEROID.perSeconds),
    );
    if (active >= cap) return;
    for (let index = 0; index < rocks.length; index += 1) {
      const rock = rocks[index];
      if (rock.active) continue;
      const edge = Math.floor(random() * 4);
      if (edge === 0) { rock.x = -30; rock.y = random() * FIELD.height; }
      else if (edge === 1) { rock.x = FIELD.width + 30; rock.y = random() * FIELD.height; }
      else if (edge === 2) { rock.x = random() * FIELD.width; rock.y = -30; }
      else { rock.x = random() * FIELD.width; rock.y = FIELD.height + 30; }
      const targetX = FIELD.width * (0.25 + random() * 0.5);
      const targetY = FIELD.height * (0.25 + random() * 0.5);
      const angle = Math.atan2(targetY - rock.y, targetX - rock.x);
      const speed = ASTEROID.speedMin + random() * (ASTEROID.speedMax - ASTEROID.speedMin)
        + state.elapsed * ASTEROID.speedRamp * 0.05;
      rock.vx = Math.cos(angle) * speed;
      rock.vy = Math.sin(angle) * speed;
      rock.radius = ASTEROID.radiusMin + random() * (ASTEROID.radiusMax - ASTEROID.radiusMin);
      rock.angle = random() * Math.PI * 2;
      rock.spin = (random() - 0.5) * 1.2;
      rock.active = true;
      return;
    }
  }

  function addPopup(x, y, text, color) {
    if (popups.length > 8) popups.shift();
    popups.push({ x, y, text, life: 1.1, maxLife: 1.1, color });
  }

  function crash(reason) {
    comet.mode = MODE_DEAD;
    comet.vx = 0;
    comet.vy = 0;
    comet.trail.length = 0;
    comet.respawnTimer = COMET.respawnDelay;
    state.lives -= 1;
    state.combo = 0;
    state.comboTimer = 0;
    state.shake = 14;
    addPopup(comet.x, comet.y - 24, reason === 'void' ? 'LOST TO THE VOID' : 'CRASH', '#f87171');
    let events = EVENT_HIT;
    if (state.lives <= 0) events |= EVENT_OVER;
    return events;
  }

  function respawn() {
    comet.x = CENTRE.x;
    comet.y = CENTRE.y;
    comet.vx = 0;
    comet.vy = 0;
    comet.mode = MODE_READY;
    comet.invulnerable = COMET.invulnerable;
    comet.flyTime = 0;
    for (const planet of planets) planet.assisted = false;
  }

  /** Start pulling back from (x, y): only when the comet is sitting or caught, and near it. */
  function beginAim(x, y) {
    if (comet.mode !== MODE_READY && comet.mode !== MODE_CAUGHT) return false;
    if (Math.hypot(x - comet.x, y - comet.y) > COMET.grabRadius) return false;
    comet.prevMode = comet.mode;
    comet.mode = MODE_AIM;
    comet.aimX = x;
    comet.aimY = y;
    return true;
  }

  function updateAim(x, y) {
    if (comet.mode !== MODE_AIM) return;
    comet.aimX = x;
    comet.aimY = y;
  }

  /** Let go: a real pull slings the comet, a tap just puts it back down. */
  function releaseAim() {
    if (comet.mode !== MODE_AIM) return 0;
    const launch = launchVelocity(comet.x, comet.y, comet.aimX, comet.aimY);
    if (launch === null) {
      comet.mode = comet.prevMode;
      return 0;
    }
    comet.vx = launch.vx;
    comet.vy = launch.vy;
    comet.mode = MODE_FLY;
    comet.flyTime = 0;
    comet.trail.length = 0;
    for (const planet of planets) planet.assisted = false;
    return EVENT_LAUNCH;
  }

  /** Catch the comet mid-flight: it freezes where it is, ready to be re-aimed. */
  function grab() {
    if (comet.mode !== MODE_FLY) return false;
    comet.vx = 0;
    comet.vy = 0;
    comet.mode = MODE_CAUGHT;
    return true;
  }

  /**
   * One fixed step. With `harmless` set (the title screen's backdrop) the comet still
   * flies and the field still lives, but nothing scores and nothing can kill it.
   */
  function step(dt, harmless) {
    let events = 0;
    state.elapsed += dt;
    state.phase = state.score >= PHASES[2] ? 2 : state.score >= PHASES[1] ? 1 : 0;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 26);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.6);
    if (comet.invulnerable > 0) comet.invulnerable = Math.max(0, comet.invulnerable - dt);
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }
    for (let index = popups.length - 1; index >= 0; index -= 1) {
      popups[index].life -= dt;
      if (popups[index].life <= 0) popups.splice(index, 1);
    }

    if (comet.mode === MODE_DEAD) {
      comet.respawnTimer -= dt;
      if (comet.respawnTimer <= 0 && state.lives > 0) respawn();
    } else if (comet.mode === MODE_FLY) {
      const g = gravityAt(comet.x, comet.y, planets);
      comet.vx += g.ax * dt;
      comet.vy += g.ay * dt;
      comet.x += comet.vx * dt;
      comet.y += comet.vy * dt;
      comet.flyTime += dt;
      comet.trail.push({ x: comet.x, y: comet.y });
      if (comet.trail.length > COMET.trail) comet.trail.shift();

      if (!harmless) {
        const out = comet.x < -VOID_MARGIN || comet.x > FIELD.width + VOID_MARGIN
          || comet.y < -VOID_MARGIN || comet.y > FIELD.height + VOID_MARGIN;
        if (out) {
          events |= crash('void');
        } else {
          for (let index = 0; index < planets.length; index += 1) {
            const planet = planets[index];
            const dist = Math.hypot(comet.x - planet.x, comet.y - planet.y);
            if (dist < planet.radius + COMET.radius) {
              if (comet.invulnerable === 0) {
                events |= crash('planet');
                break;
              }
            } else if (dist < planet.radius * GRAVITY.assistRange && !planet.assisted) {
              planet.assisted = true;
              state.score += GRAVITY.assistPoints;
              state.combo += 1;
              state.comboTimer = SHARD.comboWindow;
              state.flash = 1;
              state.assistText = 'GRAVITY ASSIST +50';
              addPopup(planet.x, planet.y - planet.radius - 14, 'GRAVITY ASSIST +50', '#5eead4');
              events |= EVENT_ASSIST;
            }
          }
          if (!(events & EVENT_HIT) && comet.mode === MODE_FLY) {
            for (let index = 0; index < shards.length; index += 1) {
              const shard = shards[index];
              if (!shard.active) continue;
              if (circlesHit(comet.x, comet.y, COMET.radius + 6, shard.x, shard.y, SHARD.radius)) {
                shard.active = false;
                state.shardsCollected += 1;
                state.combo += 1;
                state.comboTimer = SHARD.comboWindow;
                const points = SHARD.points + Math.min(SHARD.comboCap, SHARD.comboStep * (state.combo - 1));
                state.score += points;
                addPopup(shard.x, shard.y - 18, `+${points}`, '#fde68a');
                events |= EVENT_COLLECT;
              }
            }
          }
          if (!(events & EVENT_HIT) && comet.mode === MODE_FLY) {
            for (let index = 0; index < rocks.length; index += 1) {
              const rock = rocks[index];
              if (!rock.active) continue;
              if (circlesHit(comet.x, comet.y, COMET.radius, rock.x, rock.y, rock.radius - 2)) {
                if (comet.invulnerable === 0) {
                  events |= crash('rock');
                  break;
                }
              }
            }
          }
        }
      } else {
        // Title-screen backdrop: a comet that drifts out of the sky simply comes
        // home to the centre, ready to be slung again — no life lost, no score.
        const out = comet.x < -VOID_MARGIN || comet.x > FIELD.width + VOID_MARGIN
          || comet.y < -VOID_MARGIN || comet.y > FIELD.height + VOID_MARGIN;
        if (out) {
          comet.x = CENTRE.x;
          comet.y = CENTRE.y;
          comet.vx = 0;
          comet.vy = 0;
          comet.mode = MODE_READY;
          comet.trail.length = 0;
        }
      }
    }

    let shardCount = 0;
    for (let index = 0; index < shards.length; index += 1) {
      if (shards[index].active) {
        shardCount += 1;
        shards[index].spin += dt * 2;
      }
    }
    if (shardCount < SHARD.target) {
      state.shardTimer -= dt;
      if (state.shardTimer <= 0) {
        spawnShard();
        state.shardTimer = SHARD.respawn;
      }
    }

    state.rockTimer -= dt;
    if (state.rockTimer <= 0) {
      spawnRock();
      state.rockTimer = ASTEROID.interval;
    }
    for (let index = 0; index < rocks.length; index += 1) {
      const rock = rocks[index];
      if (!rock.active) continue;
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.angle += rock.spin * dt;
      if (rock.x < -90 || rock.x > FIELD.width + 90 || rock.y < -90 || rock.y > FIELD.height + 90) {
        rock.active = false;
      }
    }
    return events;
  }

  reset();
  return { state, reset, step, beginAim, updateAim, releaseAim, grab };
}
