import { TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Élément enregistré sans catégorie ou sans type (avant que le choix soit obligatoire). */
export function MissingListValue({ children }: { children: ReactNode }) {
  return (
    <span
      data-testid="missing-list-value"
      className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
    >
      <TriangleAlertIcon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}
