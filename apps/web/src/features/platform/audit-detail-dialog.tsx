'use client';

import type { PlatformAuditEntry } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/format/date';
import { isolate } from '@/lib/format/bidi';

import { useActionLabel } from './action-label';
import { useAuditDescriber } from './audit-summary';

/**
 * Détail d'une ligne du journal : qui, quand, d'où, et les valeurs avant / après, champ par
 * champ. Pour une action d'un traiteur, le contenu n'est pas affiché (données de ses clients).
 */
export function AuditDetailDialog({
  entry,
  onClose,
}: {
  entry: PlatformAuditEntry | null;
  onClose: () => void;
}) {
  const t = useTranslations('platform.audit');
  const actionLabel = useActionLabel();
  const describe = useAuditDescriber();
  if (!entry) return null;

  const keys = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ];
  const hasChange = entry.before !== null || entry.after !== null;
  const summary = describe.summary(entry);
  const meta: [string, string][] = [
    [t('detail.when'), formatDateTime(entry.at)],
    [
      t('detail.who'),
      entry.actor
        ? [entry.actor.name ?? t('hiddenName'), entry.actor.role && describe.role(entry.actor.role)]
            .filter((part): part is string => Boolean(part))
            .map(isolate)
            .join(' · ')
        : t('system'),
    ],
    [t('traiteur'), entry.traiteur?.name ?? t('noTraiteur')],
    [t('detail.ip'), entry.ipAddress ?? '—'],
    [t('detail.userAgent'), entry.userAgent ?? '—'],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="audit-detail">
        <DialogHeader>
          <DialogTitle>{actionLabel(entry.action)}</DialogTitle>
          {summary && (
            <DialogDescription className="text-base" dir="auto">
              {summary}
            </DialogDescription>
          )}
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {meta.map(([label, text]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all" dir="auto">
                {text}
              </dd>
            </div>
          ))}
        </dl>
        {hasChange ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="audit-detail-changes">
              <thead className="bg-muted/60">
                <tr>
                  <th className="p-2 text-start">{t('detail.field')}</th>
                  <th className="p-2 text-start">{t('detail.before')}</th>
                  <th className="p-2 text-start">{t('detail.after')}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const before = describe.value(key, entry.before?.[key]);
                  const after = describe.value(key, entry.after?.[key]);
                  return (
                    <tr key={key} className="border-t">
                      <td className="p-2 text-muted-foreground">{describe.field(key)}</td>
                      <td className="p-2 break-words" dir="auto">
                        {before}
                      </td>
                      <td
                        className={`p-2 break-words ${before !== after ? 'font-medium' : ''}`}
                        dir="auto"
                      >
                        {after}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('detail.hidden')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
