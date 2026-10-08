import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

interface MessageScreenProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

/** Écran de message plein cadre (accès refusé, page introuvable, bientôt disponible). */
export function MessageScreen({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: MessageScreenProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted">
        <Icon className="size-8 text-muted-foreground" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-base text-muted-foreground">{description}</p>
      {actionLabel && actionHref && (
        <Button asChild size="lg" className="mt-2">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}
