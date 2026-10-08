'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';

const TABS = [
  { key: 'dishes', href: '/admin/catalog/dishes' },
  { key: 'packages', href: '/admin/catalog/packages' },
  { key: 'categories', href: '/admin/catalog/categories' },
  { key: 'services', href: '/admin/catalog/services' },
] as const;

/** En-tête des listes du catalogue : titre, onglets (liens) et action principale. */
export function CatalogHeader({ action }: { action?: ReactNode }) {
  const t = useTranslations('catalog');
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('title')} description={t('subtitle')} actions={action} />
      <nav aria-label={t('title')} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b px-1">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex h-12 items-center border-b-2 px-4 text-base font-medium transition-colors ${
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`tabs.${tab.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
