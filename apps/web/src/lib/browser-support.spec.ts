import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  currentScriptFallbackScript,
  UNSUPPORTED_BROWSER_ID,
  unsupportedBrowserScript,
} from './browser-support';

describe('currentScriptFallbackScript', () => {
  /** Document minimal : currentScript natif (getter du prototype) et scripts de la page. */
  function page(native: unknown, scripts: unknown[]) {
    class Document {
      get currentScript() {
        return native;
      }
    }
    const document = Object.assign(new Document(), { querySelectorAll: () => scripts });
    runInNewContext(currentScriptFallbackScript(), { document, Document, Object });
    return document;
  }

  it('garde le script en cours quand le navigateur le donne', () => {
    const running = { src: '/_next/static/chunks/a.js' };
    expect(page(running, [{ src: '/_next/static/chunks/z.js' }]).currentScript).toBe(running);
  });

  it('renvoie un script de Next quand le navigateur donne null', () => {
    const last = { src: '/_next/static/chunks/z.js' };
    expect(page(null, [{ src: '/_next/static/chunks/a.js' }, last]).currentScript).toBe(last);
  });

  it('reste null sans script de Next dans la page', () => {
    expect(page(null, []).currentScript).toBeNull();
  });

  it('reste en ES5', () => {
    expect(currentScriptFallbackScript()).not.toMatch(/=>|`|\blet\b|\bconst\b|\bclass\b|</);
  });
});

const text = {
  title: 'Navigateur trop ancien',
  body: 'Mettez à jour <votre> navigateur.',
  dir: 'ltr' as const,
};

interface FakeElement {
  tag: string;
  id?: string;
  innerHTML?: string;
  attributes: Record<string, string>;
  children: (FakeElement | string)[];
  appendChild(child: FakeElement | string): void;
  setAttribute(name: string, value: string): void;
}

/** Exécute le script dans un « navigateur » minimal ; `globals` simule ses fonctions. */
function run(globals: Record<string, unknown>) {
  const element = (tag: string): FakeElement => ({
    tag,
    attributes: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  });
  const head = element('head');
  const body = element('body');
  const document = {
    readyState: 'complete',
    body,
    createElement: element,
    createTextNode: (value: string) => value,
    getElementsByTagName: () => [head],
    addEventListener: () => undefined,
  };
  runInNewContext(unsupportedBrowserScript(text), { document, ...globals });
  return { head, body };
}

const modern = {
  Promise: { any: () => undefined },
  String,
  BigInt64Array: class {},
};

describe('unsupportedBrowserScript', () => {
  it('ne fait rien sur un navigateur pris en charge', () => {
    const { head, body } = run(modern);
    expect(head.children).toHaveLength(0);
    expect(body.children).toHaveLength(0);
  });

  it.each([
    ['Promise.any absent (Chrome < 85, Safari < 14)', { ...modern, Promise: {} }],
    ['BigInt64Array absent (Safari < 15)', { ...modern, BigInt64Array: undefined }],
    ['Promise absent (très ancien navigateur)', { ...modern, Promise: undefined }],
  ])('affiche le message : %s', (_case, globals) => {
    const { head, body } = run(globals);
    expect(head.children).toHaveLength(1);
    const message = body.children[0] as FakeElement;
    expect(message.id).toBe(UNSUPPORTED_BROWSER_ID);
    expect(message.attributes.dir).toBe('ltr');
    // Texte échappé : aucune balise injectée depuis les traductions
    expect(message.innerHTML).toBe(
      '<h1>Navigateur trop ancien</h1><p>Mettez à jour &lt;votre&gt; navigateur.</p>',
    );
  });

  it('reste en ES5 et ne peut pas fermer la balise <script>', () => {
    const script = unsupportedBrowserScript(text);
    expect(script).not.toMatch(/=>|`|\blet\b|\bconst\b|\bclass\b/);
    expect(script).not.toContain('<');
  });
});
