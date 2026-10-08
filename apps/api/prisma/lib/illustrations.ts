/**
 * Illustrations de démonstration du catalogue, générées sans aucune photo externe (aucun droit
 * d'auteur) : assiette sur fond de zellige stylisé, aux couleurs de la catégorie. Volontairement
 * sans texte (le rendu des polices varie d'une machine à l'autre). À remplacer par de vraies
 * photos avec : pnpm --filter @traiteur/api catalog:set-photo (voir README).
 */
import sharp from 'sharp';

export interface Palette {
  background: [string, string];
  pattern: string;
  accent: string;
  food: string[];
}

/** Palettes inspirées de la cuisine marocaine, par catégorie. */
export const PALETTES: Readonly<Record<string, Palette>> = {
  entrees: {
    background: ['#e9f0dc', '#c9d8b0'],
    pattern: '#5b7a3a',
    accent: '#5b7a3a',
    food: ['#c8553d', '#e9b44c', '#6a994e', '#f2e8cf', '#a7c957'],
  },
  plats: {
    background: ['#f6e3d3', '#e3b38f'],
    pattern: '#8c3b1f',
    accent: '#a0522d',
    food: ['#8c3b1f', '#c06014', '#e9b44c', '#5c3d2e', '#6a994e'],
  },
  patisseries: {
    background: ['#fbf1d9', '#efd28d'],
    pattern: '#b8860b',
    accent: '#b8860b',
    food: ['#f3d9a4', '#d4a017', '#8b5a2b', '#fff8e7', '#c19a6b'],
  },
  boissons: {
    background: ['#dff2ec', '#a8d5c4'],
    pattern: '#2a7f62',
    accent: '#2a7f62',
    food: ['#3a9d6e', '#f4a261', '#e76f51', '#b7e4c7', '#fefae0'],
  },
  formules: {
    background: ['#f3e6f0', '#d7b5c9'],
    pattern: '#7b2d5b',
    accent: '#b08d57',
    food: ['#8c3b1f', '#e9b44c', '#6a994e', '#c8553d', '#f3d9a4'],
  },
};

/** Générateur pseudo-aléatoire déterministe : la même clé donne toujours la même image. */
function seededRandom(seedText: string): () => number {
  let seed = 0;
  for (const char of seedText) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Étoile à huit branches (motif de zellige) centrée en (cx, cy). */
function eightPointStar(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI / 8) * index;
    const length = index % 2 === 0 ? radius : radius * 0.62;
    points.push(
      `${(cx + Math.cos(angle) * length).toFixed(1)},${(cy + Math.sin(angle) * length).toFixed(1)}`,
    );
  }
  return points.join(' ');
}

function illustrationSvg(seedText: string, palette: Palette): string {
  const random = seededRandom(seedText);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  const food: string[] = [];
  const pieces = 5 + Math.floor(random() * 5);
  for (let index = 0; index < pieces; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * 210;
    const cx = 800 + Math.cos(angle) * distance;
    const cy = 600 + Math.sin(angle) * distance;
    const rx = 70 + random() * 90;
    const ry = rx * (0.6 + random() * 0.4);
    const rotation = Math.floor(random() * 180);
    food.push(
      `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" ` +
        `transform="rotate(${rotation} ${cx.toFixed(0)} ${cy.toFixed(0)})" fill="${pick(palette.food)}" opacity="0.92"/>`,
    );
  }
  const garnish: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 60 + random() * 230;
    const cx = 800 + Math.cos(angle) * distance;
    const cy = 600 + Math.sin(angle) * distance;
    garnish.push(
      `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="22" ry="9" ` +
        `transform="rotate(${Math.floor(random() * 180)} ${cx.toFixed(0)} ${cy.toFixed(0)})" fill="#4f772d"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.background[0]}"/>
      <stop offset="1" stop-color="${palette.background[1]}"/>
    </linearGradient>
    <pattern id="zellige" width="160" height="160" patternUnits="userSpaceOnUse">
      <polygon points="${eightPointStar(80, 80, 52)}" fill="${palette.pattern}" opacity="0.16"/>
      <polygon points="${eightPointStar(0, 0, 26)}" fill="${palette.pattern}" opacity="0.1"/>
      <polygon points="${eightPointStar(160, 160, 26)}" fill="${palette.pattern}" opacity="0.1"/>
    </pattern>
    <radialGradient id="plate" cx="0.45" cy="0.4" r="0.6">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#ece4d8"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1200" fill="url(#bg)"/>
  <rect width="1600" height="1200" fill="url(#zellige)"/>
  <ellipse cx="820" cy="650" rx="470" ry="450" fill="#000000" opacity="0.14"/>
  <circle cx="800" cy="600" r="460" fill="url(#plate)"/>
  <circle cx="800" cy="600" r="395" fill="none" stroke="${palette.accent}" stroke-width="12" opacity="0.45"/>
  <circle cx="800" cy="600" r="360" fill="#f8f3ea"/>
  ${food.join('\n  ')}
  ${garnish.join('\n  ')}
</svg>`;
}

/** Illustration JPEG (1600×1200) propre à un élément du catalogue. */
export function generateIllustration(seedText: string, palette: Palette): Promise<Buffer> {
  return sharp(Buffer.from(illustrationSvg(seedText, palette)))
    .jpeg({ quality: 88 })
    .toBuffer();
}
