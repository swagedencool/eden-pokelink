// Projection monde -> écran du jeu (écran du haut, 256×192).
// Paramètres de la caméra par défaut de Platine (src/overlay005/field_camera.c, pret/pokeplatinum) :
// distance 666.92, inclinaison 59.05°, demi-angle vertical 8.09°. La cible de la caméra est le joueur.
// Vérifié : les positions projetées tombent au pixel près sur les PNJ du jeu.

/** Types de caméra de Platine (distance, inclinaison en degrés, demi-angle vertical, orthographique ?). */
export const CAMERAS = [
  [666.922119140625, 59.051513671875, 8.0914306640625], [666.922119140625, 68.367919921875, 8.0914306640625],
  [515.4560546875, 54.656982421875, 10.458984375], [666.922119140625, 59.051513671875, 8.0914306640625],
  [1563.537841796875, 50.086669921875, 3.5211181640625, true], [316.501220703125, 59.0460205078125, 16.8804931640625],
  [866.554443359375, 73.1085205078125, 6.3336181640625], [666.922119140625, 59.0460205078125, 8.0914306640625],
  [662.922119140625, 70.4718017578125, 9.8492431640625], [357.6044921875, 40.5889892578125, 15.029296875],
  [1202.355712890625, 60.8038330078125, 4.5758056640625], [675.833251953125, 57.8155517578125, 8.0914306640625],
  [574.577880859375, 63.2647705078125, 9.4976806640625], [515.4560546875, 47.7960205078125, 10.458984375],
  [169.462158203125, 78.37646484375, 29.5367431640625], [653.929443359375, 54.656982421875, 8.349609375],
  [330.921875, 59.051513671875, 15.4742431640625],
].map(([D, a, fov, ortho]) => {
  const th = (a * Math.PI) / 180, t = Math.tan((fov * Math.PI) / 180);
  return { D, S: Math.sin(th), C: Math.cos(th), F: 96 / t, K: 96 / (t * D), ortho: !!ortho };
});

export const SCREEN_W = 256, SCREEN_H = 192, TILE = 16;

/**
 * dx, dy, dz : décalage en unités monde (16 = 1 case) par rapport à la cible de la caméra (le joueur).
 * cam : type de caméra de la carte (en-tête de carte). Perspective : vérifiée sur les PNJ de Bonaugure ;
 * orthographique (intérieurs) : vérifiée sur la mère dans la maison du joueur.
 */
export function project(dx, dy, dz, cam = 0) {
  const c = CAMERAS[cam] || CAMERAS[0];
  const up = dy * c.C - dz * c.S;
  if (c.ortho) return { x: 128 + dx * c.K, y: 96 - up * c.K, scale: 1 };
  const depth = c.D - dy * c.S - dz * c.C;
  return { x: 128 + (c.F * dx) / depth, y: 96 - (c.F * up) / depth, scale: c.D / depth };
}

/** Coin haut-gauche d'un sprite 32×32 posé sur le sol au point projeté (mesuré sur le sprite du joueur). */
export const SPRITE_ANCHOR = { x: -15, y: -27 };

export const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // haut, bas, gauche, droite (ordre du jeu)
export const OPPOSITE = [1, 0, 3, 2];
export const tileOf = v => Math.floor(v / TILE);
