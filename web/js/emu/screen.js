// Affichage des écrans du jeu avec un filtre (WebGL) : pixels nets, lissé, contours HD (Scale3x) ou écran LCD.
// La source (256 × 192, ou plus en 3D HD) est composée avec la couche des amis, puis agrandie à la taille affichée.

export const FILTERS = [
  { id: 'net', label: 'Pixels nets', sub: 'L’image d’origine, sans retouche' },
  { id: 'hq', label: 'Contours HD', sub: 'Bords arrondis, pixels lissés (Scale3x)' },
  { id: 'lisse', label: 'Lissé', sub: 'Doux, comme un écran moderne' },
  { id: 'lcd', label: 'Écran LCD', sub: 'Grille fine, comme sur la console' },
];
const MODE = { net: 0, hq: 1, lisse: 2, lcd: 3 };

const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D t; uniform vec2 sz; uniform int mode;
vec3 px(vec2 c) { return texture2D(t, (floor(c) + .5) / sz).rgb; }
bool eq(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b < .02; }
void main() {
  vec2 c = uv * sz;
  if (mode == 2) { gl_FragColor = vec4(texture2D(t, uv).rgb, 1.); return; }
  vec3 E = px(c);
  if (mode == 3) {
    vec2 f = fract(c), g = min(f, 1. - f);
    float k = smoothstep(0., .14, min(g.x, g.y));
    gl_FragColor = vec4(E * (.78 + .22 * k), 1.); return;
  }
  if (mode == 1) {
    vec3 A = px(c + vec2(-1., -1.)), B = px(c + vec2(0., -1.)), C = px(c + vec2(1., -1.));
    vec3 D = px(c + vec2(-1., 0.)),                              F = px(c + vec2(1., 0.));
    vec3 G = px(c + vec2(-1., 1.)),  H = px(c + vec2(0., 1.)),  I = px(c + vec2(1., 1.));
    vec2 s = floor(fract(c) * 3.);
    int k = int(s.y * 3. + s.x);
    bool db = eq(D, B), bf = eq(B, F), dh = eq(D, H), hf = eq(H, F);
    vec3 o = E;
    if (k == 0) { if (db && !bf && !dh) o = D; }
    else if (k == 1) { if ((db && !bf && !dh && !eq(E, C)) || (bf && !db && !hf && !eq(E, A))) o = B; }
    else if (k == 2) { if (bf && !db && !hf) o = F; }
    else if (k == 3) { if ((db && !bf && !dh && !eq(E, G)) || (dh && !db && !hf && !eq(E, A))) o = D; }
    else if (k == 5) { if ((bf && !db && !hf && !eq(E, I)) || (hf && !dh && !bf && !eq(E, C))) o = F; }
    else if (k == 6) { if (dh && !db && !hf) o = D; }
    else if (k == 7) { if ((dh && !db && !hf && !eq(E, I)) || (hf && !dh && !bf && !eq(E, G))) o = H; }
    else if (k == 8) { if (hf && !dh && !bf) o = F; }
    gl_FragColor = vec4(o, 1.); return;
  }
  gl_FragColor = vec4(E, 1.);
}`;

export class ScreenFilter {
  /** src : canvas du jeu · overlay : canvas des amis (facultatif) · el : canvas affiché (créé ici). */
  constructor(src, overlay = null) {
    Object.assign(this, { src, overlay, mode: 'net' });
    this.el = Object.assign(document.createElement('canvas'), { className: 'pl-screen' });
    this.comp = document.createElement('canvas');
    this.cctx = this.comp.getContext('2d');
    const gl = this.gl = this.el.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) { this.ok = false; return; }
    const sh = (type, code) => { const o = gl.createShader(type); gl.shaderSource(o, code); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = { sz: gl.getUniformLocation(prog, 'sz'), mode: gl.getUniformLocation(prog, 'mode') };
    this.ok = true;
  }
  setMode(mode) {
    this.mode = this.ok && MODE[mode] !== undefined ? mode : 'net';
    const on = this.mode !== 'net';
    this.el.style.display = on ? '' : 'none';
    // le canvas d'origine reste en place (transparent) : il continue de recevoir la souris (écran tactile)
    this.src.style.opacity = on ? '0' : '';
    if (this.overlay) this.overlay.style.visibility = on ? 'hidden' : '';
  }
  /** Une fois par image affichée, après le rendu du jeu et des amis. */
  present() {
    if (this.mode === 'net' || !this.ok) return;
    const gl = this.gl, el = this.el, src = this.src;
    const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
    let img = src;
    if (this.overlay) {                                        // le jeu et les amis, filtrés ensemble
      const c = this.comp;
      if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
      const x = this.cctx; x.imageSmoothingEnabled = false;
      x.globalAlpha = 1; x.drawImage(src, 0, 0);
      const o = +(this.overlay.style.opacity || 1);
      if (o > 0) { x.globalAlpha = o; x.drawImage(this.overlay, 0, 0, src.width, src.height); x.globalAlpha = 1; }
      img = c;
    }
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // image déjà en haute définition (3D HD) : les contours HD n'ont plus de sens, on lisse simplement
    const mode = this.mode === 'hq' && img.width > 256 ? 'lisse' : this.mode;
    const f = mode === 'lisse' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.uniform2f(this.u.sz, img.width, img.height);
    gl.uniform1i(this.u.mode, MODE[mode]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
