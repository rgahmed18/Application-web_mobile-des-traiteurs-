import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Langue lue dans un cookie : voir src/i18n/request.ts
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Devis consultés par lien sécurisé : jamais indexés, jeton jamais transmis dans un Referer
  headers() {
    return Promise.resolve([
      {
        source: '/devis/:path*',
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
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default withNextIntl(nextConfig);
