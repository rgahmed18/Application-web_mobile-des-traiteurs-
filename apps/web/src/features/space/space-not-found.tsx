import { CircleSlashIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Adresse qui ne sert aucun espace (traiteur inconnu ou résilié, domaine non vérifié) : rien ne
 * laisse deviner ce qui existe ailleurs sur la plateforme.
 */
export async function SpaceNotFound({ unavailable = false }: { unavailable?: boolean }) {
  const t = await getTranslations('space');
  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="space-not-found"
    >
      <CircleSlashIcon className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">
        {unavailable ? t('unavailableTitle') : t('notFoundTitle')}
      </h1>
      <p className="max-w-md text-muted-foreground">
        {unavailable ? t('unavailableBody') : t('notFoundBody')}
      </p>
    </main>
  );
}
