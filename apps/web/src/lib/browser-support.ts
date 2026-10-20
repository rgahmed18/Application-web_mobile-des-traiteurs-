/**
 * Navigateurs trop anciens : message clair au lieu d'une page cassée.
 *
 * Le back-office vise les navigateurs de « browserslist » (package.json) : Chrome / Edge /
 * Samsung Internet / Huawei de 2020 et plus, Safari iOS 15 et plus, Firefox 79 et plus. En
 * dessous, il manque des fonctions JavaScript dont l'application a besoin. Ce script, placé en
 * tête de page, s'exécute avant l'application ; il est écrit en ES5 pour fonctionner sur
 * n'importe quel navigateur (pas de const, de fonctions fléchées ni de gabarits).
 *
 * Fonctions testées (une par moteur, toutes présentes au minimum visé) :
 *   - Promise.any : Chrome 85, Safari 14, Firefox 79 ;
 *   - String.prototype.replaceAll : Chrome 85, Safari 13.1, Firefox 77 ;
 *   - BigInt64Array : Chrome 67, Safari 15, Firefox 68.
 */
export interface UnsupportedBrowserText {
  title: string;
  body: string;
  dir: 'ltr' | 'rtl';
}

/** Identifiant du message, seul élément visible de la page sur un navigateur trop ancien. */
export const UNSUPPORTED_BROWSER_ID = 'navigateur-ancien';

// !important : le CSS de l'application (couches aplaties, spécificité renforcée) l'emporterait
const STYLE =
  `body>*:not(#${UNSUPPORTED_BROWSER_ID}){display:none!important}` +
  `#${UNSUPPORTED_BROWSER_ID}{display:block!important;max-width:28rem!important;` +
  'margin:15vh auto 0!important;padding:1.5rem!important;' +
  'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif!important;' +
  'color:#171717!important}' +
  `#${UNSUPPORTED_BROWSER_ID} h1{font-size:1.25rem!important;font-weight:600!important;` +
  'margin:0 0 .75rem!important;color:#9e441d!important}' +
  `#${UNSUPPORTED_BROWSER_ID} p{margin:0!important}`;

/** Script ES5 de détection, à placer dans le <head> (texte échappé pour une balise <script>). */
export function unsupportedBrowserScript(text: UnsupportedBrowserText): string {
  const html = `<h1>${escapeHtml(text.title)}</h1><p>${escapeHtml(text.body)}</p>`;
  const script =
    '(function(){' +
    'try{' +
    "if(typeof Promise.any==='function'&&typeof ''.replaceAll==='function'" +
    "&&typeof BigInt64Array==='function')return;" +
    '}catch(e){}' +
    "var s=document.createElement('style');" +
    `s.appendChild(document.createTextNode(${JSON.stringify(STYLE)}));` +
    "document.getElementsByTagName('head')[0].appendChild(s);" +
    'function show(){' +
    "var d=document.createElement('div');" +
    `d.id=${JSON.stringify(UNSUPPORTED_BROWSER_ID)};` +
    `d.setAttribute('dir',${JSON.stringify(text.dir)});` +
    `d.innerHTML=${JSON.stringify(html)};` +
    'document.body.appendChild(d);' +
    '}' +
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show);" +
    'else show();' +
    '})();';
  // Aucune séquence « </script> » possible dans la balise
  return script.replace(/</g, '\\u003c');
}

/**
 * document.currentScript de secours, en ES5, à placer avant les scripts de Next.
 *
 * Next lit document.currentScript pour trouver l'adresse de ses fichiers (getAssetPrefix). Si un
 * fichier dont il dépend arrive après lui (réseau lent, Firefox ancien), Turbopack l'exécute plus
 * tard, quand document.currentScript vaut null : la page ne démarre pas. Seulement dans ce cas,
 * un script /_next/ de la page est renvoyé ; Next en déduit la même adresse.
 */
export function currentScriptFallbackScript(): string {
  return (
    '(function(){try{' +
    "var d=document,p=Object.getOwnPropertyDescriptor(Document.prototype,'currentScript');" +
    'if(!p||!p.get)return;var g=p.get;' +
    "Object.defineProperty(d,'currentScript',{configurable:true,get:function(){" +
    'var s=g.call(d);if(s)return s;' +
    'var l=d.querySelectorAll(\'script[src*="/_next/"]\');return l.length?l[l.length-1]:null;' +
    '}});}catch(e){}})();'
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
