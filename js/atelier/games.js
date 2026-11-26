// Reconnaissance locale d'une ROM Pokémon (Gen 1 à 5) d'après son en-tête, sans rien envoyer.
const LANG = { F: 'FR', E: 'EN', D: 'DE', I: 'IT', S: 'ES', J: 'JP', K: 'KO', P: 'EU' };
const NDS = { ADA: 'Diamant', APA: 'Perle', CPU: 'Platine', IPK: 'Or HeartGold', IPG: 'Argent SoulSilver', IRB: 'Noir', IRA: 'Blanc', IRE: 'Noir 2', IRD: 'Blanc 2' };
const GBA = { AXV: 'Rubis', AXP: 'Saphir', BPE: 'Émeraude', BPR: 'Rouge Feu', BPG: 'Vert Feuille' };
const GB = [[/^POKEMON RED/, 'Rouge', 1], [/^POKEMON BLUE/, 'Bleu', 1], [/^POKEMON (YELLOW|YELAPS)/, 'Jaune', 1], [/^POKEMON GREEN/, 'Vert', 1],
  [/^POKEMON_GLD/, 'Or', 2], [/^POKEMON_SLV/, 'Argent', 2], [/^PM_CRYSTAL/, 'Cristal', 2]];

const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n)).replace(/\0+$/, '');

/** header : les 0x200 premiers octets suffisent. Renvoie { platform, gen, name, lang, code } ou null. */
export function detectRom(header, fileName = '') {
  const b = header;
  const code4 = ascii(b, 0x0c, 4);
  if (b.length >= 0x10 && NDS[code4.slice(0, 3)]) {
    const g = code4.startsWith('IR') ? 5 : 4;
    return { platform: 'nds', gen: g, name: 'Pokémon ' + NDS[code4.slice(0, 3)], lang: LANG[code4[3]] || code4[3], code: code4 };
  }
  const gba = b.length >= 0xb0 ? ascii(b, 0xac, 4) : '';
  if (GBA[gba.slice(0, 3)]) return { platform: 'gba', gen: 3, name: 'Pokémon ' + GBA[gba.slice(0, 3)], lang: LANG[gba[3]] || gba[3], code: gba };
  if (b.length >= 0x150) {
    const title = ascii(b, 0x134, 16);
    for (const [re, name, gen] of GB) if (re.test(title)) {
      const lang = /YELAPS([FDIS])/.exec(title)?.[1] || (gen === 2 ? title.slice(-1) : '');
      return { platform: b[0x143] & 0x80 ? 'gbc' : 'gb', gen, name: 'Pokémon ' + name, lang: LANG[lang] || '', code: title };
    }
  }
  return null;
}

export const prettyName = s => s ? s.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, c) => a + c.toUpperCase()) : s;
export const sizeLabel = n => n >= 1 << 20 ? `${Math.round(n / (1 << 20))} Mo` : `${Math.round(n / 1024)} Ko`;
