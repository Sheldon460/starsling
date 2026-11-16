// The screenshot scenes behind ?shot=start|play|assist|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot
// (grab the comet, aim at the nearest shard — or, for the assist scene, at a planet's edge
// — sling it, catch it again when it slows), so the frame is what a short game really
// looks like and the same seed always gives the same frame.

import { COMET, FIELD, STEP } from './config.js';
import {
  EVENT_ASSIST, EVENT_OVER, MODE_CAUGHT, MODE_FLY, MODE_READY,
} from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const ASSIST_LIMIT_SECONDS = 150;
const END_LIMIT_SECONDS = 600;

/** Nearest active shard to the comet, or null when the field is momentarily empty. */
function nearestShard(state) {
  const comet = state.comet;
  let bestShard = null;
  let bestDist = Infinity;
  for (let index = 0; index < state.shards.length; index += 1) {
    const shard = state.shards[index];
    if (!shard.active) continue;
    const dist = Math.hypot(shard.x - comet.x, shard.y - comet.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestShard = shard;
    }
  }
  return bestShard;
}

function nearestPlanet(state) {
  const comet = state.comet;
  let bestPlanet = null;
  let bestDist = Infinity;
  for (let index = 0; index < state.planets.length; index += 1) {
    const planet = state.planets[index];
    const dist = Math.hypot(planet.x - comet.x, planet.y - comet.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestPlanet = planet;
    }
  }
  return bestPlanet;
}

/**
 * Aim the comet at (targetX, targetY) with the given launch speed: pull back along the
 * opposite direction and release. `error` turns the aim by that many radians.
 */
function aimAndRelease(world, targetX, targetY, speed, error = 0) {
  const comet = world.state.comet;
  const dx = targetX - comet.x;
  const dy = targetY - comet.y;
  const dist = Math.hypot(dx, dy) || 1;
  const base = Math.atan2(dy, dx) + error;
  const dirX = Math.cos(base);
  const dirY = Math.sin(base);
  const pull = Math.min(COMET.maxPull, Math.max(COMET.minPull + 1, speed / COMET.power));
  world.beginAim(comet.x, comet.y);
  world.updateAim(comet.x - dirX * pull, comet.y - dirY * pull);
  return world.releaseAim();
}

/**
 * One autopilot decision per step. Careful mode chases shards, catches the comet when it
 * slows or nears the void, and (when `seekPlanet`) aims past a planet's edge so the shot
 * catches a gravity assist. Reckless mode over-pulls, aims off and never catches a comet
 * heading for the edge, so it is caught out once the rocks speed up.
 */
function autopilot(state, world, { seekPlanet = false, reckless = false } = {}) {
  const comet = state.comet;
  if (comet.mode === MODE_READY || comet.mode === MODE_CAUGHT) {
    const shard = nearestShard(state);
    const planet = nearestPlanet(state);
    if (seekPlanet && planet !== null && (shard === null || Math.hypot(shard.x - comet.x, shard.y - comet.y) > 260)) {
      const dx = planet.x - comet.x;
      const dy = planet.y - comet.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Aim at a point offset from the planet's centre, so the path skims its edge.
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const targetX = planet.x + perpX * planet.radius * 1.2;
      const targetY = planet.y + perpY * planet.radius * 1.2;
      return aimAndRelease(world, targetX, targetY, 520);
    }
    if (shard !== null) {
      const dist = Math.hypot(shard.x - comet.x, shard.y - comet.y);
      const speed = reckless ? 748 : Math.min(620, Math.max(300, dist * 1.15));
      return aimAndRelease(world, shard.x, shard.y, speed, reckless ? 0.42 : 0);
    }
    if (planet !== null) return aimAndRelease(world, planet.x, planet.y, 480);
    return 0;
  }
  if (comet.mode === MODE_FLY) {
    const speed = Math.hypot(comet.vx, comet.vy);
    const nearEdge = Math.min(comet.x, FIELD.width - comet.x, comet.y, FIELD.height - comet.y);
    const slowEnough = reckless ? speed < 40 : speed < COMET.catchSpeed;
    const tooLong = reckless ? comet.flyTime > 6 : comet.flyTime > COMET.catchAfter;
    if (slowEnough || tooLong || (!reckless && nearEdge < 90)) world.grab();
  }
  return 0;
}

/**
 * Set `world` to the named scene (start, play, assist or end; any other name is start)
 * and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'assist' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      autopilot(world.state, world, {});
      world.step(STEP, true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'assist') {
    let assisted = false;
    for (let index = 0; index < ASSIST_LIMIT_SECONDS / STEP; index += 1) {
      autopilot(world.state, world, { seekPlanet: true });
      if (world.step(STEP, false) & EVENT_ASSIST) assisted = true;
      if (assisted) {
        // Let the assist flash and popup show for another second of flight.
        for (let extra = 0; extra < 1 / STEP; extra += 1) {
          autopilot(world.state, world, {});
          world.step(STEP, false);
        }
        break;
      }
      if (world.state.lives === 0) break;
    }
    return { screen: SCREEN_PLAY, best: world.state.score };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const reckless = name === 'end';
  for (let index = 0; index < limit / STEP; index += 1) {
    autopilot(world.state, world, { reckless });
    if (world.step(STEP, false) & EVENT_OVER) break;
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
