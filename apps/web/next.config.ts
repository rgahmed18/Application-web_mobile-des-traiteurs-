import path from 'node:path';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Langue lue dans un cookie : voir src/i18n/request.ts
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Parcours e2e : build séparé (.next-e2e), le site de démonstration (.next) n'est jamais touché
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Image Docker : serveur autonome (.next/standalone), dépendances tracées depuis la racine du
  // monorepo (paquet partagé). Activé seulement au build de l'image (NEXT_OUTPUT=standalone) :
  // sous Windows, la copie autonome peut exiger des droits de création de liens symboliques.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../../') }
    : {}),
  // Devis, invitations et activations par lien sécurisé : jamais indexés, jeton jamais transmis
  headers() {
    return Promise.resolve([
      {
        source: '/:area(devis|invitation|activation)/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]);
  },
  // Le back-office est entièrement personnalisé (session, langue par cookie) : pas de
  // pré-rendu partiel, chaque page est rendue à la demande.
  turbopack: {
    rules: {
      // Chargeurs exécutés du dernier au premier : Tailwind, puis la compatibilité avec les
      // anciens navigateurs (legacy-css-loader.cjs)
      '*.css': {
        loaders: [path.join(__dirname, 'legacy-css-loader.cjs'), '@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default withNextIntl(nextConfig);
