/**
 * The two shaders for the cover's otter.
 *
 * The first pass (SCENE) is a tiny "camera" ray-marching an otter sculpted out of a distance
 * field:
 *   · First sculpt the "skin": body, head, limbs, tail, all ellipsoids and capsules smoothly
 *     blended together. For it to read as an otter and not a bear cub, a few things matter: the
 *     head is a wide, flat, long block (width : length : height ≈ 1 : 1 : 0.6), not a sphere; the
 *     widest part of the face is the jowls hanging on either side; the muzzle is one blunt bulging
 *     pad pushed forward, with the forehead sliding down into it — no "forehead-to-bridge" step;
 *     the nose is the wide, black lump at the very front of the muzzle; the eyes are small and set
 *     wide apart, on the two corners where the muzzle meets the skull; the ears are small and dark,
 *     set on the sides of the head, well behind the eyes, not on top; there's no neck, the body is
 *     one long shape; the forelimbs are short with mitten-like paws; the hind feet are fan-shaped
 *     flippers kicked up above the water; the tail is a flat paddle. It holds its head up with its
 *     face toward its own feet, and the camera looks down from above and to the side: forehead on
 *     top, features crowded into the lower half of the face. Don't lose any of this when restyling.
 *     It also has to read as cute, not grumpy, but without overdoing it: the eyes should face
 *     forward (helped by the eye sockets padded up on either side of the muzzle root), two slightly
 *     vertical little black beans with a bit of light in them — not two drooping slits on a slope,
 *     and no heavy eyeliner; the mouth is a shallow line below the nose tip, pulling in slightly at
 *     each end — neither turning down into an inverted V (like the character "人") nor curling up
 *     into a big "ω". The fur on the head and belly is a smooth short pile, fluffier on the jowls.
 *   · Outside the skin sits a thin shell, and the shell is where the fur lives: as the ray crosses
 *     this shell it's sampled step by step, each step asking "is there a hair here" — dense and dark
 *     at the root, sparse and bright at the tip.
 *     So the fur reads as individual strands with a fuzzy silhouette, rather than a few lumps
 *     bulging out of the surface.
 *   · Eyes, nose, and the stone grow no fur and are hard; the fur right around the eyes and mouth is
 *     cut very short so it doesn't cover them.
 * The pose (how the head turns, where the paws are, where the stone is flying) is all computed and
 * passed in by renderer.ts; this file just draws.
 *
 * The second pass (PRINT) is a "printing press": it splits the photo above into a black plate and a
 * blue plate, each screened with a halftone and printed onto paper (or swapped for ASCII, ordered
 * dithering, or just viewing the photo directly). The whiskers are traced in this pass: they're real
 * lines in space, checked against the depth recorded in the photo, so any part hidden behind the
 * head isn't drawn.
 */

/** A single triangle that covers the whole screen; needs no vertex data */
export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SCENE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  uRes;       // resolution of this "photo"
uniform float uTime;
uniform vec2  uCenter;    // where the otter sits in frame (0-1, origin bottom-left)
uniform float uZoom;      // focal length: bigger means it looks bigger in frame
uniform float uDark;      // 0 light theme, 1 dark theme
uniform float uLift;      // the camera rises a bit as the page scrolls down
uniform vec4  uRip[6];    // clicked ripples: xz, start time, strength
uniform vec4  uShy;       // make way for text: the water only fades in between (x0->x1), (y0->y1) of the frame (0-1, origin top-left)

// pose. Coordinates are its own: body along the x axis, head at the +x end, y is up
uniform vec4  uBody;      // bob, lean, tail sway, flipper sway
uniform vec3  uHead;      // head center
uniform mat3  uHeadRot;   // the head's three directions (three columns): where the face points, where the crown points, sideways
uniform vec3  uElbow;     // right forelimb elbow (left is mirrored)
uniform vec3  uPaw;       // right paw
uniform vec3  uStone;     // stone center
uniform mat3  uStoneRot;  // how the stone has turned
uniform float uBlink;     // how much the eyelid is closed (0 open ... 1 closed)

layout(location = 0) out vec4 oColor; // color; alpha = how much this point survives (fades out at the edges onto the paper)
layout(location = 1) out vec4 oPlate; // separations: r lightness, g blue plate, b whether it's the stone, a depth

const vec3  SUN = vec3(-0.5571, 0.7597, 0.3350); // light comes from the upper left, slightly toward the camera
const float YAW = -0.95;   // its heading on the water: feet toward the camera, head farther off to the right -- so the face reads square
const float FUR = 0.056;   // length of the longest fur
const float NEAR = 2.6;    // depth is recorded from here out to NEAR + DEPTH
const float DEPTH = 2.8;

// ── small helpers ────────────────────────────────────────────

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// smoothly blend together: the bigger k, the softer the seam (like kneading clay)
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  if (k0 < 1.0) return (k0 - 1.0) * min(min(r.x, r.y), r.z);
  return k0 * (k0 - 1.0) / length(p / (r * r));
}

// capsule whose two ends can differ in thickness
float sdLimb(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(r1, r2, h);
}

float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// ── otter ──────────────────────────────────────────────────

// world -> its own body
vec3 toBody(vec3 p) {
  p.xz = rot(YAW) * p.xz;
  p.y -= uBody.x;
  p.yz = rot(uBody.y) * p.yz;
  return p;
}

// body -> head's own coordinates (x face-forward, y crown, z sideways). Head dimensions are all written as if scale 1, then the whole thing is scaled up by HEAD_S
const float HEAD_S = 1.13;
vec3 toHead(vec3 b) {
  return (b - uHead) * uHeadRot / HEAD_S;
}

// Everything on the head is positioned in the head's own coordinates (x face-forward, y crown, z sideways).
// The head is sculpted to match an otter's: a wide, flat, long "pebble" (width : length : height ≈ 1 : 1 : 0.6), not a sphere.
// It holds its head up with its face toward its own feet, camera looking down from above and the side: forehead takes the upper half of the face, eyes dead center, nose and mouth crowded below
const vec3 SKULL_C = vec3(-0.04, 0.0, 0.0);     // skull: flat, with a tall, smooth brow up front
const vec3 SKULL_R = vec3(0.18, 0.16, 0.215);
const vec3 JOWL = vec3(0.05, -0.09, 0.137);     // jowl: the widest part of the face, lower than the eyes, hanging down nearly to mouth level
const vec3 MUZZLE = vec3(0.115, -0.03, 0.0);    // muzzle: one wide blunt block running from between the eyes to the nose tip, with the forehead sliding down into it
const vec3 ORBIT = vec3(0.064, 0.024, 0.118);   // eye socket: a small pad on each side of the muzzle root that angles the eyes forward.
//                                                 Without it the eyes sit on an upward-facing slope and read, head-on, as two outward-drooping slits -- a grumpy face
const vec3 PAD = vec3(0.172, -0.07, 0.058);     // whisker pad: two bulges in front of the muzzle, covering the front of the chin
const vec3 PAD_R = vec3(0.06, 0.068, 0.062);
const vec3 CHIN = vec3(0.17, -0.125, 0.0);      // chin: set back a bit from the whisker pads
const vec3 EYE = vec3(0.1248, 0.0207, 0.1101);  // eyes: two upright little black beans, set well apart, on the two corners where the muzzle meets the skull
const float EYE_R = 0.022;
const vec3 EYE_K = vec3(1.0, 0.8, 1.0);         // eyes are a bit taller than round
const vec3 NOSE = vec3(0.213, -0.014, 0.0);     // nose: the big black skin pad at the very front of the muzzle, facing forward and up
const float MOUTH_Y = -0.082;                   // the philtrum runs down to here, then the mouth runs out to each side
const vec3 EAR_A = vec3(-0.1, -0.015, 0.2);     // ears: a small flap off the side of the head, well behind the eyes (root -> tip)
const vec3 EAR_B = vec3(-0.115, 0.008, 0.272);
// on the body
const vec3 SHOULDER = vec3(0.22, 0.11, 0.205);
const vec3 ANKLE = vec3(-0.75, 0.07, 0.165);
// the flipper's own three directions (three columns): which way the sole faces (toward the foot end), which way the toes point (up, splayed out, pulled in a bit toward the head), and sideways
const mat3 FOOT = mat3(-0.9725, 0.2313, 0.0279, 0.2246, 0.8985, 0.3774, 0.0622, 0.3733, -0.9258);

// flipper: two fan shapes kicked up above the water, long and flat -- a fin, not a padded paw. s is the body coordinate folded to one side
float sdFoot(vec3 s) {
  vec3 fp = (s - ANKLE) * FOOT;
  fp.xy = rot(uBody.w) * fp.xy;
  vec3 ft = vec3(fp.x, fp.y, abs(fp.z));
  // the web: a thin fan, pointed at the ankle, opening out toward the toe tips (half-angle 17 deg)
  const vec2 c = vec2(0.2924, 0.9563);
  vec2 p2 = vec2(ft.z, ft.y);
  float pie = max(length(p2) - 0.3, length(p2 - c * clamp(dot(p2, c), 0.0, 0.3)) * sign(c.y * p2.x - c.x * p2.y));
  vec2 w = vec2(pie, abs(ft.x) - 0.004);
  float foot = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.009;
  // five toes: thin, long ridges running from the ankle out to the edge of the fan, the middle one longest
  foot = smin(foot, sdLimb(ft, vec3(0.0, 0.04, 0.0), vec3(0.0, 0.315, 0.0), 0.02, 0.014), 0.012);
  foot = smin(foot, sdLimb(ft, vec3(0.0, 0.04, 0.005), vec3(0.0, 0.305, 0.04), 0.02, 0.014), 0.012);
  return smin(foot, sdLimb(ft, vec3(0.0, 0.04, 0.01), vec3(0.0, 0.285, 0.076), 0.02, 0.013), 0.012);
}

float sdEar(vec3 qs) {
  return sdLimb(qs, EAR_A, EAR_B, 0.026, 0.017);
}

// head skin (head's own coordinates, size before scaling)
float sdHeadSkin(vec3 q) {
  vec3 qs = vec3(q.x, q.y, abs(q.z));
  float h = sdEllipsoid(q - SKULL_C, SKULL_R);
  h = smin(h, sdEllipsoid(qs - JOWL, vec3(0.14, 0.085, 0.108)), 0.05);
  h = smin(h, sdEllipsoid(q - MUZZLE, vec3(0.1, 0.085, 0.11)), 0.05);
  h = smin(h, length(qs - ORBIT) - 0.05, 0.03);
  h = smin(h, sdEllipsoid(qs - PAD, PAD_R), 0.03);
  h = smin(h, sdEllipsoid(q - CHIN, vec3(0.046, 0.036, 0.07)), 0.03);
  return smin(h, sdEar(qs), 0.02);
}

// skin: the body underneath the fur
float sdSkin(vec3 b, vec3 q) {
  vec3 s = vec3(b.x, b.y, abs(b.z));   // left-right symmetric parts: fold z over and compute only one side
  vec3 qs = vec3(q.x, q.y, abs(q.z));

  // body: chest, belly, hip form one long shape of fairly even thickness -- an otter is a round tube, no shoulders or waist
  float d = sdEllipsoid(b - vec3(-0.08, -0.02, 0.0), vec3(0.56, 0.21, 0.25));
  d = smin(d, sdEllipsoid(b - vec3(0.30, 0.02, 0.0), vec3(0.30, 0.2, 0.235)), 0.16);
  d = smin(d, sdEllipsoid(b - vec3(-0.50, -0.03, 0.0), vec3(0.28, 0.185, 0.23)), 0.16);
  // neck: short and thick, running from the chest to the underside of the skull (not to the dead center of the head -- the head is flat, so that would poke the neck out of the face). It follows wherever the head turns
  d = smin(d, sdLimb(b, vec3(0.42, 0.04, 0.0), uHead - 0.11 * uHeadRot[0] - 0.07 * uHeadRot[1], 0.2, 0.15), 0.12);
  // tail: a wide, flat paddle, about as wide as the legs at the root, narrowing toward the back, swaying near the water
  vec3 tp = b - vec3(-0.72, 0.0, 0.0);
  tp.xz = rot(0.22 + uBody.z) * tp.xz;
  float tw = mix(1.0, 0.62, smoothstep(-0.08, -0.42, tp.x));
  d = smin(d, sdEllipsoid(vec3(tp.x + 0.2, tp.y, tp.z / tw), vec3(0.23, 0.05, 0.11)) * tw, 0.1);
  // hind legs: short stubs tucked beside the hips
  d = smin(d, sdEllipsoid(s - vec3(-0.60, 0.015, 0.165), vec3(0.17, 0.125, 0.105)), 0.13);
  d = smin(d, sdFoot(s), 0.05);
  // forelimb: shoulder -> elbow -> paw, short and thick. The two bone lengths are fixed; the elbow position is derived from shoulder and paw (see renderer.ts)
  d = smin(d, sdLimb(s, SHOULDER, uElbow, 0.06, 0.05), 0.08);
  d = smin(d, sdLimb(s, uElbow, uPaw, 0.048, 0.042), 0.035);
  d = smin(d, sdEllipsoid(s - uPaw, vec3(0.058, 0.044, 0.05)), 0.03);   // paw: no separate fingers, like wearing a mitten

  return smin(d, sdHeadSkin(q) * HEAD_S, 0.1);
}

// nose's own coordinates: origin at the center of the nose, tilted back a little
vec3 noseLocal(vec3 q) {
  vec3 np = q - NOSE;
  np.xy = rot(0.26) * np.xy;
  return np;
}

// things with no fur. Returns (distance, material): 1 stone, 2 eye, 3 nose
vec2 sdHard(vec3 b, vec3 q) {
  vec3 qs = vec3(q.x, q.y, abs(q.z));
  // eye: a slightly vertical little black bean, half exposed. The eyelid is a plane closing top-down; the closed part reveals the fur behind it
  float lid = EYE.y + EYE_R / EYE_K.y * (1.0 - 2.0 * uBlink);
  vec2 res = vec2(max(length((qs - EYE) * EYE_K) - EYE_R, q.y - lid) * HEAD_S, 2.0);
  // nose: a thick black skin pad, top edge tilted back. Narrow and round on top, widening downward -- a rounded triangle, point down
  vec3 np = noseLocal(q);
  float nk = mix(0.6, 1.06, smoothstep(0.95, -0.35, np.y / 0.047));
  np.z /= nk;
  float nose = sdEllipsoid(np, vec3(0.036, 0.047, 0.072)) * min(nk, 1.0) * HEAD_S;
  if (nose < res.x) res = vec2(nose, 3.0);
  // stone: a rounded, flattened pebble, a rigid body -- only translates and rotates
  float st = sdEllipsoid((b - uStone) * uStoneRot, vec3(0.108, 0.064, 0.09));
  if (st < res.x) res = vec2(st, 1.0);
  return res;
}

// how long the fur is at this spot. y is how high this point sits above the water: fur touching the water is wet and flattened; skin is this point's distance to the skin.
// the flippers and ears are nearly bare. They're keyed not by "is this close" but by "which skin patch is nearest to this point" --
// otherwise a ring outside them that should be bare would pick up a tuft of stray fur from the body's fur length
float furLength(vec3 b, vec3 q, float y, float skin) {
  vec3 s = vec3(b.x, b.y, abs(b.z));
  vec3 qs = vec3(q.x, q.y, abs(q.z));
  float len = 0.052;                                                        // on the body
  float onHead = smoothstep(0.42, 0.27, length(q));
  len = mix(len, 0.03, onHead);                                             // crown, forehead: a short, even pile that still reads as the head's shape
  len = mix(len, 0.046, onHead * smoothstep(0.2, 0.07, length(qs - vec3(0.02, -0.1, 0.18))));    // jowl: a bit fluffier
  len = mix(len, 0.011, smoothstep(0.17, 0.11, length((q - vec3(0.16, -0.06, 0.0)) / vec3(1.0, 1.0, 1.3)))); // muzzle: shortest
  len = mix(len, 0.004, smoothstep(0.058, 0.03, length(qs - EYE)));         // around the eyes: must not cover them
  len = mix(len, 0.007, smoothstep(0.022, 0.006, sdEar(qs) * HEAD_S - skin)); // ears: just enough to peek out of the fur
  len = mix(len, 0.012, smoothstep(0.1, 0.055, length(s - uPaw)));          // paw
  len = mix(len, 0.03, smoothstep(-0.7, -0.82, b.x));                       // tail: short and sleek
  len = mix(len, 0.007, smoothstep(0.022, 0.006, sdFoot(s) - skin));        // flipper
  return len * (0.4 + 0.6 * smoothstep(-0.02, 0.1, y));
}

// the middle of the upward-facing side (chest, belly) is one solid pale patch, like the reference model; the sides, limbs, hips, and tail are dark. The edges are a gradient
float bibMask(vec3 b) {
  return smoothstep(0.03, 0.17, b.y) * smoothstep(0.2, 0.08, abs(b.z)) * smoothstep(-0.6, -0.2, b.x);
}

// fur color: the face is cream, the crown and throat are sandy, fading to deep brown toward the belly -- the older the otter, the whiter its head. Also the mouth, eyeliner, and other things painted onto the fur
vec3 furColor(vec3 b, vec3 q) {
  vec3 s = vec3(b.x, b.y, abs(b.z));
  vec3 qs = vec3(q.x, q.y, abs(q.z));
  vec3 dark = vec3(0.165, 0.098, 0.058);
  vec3 belly = vec3(0.62, 0.46, 0.32);
  vec3 pale = vec3(0.59, 0.435, 0.3);
  vec3 cream = vec3(0.73, 0.555, 0.39);
  vec3 c = mix(dark, belly, bibMask(b));
  float head = smoothstep(0.2, 0.0, sdEllipsoid(q - SKULL_C, SKULL_R * 1.25));
  float throat = smoothstep(0.5, 0.12, length((b - vec3(0.5, 0.2, 0.0)) / vec3(1.0, 0.8, 1.0)));
  c = mix(c, pale, max(head, throat * 0.9));
  float face = smoothstep(0.4, 0.14, length((q - vec3(0.1, -0.04, 0.0)) / vec3(1.0, 0.95, 1.15)));
  c = mix(c, cream, face);
  // the forelimbs are as dark as the body, which is what lets them read as two little hands against the pale chest; paws, ears, flippers, and tail are darker still
  float arm = smoothstep(0.09, 0.05, min(segDist(s, SHOULDER, uElbow), segDist(s, uElbow, uPaw)));
  c = mix(c, dark, 0.85 * arm);
  float paw = smoothstep(0.1, 0.055, length(s - uPaw));
  float ear = smoothstep(0.02, 0.006, sdEar(qs)) * smoothstep(0.208, 0.232, qs.z);
  c = mix(c, vec3(0.13, 0.085, 0.06), paw);
  c = mix(c, vec3(0.05, 0.036, 0.03), ear);
  c = mix(c, dark * 0.8, smoothstep(-0.7, -0.82, b.x));
  c = mix(c, vec3(0.062, 0.044, 0.037), smoothstep(0.024, 0.008, sdFoot(s)));
  // mouth: a short philtrum under the nose tip, then a shallow arc out to each side -- angling down and out, pulling in slightly at the end, fading the farther out it goes. The corners don't turn up
  float mz = qs.z;
  float my = MOUTH_Y - 0.2 * mz - 0.018 * sin(3.1416 * clamp(mz / 0.085, 0.0, 1.0));
  float lip = smoothstep(0.009, 0.0035, abs(q.y - my)) * (1.0 - smoothstep(0.07, 0.09, mz)) * (1.0 - 0.55 * smoothstep(0.035, 0.08, mz));
  float philtrum = smoothstep(0.006, 0.002, mz) * step(q.y, NOSE.y - 0.04) * step(MOUTH_Y, q.y);
  c = mix(c, vec3(0.13, 0.09, 0.07), max(lip, philtrum) * step(0.15, q.x));
  // eyeliner: a narrow ring of dark short fur hugging the eye; when the lid is closed, only an upward-curving line remains
  float eyeD = length((qs - EYE) * EYE_K);
  float dz = qs.z - EYE.z;
  float rim = 0.75 * smoothstep(EYE_R + 0.009, EYE_R + 0.002, eyeD);
  // (the eye sits on a surface angled to the side, so seen from above and the side a horizontal line would read as higher on the outside and lower on the inside, like glaring; so it's tilted a touch lower on the outside to look level)
  float seam = smoothstep(0.007, 0.003, abs(q.y - EYE.y + 0.5 * EYE_R - 9.0 * dz * dz + 0.35 * dz)) * smoothstep(EYE_R + 0.01, EYE_R + 0.001, eyeD);
  c = mix(c, vec3(0.15, 0.1, 0.075), 0.9 * mix(rim, seam, uBlink) * step(0.04, q.x));
  // whisker pores: a few rows of tiny black dots on the whisker pad
  vec2 pad = vec2(q.y - PAD.y, abs(q.z) - PAD.z);
  float pores = smoothstep(0.22, 0.12, length(fract(pad * 62.0) - 0.5)) * smoothstep(0.046, 0.026, length(pad - vec2(0.012, 0.016))) * step(0.19, q.x);
  return mix(c, vec3(0.2, 0.14, 0.1), 0.55 * pores);
}

float mapSolid(vec3 p) {
  vec3 b = toBody(p);
  vec3 q = toHead(b);
  return min(sdSkin(b, q), sdHard(b, q).x);
}

// soft shadow: walk toward the light and see how close the march brushes past anything else
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.04;
  for (int i = 0; i < 18; i++) {
    float h = mapSolid(ro + rd * t);
    res = min(res, 7.0 * h / t);
    t += clamp(h, 0.03, 0.14);
    if (res < 0.004 || t > 1.7) break;
  }
  return clamp(res, 0.0, 1.0);
}

// ── water ────────────────────────────────────────────────────

float ripple(vec2 p, float t) {
  // the ever-present small waves
  float h = 0.012 * sin(p.x * 5.1 + t * 1.1 + sin(p.y * 3.3)) + 0.009 * sin(p.y * 6.7 - t * 0.9 + p.x * 2.1);
  // the rings spreading out centered on its body
  float r = length((rot(YAW) * p - vec2(-0.06, 0.0)) / vec2(1.0, 0.66));
  h += 0.02 * sin(r * 17.0 - t * 2.6) * exp(-max(r - 0.55, 0.0) * 1.6) * smoothstep(0.5, 0.75, r);
  // clicked ripples: an outward-moving ring
  for (int i = 0; i < 6; i++) {
    vec4 rp = uRip[i];
    float age = t - rp.z;
    if (rp.w <= 0.0 || age < 0.0 || age > 4.5) continue;
    float d = length(p - rp.xy) - age * 0.55;
    h += rp.w * 0.036 * sin(d * 30.0) * exp(-d * d * 26.0) * exp(-age * 0.85);
  }
  return h;
}

vec2 hitSphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float tone(vec3 c) { return pow(clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0), 0.4545); }
// fur prints a shade lighter than everything else: otherwise a dark body prints as one solid black and the fur, and the extra whiteness of the head, both disappear
float furTone(vec3 c) { return pow(clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0), 0.3); }

void main() {
  float t = uTime;

  // camera: looking down from above its feet; long lens, perspective flattened a bit
  vec2 uv = (gl_FragCoord.xy - uRes * uCenter) / uRes.y;
  vec3 ta = vec3(-0.07, 0.06, 0.098);
  vec3 ro = ta + vec3(-0.85, 2.55 + uLift, 2.65);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uZoom * ww);
  float tWater = rd.y < 0.0 ? -ro.y / rd.y : 1e5;

  // light direction in its own coordinates (it's turned some angle on the water, and leans too)
  vec3 sunB = SUN;
  sunB.xz = rot(YAW) * sunB.xz;
  sunB.yz = rot(uBody.y) * sunB.yz;
  vec3 rdB = rd;
  rdB.xz = rot(YAW) * rdB.xz;
  rdB.yz = rot(uBody.y) * rdB.yz;

  // ── step one: march to the outermost edge of the fur (or straight into something hard)
  vec4 fur = vec4(0.0);          // fur accumulated so far: color (already multiplied by opacity) and opacity
  float furLight = 0.0;          // accumulated lightness in the same way, for the color separation
  float depth = tWater;          // the first thing this ray hits
  float stone = 0.0, blue = 0.0;
  bool solid = false;            // whether something solid has already blocked the ray
  vec3 solidCol = vec3(0.0);
  float solidLight = 0.0;

  vec2 bs = hitSphere(ro, rd, vec3(-0.07, 0.08, 0.098), 1.24);   // a sphere enclosing the whole otter: its center sits on the body, shifted a bit toward the tail
  if (bs.x < bs.y) {
    float tt = max(bs.x, 0.0);
    // a ray may pass through several patches of fur in sequence (say, grazing the chin, then landing on the chest): if it exits without being blocked, keep marching
    for (int visit = 0; visit < 6; visit++) {
    bool inShell = false;
    for (int i = 0; i < 64; i++) {
      vec3 b = toBody(ro + rd * tt);
      vec3 q = toHead(b);
      float d = min(sdSkin(b, q) - FUR, sdHard(b, q).x);
      if (d < 0.0015) { inShell = true; break; }
      tt += d * 0.9;
      if (tt > bs.y || tt > tWater) break;
    }

    if (!inShell) break;
    {
      // computed once at the moment of entering the shell: which way the skin faces (the fur grows along it), and whether some other part blocks the light
      vec3 p0 = ro + rd * tt;
      vec3 b0 = toBody(p0);
      const vec2 e = vec2(1.0, -1.0) * 0.004;
      vec3 n = normalize(
        e.xyy * sdSkin(b0 + e.xyy, toHead(b0 + e.xyy)) + e.yyx * sdSkin(b0 + e.yyx, toHead(b0 + e.yyx)) +
        e.yxy * sdSkin(b0 + e.yxy, toHead(b0 + e.yxy)) + e.xxx * sdSkin(b0 + e.xxx, toHead(b0 + e.xxx)));
      float sh = softShadow(p0 + SUN * 0.02, SUN);
      float ndl = dot(n, sunB);
      float dif = clamp(ndl * 0.62 + 0.38, 0.0, 1.0);       // "wrap" the light around toward the back: fur lets light through
      float sky = 0.5 + 0.5 * n.y;
      float ndv = clamp(dot(n, -rdB), 0.0, 1.0);
      float sheen = pow(clamp(dot(n, normalize(sunB - rdB)), 0.0, 1.0), 12.0);
      // the fur is combed toward the tail, and droops downward: the closer to the tip, the more it's deflected
      // which way the fur leans: on the body it's combed toward the tail and droops; on the head it leans from the nose back toward the skull (following the head), otherwise the forehead fur would flop down and cover the eyes
      vec3 comb = length(toHead(b0)) < 0.36 ? uHeadRot * vec3(-1.0, -0.2, 0.0) : vec3(-1.0, -0.55, 0.0);
      comb = normalize(comb - n * dot(comb, n) + 1e-4);

      // ── step two: walk step by step inside the shell, asking at each step "is there a hair here"
      for (int i = 0; i < 40; i++) {
        vec3 p = ro + rd * tt;
        if (tt > tWater) break;
        vec3 b = toBody(p);
        vec3 q = toHead(b);
        float s = sdSkin(b, q);
        vec2 hd = sdHard(b, q);

        if (hd.x < 0.002) {
          // hit something hard: eye, nose, or stone
          const vec2 f = vec2(1.0, -1.0) * 0.0015;
          vec3 hn = normalize(
            f.xyy * sdHard(b + f.xyy, toHead(b + f.xyy)).x + f.yyx * sdHard(b + f.yyx, toHead(b + f.yyx)).x +
            f.yxy * sdHard(b + f.yxy, toHead(b + f.yxy)).x + f.xxx * sdHard(b + f.xxx, toHead(b + f.xxx)).x);
          vec3 alb; float spec, gloss;
          if (hd.y > 2.5) { alb = vec3(0.028, 0.025, 0.026) * (0.7 + 0.6 * noise3(q * 190.0)); spec = 0.5 * noise3(q * 260.0 + 3.0); gloss = 22.0; } // nose: rough, wet skin
          else if (hd.y > 1.5) { alb = vec3(0.02, 0.014, 0.012); spec = 2.3; gloss = 64.0; }    // eye: dark and glossy, with a bit of light in it
          else {                                                                                 // stone: Klein blue
            vec3 sp = (b - uStone) * uStoneRot;
            alb = vec3(0.0, 0.165, 0.64) * (0.86 + 0.28 * noise3(sp * 40.0));
            spec = 0.6; gloss = 52.0;
          }
          float hdif = clamp(dot(hn, sunB) * 0.8 + 0.2, 0.0, 1.0);
          float hsh = softShadow(p + SUN * 0.02, SUN);
          float hl = pow(clamp(dot(hn, normalize(sunB - rdB)), 0.0, 1.0), gloss);
          if (hd.y > 1.5 && hd.y < 2.5) hsh = max(hsh, 0.65);        // the highlight in the eye isn't purely from the sun: sky light reaches in too
          float shade = clamp(0.95 * hdif * hsh + 0.3 * (0.5 + 0.5 * hn.y) + hl * spec * hsh, 0.0, 1.4);
          solidCol = alb * (1.35 * hdif * hsh * vec3(1.0, 0.96, 0.9) + 0.36 * (0.5 + 0.5 * hn.y) * vec3(0.9, 0.95, 1.0)) + hl * spec * hsh;
          solidCol = 1.0 - exp(-solidCol * 1.35);
          solidLight = tone(solidCol);
          // when printed the eye is two solid black beans: the highlight is reserved for the photo view, otherwise the halftone would print it as a hollow ring
          if (hd.y > 1.5 && hd.y < 2.5) solidLight = min(solidLight, 0.22);
          if (hd.y < 1.5) {
            stone = 1.0 - fur.a;
            solidLight = clamp(shade * 0.82, 0.0, 1.0);
            // blue plate: in light theme, dark areas print solid and light areas stay bare; in dark theme it's reversed, bright areas carry the light
            blue = stone * mix(1.0 - 0.8 * smoothstep(0.6, 1.2, shade), 0.22 + 0.78 * smoothstep(0.1, 1.0, shade), uDark);
          }
          solid = true;
          if (fur.a < 0.5) depth = tt;
          break;
        }

        float len = furLength(b, q, p.y, s);
        if (s < 0.0025) {
          // the skin under the fur roots. Where fur is long it's a very dark undercoat; where it's cut short (flippers, tail, mouth) it's the visible surface
          float bare = 1.0 - smoothstep(0.008, 0.04, len);
          solidCol = furColor(b, q) * mix(length(q) < 0.36 ? 0.62 : 0.34, 1.0, bare) * (0.35 + 0.95 * dif * sh);
          solidCol = 1.0 - exp(-solidCol * 1.35);
          solidLight = furTone(solidCol);
          solid = true;
          if (fur.a < 0.5) depth = tt;
          break;
        }

        float step_ = clamp(s * 0.35, 0.0035, 0.012);
        if (s < len) {
          float h = s / len;                                   // 0 root ... 1 tip
          // head fur is dry: fine, dense, fluffy. Body fur is wet: lies flatter, clumping into strands that follow the body, with more variation in length
          bool onHead = length(q) < 0.36;
          // where this point's hair is rooted in the skin: walk back along the normal, then subtract the "combed" offset
          vec3 off = n * s + comb * h * h * len * (onHead ? 0.9 : 1.5);
          vec3 root = b - off;
          // head fur follows the head: it's keyed in the head's own coordinates, otherwise the fur would stay put while the head turns under it
          vec3 rk = onHead ? q + 7.0 - off * uHeadRot / HEAD_S : root;
          float clump = noise3(rk * (onHead ? vec3(30.0) : vec3(12.0, 34.0, 34.0)));   // clumped into tufts: each tuft has its own length
          float hh = h / (onHead ? 0.84 + 0.32 * clump : 0.5 + 0.9 * clump);          // less length variation on the head: it's a smooth layer
          float strand = noise3(rk * (onHead ? vec3(250.0) : vec3(110.0, 190.0, 190.0)));
          float thin = onHead ? 0.56 : 0.8;                    // head fur is denser at the tip: a pile, not individual spiky strands
          float dens = hh < 1.0 ? smoothstep(mix(0.26, thin, hh), mix(0.4, thin + 0.1, hh), strand) : 0.0;
          if (dens > 0.001) {
            vec3 alb = furColor(root, toHead(root)) * (0.82 + 0.36 * noise3(rk * 60.0));
            float paleness = smoothstep(0.25, 0.7, dot(alb, vec3(0.333)));
            // dark at the root, bright at the tip; pale fur is also paler at the root. Head and belly fur isn't darkened as much at the root: it should look like a smooth pile, not grainy
            float soft = onHead ? 1.0 : bibMask(root);
            vec3 c = mix(alb * mix(mix(0.42, 0.7, paleness), 0.84, soft), alb * 1.3 + 0.04, hh);
            float occ = mix(mix(mix(0.28, 0.5, paleness), 0.68, soft), 1.0, hh * hh);  // deep in the fur, little light reaches
            vec3 lit = c * (1.3 * dif * sh * occ * vec3(1.0, 0.96, 0.9) + 0.38 * sky * occ * vec3(0.9, 0.95, 1.0));
            // a rim of light at the edge seen against the view direction, where the tips catch the light
            lit += c * 0.55 * pow(1.0 - ndv, 2.5) * hh * (0.3 + 0.7 * clamp(ndl * 0.5 + 0.5, 0.0, 1.0));
            // a sheen of water on wet fur: only on the body, bright in streaks
            lit += vec3(0.5, 0.47, 0.42) * sheen * sh * hh * clump * (1.0 - soft);
            lit = 1.0 - exp(-lit * 1.35);
            float a = dens * (1.0 - exp(-step_ * 210.0)) * (1.0 - fur.a);
            fur.rgb += lit * a;
            // when printed, darken the silhouette edge a touch: a light head on light paper still needs a visible edge
            furLight += furTone(lit) * (1.0 - 0.24 * pow(1.0 - ndv, 1.5)) * a;
            if (fur.a < 0.5 && fur.a + a >= 0.5) depth = tt;
            fur.a += a;
          }
        }
        tt += step_;
        if (fur.a > 0.985) break;
        if (s > FUR + 0.003 && i > 3) break;
        if (tt > bs.y) break;
      }
    }
    if (solid || fur.a > 0.985 || tt > bs.y || tt > tWater) break;
    }
  }

  // ── step three: what's behind the fur. Either the solid thing just hit, or the water
  vec3 back;
  float backLight, keep;
  if (solid) {
    back = solidCol;
    backLight = solidLight;
    keep = 1.0;
  } else {
    // water surface. First work out how much of this point survives at the end: the farther away, the closer the water gets to blank paper; it also makes way for the text side
    vec3 pw = ro + rd * tWater;
    vec2 xz = pw.xz;
    vec2 sp = gl_FragCoord.xy / uRes;
    keep = 1.0 - smoothstep(0.9, 2.3, length((rot(YAW) * xz - vec2(-0.1, 0.0)) / vec2(1.3, 1.05)));
    keep *= smoothstep(uShy.x, uShy.y, sp.x) * smoothstep(uShy.z, uShy.w, 1.0 - sp.y);
    if (tWater > 1e4) keep = 0.0;
    if (keep < 0.003 && fur.a < 0.003) {
      // nothing survives here (most of the frame), so no need to compute further
      oColor = vec4(0.0);
      oPlate = vec4(1.0 - uDark, 0.0, 0.0, 1.0);
      return;
    }
    const float e = 0.012;
    float h0 = ripple(xz, t);
    vec3 nw = normalize(vec3(h0 - ripple(xz + vec2(e, 0.0), t), e, h0 - ripple(xz + vec2(0.0, e), t)));
    float relief = 1.5 * (dot(nw, SUN) - SUN.y);          // the wave's lit face is bright, its shadowed face is dark
    float glint = pow(max(dot(reflect(rd, nw), SUN), 0.0), 120.0);
    vec3 bw = toBody(vec3(pw.x, 0.0, pw.z));
    float dObj = sdSkin(bw, toHead(bw)) - 0.03;           // how far this point on the water is from it (fur and skin together)
    float shadow = dObj < 0.9 ? 1.0 - softShadow(vec3(pw.x, 0.006, pw.z), SUN) : 0.0;
    float contact = exp(-max(dObj, 0.0) * 9.0);           // a ring of dark hugging the body
    float lip = smoothstep(0.03, 0.0, abs(dObj - 0.014)); // a bright waterline hugging the body
    float sunk = smoothstep(0.02, -0.06, dObj);           // the half of the body under water, dimly visible through it

    float day = clamp(0.99 + min(relief, 0.0) * 0.85 + max(relief, 0.0) * 0.2 - 0.34 * shadow - 0.24 * contact + 0.5 * glint + 0.16 * lip * (1.0 - sunk) - 0.42 * sunk, 0.0, 1.0);
    float night = clamp(0.02 + 0.9 * pow(max(relief, 0.0), 1.3) + 0.9 * glint + 0.4 * lip + 0.04 * contact + 0.05 * sunk, 0.0, 1.0);
    backLight = mix(day, night, uDark);
    back = mix(pow(vec3(0.93, 0.955, 0.97) * day, vec3(2.2)), pow(vec3(0.045, 0.07, 0.115) + vec3(0.62, 0.74, 0.95) * night, vec3(2.2)), uDark);
    back = mix(back, back * vec3(0.62, 0.5, 0.38), sunk * (1.0 - uDark));
  }

  vec3 col = fur.rgb + back * (1.0 - fur.a);
  float light = furLight + backLight * (1.0 - fur.a);
  keep = max(keep, fur.a);
  oColor = vec4(col, keep);
  oPlate = vec4(light, blue, stone, clamp((depth - NEAR) / DEPTH, 0.0, 1.0));
}`;

export const PRINT_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uColor;
uniform sampler2D uPlate;
uniform sampler2D uGlyph;  // the glyph strip used in character mode: one row, sparse to dense
uniform vec2  uRes;        // canvas resolution (device pixels)
uniform float uPx;         // how many device pixels make up one CSS pixel
uniform float uCell;       // size of one halftone dot / one character cell (device pixels)
uniform float uGlyphs;     // total number of glyphs
uniform int   uMode;       // 0 halftone, 1 characters, 2 dither, 3 photo
uniform float uDark;
uniform vec3  uInk;
uniform vec3  uBlue;

// the whiskers are real lines in space, so this needs to know where the camera is in order to compute each pixel's view ray
uniform vec2  uCenter;
uniform float uZoom;
uniform vec3  uEye;        // camera position
uniform mat3  uCam;        // the camera's three directions (three columns): right, up, forward
uniform vec3  uWhisk[24];  // eight whiskers, three points each: root, middle, tip (world coordinates)
uniform vec3  uFace;       // the face's position and size on the canvas (device pixels): whiskers are only computed near it

out vec4 o;

const float NEAR = 2.6;
const float DEPTH = 2.8;

// how much ink the black plate should lay down: in light theme, dark areas get ink; in dark theme the "ink" is the bright parts, so bright areas get it
float inkOf(vec4 pl) {
  // darken the midtones a bit in dark theme: so the dark body fur doesn't end up as bright as the head
  return uDark > 0.5 ? pow(pl.r, 1.7) * (1.0 - pl.b) : (1.0 - pl.r) * (1.0 - pl.b * 0.9);
}

// a halftone screen turned at an angle: each cell samples once at its center, bigger dots for dark areas, smaller for bright ones
float screen(vec2 frag, float angle, int plate) {
  float c = cos(angle), s = sin(angle);
  mat2 R = mat2(c, -s, s, c);
  vec2 g = R * frag / uCell;
  vec2 cell = floor(g) + 0.5;
  vec2 at = (transpose(R) * cell) * uCell / uRes;
  vec4 pl = texture(uPlate, at);
  float amount = (plate == 0 ? inkOf(pl) : pl.g) * texture(uColor, at).a;
  if (amount < 0.004) return 0.0;
  float r = 0.74 * sqrt(clamp(amount, 0.0, 1.0));
  float aa = 0.8 / uCell;
  return smoothstep(r + aa, r - aa, length(g - cell));
}

float bayer(vec2 p) {
  const float M[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  ivec2 i = ivec2(mod(p, 4.0));
  return (M[i.y * 4 + i.x] + 0.5) / 16.0;
}

// whiskers: each is a short arc (four line segments), thick at the root, thin at the tip.
// for each segment, find the closest point on the view ray; draw it only if close enough and not blocked by something in front.
float whiskers(vec2 frag) {
  if (length(frag - uFace.xy) > uFace.z) return 0.0;
  vec2 uv = (frag - uRes * uCenter) / uRes.y;
  vec3 rd = normalize(uCam * vec3(uv, uZoom));
  float seen = NEAR + DEPTH * texture(uPlate, frag / uRes).a + 0.035;   // how deep this point is in the photo
  float m = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 A = uWhisk[i * 3], M = uWhisk[i * 3 + 1], B = uWhisk[i * 3 + 2];
    vec3 prev = A;
    for (int j = 1; j <= 4; j++) {
      float s = float(j) / 4.0;
      vec3 next = mix(mix(A, M, s), mix(M, B, s), s);
      vec3 ab = next - prev, ao = prev - uEye;
      float abab = dot(ab, ab), abrd = dot(ab, rd);
      float k = clamp((dot(ao, rd) * abrd - dot(ao, ab)) / max(abab - abrd * abrd, 1e-6), 0.0, 1.0);
      vec3 c = prev + ab * k;
      float t = dot(c - uEye, rd);
      float px = t / (uZoom * uRes.y);                         // how wide one device pixel is at this depth
      float along = (float(j - 1) + k) / 4.0;                  // how far along from root to tip
      float cover = clamp(mix(0.95, 0.3, along) * uPx - length(uEye + rd * t - c) / px + 0.5, 0.0, 1.0);
      if (t < seen) m = max(m, cover);
      prev = next;
    }
  }
  return m;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float k = 0.0, b = 0.0;
  float wk = whiskers(frag);

  if (uMode == 0) {
    // halftone: black plate at 45 deg, blue plate at 15 deg, offset the same way as two-color offset printing
    k = screen(frag, 0.7854, 0);
    b = screen(frag, 0.2618, 1);
  } else if (uMode == 1) {
    // characters: one cell (width 1, height 2) per glyph, denser glyphs for more ink
    vec2 size = vec2(uCell, uCell * 2.0);
    vec2 g = frag / size;
    vec2 cell = floor(g);
    vec2 at = (cell + 0.5) * size / uRes;
    vec4 pl = texture(uPlate, at);
    float keep = texture(uColor, at).a;
    float ink = inkOf(pl) * keep, blu = pl.g * keep;
    float amount = max(ink, blu);
    float idx = floor(clamp(amount, 0.0, 0.999) * uGlyphs);
    vec2 in_ = fract(g);
    float cov = texture(uGlyph, vec2((idx + in_.x) / uGlyphs, 1.0 - in_.y)).r;
    if (blu > ink) b = cov; else k = cov;
  } else if (uMode == 2) {
    // ordered dithering: the plainest black-and-white pixels
    float px = max(2.0, floor(uCell * 0.5));
    vec2 cell = floor(frag / px);
    vec2 at = (cell + 0.5) * px / uRes;
    vec4 pl = texture(uPlate, at);
    float keep = texture(uColor, at).a;
    float th = bayer(cell);
    k = step(th, inkOf(pl) * keep);
    b = step(th, pl.g * keep);
  } else {
    // photo: no printing, just view it directly. The whiskers are translucent ivory, visible only against the darker fur
    vec4 c = texture(uColor, frag / uRes);
    vec3 rgb = pow(clamp(c.rgb, 0.0, 1.0), vec3(0.4545));
    float a = max(c.a, wk * 0.85);
    o = vec4(mix(rgb, mix(vec3(0.99, 0.97, 0.93), vec3(0.45, 0.4, 0.36), smoothstep(0.55, 0.9, dot(rgb, vec3(0.333)))), wk * 0.85) * a, a);
    return;
  }

  // print blue first, then black, then trace the whiskers last; wherever there's no ink it's transparent, showing the paper underneath
  k = max(k, wk * 0.8);
  float a = 1.0 - (1.0 - b) * (1.0 - k);
  o = vec4(uBlue * b * (1.0 - k) + uInk * k, a);
}`;
