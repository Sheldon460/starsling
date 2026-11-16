// Gravity and trajectory maths, with no drawing and no browser in it: the pull of each
// planet on a point, the dotted path a launch would take, and circle collision tests.
// Pure functions over plain numbers, so the world, the renderer and the autopilot share them.

import { COMET, GRAVITY } from './config.js';

/**
 * Acceleration on `body` from every planet: G / (dist^2 + soft^2) toward the planet's
 * centre, capped so a near miss bends hard but never explodes the numbers.
 */
export function gravityAt(x, y, planets) {
  let ax = 0;
  let ay = 0;
  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];
    const dx = planet.x - x;
    const dy = planet.y - y;
    const distSq = dx * dx + dy * dy + planet.radius * planet.radius;
    const pull = planet.strength / distSq;
    const dist = Math.sqrt(distSq);
    ax += (dx / dist) * pull;
    ay += (dy / dist) * pull;
  }
  const mag = Math.hypot(ax, ay);
  if (mag > GRAVITY.maxAccel) {
    ax = (ax / mag) * GRAVITY.maxAccel;
    ay = (ay / mag) * GRAVITY.maxAccel;
  }
  return { ax, ay };
}

/**
 * The path a launch from (x, y) with (vx, vy) would take: simulate forward in 1/30 s
 * steps, stop on a planet, an asteroid or the field edge, return the sampled points.
 */
export function predictPath(x, y, vx, vy, planets, asteroids, field, steps = 90) {
  const points = [];
  let px = x;
  let py = y;
  let pvx = vx;
  let pvy = vy;
  const dt = 1 / 30;
  for (let step = 0; step < steps; step += 1) {
    const g = gravityAt(px, py, planets);
    pvx += g.ax * dt;
    pvy += g.ay * dt;
    px += pvx * dt;
    py += pvy * dt;
    if (px < 0 || px > field.width || py < 0 || py > field.height) break;
    let blocked = false;
    for (let index = 0; index < planets.length; index += 1) {
      const planet = planets[index];
      if (Math.hypot(px - planet.x, py - planet.y) < planet.radius + COMET.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    for (let index = 0; index < asteroids.length; index += 1) {
      const rock = asteroids[index];
      if (!rock.active) continue;
      if (Math.hypot(px - rock.x, py - rock.y) < rock.radius + COMET.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    if (step % 3 === 0) points.push({ x: px, y: py });
  }
  return points;
}

/** True when two circles touch. */
export function circlesHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const reach = ar + br;
  return dx * dx + dy * dy < reach * reach;
}

/** Launch velocity for a pull from the comet to `pointer`: pull back, fly forward. */
export function launchVelocity(cometX, cometY, pointerX, pointerY) {
  let dx = cometX - pointerX;
  let dy = cometY - pointerY;
  const pull = Math.hypot(dx, dy);
  if (pull < COMET.minPull) return null;
  const capped = Math.min(pull, COMET.maxPull);
  dx = (dx / pull) * capped;
  dy = (dy / pull) * capped;
  return { vx: dx * COMET.power, vy: dy * COMET.power, pull: capped };
}
