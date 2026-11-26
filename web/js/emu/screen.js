// Affichage des écrans du jeu avec un filtre (WebGL) : net et régulier, contours HD (Scale3x) ou écran LCD.
// La source (256 × 192, ou plus en 3D HD) est composée avec la couche des amis, puis agrandie à la taille affichée.

export const FILTERS = [
  { id: 'net', label: 'Pixels d’origine', sub: 'L’image telle quelle' },
  { id: 'sharp', label: 'Net et régulier', sub: 'Tous les pixels de la même taille, sans flou' },
  { id: 'hq', label: 'Contours HD', sub: 'Escaliers adoucis (Scale3x), toujours net' },
  { id: 'lcd', label: 'Écran LCD', sub: 'Fine grille, comme sur la console' },
];
const MODE = { net: 0, sharp: 0, hq: 1, lcd: 3 };
const OLD = { lisse: 'sharp' };   // anciens réglages

const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D t; uniform vec2 sz; uniform int mode; uniform float k;
vec3 px(vec2 c) { return texture2D(t, (floor(c) + .5) / sz).rgb; }
bool eq(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b < .02; }
void main() {
  vec2 c = uv * sz;
  vec3 E = px(c);
  if (mode == 3) {                               // LCD : la dernière ligne et colonne de chaque pixel, plus sombres
    vec2 s = floor(fract(c) * k);
    float edge = (s.x >= k - 1. || s.y >= k - 1.) ? .82 : 1.;
    gl_FragColor = vec4(E * edge, 1.); return;
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
    this.u = { sz: gl.getUniformLocation(prog, 'sz'), mode: gl.getUniformLocation(prog, 'mode'), k: gl.getUniformLocation(prog, 'k') };
    this.ok = true;
  }
  setMode(mode) {
    mode = OLD[mode] || mode;
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
    // Rendu à un multiple ENTIER de l'image (tous les pixels identiques), puis le navigateur ajuste en douceur
    // à la taille affichée : net, régulier, sans pixels plus gros que d'autres.
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const need = Math.ceil((r.width * dpr) / img.width);           // agrandissement nécessaire pour remplir l'écran
    const k = this.mode === 'hq' ? 3 * Math.max(1, Math.min(3, Math.ceil(need / 3))) : Math.max(2, Math.min(8, need));
    const W = img.width * k, H = img.height * k;
    if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.uniform2f(this.u.sz, img.width, img.height);
    gl.uniform1i(this.u.mode, MODE[this.mode]);
    gl.uniform1f(this.u.k, k);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
