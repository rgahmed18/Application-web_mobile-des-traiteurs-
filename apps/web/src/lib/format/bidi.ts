/**
 * Texte de sens inconnu (nom en arabe ou en français, motif saisi…) inséré dans une phrase :
 * isolat « premier caractère fort » (FSI … PDI, invisibles). Sans lui, un nom arabe dans une
 * ligne française (ou l'inverse) entraîne la ponctuation et les éléments voisins de son côté.
 * Dans le JSX, préférer l'élément <bdi>.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}
