'use client';

import {
  type InvitationLink,
  STAFF_ROLES,
  STAFF_STATUSES,
  type StaffMember,
  type StaffMemberRole,
} from '@traiteur/shared';
import {
  BanIcon,
  LinkIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  RotateCcwIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

import {
  useCancelInvitation,
  useReactivateMember,
  useRenewInvitation,
  useStaff,
  useSuspendMember,
} from './staff-api';
import { EditMemberDialog, InvitationLinkDialog, InviteDialog } from './staff-dialogs';

const ALL = 'all';
const STATUS_STYLES: Record<StaffMember['status'], string> = {
  ACTIVE:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  INVITED: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  SUSPENDED: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
};

type Dialog =
  | { kind: 'invite' }
  | { kind: 'edit'; member: StaffMember }
  | { kind: 'link'; member: StaffMember; link: InvitationLink }
  | { kind: 'suspend'; member: StaffMember }
  | null;

/** Équipe : rôle, statut, invitations en cours, suspension et réactivation. */
export function TeamList() {
  const t = useTranslations('staff');
  const can = usePermission();
  const timeZone = useTimeZone();
  const describeError = useErrorMessage();
  const manage = can('staff.manage');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffMemberRole | typeof ALL>(ALL);
  const [status, setStatus] = useState<StaffMember['status'] | typeof ALL>(ALL);
  const [dialog, setDialog] = useState<Dialog>(null);
  const debounced = useDebouncedValue(search.trim());
  const staff = useStaff({
    search: debounced || undefined,
    role: role === ALL ? undefined : role,
    status: status === ALL ? undefined : status,
  });
  const renew = useRenewInvitation();
  const cancel = useCancelInvitation();
  const suspend = useSuspendMember();
  const reactivate = useReactivateMember();
  const fail = (error: unknown) => toast.error(describeError(error));

  const members = staff.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            aria-label={t('search')}
            placeholder={t('search')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
          <SelectTrigger className="w-full" aria-label={t('fields.role')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allRoles')}</SelectItem>
            {STAFF_ROLES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`roles.${value}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-full" aria-label={t('fields.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            {STAFF_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {manage && (
          <Button size="lg" onClick={() => setDialog({ kind: 'invite' })}>
            <UserPlusIcon aria-hidden />
            {t('inviteButton')}
          </Button>
        )}
      </div>

      {staff.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="staff-list">
          {members.map((member) => (
            <li
              key={member.id}
              className={cn(
                'flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4',
                member.status === 'SUSPENDED' && 'opacity-75',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium" dir="auto">
                  {member.firstName} {member.lastName}
                  {member.isSelf && (
                    <span className="ms-2 text-sm text-muted-foreground">{t('you')}</span>
                  )}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span dir="ltr">{member.phone}</span>
                  <span>{t(`roles.${member.role}.label`)}</span>
                </p>
                {member.status === 'INVITED' && member.invitation && (
                  <p className="text-sm text-muted-foreground">
                    {member.invitation.expired
                      ? t('invitation.expired')
                      : t('invitation.pending', {
                          date: formatDate(member.invitation.expiresAt, timeZone),
                        })}
                  </p>
                )}
                {member.status === 'SUSPENDED' && member.suspensionReason && (
                  <p className="text-sm text-destructive">
                    {t('suspendedReason', { reason: member.suspensionReason })}
                  </p>
                )}
              </div>
              <Badge
                variant="outline"
                className={STATUS_STYLES[member.status]}
                data-testid="staff-status"
              >
                {t(`status.${member.status}`)}
              </Badge>
              <div className="flex flex-wrap gap-1">
                <Button asChild variant="ghost" size="icon" aria-label={t('actions.call')}>
                  <a href={`tel:${member.phone}`}>
                    <PhoneIcon aria-hidden />
                  </a>
                </Button>
                <Button asChild variant="ghost" size="icon" aria-label="WhatsApp">
                  <a
                    href={`https://wa.me/${member.phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <MessageCircleIcon aria-hidden />
                  </a>
                </Button>
                {manage && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('actions.edit')}
                      title={t('actions.edit')}
                      onClick={() => setDialog({ kind: 'edit', member })}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    {member.status === 'INVITED' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={renew.isPending}
                          onClick={() =>
                            renew.mutate(member.id, {
                              onSuccess: (result) =>
                                setDialog({
                                  kind: 'link',
                                  member: result.member,
                                  link: result.link,
                                }),
                              onError: fail,
                            })
                          }
                        >
                          <LinkIcon aria-hidden />
                          {t('actions.newLink')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('actions.cancelInvitation')}
                          title={t('actions.cancelInvitation')}
                          disabled={cancel.isPending}
                          onClick={() =>
                            cancel.mutate(member.id, {
                              onSuccess: () => toast.success(t('invitation.cancelled')),
                              onError: fail,
                            })
                          }
                        >
                          <XIcon aria-hidden />
                        </Button>
                      </>
                    )}
                    {member.status !== 'SUSPENDED' && !member.isSelf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'suspend', member })}
                      >
                        <BanIcon aria-hidden />
                        {t('actions.suspend')}
                      </Button>
                    )}
                    {member.status === 'SUSPENDED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reactivate.isPending}
                        onClick={() =>
                          reactivate.mutate(member.id, {
                            onSuccess: (result) => {
                              toast.success(t('reactivated'));
                              if (result.link) {
                                setDialog({
                                  kind: 'link',
                                  member: result.member,
                                  link: result.link,
                                });
                              }
                            },
                            onError: fail,
                          })
                        }
                      >
                        <RotateCcwIcon aria-hidden />
                        {t('actions.reactivate')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'invite' && (
        <InviteDialog
          onClose={() => setDialog(null)}
          onInvited={(member, link) => {
            toast.success(t('invite.done', { name: member.firstName }));
            setDialog({ kind: 'link', member, link });
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditMemberDialog member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'link' && (
        <InvitationLinkDialog
          member={dialog.member}
          link={dialog.link}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
        />
      )}
      <ReasonDialog
        key={dialog?.kind === 'suspend' ? dialog.member.id : 'none'}
        open={dialog?.kind === 'suspend'}
        title={t('suspendDialog.title', {
          name: dialog?.kind === 'suspend' ? dialog.member.firstName : '',
        })}
        description={t('suspendDialog.description')}
        label={t('suspendDialog.reason')}
        confirmLabel={t('suspendDialog.confirm')}
        destructive
        pending={suspend.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => {
          if (dialog?.kind !== 'suspend') return;
          suspend.mutate(
            { id: dialog.member.id, input: { reason } },
            {
              onSuccess: () => {
                toast.success(t('suspendDialog.done'));
                setDialog(null);
              },
              onError: fail,
            },
          );
        }}
      />
    </div>
  );
}
