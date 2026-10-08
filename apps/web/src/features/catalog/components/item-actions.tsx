'use client';

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useErrorMessage } from '@/lib/api/use-error-message';

import { type CatalogResource, type LifecycleAction, useLifecycleAction } from '../catalog-api';

interface ItemActionsProps {
  resource: CatalogResource;
  id: string;
  name: string;
  archived: boolean;
  /** Utilisé dans une commande ou un devis : seule l'archive est proposée. */
  inUse: boolean;
  onEdit: () => void;
  onDuplicate?: () => void;
}

/**
 * Actions d'un élément du catalogue. La suppression définitive n'est proposée que pour un
 * élément jamais utilisé ; sinon, l'élément s'archive (et se restaure).
 */
export function ItemActions({
  resource,
  id,
  name,
  archived,
  inUse,
  onEdit,
  onDuplicate,
}: ItemActionsProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const describeError = useErrorMessage();
  const lifecycle = useLifecycleAction(resource);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  async function run(action: LifecycleAction) {
    try {
      await lifecycle.mutateAsync({ id, action });
      toast.success(
        tc(
          action === 'archive'
            ? 'archivedSuccess'
            : action === 'restore'
              ? 'restoredSuccess'
              : 'deletedSuccess',
        ),
      );
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('actions.moreActions', { name })}>
            <EllipsisVerticalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem className="py-2.5 text-base" onSelect={onEdit}>
            <PencilIcon aria-hidden />
            {t('actions.edit')}
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem className="py-2.5 text-base" onSelect={onDuplicate}>
              <CopyIcon aria-hidden />
              {t('actions.duplicate')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem className="py-2.5 text-base" onSelect={() => void run('restore')}>
              <ArchiveRestoreIcon aria-hidden />
              {t('actions.restore')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="py-2.5 text-base"
              onSelect={() => setConfirming('archive')}
            >
              <ArchiveIcon aria-hidden />
              {t('actions.archive')}
            </DropdownMenuItem>
          )}
          {!inUse && (
            <DropdownMenuItem
              variant="destructive"
              className="py-2.5 text-base"
              onSelect={() => setConfirming('delete')}
            >
              <Trash2Icon aria-hidden />
              {t('actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === 'delete'
                ? t('confirm.deleteTitle', { name })
                : t('confirm.archiveTitle', { name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {confirming === 'delete'
                ? t('confirm.deleteDescription')
                : t('confirm.archiveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              variant={confirming === 'delete' ? 'destructive' : 'default'}
              disabled={lifecycle.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirming) void run(confirming);
              }}
            >
              {confirming === 'delete' ? t('actions.delete') : t('actions.archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
