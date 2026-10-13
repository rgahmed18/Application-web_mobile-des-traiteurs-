'use client';

import {
  type InvitationLink,
  STAFF_ROLES,
  type StaffMember,
  type StaffMemberRole,
  staffInviteSchema,
  staffUpdateSchema,
} from '@traiteur/shared';
import { CheckIcon, CopyIcon, MessageCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { PhoneInput } from '@/components/forms/phone-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession } from '@/features/auth/session-provider';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';
import { useZodForm } from '@/lib/forms/use-zod-form';
import { cn } from '@/lib/utils';

import { useInviteMember, useUpdateMember } from './staff-api';

const LOCALES = ['fr', 'ar'] as const;

/** Choix du rôle : libellé clair et phrase d'explication sous chaque rôle. */
export function RolePicker({
  value,
  onChange,
  allowAdmin,
}: {
  value: StaffMemberRole;
  onChange: (role: StaffMemberRole) => void;
  allowAdmin: boolean;
}) {
  const t = useTranslations('staff.roles');
  return (
    <div role="radiogroup" aria-label={t('label')} className="grid gap-2 sm:grid-cols-2">
      {STAFF_ROLES.filter((role) => allowAdmin || role !== 'ADMIN_TRAITEUR').map((role) => {
        const selected = role === value;
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(role)}
            className={cn(
              'flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors',
              selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              {selected && <CheckIcon className="size-4 text-primary" aria-hidden />}
              {t(`${role}.label`)}
            </span>
            <span className="text-sm text-muted-foreground">{t(`${role}.hint`)}</span>
          </button>
        );
      })}
    </div>
  );
}

const inviteFormSchema = z
  .object({
    phone: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(STAFF_ROLES),
    locale: z.enum(LOCALES),
  })
  .transform((values): z.input<typeof staffInviteSchema> => values)
  .pipe(staffInviteSchema);

/** Invitation : le lien d'activation est ensuite affiché (copie, WhatsApp). */
export function InviteDialog({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (member: StaffMember, link: InvitationLink) => void;
}) {
  const t = useTranslations('staff.invite');
  const tl = useTranslations('staff');
  const describeError = useErrorMessage();
  const { context } = useSession();
  const invite = useInviteMember();
  const form = useZodForm(inviteFormSchema, {
    phone: '',
    firstName: '',
    lastName: '',
    role: 'LIVREUR',
    locale: 'fr',
  });

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      const result = await invite.mutateAsync(input);
      onInvited(result.member, result.link);
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('title')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="phone"
        label={tl('fields.phone')}
        description={t('phoneHint')}
        render={(field, { invalid }) => <PhoneInput {...field} aria-invalid={invalid} />}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="firstName"
          label={tl('fields.firstName')}
          render={(field, { invalid }) => (
            <Input {...field} dir="auto" autoComplete="off" aria-invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="lastName"
          label={tl('fields.lastName')}
          render={(field, { invalid }) => (
            <Input {...field} dir="auto" autoComplete="off" aria-invalid={invalid} />
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="role"
        label={tl('fields.role')}
        render={(field) => (
          <RolePicker
            value={field.value}
            onChange={field.onChange}
            allowAdmin={context?.role === 'ADMIN_TRAITEUR' || context?.role === 'SUPER_ADMIN'}
          />
        )}
      />
      <FormField
        control={form.control}
        name="locale"
        label={tl('fields.locale')}
        description={t('localeHint')}
        render={(field) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={field.id} className="w-full sm:w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {tl(`locales.${locale}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FormDialog>
  );
}

const editFormSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(STAFF_ROLES),
    locale: z.enum(LOCALES),
  })
  .transform((values): z.input<typeof staffUpdateSchema> => values)
  .pipe(staffUpdateSchema);

export function EditMemberDialog({
  member,
  onClose,
}: {
  member: StaffMember;
  onClose: () => void;
}) {
  const t = useTranslations('staff');
  const describeError = useErrorMessage();
  const { context } = useSession();
  const update = useUpdateMember();
  const form = useZodForm(editFormSchema, {
    firstName: member.firstName,
    lastName: member.lastName,
    role: member.role,
    locale: member.locale,
  });
  const isAdmin = context?.role === 'ADMIN_TRAITEUR' || context?.role === 'SUPER_ADMIN';

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await update.mutateAsync({ id: member.id, input });
      toast.success(t('edit.saved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('edit.title', { name: `${member.firstName} ${member.lastName}` })}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="firstName"
          label={t('fields.firstName')}
          render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="lastName"
          label={t('fields.lastName')}
          render={(field, { invalid }) => <Input {...field} dir="auto" aria-invalid={invalid} />}
        />
      </div>
      {member.isSelf ? (
        <p className="text-sm text-muted-foreground">{t('edit.selfRole')}</p>
      ) : (
        <FormField
          control={form.control}
          name="role"
          label={t('fields.role')}
          description={t('edit.roleHint')}
          render={(field) => (
            <RolePicker
              value={field.value}
              onChange={field.onChange}
              allowAdmin={isAdmin || member.role === 'ADMIN_TRAITEUR'}
            />
          )}
        />
      )}
      <FormField
        control={form.control}
        name="locale"
        label={t('fields.locale')}
        render={(field) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={field.id} className="w-full sm:w-60">
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
    </FormDialog>
  );
}

/** Lien d'activation, affiché une seule fois : copie, ou envoi par WhatsApp. */
export function InvitationLinkDialog({
  member,
  link,
  timeZone,
  onClose,
}: {
  member: StaffMember;
  link: InvitationLink;
  timeZone: string;
  onClose: () => void;
}) {
  const t = useTranslations('staff.link');
  const role = useTranslations('staff.roles');
  const message =
    member.locale === 'ar'
      ? `السلام عليكم ${member.firstName}، لتفعيل حسابك (${role(`${member.role}.label`)}) : ${link.url}`
      : `Bonjour ${member.firstName}, pour activer votre accès (${role(`${member.role}.label`)}) : ${link.url}`;
  const whatsapp = `https://wa.me/${member.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

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
          <DialogTitle>{t('title', { name: member.firstName })}</DialogTitle>
          <DialogDescription>
            {link.smsSent ? t('smsSent') : t('smsNotSent')}{' '}
            {t('expires', { date: formatDateTime(link.expiresAt, timeZone) })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={link.url}
            dir="ltr"
            aria-label={t('url')}
            data-testid="invitation-link-url"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <CopyIcon aria-hidden />
            {t('copy')}
          </Button>
        </div>
        <Button asChild variant="outline" className="self-start">
          <a href={whatsapp} target="_blank" rel="noreferrer noopener">
            <MessageCircleIcon aria-hidden />
            WhatsApp
          </a>
        </Button>
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
