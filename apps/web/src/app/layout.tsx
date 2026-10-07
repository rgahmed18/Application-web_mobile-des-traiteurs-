import { DEFAULT_LOCALE, getTextDirection } from '@traiteur/shared';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';

import './globals.css';
import { Providers } from './providers';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Gestion Traiteurs',
  description: 'Plateforme de gestion pour traiteurs de fêtes',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // La langue sera dynamique (fr / ar) lors de la mise en place de l'i18n.
  const locale = DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      dir={getTextDirection(locale)}
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
