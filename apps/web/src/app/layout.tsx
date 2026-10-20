import { getTextDirection } from '@traiteur/shared';
import type { Metadata } from 'next';
import { Geist, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { currentScriptFallbackScript, unsupportedBrowserScript } from '@/lib/browser-support';
import { publicEnvScript, serverPublicEnv } from '@/lib/env/public';

import './globals.css';
import { Providers } from './providers';

const latinFont = Geist({
  variable: '--font-latin',
  subsets: ['latin'],
});

// Police arabe lisible à l'écran, avec les mêmes graisses que l'interface latine
const arabicFont = IBM_Plex_Sans_Arabic({
  variable: '--font-arabic',
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  const dir = getTextDirection(locale);
  const t = await getTranslations('unsupportedBrowser');

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${latinFont.variable} ${arabicFont.variable} h-full antialiased`}
    >
      <head>
        {/* Navigateur trop ancien : message à la place de l'application (avant tout le reste) */}
        <script
          dangerouslySetInnerHTML={{
            __html: unsupportedBrowserScript({ title: t('title'), body: t('body'), dir }),
          }}
        />
        {/* Démarrage de Next quand ses fichiers arrivent dans le désordre (voir browser-support) */}
        <script dangerouslySetInnerHTML={{ __html: currentScriptFallbackScript() }} />
        {/* Adresses de l'API et des photos, lues au démarrage du serveur (pas au build) */}
        <script dangerouslySetInnerHTML={{ __html: publicEnvScript(serverPublicEnv()) }} />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
