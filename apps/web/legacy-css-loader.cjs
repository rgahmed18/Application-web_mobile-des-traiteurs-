// Chargeur Turbopack exécuté APRÈS Tailwind (voir next.config.ts) : rend le CSS lisible par les
// navigateurs visés dans « browserslist » (package.json), jusqu'à Chrome 87 et Safari 15.
// Les navigateurs récents gardent exactement le même rendu.
//   - @layer (Chrome 99, Safari 15.4) : sans support, le navigateur ignore tout le bloc, donc
//     toute la mise en forme. Les couches sont aplaties ; leur ordre de priorité est conservé
//     par le plugin csstools (spécificité ajoutée aux couches les plus prioritaires).
//   - svh / dvh / lvh (Chrome 108, Safari 15.4) : une valeur de repli en vh est placée juste
//     avant, ignorée par les navigateurs récents qui lisent la déclaration suivante.
//   - color-mix() (Chrome 111, Safari 16.2) : Tailwind s'en sert pour les couleurs avec opacité
//     (bg-primary/10, ring-foreground/10...) et ne prévoit qu'un repli opaque. Chaque couleur
//     du thème reçoit ses composantes (--x-rgb, --x-a) et un bloc @supports not (color-mix)
//     applique rgb(var(--x-rgb) / opacité) aux seuls navigateurs anciens.
//   - couleurs oklch() du thème : Turbopack ajoute un repli sRGB et réserve lab() aux navigateurs
//     qui le lisent, dont Safari 15 (au test, ses teintes sombres en lab() sortent trop claires :
//     #242424 au lieu de #0a0a0a pour le texte). La valeur sRGB
//     est donc écrite pour tous et l'oklch() d'origine rétabli sous @supports (color-mix).
//   - var(--x,) à repli vide (Chrome 99 environ) : rejeté à la lecture par les anciens Chrome, ce
//     qui supprime contours (ring), flous et transformations de Tailwind. Le repli devient un
//     espace, de même sens : « var(--x,/*!*/ /*!*/) », que le minificateur garde en « var(--x, ) ».
// Le reste (imbrication, couleurs lab() / oklch(), @property) a déjà un repli produit par
// Tailwind ou par Turbopack.
/* eslint-disable @typescript-eslint/no-require-imports -- chargeur CommonJS (loader-runner de Turbopack) */
const postcss = require('postcss');
const cascadeLayers = require('@csstools/postcss-cascade-layers');
const { transform } = require('lightningcss');

const VIEWPORT_UNIT = /(\d)(?:s|d|l)vh\b/g;
const COLOR_LITERAL = /^(?:#[\da-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(.*\))$/i;
const ALIAS = /^var\((--[\w-]+)\)$/;
const COLOR_MIX = /color-mix\(in [a-z]+,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)/g;
const EMPTY_FALLBACK = /var\((--[\w-]+),\s*\)/g;

/** @type {import('postcss').PluginCreator<void>} */
const emptyFallback = () => ({
  postcssPlugin: 'empty-var-fallback',
  Declaration(decl) {
    if (!decl.value.includes(',')) return;
    const value = decl.value.replace(EMPTY_FALLBACK, 'var($1,/*!*/ /*!*/)');
    if (value !== decl.value) decl.value = value;
  },
});
emptyFallback.postcss = true;

/** @type {import('postcss').PluginCreator<void>} */
const viewportUnitFallback = () => ({
  postcssPlugin: 'viewport-unit-fallback',
  Declaration(decl) {
    if (!VIEWPORT_UNIT.test(decl.value)) return;
    VIEWPORT_UNIT.lastIndex = 0;
    const fallback = decl.value.replace(VIEWPORT_UNIT, '$1vh');
    const previous = decl.prev();
    if (previous?.type === 'decl' && previous.prop === decl.prop && previous.value === fallback) {
      return;
    }
    decl.cloneBefore({ value: fallback });
  },
});
viewportUnitFallback.postcss = true;

const rgbCache = new Map();

/**
 * Composantes sRGB d'une couleur CSS et son écriture sRGB (#rrggbb ou rgba()), par Lightning
 * CSS ; null si la valeur n'est pas une couleur.
 */
function toRgb(color) {
  if (rgbCache.has(color)) return rgbCache.get(color);
  let rgb = null;
  try {
    const css = transform({
      filename: 'couleur.css',
      code: Buffer.from(`a{color:${color}}`),
      minify: true,
      targets: { chrome: 60 << 16 },
    }).code.toString();
    // Premier repli produit : #rrggbb, #rgb ou rgba(r,g,b,a)
    const value = /color:([^;}]+)/.exec(css)?.[1] ?? '';
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1];
    if (hex) {
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
      rgb = {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: 1,
        srgb: value,
      };
    } else {
      const parts = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(value);
      if (parts)
        rgb = {
          r: +parts[1],
          g: +parts[2],
          b: +parts[3],
          a: parts[4] === undefined ? 1 : +parts[4],
          srgb: value,
        };
    }
  } catch {
    rgb = null;
  }
  rgbCache.set(color, rgb);
  return rgb;
}

/** @type {import('postcss').PluginCreator<void>} */
const colorMixFallback = () => ({
  postcssPlugin: 'color-mix-fallback',
  OnceExit(root) {
    // 1. Composantes de chaque couleur déclarée en propriété personnalisée (thème clair et sombre)
    const known = new Set();
    /** Couleurs hors sRGB (oklch, lab…) à rétablir dans un bloc réservé aux navigateurs récents. */
    const modern = new Map();
    root.walkDecls(/^--/, (decl) => {
      if (/-(?:rgb|a)$/.test(decl.prop)) return;
      const value = decl.value.trim();
      const alias = ALIAS.exec(value)?.[1];
      if (alias) {
        decl.cloneAfter({ prop: `${decl.prop}-a`, value: `var(${alias}-a, 1)` });
        decl.cloneAfter({ prop: `${decl.prop}-rgb`, value: `var(${alias}-rgb)` });
        known.add(decl.prop);
        return;
      }
      if (!COLOR_LITERAL.test(value)) return;
      const rgb = toRgb(value);
      if (!rgb) return;
      decl.cloneAfter({ prop: `${decl.prop}-a`, value: String(rgb.a) });
      decl.cloneAfter({ prop: `${decl.prop}-rgb`, value: `${rgb.r} ${rgb.g} ${rgb.b}` });
      known.add(decl.prop);
      // oklch() / lab()… : valeur sRGB pour tous, valeur d'origine sous @supports (color-mix).
      // Sans cela, Safari 15 (qui lit lab() mais pas color-mix()) recevrait le lab() produit
      // ensuite par Turbopack, rendu trop clair pour les teintes sombres.
      if (/^(?:oklch|oklab|lab|lch|color)\(/i.test(value) && decl.parent?.type === 'rule') {
        const rule = decl.parent;
        if (!modern.has(rule)) modern.set(rule, []);
        modern.get(rule).push({ prop: decl.prop, value });
        decl.value = rgb.srgb;
      }
    });
    for (const [rule, decls] of modern) {
      const supports = postcss.atRule({
        name: 'supports',
        params: '(color: color-mix(in lab, red, red))',
      });
      supports.append(
        postcss.rule({ selector: rule.selector }).append(decls.map((d) => postcss.decl(d))),
      );
      rule.after(supports);
    }

    // 2. Pendant « @supports not (color-mix) » de chaque bloc « @supports (color-mix) »
    const blocks = [];
    root.walkAtRules('supports', (rule) => {
      if (rule.params.includes('color-mix')) blocks.push(rule);
    });
    for (const block of blocks) {
      const fallback = block.clone({ params: `not (${block.params})` });
      // Seules les déclarations avec un color-mix() convertible sont reprises (les blocs ajoutés
      // à l'étape 1, sans color-mix(), ne doivent pas revenir aux anciens navigateurs)
      fallback.walkDecls((decl) => {
        let convertible = true;
        const value = decl.value.replace(COLOR_MIX, (_match, name, percent) => {
          if (!known.has(name)) convertible = false;
          return `rgb(var(${name}-rgb) / calc(var(${name}-a, 1) * ${Number(percent) / 100}))`;
        });
        if (!convertible || value === decl.value || value.includes('color-mix(')) decl.remove();
        else decl.value = value;
      });
      fallback.walkRules((rule) => {
        if (rule.nodes.length === 0) rule.remove();
      });
      fallback.walkAtRules((atRule) => {
        if (atRule.nodes?.length === 0) atRule.remove();
      });
      if (fallback.nodes.length > 0) block.before(fallback);
    }
  },
});
colorMixFallback.postcss = true;

const processor = postcss([
  cascadeLayers(),
  viewportUnitFallback(),
  emptyFallback(),
  colorMixFallback(),
]);

/** @this {{ async(): (error: Error | null, css?: string) => void, resourcePath: string }} */
module.exports = function legacyCssLoader(source) {
  const callback = this.async();
  processor
    .process(source, { from: this.resourcePath, to: this.resourcePath })
    .then((result) => callback(null, result.css))
    .catch((error) => callback(error));
};

/** Transformation seule, pour les tests. */
module.exports.transformCss = (css) =>
  processor.process(css, { from: undefined }).then((result) => result.css);
