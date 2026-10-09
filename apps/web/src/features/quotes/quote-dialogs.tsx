'use client';

import {
  MANUAL_ACCEPTANCE_MODES,
  type Quote,
  type QuoteLink,
  quoteUpdateSchema,
} from '@traiteur/shared';
import { CopyIcon, MailIcon, MessageCircleIcon, MessageSquareTextIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime, formatLocalDate } from '@/lib/format/date';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { useAcceptQuoteManually, useUpdateQuote } from './quotes-api';
import { mailtoUrl, shareMessage, shareSubject, smsUrl, whatsappUrl } from './share-links';

const LOCALES = ['fr', 'ar'] as const;

// ─────────────────────────── Brouillon ───────────────────────────

const draftFormSchema = z
  .object({ validUntil: z.string(), locale: z.enum(LOCALES), notes: z.string() })
  .transform((values): z.input<typeof quoteUpdateSchema> => ({
    validUntil: values.validUntil,
    locale: values.locale,
    notes: values.notes.trim() === '' ? null : values.notes.trim(),
  }))
  .pipe(quoteUpdateSchema);

/** Validité, langue et remarques d'un brouillon. */
export function QuoteDraftDialog({
  orderId,
  quote,
  today,
  onClose,
}: {
  orderId: string;
  quote: Quote;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations('quotes');
  const describeError = useErrorMessage();
  const update = useUpdateQuote(orderId);
  const form = useZodForm(draftFormSchema, {
    validUntil: quote.validUntil,
    locale: quote.locale,
    notes: quote.notes ?? '',
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await update.mutateAsync({ id: quote.id, input });
      toast.success(t('draft.saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('draft.title', { reference: quote.reference, version: quote.version })}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="validUntil"
          label={t('draft.validUntil')}
          render={(field, { invalid }) => (
            <Input {...field} type="date" min={today} dir="ltr" aria-invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="locale"
          label={t('draft.locale')}
          description={t('draft.localeHint')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {t(`locales.${locale}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="notes"
        label={t('draft.notes')}
        description={t('draft.notesHint')}
        render={(field, { invalid }) => (
          <Textarea {...field} rows={3} dir="auto" aria-invalid={invalid} />
        )}
      />
    </FormDialog>
  );
}

// ─────────────────────────── Lien à partager ───────────────────────────

/**
 * Lien sécurisé du devis, affiché une seule fois (seule son empreinte est conservée) : copie,
 * ou envoi par WhatsApp, SMS ou e-mail depuis l'appareil du traiteur.
 */
export function QuoteLinkDialog({
  quote,
  link,
  client,
  timeZone,
  onClose,
}: {
  quote: Quote;
  link: QuoteLink;
  client: { firstName: string; phone: string };
  timeZone: string;
  onClose: () => void;
}) {
  const t = useTranslations('quotes.link');
  const message = shareMessage({
    locale: quote.locale,
    firstName: client.firstName,
    reference: quote.reference,
    url: link.url,
    validUntil: formatLocalDate(quote.validUntil),
  });

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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { date: formatDateTime(link.expiresAt, timeZone) })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={link.url}
            dir="ltr"
            aria-label={t('url')}
            data-testid="quote-link-url"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <CopyIcon aria-hidden />
            {t('copy')}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button asChild variant="outline">
            <a href={whatsappUrl(client.phone, message)} target="_blank" rel="noreferrer noopener">
              <MessageCircleIcon aria-hidden />
              WhatsApp
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={smsUrl(client.phone, message)}>
              <MessageSquareTextIcon aria-hidden />
              {t('sms')}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={mailtoUrl(
                shareSubject({ locale: quote.locale, reference: quote.reference }),
                message,
              )}
            >
              <MailIcon aria-hidden />
              {t('email')}
            </a>
          </Button>
        </div>
        <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line" dir="auto">
          {message}
        </p>
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

// ─────────────────────────── Accord manuel ───────────────────────────

const manualFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mode: z.enum(MANUAL_ACCEPTANCE_MODES),
  note: z.string().max(1000),
});

const ACCEPTED_FILES = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Accord du client reçu hors ligne (téléphone, devis papier signé…) : même effet que l'accord
 * en ligne. Le scan ou la photo du devis signé est facultatif (stockage privé).
 */
export function ManualAcceptanceDialog({
  orderId,
  quote,
  clientName,
  onClose,
}: {
  orderId: string;
  quote: Quote;
  clientName: string;
  onClose: () => void;
}) {
  const t = useTranslations('quotes.manual');
  const describeError = useErrorMessage();
  const accept = useAcceptQuoteManually(orderId);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const form = useZodForm(manualFormSchema, { name: clientName, mode: 'PHONE', note: '' });

  const onSubmit = form.handleSubmit(async (values) => {
    if (file && file.size > MAX_FILE_BYTES) {
      setFileError(t('fileTooLarge'));
      return;
    }
    try {
      const result = await accept.mutateAsync({ id: quote.id, ...values, file });
      toast.success(result.availabilityPending ? t('donePending') : t('done'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('title', { reference: quote.reference, version: quote.version })}
      dirty={form.formState.isDirty || file !== null}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="name"
          label={t('name')}
          render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="mode"
          label={t('mode')}
          render={(field) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_ACCEPTANCE_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`modes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="note"
        label={t('note')}
        render={(field, { invalid }) => (
          <Textarea {...field} rows={3} dir="auto" aria-invalid={invalid} />
        )}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="acceptance-file">{t('file')}</Label>
        <Input
          id="acceptance-file"
          type="file"
          accept={ACCEPTED_FILES}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setFileError(null);
          }}
        />
        <p className="text-sm text-muted-foreground">{t('fileHint')}</p>
        {fileError && <p className="text-sm text-destructive">{fileError}</p>}
      </div>
    </FormDialog>
  );
}
