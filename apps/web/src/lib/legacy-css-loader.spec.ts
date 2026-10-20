import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

// Chargeur CSS de compatibilité avec les anciens navigateurs (CommonJS, exécuté par Turbopack)
const { transformCss } = createRequire(import.meta.url)('../../legacy-css-loader.cjs') as {
  transformCss: (css: string) => Promise<string>;
};

const compact = (css: string) => css.replace(/\s+/g, ' ').trim();

describe('legacy-css-loader', () => {
  it('aplatit les couches @layer en conservant leur priorité', async () => {
    const css = await transformCss(
      '@layer base, utilities; @layer utilities { .p-4 { padding: 1rem } } @layer base { a { color: red } }',
    );
    expect(css).not.toContain('@layer');
    // La couche « utilities », déclarée après « base », reste prioritaire
    expect(compact(css)).toMatch(/\.p-4:not\(#\\#\)[^{]*\{ padding: 1rem \}/);
    expect(compact(css)).toContain('a { color: red }');
  });

  it('ajoute une hauteur en vh avant svh / dvh', async () => {
    const css = await transformCss(
      '.h-svh { height: 100svh } .m { max-height: calc(100dvh - 2rem) }',
    );
    expect(compact(css)).toContain('height: 100vh; height: 100svh');
    expect(compact(css)).toContain(
      'max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem)',
    );
  });

  it('donne les composantes RVB des couleurs du thème, alias compris', async () => {
    const css = compact(
      await transformCss(
        ':root { --primary: oklch(0.5 0.13 42); --border: oklch(1 0 0 / 10%); --color-primary: var(--primary) }',
      ),
    );
    expect(css).toContain('--primary-rgb: 158 68 29; --primary-a: 1');
    expect(css).toContain('--border-rgb: 255 255 255; --border-a: 0.1');
    expect(css).toContain(
      '--color-primary-rgb: var(--primary-rgb); --color-primary-a: var(--primary-a, 1)',
    );
  });

  it('remplace color-mix() par rgb() avec opacité pour les seuls navigateurs anciens', async () => {
    const css = compact(
      await transformCss(
        ':root { --primary: #9e441d } .bg-primary\\/10 { background-color: var(--primary) } ' +
          '@supports (color: color-mix(in lab, red, red)) { .bg-primary\\/10 { background-color: color-mix(in oklab, var(--primary) 10%, transparent) } }',
      ),
    );
    expect(css).toContain(
      '@supports not ((color: color-mix(in lab, red, red))) { .bg-primary\\/10 { background-color: rgb(var(--primary-rgb) / calc(var(--primary-a, 1) * 0.1)) } }',
    );
    // Le bloc d'origine reste en place pour les navigateurs récents
    expect(css).toContain('@supports (color: color-mix(in lab, red, red))');
  });

  it("écrit les couleurs oklch() en sRGB et ne rétablit l'oklch() que sous @supports (color-mix)", async () => {
    const css = compact(
      await transformCss(
        ':root { --primary: oklch(0.5 0.13 42) } ' +
          '@supports (color: color-mix(in lab, red, red)) { .x { color: color-mix(in oklab, var(--primary) 10%, transparent) } }',
      ),
    );
    expect(css).toContain(':root { --primary: #9e441d;');
    expect(css).toMatch(
      /@supports \(color: color-mix\(in lab, red, red\)\) \{ :root \{ --primary: oklch\(0\.5 0\.13 42\)\s*\}\s*\}/,
    );
    // Le bloc réservé aux anciens navigateurs ne reprend jamais l'oklch()
    expect(css).not.toMatch(/@supports not[^@]*oklch/);
  });

  it('remplace un repli vide var(--x,) par un espace que le minificateur conserve', async () => {
    const css = await transformCss(
      '.ring-1 { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 1px red } .b { backdrop-filter: var(--a,) var(--b, ) }',
    );
    expect(css).toContain('--tw-ring-shadow: var(--tw-ring-inset,/*!*/ /*!*/) 0 0 0 1px red');
    expect(css).toContain('backdrop-filter: var(--a,/*!*/ /*!*/) var(--b,/*!*/ /*!*/)');
  });

  it("ignore un color-mix() sur une variable qui n'est pas une couleur du thème", async () => {
    const css = await transformCss(
      '@supports (color: color-mix(in lab, red, red)) { .x { color: color-mix(in oklab, var(--inconnue) 50%, transparent) } }',
    );
    expect(css).not.toContain('@supports not');
  });
});
