/**
 * Draws the cover's otter onto a canvas (WebGL2).
 *
 * Three things happen every frame:
 *   1. Pose it -- this is its "skeleton": the head turns from the base of the neck (so the head's
 *      position moves with it, not just the face sliding around), with a bit of inertia; the two
 *      forelimb bone lengths are fixed, and the elbow position is derived from the shoulder and
 *      paw; the stone is a rigid body that, when tossed, really leaves the paw, flips over once,
 *      and falls back in; the whiskers lag half a beat behind the head.
 *   2. Take a photo -- the SCENE shader renders a low-resolution photo (color, the plates used for
 *      the color separation, and depth) for this pose.
 *   3. Print it -- the PRINT shader prints that photo across the whole canvas, then traces the
 *      whiskers on top.
 * Also handled here: canvas size, the camera, the pointer, ripples from clicking the water, the
 * light/dark theme, pausing when off-screen, and automatically lowering the photo resolution when
 * the machine is struggling.
 */
import { PRINT_FRAG, SCENE_FRAG, VERT } from './shaders';

export const PRINT_MODES = ['halftone', 'ascii', 'dither', 'photo'] as const;
export type PrintMode = (typeof PRINT_MODES)[number];

export interface OtterOptions {
  /** where the otter sits in frame: 0-1, origin top-left */
  center(width: number, height: number): [number, number];
  /** how wide it is on screen (px) */
  span(width: number, height: number): number;
  /** make way for text: the water only fades in between x0->x1 horizontally, y0->y1 vertically (0-1, origin top-left). Omit it to cover the whole frame */
  shy?(width: number, height: number): [number, number, number, number];
}

/** for debugging: pin the pose to a fixed state */
export interface PoseOverride {
  /** where it's looking: -1...1 */
  look?: [number, number];
  /** how many seconds into the toss it is */
  toss?: number;
  /** how much the eyelid is closed: 0...1 */
  blink?: number;
  /** turn the head straight to this angle (radians: left-right, up-down), with no tilt. For viewing it in profile */
  turn?: [number, number];
}

export interface OtterHandle {
  mode(next: PrintMode): void;
  /** immediately render how it looks at second t (for debugging and screenshots) */
  renderAt(t: number, pose?: PoseOverride): void;
  destroy(): void;
}

type V3 = [number, number, number];

const GLYPHS = ' .:-=+*#%@';
const WIDTH = 2.0; //                           how wide the otter looks on screen (world units)
const CAMERA: V3 = [-0.85, 2.55, 2.65]; //      camera position relative to it
const TARGET: V3 = [-0.07, 0.06, 0.098]; //     what the camera points at: the midpoint of its body
const YAW = -0.95; //                           its heading on the water. These three match the same numbers written in the shader

// ── skeleton (coordinates are its own: body along x, head at +x, y is up) ──────────
const NECK: V3 = [0.5, 0.06, 0]; //             base of the neck: the head pivots around it
const HEAD_UP = 0.3; //                         how far the head's center sits above the base of the neck
const HEAD_S = 1.13; //                         how much the head is scaled up overall (same number as in the shader)
const FACE: V3 = [-0.9703, 0.2419, 0]; //       which way the face points when the head isn't turned: it holds its head up, face toward its own feet and slightly upward -- the camera sits about 20 deg above and to the side,
//                                              so the face it sees has the forehead on top, nose and mouth below
const SHOULDER: V3 = [0.22, 0.11, 0.205];
const BONE = 0.185; //                          length of the upper arm and forearm each
const PAW_REST: V3 = [-0.03, 0.323, 0.128]; //  where the paws sit while holding the stone: one on each side, cupping it
const STONE_REST: V3 = [0, 0.325, 0]; //        the stone rests on the belly (it treats its belly as a table): far enough from the face that tossing it doesn't block the view
const GRAVITY = 6.4;

// whiskers: four per side, long and dense, the lower ones drooping more. Root and tip are fixed in the head's own coordinates (face forward, crown up, sideways)
const WHISKERS = [-1, 1].flatMap((side) =>
  (
    [
      [[0.212, -0.062, 0.105], [0.25, 0.02, 0.36]],
      [[0.214, -0.078, 0.108], [0.26, -0.07, 0.4]],
      [[0.21, -0.094, 0.106], [0.24, -0.16, 0.38]],
      [[0.202, -0.108, 0.1], [0.2, -0.24, 0.32]],
    ] as [V3, V3][]
  ).map(([root, tip]) => ({ root: [root[0], root[1], root[2] * side] as V3, tip: [tip[0], tip[1], tip[2] * side] as V3 })),
);

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};
/** turn a pair of mutually perpendicular directions by an angle, within their shared plane */
const turn = (a: V3, b: V3, angle: number): [V3, V3] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [add(mul(a, c), mul(b, s)), sub(mul(b, c), mul(a, s))];
};

/** a spring: has inertia, overshoots slightly before settling */
interface Spring {
  x: number;
  v: number;
}
const pull = (s: Spring, target: number, dt: number, freq: number, damping: number) => {
  s.v += (-2 * damping * freq * s.v - freq * freq * (s.x - target)) * dt;
  s.x += s.v * dt;
};

/**
 * Toss the stone: a dip down, a push up, the stone leaves the paw, flips over once, falls back,
 * and the paw dips again when it's caught.
 * Returns how much higher than usual the paw and stone each are, how far the stone has flipped,
 * whether it's left the paw, and whether the toss is over.
 */
function toss(age: number, power: number) {
  const v0 = Math.sqrt(2 * GRAVITY * 0.13 * power);
  const flight = (v0 + Math.sqrt(v0 * v0 + 2 * GRAVITY * 0.03)) / GRAVITY;
  const A = 0.16; //         dip down
  const B = A + 0.11; //     push up; leaves the paw at this moment
  const C = B + flight; //   falls back into the paw
  const end = C + 0.42;
  if (age < A) {
    const y = -0.022 * ease(age / A);
    return { paw: y, stone: y, spin: 0, air: 0, landed: false, done: false };
  }
  if (age < B) {
    const k = (age - A) / (B - A);
    const y = -0.022 + 0.052 * k * k;
    return { paw: y, stone: y, spin: 0, air: 0, landed: false, done: false };
  }
  if (age < C) {
    const u = age - B;
    return {
      paw: 0.03 * (1 - ease(u / 0.2)),
      stone: 0.03 + v0 * u - 0.5 * GRAVITY * u * u,
      spin: u / flight,
      air: Math.sin((u / flight) * Math.PI),
      landed: false,
      done: false,
    };
  }
  const w = age - C;
  const y = -0.034 * Math.sin(w * 16) * Math.exp(-w * 8);
  return { paw: y, stone: y, spin: 1, air: 0, landed: true, done: age >= end };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[otter] shader compile failed\n' + gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, frag: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[otter] shader link failed\n' + gl.getProgramInfoLog(program));
    return null;
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    at(name: string) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name)!;
    },
  };
}

const rgb = (css: string, fallback: V3): V3 => {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function mountOtter(host: HTMLElement, canvas: HTMLCanvasElement, opts: OtterOptions): OtterHandle | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  const scene = link(gl, SCENE_FRAG);
  const print = link(gl, PRINT_FRAG);
  if (!scene || !print) return null;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const makeTexture = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const colorTex = makeTexture();
  const plateTex = makeTexture();
  const glyphTex = makeTexture();
  const fbo = gl.createFramebuffer();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let sw = 0;
  let sh = 0;
  let quality = 0.5; //    the photo's resolution as a fraction of the canvas (CSS pixels)
  let mode: PrintMode = 'halftone';
  let center: [number, number] = [0.5, 0.5];
  let shy: [number, number, number, number] = [-1, -0.5, -1, -0.5];
  let zoom = 1.3;
  let ink: V3 = [0.1, 0.1, 0.1];
  let blue: V3 = [0, 0.18, 0.65];
  let dark = false;
  let lift = 0;

  let raf = 0;
  let visible = true;
  let destroyed = false;
  let lastFrame = 0;
  let slow = 0;
  let clock = -1; //       what second the previous frame was at (used to compute each frame's delta)

  // ── pose state ──
  const want = { x: 0, y: 0, held: false }; //  where the pointer wants it to look
  const lookX: Spring = { x: 0, v: 0 };
  const lookY: Spring = { x: 0, v: 0 };
  const lagX: Spring = { x: 0, v: 0 }; //       whiskers: lag half a beat behind the head
  const lagY: Spring = { x: 0, v: 0 };
  const sink: Spring = { x: 0, v: 0 }; //       the dip into the water when the stone is caught
  let tossAt = -100; //                          what second this toss started at
  let tossPower = 1;
  let tossAgain = 0; //                          how many more tosses are queued up
  let nextToss = 5;
  let caught = true;
  let blinkAt = -100;
  let nextBlink = 2.5;
  const rips = new Float32Array(24);
  let ripIndex = 0;
  const whisk = new Float32Array(72);

  const cell = () => (mode === 'photo' ? 1 : W < 700 ? 3 : 4) * dpr;

  const readTheme = () => {
    const css = getComputedStyle(host);
    dark = document.documentElement.dataset.theme === 'dark';
    ink = rgb(css.getPropertyValue('--print-ink'), dark ? [0.93, 0.92, 0.89] : [0.09, 0.09, 0.1]);
    blue = rgb(css.getPropertyValue('--print-blue'), dark ? [0.48, 0.6, 1] : [0, 0.184, 0.655]);
  };

  /** glyphs used for character mode: one row, sparse to dense, white on black */
  const buildGlyphs = () => {
    const w = Math.round((W < 700 ? 3 : 4) * dpr);
    const h = w * 2;
    const atlas = document.createElement('canvas');
    atlas.width = w * GLYPHS.length;
    atlas.height = h;
    const g = atlas.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, atlas.width, h);
    g.fillStyle = '#fff';
    g.font = `500 ${w / 0.6}px "JetBrains Mono NL", ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [...GLYPHS].forEach((ch, i) => g.fillText(ch, i * w + w / 2, h / 2 + dpr * 0.5));
    gl.bindTexture(gl.TEXTURE_2D, glyphTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  };

  const allocate = () => {
    // when viewing the photo it needs to be sharper; printed as a halftone, one sample per dot is enough
    const q = mode === 'photo' ? Math.min(dpr, 1.25) * Math.min(1, quality * 2) : quality;
    sw = Math.max(2, Math.round(W * q));
    sh = Math.max(2, Math.round(H * q));
    for (const tex of [colorTex, plateTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, plateTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const resize = () => {
    W = host.clientWidth;
    H = host.clientHeight;
    if (!W || !H) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    center = opts.center(W, H);
    shy = opts.shy?.(W, H) ?? [-1, -0.5, -1, -0.5];
    zoom = (opts.span(W, H) * Math.hypot(...CAMERA)) / (WIDTH * H);
    allocate();
    buildGlyphs();
  };

  /** camera: position and three directions. Identical to the math in the shader */
  const camera = () => {
    const eye: V3 = [TARGET[0] + CAMERA[0], TARGET[1] + CAMERA[1] + lift, TARGET[2] + CAMERA[2]];
    const ww = norm(sub(TARGET, eye));
    const uu = norm(cross(ww, [0, 1, 0]));
    const vv = cross(uu, ww);
    return { eye, uu, vv, ww };
  };

  /** where a point in the world lands on the canvas (device pixels, origin bottom-left), and how far it is from the camera */
  const project = (p: V3, cam: ReturnType<typeof camera>): [number, number, number] => {
    const d = sub(p, cam.eye);
    const z = dot(d, cam.ww);
    return [(center[0] * W + ((dot(d, cam.uu) / z) * zoom) * H) * dpr, ((1 - center[1]) * H + ((dot(d, cam.vv) / z) * zoom) * H) * dpr, z];
  };

  /** where a point on screen (CSS pixels, origin top-left of the canvas) lands on the water */
  const toWater = (x: number, y: number): [number, number] | null => {
    const { eye, uu, vv, ww } = camera();
    const u = (x - center[0] * W) / H;
    const v = (center[1] * H - y) / H;
    const rd = norm(add(add(mul(uu, u), mul(vv, v)), mul(ww, zoom)));
    if (rd[1] >= -1e-4) return null;
    const t = -eye[1] / rd[1];
    return [eye[0] + rd[0] * t, eye[2] + rd[2] * t];
  };

  const addRipple = (x: number, z: number, t: number, strength: number) => {
    rips.set([x, z, t, strength], ripIndex * 4);
    ripIndex = (ripIndex + 1) % 6;
  };

  const startToss = (t: number, power = 1, again = 1) => {
    if (t - tossAt < 1.2) return;
    tossAt = t;
    tossPower = power;
    tossAgain = again;
    caught = false;
    nextToss = t + 7 + Math.random() * 6;
  };

  const draw = (t: number, fixed?: PoseOverride) => {
    if (!W || !H) return;
    const dt = clock < 0 || fixed ? 1 / 60 : clamp(t - clock, 0, 1 / 20);
    clock = t;

    // ── 1. pose it ────────────────────────────────────────────
    // when no one's bothering it, it slowly looks around on its own
    const tx = want.held ? want.x : 0.35 * Math.sin(t * 0.31) + 0.15 * Math.sin(t * 0.83 + 1.7);
    const ty = want.held ? want.y : 0.2 * Math.sin(t * 0.23 + 0.6);
    if (fixed?.look) {
      lookX.x = lagX.x = fixed.look[0];
      lookY.x = lagY.x = fixed.look[1];
      lookX.v = lookY.v = lagX.v = lagY.v = 0;
    } else {
      pull(lookX, tx, dt, 9, 0.62);
      pull(lookY, ty, dt, 9, 0.62);
      pull(lagX, lookX.x, dt, 5.5, 0.36);
      pull(lagY, lookY.x, dt, 5.5, 0.36);
    }

    // tossing the stone: every so often it does a couple on its own
    if (!still && !fixed && t > nextToss) startToss(t);
    const tossing = toss(fixed?.toss ?? t - tossAt, tossPower);
    if (!fixed) {
      if (tossing.landed && !caught) {
        // the moment it's caught: a dip in the body, a ripple across the chest
        caught = true;
        sink.v -= 0.16 * tossPower;
        const chest = toWorld([STONE_REST[0], 0, 0], 0, 0);
        addRipple(chest[0], chest[2], t, 0.55 * tossPower);
      }
      if (tossing.done && tossAgain > 0) {
        tossAt = t;
        tossPower *= 0.55;
        tossAgain -= 1;
        caught = false;
      }
      pull(sink, 0, dt, 11, 0.45);
    }
    if (!still && !fixed && t > nextBlink) {
      blinkAt = t;
      nextBlink = t + 2.2 + Math.random() * 4;
    }
    const blinkAge = t - blinkAt;
    const blink = fixed?.blink ?? (blinkAge < 0.07 ? blinkAge / 0.07 : blinkAge < 0.2 ? 1 - (blinkAge - 0.07) / 0.13 : 0);

    // body: bobs and leans with the water; the shoulders follow a bit wherever the head turns
    const bob = 0.012 * Math.sin(t * 1.3) + sink.x;
    const roll = 0.035 * Math.sin(t * 0.9 + 1.0) - lookX.x * 0.035;
    const sway = 0.16 * Math.sin(t * 1.1);
    const toe = 0.1 * Math.sin(t * 1.7) * ease((Math.sin(t * 0.37) - 0.2) / 0.8);

    // head: turns left-right, then nods, then tilts a little -- all around the base of the neck, so the head's position moves along with it
    const up0 = norm(sub([1, 0, 0], mul(FACE, FACE[0])));
    let f = FACE;
    let u = up0;
    let r = cross(FACE, up0);
    const yaw = fixed?.turn ? fixed.turn[0] : -lookX.x * 0.42;
    // it can lift its head up a lot, but there's little room to lower it further: the chin is already against the chest
    const pitch = fixed?.turn ? fixed.turn[1] : lookY.x * (lookY.x > 0 ? 0.26 : 0.1);
    [f, r] = turn(f, r, yaw);
    [f, u] = turn(f, u, pitch);
    [u, r] = turn(u, r, fixed?.turn ? 0 : -lookX.x * 0.14);
    const head = add(NECK, mul(u, HEAD_UP));

    // forelimb: where the paw goes is fixed, and the elbow is derived from the two fixed bone lengths (bending outward and down)
    const want_: V3 = [PAW_REST[0], PAW_REST[1] + tossing.paw, PAW_REST[2] + 0.014 * tossing.air];
    const reach = sub(want_, SHOULDER);
    const far = Math.hypot(...reach);
    const span = Math.min(far, BONE * 1.995);
    const along = mul(reach, 1 / far);
    const paw = add(SHOULDER, mul(along, span));
    let pole: V3 = [-0.2, -0.55, 1];
    pole = norm(sub(pole, mul(along, dot(pole, along))));
    const elbow = add(add(SHOULDER, mul(along, span / 2)), mul(pole, Math.sqrt(Math.max(0, BONE * BONE - (span / 2) ** 2))));

    // stone: a rigid body. Rocks gently while held, flips all the way over once it leaves the paw
    const stone: V3 = [STONE_REST[0], STONE_REST[1] + tossing.stone, STONE_REST[2]];
    const spin = tossing.spin * Math.PI * 2 + 0.06 * Math.sin(t * 0.8);
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const cy = Math.cos(0.5);
    const sy = Math.sin(0.5);
    // first a fixed rotation around the vertical axis (the stone sits tilted), then it flips around the horizontal axis
    const stoneRot = [cy * cs, cy * sn, -sy, -sn, cs, 0, sy * cs, sy * sn, cy];

    // whiskers: follow the head, but the tip lags half a beat behind
    const cam = camera();
    WHISKERS.forEach((w, i) => {
      const tip: V3 = [w.tip[0], w.tip[1] - (lookY.x - lagY.x) * 0.16, w.tip[2] + (lookX.x - lagX.x) * 0.22];
      const mid: V3 = [(w.root[0] + tip[0]) / 2 + 0.02, (w.root[1] + tip[1]) / 2 - 0.035, (w.root[2] + tip[2]) / 2];
      [w.root, mid, tip].forEach((q, j) => {
        const b = add(add(add(head, mul(f, q[0] * HEAD_S)), mul(u, q[1] * HEAD_S)), mul(r, q[2] * HEAD_S));
        whisk.set(toWorld(b, bob, roll), i * 9 + j * 3);
      });
    });
    const face = project(toWorld(head, bob, roll), cam);

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);

    // ── 2. take a photo ──────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, sw, sh);
    gl.useProgram(scene.program);
    gl.uniform2f(scene.at('uRes'), sw, sh);
    gl.uniform1f(scene.at('uTime'), t);
    gl.uniform2f(scene.at('uCenter'), center[0], 1 - center[1]);
    gl.uniform1f(scene.at('uZoom'), zoom);
    gl.uniform1f(scene.at('uDark'), dark ? 1 : 0);
    gl.uniform1f(scene.at('uLift'), lift);
    gl.uniform4fv(scene.at('uRip'), rips);
    gl.uniform4f(scene.at('uShy'), ...shy);
    gl.uniform4f(scene.at('uBody'), bob, roll, sway, toe);
    gl.uniform3f(scene.at('uHead'), ...head);
    gl.uniformMatrix3fv(scene.at('uHeadRot'), false, [...f, ...u, ...r]);
    gl.uniform3f(scene.at('uElbow'), ...elbow);
    gl.uniform3f(scene.at('uPaw'), ...paw);
    gl.uniform3f(scene.at('uStone'), ...stone);
    gl.uniformMatrix3fv(scene.at('uStoneRot'), false, stoneRot);
    gl.uniform1f(scene.at('uBlink'), blink);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 3. print it ──────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(print.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, glyphTex);
    gl.uniform1i(print.at('uColor'), 0);
    gl.uniform1i(print.at('uPlate'), 1);
    gl.uniform1i(print.at('uGlyph'), 2);
    gl.uniform2f(print.at('uRes'), canvas.width, canvas.height);
    gl.uniform1f(print.at('uPx'), dpr);
    gl.uniform1f(print.at('uCell'), cell());
    gl.uniform1f(print.at('uGlyphs'), GLYPHS.length);
    gl.uniform1i(print.at('uMode'), PRINT_MODES.indexOf(mode));
    gl.uniform1f(print.at('uDark'), dark ? 1 : 0);
    gl.uniform3f(print.at('uInk'), ...ink);
    gl.uniform3f(print.at('uBlue'), ...blue);
    gl.uniform2f(print.at('uCenter'), center[0], 1 - center[1]);
    gl.uniform1f(print.at('uZoom'), zoom);
    gl.uniform3f(print.at('uEye'), ...cam.eye);
    gl.uniformMatrix3fv(print.at('uCam'), false, [...cam.uu, ...cam.vv, ...cam.ww]);
    gl.uniform3fv(print.at('uWhisk'), whisk);
    gl.uniform3f(print.at('uFace'), face[0], face[1], ((0.85 * zoom * H) / face[2]) * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** where a point in its own coordinates lands in the world (undoing the bob, lean, and heading layer by layer) */
  function toWorld(b: V3, bob: number, roll: number): V3 {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const y = cr * b[1] - sr * b[2] + bob;
    const z = sr * b[1] + cr * b[2];
    const c = Math.cos(YAW);
    const s = Math.sin(YAW);
    return [c * b[0] - s * z, y, s * b[0] + c * z];
  }

  const now = () => (still ? 3.4 : performance.now() / 1000);

  const loop = (ms: number) => {
    raf = 0;
    if (destroyed || !visible || document.hidden) return;
    // if dozens of frames in a row run slow, drop the photo resolution a notch
    if (lastFrame) {
      slow = ms - lastFrame > 30 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 40 && quality > 0.3) {
        quality *= 0.8;
        slow = 0;
        allocate();
      }
    }
    lastFrame = ms;
    draw(ms / 1000);
    raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    lastFrame = 0;
    clock = -1;
    if (!still && !raf && visible) raf = requestAnimationFrame(loop);
  };

  const local = (e: PointerEvent): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const [x, y] = local(e);
    want.x = clamp((x - center[0] * W) / (W * 0.4), -1, 1);
    want.y = clamp((center[1] * H - y) / (H * 0.5), -1, 1);
    want.held = true;
  };
  const onLeave = () => {
    want.held = false;
  };
  const onDown = (e: PointerEvent) => {
    if (still || (e.target as HTMLElement).closest('a, button, input, [data-no-ripple]')) return;
    const [x, y] = local(e);
    const hit = toWater(x, y);
    if (!hit) return;
    const t = performance.now() / 1000;
    // click on it: toss the stone; click on the water: raise a ripple
    const bx = Math.cos(YAW) * hit[0] + Math.sin(YAW) * hit[1];
    const bz = -Math.sin(YAW) * hit[0] + Math.cos(YAW) * hit[1];
    if (Math.hypot((bx + 0.1) / 1.15, bz / 0.5) < 1) startToss(t);
    else addRipple(hit[0], hit[1], t, 1);
  };
  const onScroll = () => {
    lift = clamp(window.scrollY / Math.max(1, H), 0, 1) * 0.9;
    if (still) draw(now());
  };

  readTheme();
  resize();
  draw(now());

  const ro = new ResizeObserver(() => {
    resize();
    draw(now());
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    kick();
  });
  io.observe(host);
  const mo = new MutationObserver(() => {
    readTheme();
    draw(now());
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const onVisibility = () => kick();
  document.addEventListener('visibilitychange', onVisibility);
  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });
  host.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  void document.fonts?.ready.then(() => {
    buildGlyphs();
    draw(now());
  });
  kick();

  return {
    mode(next) {
      mode = next;
      allocate();
      draw(now());
    },
    renderAt: draw,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll);
    },
  };
}
