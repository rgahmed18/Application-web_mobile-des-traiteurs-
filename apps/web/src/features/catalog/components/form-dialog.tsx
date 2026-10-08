'use client';

import { useTranslations } from 'next-intl';
import { type FormEventHandler, type ReactNode, useState } from 'react';

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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { UnsavedChangesGuard } from '../forms/unsaved-changes-guard';

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Formulaire modifié : la fermeture demande confirmation. */
  dirty: boolean;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}

/** Formulaire court dans une fenêtre (catégorie, service), protégé contre la perte de saisie. */
export function FormDialog({
  open,
  onClose,
  title,
  dirty,
  submitting,
  disabled,
  onSubmit,
  children,
}: FormDialogProps) {
  const t = useTranslations('catalog.unsaved');
  const tc = useTranslations('common');
  const [confirming, setConfirming] = useState(false);

  const requestClose = () => (dirty ? setConfirming(true) : onClose());

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <UnsavedChangesGuard when={open && dirty} />
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle className="text-xl">{title}</DialogTitle>
            </DialogHeader>
            {children}
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={requestClose}>
                {tc('cancel')}
              </Button>
              <Button type="submit" size="lg" disabled={submitting || disabled}>
                {submitting ? tc('saving') : tc('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t('description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">{t('stay')}</AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onClose();
              }}
            >
              {t('leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
