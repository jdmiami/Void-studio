const TAU = Math.PI * 2;
export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export const families = {
  energy: { label: 'Energy', instruction: 'Bring both hands together, then pull them apart.', accent: '#ffb05e', size: 'Field strength' },
  portal: { label: 'Portal', instruction: 'Draw a circle with your hand to open a portal.', accent: '#68edff', size: 'Portal size' },
  elements: { label: 'Elements', instruction: 'Sweep your hands to paint the air.', accent: '#ff9860', size: 'Trail intensity' },
  aura: { label: 'Aura', instruction: 'Step back and move your body to shape the aura.', accent: '#c5a0ff', size: 'Aura intensity' },
};

export const palettes = {
  fire: ['#ff941f', '#ffdc8d', '#fff3d4'],
  water: ['#1cbbf2', '#65e9ff', '#d8ffff'],
  air: ['#8fbbfc', '#c3dcff', '#f6faff'],
  lightning: ['#a580ff', '#dec2ff', '#ffffff'],
};
const colors = { ...palettes, portal: ['#19c7fb', '#5cecff', '#ddfdff'] };
const portalSprite = new Image();
portalSprite.src = '/art/portal-energy.webp';
let emberSprite;

function portalTexture(ember) {
  if (!portalSprite.naturalWidth) return null;
  if (!ember) return portalSprite;
  if (emberSprite) return emberSprite;
  const texture = document.createElement('canvas');
  texture.width = portalSprite.naturalWidth;
  texture.height = portalSprite.naturalHeight;
  const context = texture.getContext('2d', { willReadFrequently: true });
  context.drawImage(portalSprite, 0, 0);
  const pixels = context.getImageData(0, 0, texture.width, texture.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luma = Math.max(0, pixels.data[i + 1] - 4);
    pixels.data[i] = luma * 1.18;
    pixels.data[i + 1] = luma * .62;
    pixels.data[i + 2] = luma * .23 + Math.max(0, luma - 180) * .8;
  }
  context.putImageData(pixels, 0, 0);
  emberSprite = texture;
  return texture;
}

function plasma(ctx, x, y, rx, ry, angle, alpha, ember = false) {
  const texture = portalTexture(ember);
  if (!texture || alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = clamp(alpha);
  ctx.drawImage(texture, -rx / .85, -ry / .85, rx * 2 / .85, ry * 2 / .85);
  ctx.restore();
}

function cover(context, source, width, height, zoom, mirror) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const scale = Math.max(width / sw, height / sh) * zoom;
  const w = sw * scale;
  const h = sh * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  if (context) {
    context.save();
    if (mirror) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(source, x, y, w, h);
    context.restore();
  }
  return { x, y, w, h, mirror };
}

export function project(point, fit, width, height) {
  if (!point || !fit) return null;
  return {
    x: (fit.x + (fit.mirror ? 1 - point.x : point.x) * fit.w) / width,
    y: (fit.y + point.y * fit.h) / height,
    z: point.z || 0,
  };
}

const fract = value => value - Math.floor(value);
const noise = n => fract(Math.sin(n * 91.137 + 33.7) * 46374.241);
const rgba = (hex, alpha) => {
  const number = Number.parseInt(hex.slice(1), 16);
  return `rgba(${number >> 16},${number >> 8 & 255},${number & 255},${clamp(alpha)})`;
};

function light(ctx, x, y, radius, tint, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  const bloom = ctx.createRadialGradient(x, y, 0, x, y, radius);
  bloom.addColorStop(0, rgba(tint, alpha));
  bloom.addColorStop(.24, rgba(tint, alpha * .42));
  bloom.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function ribbon(ctx, trace, tint, width, alpha, steps = 72) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = trace(i / steps);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = rgba(tint, alpha);
  ctx.stroke();
}

function vortex(ctx, x, y, rx, ry, time, power, count, palette, width, twist = .12) {
  if (rx < 1 || ry < 1 || power <= 0) return;
  const unit = width / 420;
  const [base, bright, core] = palette;
  light(ctx, x, y - ry * .88, rx * .8, base, .33 * power);
  light(ctx, x + rx * .79, y - ry * .27, rx * .61, base, .26 * power);

  for (let i = 0; i < 35; i++) {
    const phase = i / 35 * TAU;
    const a = phase + time * .32;
    const pulse = .27 + .73 * Math.pow(.5 + .5 * Math.sin(a * 2.1 + .34), 3);
    const ripple = 1 + .065 * Math.sin(a * 5.8 - time * 1.3);
    const px = x + Math.cos(a) * rx * ripple;
    const py = y + Math.sin(a) * ry * ripple + Math.cos(a) * ry * twist;
    light(ctx, px, py, rx * (.10 + noise(i + 41) * .16), base, pulse * .32 * power);
    if (i % 3 === 0) light(ctx, px, py, rx * .11, bright, pulse * .26 * power);
  }

  const strands = Math.max(5, Math.round(count / 9));
  for (let i = 0; i < strands; i++) {
    const seed = noise(i + 3);
    const drift = time * (.22 + seed * .32);
    const phase = i * .49 + drift;
    const extent = i % 4 === 0 ? TAU * .99 : TAU * (.21 + seed * .6);
    const curve = progress => {
      const a = phase + extent * progress;
      const distortion = Math.sin(a * 3.1 - time * 1.5 + i * .41) * (.04 + seed * .12)
        + Math.cos(a * 6 + time * 1.1 + i) * .033;
      const taper = 1 + (seed - .5) * .29 + distortion;
      return [x + Math.cos(a) * rx * taper, y + Math.sin(a) * ry * taper + Math.cos(a) * ry * twist];
    };
    if (i % 3 === 0) ribbon(ctx, curve, base, (4 + seed * 6) * unit, .14 * power);
    ribbon(ctx, curve, i % 4 ? bright : core, (.29 + seed * .89) * unit, (.2 + seed * .56) * power);
  }

  for (let i = 0; i < 5; i++) {
    const angle = -2.38 + i * 1.19 + time * (.17 + i * .027);
    const filament = p => {
      const a = angle + p * (.49 + i * .075);
      const taper = Math.sin(Math.PI * p);
      const fold = 1 + (.055 + i * .012) * Math.sin(a * 5 - time * 1.2) + taper * .12;
      return [x + Math.cos(a) * rx * fold, y + Math.sin(a) * ry * fold + Math.cos(a) * ry * twist];
    };
    ribbon(ctx, filament, base, 6.6 * unit, .32 * power, 23);
    ribbon(ctx, filament, bright, 2.7 * unit, .65 * power, 23);
    ribbon(ctx, filament, core, .7 * unit, .78 * power, 23);
  }

  for (let i = 0; i < count; i++) {
    const a = noise(i * 3) * TAU + time * (.27 + noise(i + 59) * .5);
    const offset = .79 + noise(i * 3 + 1) * .43;
    const px = x + Math.cos(a) * rx * offset;
    const py = y + Math.sin(a) * ry * offset + Math.cos(a) * ry * twist;
    const sparkle = Math.pow(.5 + .5 * Math.sin(time * 3 + i * 4.1), 1.8);
    const radius = (.32 + noise(i + 75) * 1.3) * unit;
    ctx.fillStyle = rgba(i % 4 ? bright : core, (.2 + sparkle * .8) * power);
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, TAU);
    ctx.fill();
    if (i % 19 === 0) light(ctx, px, py, radius * 6, base, sparkle * power * .5);
  }
}

function trail(ctx, points, time, power, palette, width) {
  if (points.length < 2 || power <= 0) return;
  const [base, bright] = palette;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const alpha = (i / points.length) ** 1.7 * power;
    const sweep = Math.sin(i * .7 + time * 5) * width * .012;
    ctx.lineCap = 'round';
    ribbon(ctx, p => [a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p + sweep * Math.sin(p * Math.PI)], base, width * .018 * alpha + 1, .23 * alpha, 5);
    ribbon(ctx, p => [a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p + sweep * Math.sin(p * Math.PI)], bright, width * .003 + 1, .68 * alpha, 5);
    if (i % 3 === 0) light(ctx, b.x, b.y, width * .036, base, alpha * .22);
  }
}

const defaultDemo = {
  hands: [{ x: .79, y: .235 }, { x: .35, y: .62 }],
  body: { x: .48, y: .54, scale: .48 },
  portal: { x: .51, y: .31, radius: .38 },
  trails: [],
};

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.behind = document.createElement('canvas');
    this.behindContext = this.behind.getContext('2d');
    this.mask = document.createElement('canvas');
    this.maskContext = this.mask.getContext('2d');
    this.demo = new Image();
    this.demo.src = '/art/performer.webp';
    this.fit = null;
  }

  resize(element, resolution) {
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = Math.min(resolution / height, 2.5);
    const w = Math.max(2, Math.round(width * pixelRatio / 2) * 2);
    const h = Math.max(2, Math.round(height * pixelRatio / 2) * 2);
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = this.behind.width = w;
    this.canvas.height = this.behind.height = h;
  }

  updateMask(mask) {
    const { width, height } = mask;
    this.mask.width = width;
    this.mask.height = height;
    const pixels = this.maskContext.createImageData(width, height);
    const data = mask.getAsFloat32Array();
    for (let i = 0; i < data.length; i++) {
      pixels.data[i * 4 + 3] = clamp((data[i] - .26) / .52) * 255;
    }
    this.maskContext.putImageData(pixels, 0, 0);
  }

  frame({ source, settings, tracking, time, mirror = false, demo = false, mask = false }) {
    const { canvas, context: ctx } = this;
    const { width, height } = canvas;
    const picture = demo ? this.demo : source;
    ctx.fillStyle = '#05090c';
    ctx.fillRect(0, 0, width, height);
    if (!picture || (picture instanceof HTMLVideoElement && picture.readyState < 2)
        || (picture instanceof HTMLImageElement && !picture.naturalWidth)) return;
    this.fit = cover(ctx, picture, width, height, settings.zoom, mirror);
    this.grade(ctx, width, height, settings);
    if (settings.intensity <= 0) return;

    let state = tracking;
    if (demo) {
      const { hands, body, ...rest } = defaultDemo;
      state = {
        ...rest,
        hands: hands.map(point => project(point, this.fit, width, height)),
        body: { ...project(body, this.fit, width, height), scale: body.scale },
        portal: settings.demoPortal || rest.portal,
      };
    }
    const shouldLayer = mask && settings.depth && this.mask.width > 2;
    const layers = shouldLayer ? this.behindContext : ctx;
    if (shouldLayer) {
      layers.globalCompositeOperation = 'source-over';
      layers.clearRect(0, 0, width, height);
    }
    this.drawEffects(layers, ctx, width, height, time, settings, state, demo);
    if (shouldLayer) {
      layers.save();
      layers.globalCompositeOperation = 'destination-out';
      if (mirror) {
        layers.translate(width, 0);
        layers.scale(-1, 1);
      }
      const fit = this.fit;
      layers.drawImage(this.mask, fit.x, fit.y, fit.w, fit.h);
      layers.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(this.behind, 0, 0);
      ctx.restore();
    }
  }

  grade(ctx, width, height, settings) {
    ctx.save();
    const grade = {
      arctic: ['#328ac5', 'soft-light', .45],
      ember: ['#ed6b29', 'soft-light', .45],
      mono: ['#9ba0a6', 'color', 1],
    }[settings.look];
    if (grade) {
      const [tint, blend, alpha] = grade;
      ctx.globalCompositeOperation = blend;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
    }
    if (settings.exposure) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.abs(settings.exposure) / 5;
      ctx.fillStyle = settings.exposure > 0 ? '#fff' : '#000';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  drawEffects(back, front, w, h, time, settings, tracking = {}, demo) {
    const { hands = [], body, portal, trails = [] } = tracking;
    const power = settings.intensity / 100;
    const density = settings.density;
    const palette = colors[settings.element] || palettes.fire;
    for (const layer of new Set([back, front])) {
      layer.save();
      layer.globalCompositeOperation = 'screen';
    }

    if (settings.family === 'portal' && portal) {
      const radius = portal.radius * w * (.42 + power * .74);
      const x = portal.x * w;
      const y = portal.y * h;
      plasma(back, x, y, radius * 1.13, radius * 1.1, time * .15 - .3, power * 1.3);
      vortex(back, x, y, radius, radius * 1.07, time, power * .53, density + 15, colors.portal, w);
      if (demo) {
        plasma(front, w * .35, h * .64, w * .29, w * .114, .43 + .06 * Math.sin(time), power * 1.03, true);
        vortex(front, w * .35, h * .64, w * .23, w * .108, -time, power * .51, density * .55, palettes.fire, w, .46);
      }
    }

    if (settings.family === 'energy' && hands.length) {
      const [a, b = a] = hands;
      const x = (a.x + b.x) * w / 2;
      const y = (a.y + b.y) * h / 2;
      const spread = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
      const radius = clamp(spread * .37, w * .05, w * .32) * (.45 + power);
      light(front, x, y, radius * 1.8, palette[0], .79 * power);
      vortex(front, x, y, radius, radius * .84, time * 1.5, power, density, palette, w, .34);
      vortex(front, x, y, radius * .76, radius * .48, -time, power * .68, density * .52, colors.portal, w, -.35);
    }

    if (settings.family === 'elements') {
      if (demo && !trails.length) {
        hands.forEach((hand, i) => vortex(front, hand.x * w, hand.y * h, w * .21, w * .11, time + i, power, density, palette, w, i ? -.48 : .48));
      }
      hands.forEach(hand => light(front, hand.x * w, hand.y * h, w * .105, palette[0], power * .42));
      trails.forEach(points => trail(front, points.map(point => ({ x: point.x * w, y: point.y * h })), time, power, palette, w));
    }

    if (settings.family === 'aura' && body) {
      const radius = clamp(body.scale * .7, .14, .57) * w * (.65 + power * .55);
      vortex(back, body.x * w, body.y * h, radius, radius * 1.72, time * .55, power, density, palettes.lightning, w, -.22);
      vortex(front, body.x * w, body.y * h + radius * .55, radius * 1.25, radius * .35, -time, power * .72, density * .62, palettes.lightning, w, .56);
      if (settings.skeleton && body.points) {
        const links = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
        for (const [from, to] of links) {
          const a = body.points[from];
          const b = body.points[to];
          if (a && b) ribbon(front, p => [(a.x + (b.x - a.x) * p) * w, (a.y + (b.y - a.y) * p) * h], '#ddc7ff', w * .003, power, 1);
        }
      }
    }
    for (const layer of new Set([back, front])) layer.restore();
  }
}
