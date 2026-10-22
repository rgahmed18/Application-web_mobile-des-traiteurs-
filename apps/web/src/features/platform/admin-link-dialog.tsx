'use client';

import type { PlatformTraiteurCreateResult } from '@traiteur/shared';
import { CopyIcon, MessageCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format/date';

/**
 * Lien d'activation de l'administrateur d'un traiteur, affiché une seule fois : copie, ou envoi
 * par WhatsApp (le SMS part tout seul si le numéro est dans un pays autorisé).
 */
export function AdminLinkDialog({
  result,
  onClose,
}: {
  result: PlatformTraiteurCreateResult | null;
  onClose: () => void;
}) {
  const t = useTranslations('platform.adminLink');
  if (!result) return null;
  const { traiteur, link } = result;
  const admin = traiteur.admin;
  const message = t('message', {
    name: admin?.firstName ?? '',
    traiteur: traiteur.name,
    url: link.url,
  });
  const whatsapp = admin
    ? `https://wa.me/${admin.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
    : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="admin-link-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { traiteur: traiteur.name })}</DialogTitle>
          <DialogDescription>
            {link.smsSent ? t('smsSent') : t('smsNotSent')}{' '}
            {t('expires', { date: formatDateTime(link.expiresAt) })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={link.url}
            dir="ltr"
            aria-label={t('url')}
            data-testid="admin-link-url"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <CopyIcon aria-hidden />
            {t('copy')}
          </Button>
        </div>
        {whatsapp && (
          <Button asChild variant="outline" className="self-start">
            <a href={whatsapp} target="_blank" rel="noreferrer noopener">
              <MessageCircleIcon aria-hidden />
              WhatsApp
            </a>
          </Button>
        )}
        <p className="text-sm text-muted-foreground">{t('once')}</p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
