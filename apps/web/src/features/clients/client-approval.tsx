'use client';

import { type Client, clientRejectSchema } from '@traiteur/shared';
import { CheckIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/session-provider';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useDecideClient } from './clients-api';

/** Statut d'inscription d'un client : « À valider », « Refusé » (rien s'il est accepté). */
export function ClientApprovalBadge({ approval }: { approval: Client['approval'] }) {
  const t = useTranslations('clients.approval');
  if (approval === 'APPROVED') return null;
  return (
    <Badge
      variant={approval === 'PENDING' ? 'default' : 'destructive'}
      data-testid="client-approval-badge"
    >
      {t(`status.${approval}`)}
    </Badge>
  );
}

/**
 * Inscription en ligne : consentement (date, version de la politique) et accord du traiteur.
 * Accepter, refuser avec motif (le client est prévenu), ou revenir sur sa décision.
 */
export function ClientApprovalCard({ client }: { client: Client }) {
  const t = useTranslations('clients.approval');
  const tc = useTranslations('common');
  const locale = useLocale();
  const can = usePermission();
  const describeError = useErrorMessage();
  const timeZone = useTimeZone();
  const decide = useDecideClient();
  const [rejecting, setRejecting] = useState(false);
  const form = useZodForm(clientRejectSchema, { reason: '' });
  if (client.privacyConsentAt === null && client.approval === 'APPROVED') return null;
  const canDecide = can('clients.approve');

  async function approve() {
    try {
      await decide.mutateAsync({ id: client.id, decision: 'approve' });
      toast.success(t('approved'));
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const onReject = form.handleSubmit(async ({ reason }) => {
    try {
      await decide.mutateAsync({ id: client.id, decision: 'reject', reason });
      setRejecting(false);
      form.reset({ reason: '' });
      toast.success(t('rejected'));
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <Card data-testid="client-approval">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheckIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <Badge
          variant={
            client.approval === 'APPROVED'
              ? 'secondary'
              : client.approval === 'PENDING'
                ? 'default'
                : 'destructive'
          }
        >
          {t(`status.${client.approval}`)}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {client.privacyConsentAt && (
          <p className="text-sm text-muted-foreground">
            {t('consent', {
              date: formatDateTime(client.privacyConsentAt, timeZone),
              version: client.privacyPolicyVersion ?? '—',
            })}
          </p>
        )}
        {client.approval === 'PENDING' && <p>{t('pendingHint')}</p>}
        {client.approval === 'REJECTED' && client.rejectionReason && (
          <p dir="auto">{t('reason', { reason: client.rejectionReason })}</p>
        )}
        {canDecide && (
          <div className="flex flex-wrap gap-2">
            {client.approval !== 'APPROVED' && (
              <Button onClick={() => void approve()} disabled={decide.isPending}>
                <CheckIcon aria-hidden />
                {t('approve')}
              </Button>
            )}
            {client.approval !== 'REJECTED' && (
              <Button
                variant="outline"
                onClick={() => setRejecting(true)}
                disabled={decide.isPending}
              >
                <XIcon aria-hidden />
                {t('reject')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <form onSubmit={onReject} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('rejectTitle')}</DialogTitle>
              <DialogDescription>{t('rejectHint')}</DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="reason"
              label={t('reasonLabel')}
              render={(field, { invalid }) => (
                <Textarea {...field} rows={3} dir="auto" aria-invalid={invalid} />
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejecting(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
                {t('confirmReject')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
