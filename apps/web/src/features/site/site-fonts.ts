import { Amiri, Aref_Ruqaa, Cormorant_Garamond, Manrope } from 'next/font/google';

/*
 * Polices du site client, hébergées avec le site (aucune requête vers Google) et chargées
 * seulement sur le site : titres en Cormorant Garamond (latin) ou Amiri (arabe), jamais pour le
 * texte courant ni sous 24 px ; texte en Manrope (latin) ou IBM Plex Sans Arabic (arabe, chargée
 * par l'application).
 */

const displayLatin = Cormorant_Garamond({
  variable: '--font-site-display',
  subsets: ['latin'],
  weight: ['600', '700'],
  // Italique : titres de la gamme Or
  style: ['normal', 'italic'],
  display: 'swap',
});

const displayArabic = Amiri({
  variable: '--font-site-display-ar',
  subsets: ['arabic'],
  weight: ['400', '700'],
  display: 'swap',
});

/**
 * Calligraphie des titres de la gamme Or en arabe. Non préchargée : téléchargée seulement quand
 * un tel titre est affiché.
 */
const scriptArabic = Aref_Ruqaa({
  variable: '--font-site-script-ar',
  subsets: ['arabic'],
  weight: ['700'],
  display: 'swap',
  preload: false,
});

const body = Manrope({
  variable: '--font-site-body',
  subsets: ['latin'],
  display: 'swap',
});

/** Classes à poser sur le cadre du site : variables des polices. */
export const siteFontClasses = `${displayLatin.variable} ${displayArabic.variable} ${scriptArabic.variable} ${body.variable}`;
