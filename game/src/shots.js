// The screenshot scenes behind ?shot=start|play|assist|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot:
// it simulates each candidate launch with the same gravity the game uses, and only slings
// the comet on a path that survives — chasing shards in play, skimming a planet's edge in
// the assist scene — so the frame is what a short game really looks like and the same
// seed always gives the same frame.

import { COMET, FIELD, STEP } from './config.js';
import { simulatePath } from './physics.js';
import {
  EVENT_ASSIST, EVENT_OVER, MODE_CAUGHT, MODE_FLY, MODE_READY,
} from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const ASSIST_LIMIT_SECONDS = 150;
const END_CAREFUL_SECONDS = 18;
const END_LIMIT_SECONDS = 600;

/** Nearest active shards to the comet, nearest first. */
function nearestShards(state, count = 3) {
  const comet = state.comet;
  const found = [];
  for (let index = 0; index < state.shards.length; index += 1) {
    const shard = state.shards[index];
    if (!shard.active) continue;
    found.push({ shard, dist: Math.hypot(shard.x - comet.x, shard.y - comet.y) });
  }
  found.sort((a, b) => a.dist - b.dist);
  return found.slice(0, count);
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
 * The pull-back point and velocity for aiming at (targetX, targetY) with `speed`,
 * turned by `error` radians. Null when the pull would be too small to launch.
 */
function launchFor(comet, targetX, targetY, speed, error = 0) {
  const dx = targetX - comet.x;
  const dy = targetY - comet.y;
  const dist = Math.hypot(dx, dy) || 1;
  const base = Math.atan2(dy, dx) + error;
  const dirX = Math.cos(base);
  const dirY = Math.sin(base);
  const pull = Math.min(COMET.maxPull, Math.max(COMET.minPull + 1, speed / COMET.power));
  return {
    aimX: comet.x - dirX * pull,
    aimY: comet.y - dirY * pull,
    vx: dirX * pull * COMET.power,
    vy: dirY * pull * COMET.power,
  };
}

/** Simulate a candidate launch; the score says how good it is (higher is better). */
function scoreLaunch(state, launch, targetX, targetY) {
  const sim = simulatePath(
    state.comet.x, state.comet.y, launch.vx, launch.vy,
    state.planets, state.rocks, FIELD,
  );
  let targetGap = Infinity;
  for (let index = 0; index < sim.points.length; index += 1) {
    const gap = Math.hypot(sim.points[index].x - targetX, sim.points[index].y - targetY);
    if (gap < targetGap) targetGap = gap;
  }
  return { sim, score: sim.points.length * 4 - targetGap };
}

/**
 * Pick a safe launch toward a shard: the candidate whose simulated path flies longest
 * and passes closest to its shard, among the nearest shards and a few speeds.
 * A path is safe when it hits no planet and no rock in its first stretch; reaching the
 * field edge is allowed — the autopilot catches the comet before the void takes it.
 * Null when nothing simulated safe — the caller then waits a step and tries again.
 */
function pickShardLaunch(state) {
  const comet = state.comet;
  let best = null;
  for (const { shard, dist } of nearestShards(state)) {
    for (const speed of [Math.min(620, Math.max(300, dist * 1.15)), 420, 560]) {
      const launch = launchFor(comet, shard.x, shard.y, speed);
      const { sim, score } = scoreLaunch(state, launch, shard.x, shard.y);
      if ((sim.hit !== null && sim.hit !== 'edge') || sim.points.length < 8) continue;
      if (best === null || score > best.score) best = { launch, score };
    }
  }
  return best === null ? null : best.launch;
}

/**
 * Pick a launch that skims a planet: the candidate whose closest pass to the planet
 * lands inside the assist band (close enough to count, far enough to live), with a
 * clean simulated path. Null when no candidate qualifies yet.
 */
function pickAssistLaunch(state) {
  const comet = state.comet;
  const planet = nearestPlanet(state);
  if (planet === null) return null;
  const planetIndex = state.planets.indexOf(planet);
  const dx = planet.x - comet.x;
  const dy = planet.y - comet.y;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  let best = null;
  for (const side of [1, -1]) {
    for (const offset of [1.25, 1.5, 1.75]) {
      for (const speed of [520, 420, 620]) {
        const targetX = planet.x + perpX * side * planet.radius * offset;
        const targetY = planet.y + perpY * side * planet.radius * offset;
        const launch = launchFor(comet, targetX, targetY, speed);
        const sim = simulatePath(
          comet.x, comet.y, launch.vx, launch.vy, state.planets, state.rocks, FIELD,
        );
        if ((sim.hit !== null && sim.hit !== 'edge') || sim.points.length < 10) continue;
        const pass = sim.closest[planetIndex] / planet.radius;
        if (pass < 1.12 || pass > 1.8) continue;
        const score = -Math.abs(pass - 1.45) * 100 + sim.points.length;
        if (best === null || score > best.score) best = { launch, score };
      }
    }
  }
  return best === null ? null : best.launch;
}

function sling(world, launch) {
  const comet = world.state.comet;
  world.beginAim(comet.x, comet.y);
  world.updateAim(launch.aimX, launch.aimY);
  return world.releaseAim();
}

/**
 * One autopilot decision per step. Careful mode chases shards on simulated-safe paths
 * and catches the comet when it slows or nears the void; assist mode first looks for a
 * planet skim, and chases shards while none is on offer. Reckless mode over-pulls, aims
 * off and never catches a comet heading for the edge, so it is caught out once the
 * rocks speed up.
 */
function autopilot(state, world, { seekPlanet = false, reckless = false } = {}) {
  const comet = state.comet;
  if (comet.mode === MODE_READY || comet.mode === MODE_CAUGHT) {
    if (seekPlanet) {
      const assist = pickAssistLaunch(state);
      if (assist !== null) return sling(world, assist);
    }
    if (reckless) {
      const found = nearestShards(state, 1)[0];
      if (found !== undefined) {
        const launch = launchFor(comet, found.shard.x, found.shard.y, 680, 0.3);
        return sling(world, launch);
      }
      return 0;
    }
    const launch = pickShardLaunch(state);
    if (launch !== null) return sling(world, launch);
    // No safe path right now (a rock is crossing): wait a step, the field moves on.
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

/** Pose the comet in aim mode toward a shard, so the final frame shows the trajectory. */
function poseAim(state, world) {
  const comet = state.comet;
  if (comet.mode === MODE_FLY) world.grab();
  if (comet.mode !== MODE_READY && comet.mode !== MODE_CAUGHT) return;
  const launch = pickShardLaunch(state);
  if (launch === null) return;
  world.beginAim(comet.x, comet.y);
  world.updateAim(launch.aimX, launch.aimY);
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
        // Let the assist flash and popup show for a beat of flight.
        for (let extra = 0; extra < 0.45 / STEP; extra += 1) {
          autopilot(world.state, world, {});
          world.step(STEP, false);
        }
        break;
      }
      if (world.state.lives === 0) break;
    }
    return { screen: SCREEN_PLAY, best: world.state.score };
  }
  if (name === 'play') {
    for (let index = 0; index < PLAY_SECONDS / STEP; index += 1) {
      autopilot(world.state, world, {});
      if (world.step(STEP, false) & EVENT_OVER) break;
    }
    poseAim(world.state, world);
    const over = world.state.lives === 0;
    return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
  }
  // End: a careful opening builds a real score, then a reckless pilot loses it all.
  for (let index = 0; index < END_CAREFUL_SECONDS / STEP; index += 1) {
    autopilot(world.state, world, {});
    if (world.step(STEP, false) & EVENT_OVER) break;
  }
  if (world.state.lives > 0) {
    for (let index = 0; index < END_LIMIT_SECONDS / STEP; index += 1) {
      autopilot(world.state, world, { reckless: true });
      if (world.step(STEP, false) & EVENT_OVER) break;
    }
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
