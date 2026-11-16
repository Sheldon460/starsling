// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Canvas gradients, glow and particles carry the look; canvas text carries the HUD
// and the panels. Text that holds a number is rebuilt only when the number changes.

import { COMET, FIELD, FONT, LIVES, PALETTES } from './config.js';
import { createRandom } from './random.js';
import { predictPath } from './physics.js';
import { MODE_AIM, MODE_FLY } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const PANEL = { width: 640, top: 150, line: 34, bottom: 76 };
const LIFE_SIZE = 16;
const LIFE_GAP = 9;

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

/** Four-point star path, for shards and the little lives icons. */
function starPath(context, x, y, outer, inner) {
  context.beginPath();
  for (let point = 0; point < 8; point += 1) {
    const radius = point % 2 === 0 ? outer : inner;
    const angle = (point * Math.PI) / 4 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const shardsLabel = cachedLabel('SHARDS ');
  const speedLabel = cachedLabel('SPD ');
  const finalLabel = cachedLabel('SCORE ');
  const comboLabel = cachedLabel('COMBO x');

  // The starfield is fixed per renderer, so the sky never reshuffles between frames.
  const starRandom = createRandom(20261117);
  const stars = [];
  for (let index = 0; index < 190; index += 1) {
    stars.push({
      x: starRandom() * FIELD.width,
      y: starRandom() * FIELD.height,
      size: 0.6 + starRandom() * 1.9,
      layer: 1 + Math.floor(starRandom() * 3),
      twinkle: starRandom() * Math.PI * 2,
    });
  }
  const craters = [];
  for (let planet = 0; planet < 4; planet += 1) {
    const list = [];
    for (let index = 0; index < 5; index += 1) {
      list.push({ a: starRandom() * Math.PI * 2, d: starRandom() * 0.55, r: 3 + starRandom() * 7 });
    }
    craters.push(list);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight = '') {
    const key = `${weight}${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${FONT}`.trim());
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function drawSky(state, palette) {
    const gradient = context.createLinearGradient(0, 0, 0, FIELD.height);
    gradient.addColorStop(0, palette.skyTop);
    gradient.addColorStop(1, palette.skyBottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Nebula blobs: two soft glows that drift almost imperceptibly with time.
    const blobs = [
      { x: 300 + Math.sin(state.elapsed * 0.02) * 12, y: 180, r: 260, c: palette.accent },
      { x: 980, y: 540 + Math.cos(state.elapsed * 0.015) * 10, r: 300, c: palette.accentSoft },
    ];
    for (const blob of blobs) {
      const glow = context.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
      glow.addColorStop(0, blob.c + '22');
      glow.addColorStop(1, blob.c + '00');
      context.fillStyle = glow;
      context.fillRect(blob.x - blob.r, blob.y - blob.r, blob.r * 2, blob.r * 2);
    }
    // Parallax starfield: nearer layers drift further as the comet flies.
    const drift = state.comet.x * 0.02 + state.elapsed * 2;
    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index];
      const x = (((star.x - drift * star.layer * 0.4) % FIELD.width) + FIELD.width) % FIELD.width;
      const alpha = 0.35 + 0.3 * Math.sin(state.elapsed * 1.4 + star.twinkle) + star.layer * 0.12;
      context.globalAlpha = Math.min(1, Math.max(0.15, alpha));
      context.fillStyle = '#ffffff';
      context.fillRect(x, star.y, star.size, star.size);
    }
    context.globalAlpha = 1;
  }

  function drawPlanets(state, palette) {
    for (let index = 0; index < state.planets.length; index += 1) {
      const planet = state.planets[index];
      const glow = context.createRadialGradient(
        planet.x, planet.y, planet.radius * 0.6, planet.x, planet.y, planet.radius * 2.1,
      );
      glow.addColorStop(0, palette.planet[index % palette.planet.length] + '55');
      glow.addColorStop(1, palette.planet[index % palette.planet.length] + '00');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(planet.x, planet.y, planet.radius * 2.1, 0, Math.PI * 2);
      context.fill();
      const body = context.createRadialGradient(
        planet.x - planet.radius * 0.35, planet.y - planet.radius * 0.4, planet.radius * 0.1,
        planet.x, planet.y, planet.radius,
      );
      body.addColorStop(0, palette.accentSoft);
      body.addColorStop(0.35, palette.planet[index % palette.planet.length]);
      body.addColorStop(1, '#0b0b12');
      context.fillStyle = body;
      context.beginPath();
      context.arc(planet.x, planet.y, planet.radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(0,0,0,0.25)';
      for (const crater of craters[index]) {
        context.beginPath();
        context.arc(
          planet.x + Math.cos(crater.a) * crater.d * planet.radius,
          planet.y + Math.sin(crater.a) * crater.d * planet.radius,
          crater.r, 0, Math.PI * 2,
        );
        context.fill();
      }
      // The assist ring: the pass that earns the bonus.
      context.strokeStyle = planet.assisted ? palette.accent + '44' : palette.text + '22';
      context.lineWidth = 1.5;
      context.setLineDash([6, 8]);
      context.beginPath();
      context.arc(planet.x, planet.y, planet.radius * 1.9, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
  }

  function drawShards(state, palette) {
    for (let index = 0; index < state.shards.length; index += 1) {
      const shard = state.shards[index];
      if (!shard.active) continue;
      const pulse = 1 + 0.18 * Math.sin(shard.spin);
      context.save();
      context.translate(shard.x, shard.y);
      context.rotate(Math.sin(shard.spin * 0.5) * 0.25);
      context.shadowColor = palette.shard;
      context.shadowBlur = 14;
      context.fillStyle = palette.shard;
      starPath(context, 0, 0, 15 * pulse, 5.5 * pulse);
      context.fill();
      context.restore();
    }
  }

  function drawRocks(state, palette) {
    for (let index = 0; index < state.rocks.length; index += 1) {
      const rock = state.rocks[index];
      if (!rock.active) continue;
      context.save();
      context.translate(rock.x, rock.y);
      context.rotate(rock.angle);
      context.fillStyle = palette.asteroid;
      context.strokeStyle = 'rgba(255,255,255,0.25)';
      context.lineWidth = 1.5;
      context.beginPath();
      for (let v = 0; v < rock.verts.length; v += 1) {
        const angle = (v / rock.verts.length) * Math.PI * 2;
        const radius = rock.radius * rock.verts[v];
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (v === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }
  }

  function drawComet(state, palette) {
    const comet = state.comet;
    if (comet.mode === 'dead') return;
    // Glowing trail, oldest faintest.
    const trail = comet.trail;
    for (let index = 0; index < trail.length; index += 1) {
      const point = trail[index];
      const t = (index + 1) / trail.length;
      context.globalAlpha = t * 0.55;
      context.fillStyle = palette.accent;
      context.beginPath();
      context.arc(point.x, point.y, COMET.radius * (0.3 + t * 0.7), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    // Blink while invulnerable after a crash: hidden on every other tenth of a second.
    if (comet.invulnerable > 0 && Math.floor(comet.invulnerable * 10) % 2 === 0) return;
    const glow = context.createRadialGradient(
      comet.x, comet.y, 0, comet.x, comet.y, COMET.radius * 3.4,
    );
    glow.addColorStop(0, palette.accent + 'cc');
    glow.addColorStop(0.4, palette.accent + '44');
    glow.addColorStop(1, palette.accent + '00');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(comet.x, comet.y, COMET.radius * 3.4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.comet;
    context.beginPath();
    context.arc(comet.x, comet.y, COMET.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.accent;
    context.beginPath();
    context.arc(comet.x, comet.y, COMET.radius * 0.45, 0, Math.PI * 2);
    context.fill();
  }

  function drawAim(state, palette) {
    const comet = state.comet;
    if (comet.mode !== MODE_AIM) return;
    const dx = comet.x - comet.aimX;
    const dy = comet.y - comet.aimY;
    const pull = Math.hypot(dx, dy);
    // Elastic band from the comet to the pointer.
    context.strokeStyle = palette.accent;
    context.lineWidth = 2;
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(comet.x, comet.y);
    context.lineTo(comet.aimX, comet.aimY);
    context.stroke();
    context.setLineDash([]);
    if (pull < COMET.minPull) return;
    const capped = Math.min(pull, COMET.maxPull);
    const vx = (dx / pull) * capped * COMET.power;
    const vy = (dy / pull) * capped * COMET.power;
    const path = predictPath(comet.x, comet.y, vx, vy, state.planets, state.rocks, FIELD);
    for (let index = 0; index < path.length; index += 1) {
      const point = path[index];
      context.globalAlpha = 0.9 * (1 - index / path.length) + 0.1;
      context.fillStyle = palette.text;
      context.beginPath();
      context.arc(point.x, point.y, index === 0 ? 4 : 3, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawPopups(state) {
    context.textBaseline = 'alphabetic';
    for (let index = 0; index < state.popups.length; index += 1) {
      const popup = state.popups[index];
      const t = popup.life / popup.maxLife;
      context.globalAlpha = Math.min(1, t * 1.6);
      text(popup.text, popup.x, popup.y - (1 - t) * 34, 22, popup.color, 'center', '700');
    }
    context.globalAlpha = 1;
  }

  function drawHud(state, palette, muted) {
    const comet = state.comet;
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 24, 18, 30, palette.text, 'left', '700');
    text(bestLabel(state.best), 24, 52, 18, palette.muted, 'left');
    if (state.combo >= 2) {
      text(comboLabel(state.combo), FIELD.width / 2, 18, 30, palette.accent, 'center', '700');
      text('chain a shard within 4s to keep it', FIELD.width / 2, 52, 16, palette.muted, 'center');
    } else {
      text(PALETTES[state.phase].name.toUpperCase(), FIELD.width / 2, 20, 22, palette.muted, 'center', '600');
    }
    const firstLife = FIELD.width - 24 - LIVES * (LIFE_SIZE + LIFE_GAP) + LIFE_GAP;
    text('LIVES', firstLife - 12, 18, 20, palette.muted, 'right', '600');
    for (let life = 0; life < LIVES; life += 1) {
      context.fillStyle = life < state.lives ? palette.accent : 'rgba(255,255,255,0.14)';
      context.beginPath();
      context.arc(
        firstLife + life * (LIFE_SIZE + LIFE_GAP) + LIFE_SIZE / 2, 26, LIFE_SIZE / 2, 0, Math.PI * 2,
      );
      context.fill();
    }
    text(shardsLabel(state.shardsCollected), FIELD.width - 24, 52, 18, palette.text, 'right');
    const speed = Math.round(Math.hypot(comet.vx, comet.vy));
    text(speedLabel(speed), FIELD.width - 24, 76, 18, palette.muted, 'right');
    text(muted ? 'M: sound off' : 'M: sound on', FIELD.width - 24, 100, 16, palette.muted, 'right');
    if (comet.mode !== MODE_FLY && state.elapsed < 8 && state.score === 0) {
      text('Drag the comet back — release to sling it', FIELD.width / 2, FIELD.height - 44, 20, palette.text, 'center');
      text('Grab it mid-flight to aim again · skim a planet for a gravity assist', FIELD.width / 2, FIELD.height - 18, 16, palette.muted, 'center');
    }
    // Red vignette when the comet nears the void edge.
    if (comet.mode === MODE_FLY) {
      const near = Math.min(comet.x, FIELD.width - comet.x, comet.y, FIELD.height - comet.y);
      if (near < 70) {
        const alpha = (1 - near / 70) * (0.35 + 0.15 * Math.sin(state.elapsed * 6));
        context.strokeStyle = `rgba(248,113,113,${alpha.toFixed(3)})`;
        context.lineWidth = 10;
        context.strokeRect(5, 5, FIELD.width - 10, FIELD.height - 10);
      }
    }
  }

  function drawPanel(title, lines, prompt, palette) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(8,8,16,0.82)';
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = palette.accent;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 82, 52, palette.text, 'center', '800');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 21, palette.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 38, 23, palette.accent, 'center', '700');
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, muted) {
    const palette = PALETTES[state.phase];
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = palette.skyTop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    drawSky(state, palette);
    drawPlanets(state, palette);
    drawShards(state, palette);
    drawRocks(state, palette);
    drawAim(state, palette);
    drawComet(state, palette);
    drawPopups(state);
    if (screen === SCREEN_TITLE) {
      const lines = [
        'An endless gravity-slingshot arcade.',
        'Drag the comet back, release to sling it.',
        'Catch star-shards, skim a planet for a gravity assist,',
        'dodge the rocks — and mind the edge of the void.',
        '',
        `Best ${best}`,
      ];
      drawPanel('STARSLING', lines, 'Click or press Space to play', palette);
      return;
    }
    drawHud(state, palette, muted);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The comet will wait for you.'], 'Press P to resume', palette);
    } else if (screen === SCREEN_OVER) {
      const lines = [
        `Score ${state.score}`,
        state.score >= best && state.score > 0 ? 'A new best — the sky is yours.' : `Best ${best}`,
        `${state.shardsCollected} star-shards caught`,
        '',
      ];
      drawPanel('GAME OVER', lines, 'Press Space or click to fly again', palette);
    }
    if (state.flash > 0) {
      context.fillStyle = `rgba(94,234,212,${(state.flash * 0.1).toFixed(3)})`;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
