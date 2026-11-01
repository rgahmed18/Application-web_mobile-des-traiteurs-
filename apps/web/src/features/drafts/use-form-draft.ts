'use client';

import type { Draft, DraftFormKey } from '@traiteur/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { sessionStore } from '@/features/auth/session-store';

import { DraftSaver, type DraftSaveStatus } from './draft-saver';
import { deleteDraft, getDraft, saveDraft, saveDraftOnUnload } from './drafts-api';

export type { DraftSaveStatus } from './draft-saver';

export interface FormDraftOptions<TValues extends FieldValues> {
  /** Clé du formulaire ; null : brouillons désactivés (ex. formulaire en lecture seule). */
  formKey: DraftFormKey | null;
  // Le type exact du formulaire (entrée, sortie) n'importe pas ici : seules les valeurs comptent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<TValues, any, any>;
  /** Résumé lisible pour la reprise (« Commande — Mariage Bennani »). */
  label: () => string | null;
  /** Version de l'élément au chargement (version ou date de modification) ; null : création. */
  baseVersion: string | null;
}

export interface FormDraft {
  /** Brouillon trouvé à l'ouverture, en attente de « Reprendre » ou « Supprimer ». */
  pending: Draft | null;
  /** L'élément a été modifié depuis le début du brouillon (verrouillage optimiste). */
  conflict: boolean;
  status: DraftSaveStatus;
  savedAt: Date | null;
  /**
   * Version à présenter à l'enregistrement : celle du brouillon repris (l'API refuse alors si
   * l'élément a changé entre-temps), sinon celle du chargement.
   */
  expectedVersion: string | null;
  resume: () => void;
  discard: () => Promise<void>;
  /** Après l'enregistrement réel : brouillon supprimé (une nouvelle saisie en recrée un). */
  clear: () => Promise<void>;
}

/**
 * Brouillon côté serveur d'un formulaire : enregistrement automatique, avant la fin de session
 * (déconnexion ici ou dans un autre onglet, expiration) et à la fermeture de la page (keepalive),
 * nouvel essai en cas d'échec ; reprise ou suppression d'un brouillon trouvé à l'ouverture.
 */
export function useFormDraft<TValues extends FieldValues>({
  formKey,
  form,
  label,
  baseVersion,
}: FormDraftOptions<TValues>): FormDraft {
  // Brouillon trouvé, rattaché à sa clé : changer de formulaire l'oublie sans effet supplémentaire
  const [found, setFound] = useState<{ key: DraftFormKey; draft: Draft | null } | null>(null);
  const pending = found?.key === formKey ? found.draft : null;
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [resumedVersion, setResumedVersion] = useState<string | null | undefined>(undefined);

  // Dernières valeurs, lues par les minuteries et les écouteurs
  const latest = useRef({ formKey, label, base: baseVersion });
  useEffect(() => {
    latest.current = {
      formKey,
      label,
      base: resumedVersion === undefined ? baseVersion : resumedVersion,
    };
  });

  const snapshot = useCallback(
    () => ({
      label: latest.current.label(),
      baseVersion: latest.current.base,
      data: form.getValues(),
    }),
    [form],
  );

  const [saver] = useState(
    () =>
      new DraftSaver({
        // Remplacés après le rendu (dernière clé, dernières valeurs)
        save: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        onStatus: (next, at) => {
          setStatus(next);
          if (at) setSavedAt(at);
        },
      }),
  );
  useEffect(() => {
    saver.configure({
      save: () => {
        const key = latest.current.formKey;
        return key ? saveDraft(key, snapshot()).then(() => undefined) : Promise.resolve();
      },
      remove: () => {
        const key = latest.current.formKey;
        return key ? deleteDraft(key) : Promise.resolve();
      },
    });
  }, [saver, snapshot]);

  // Brouillon existant ?
  useEffect(() => {
    saver.setReady(false);
    if (!formKey) return;
    let cancelled = false;
    getDraft(formKey)
      .then((draft) => {
        if (cancelled) return;
        setFound({ key: formKey, draft });
        saver.setReady(draft === null, form.formState.isDirty);
      })
      .catch(() => {
        if (!cancelled) saver.setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [form, formKey, saver]);

  // Saisie : enregistrement quelques secondes après la dernière modification
  useEffect(() => {
    const subscription = form.watch((_values, { name, type }) => {
      if (!name && type !== 'change') return; // réinitialisation du formulaire, pas une saisie
      saver.touch();
    });
    return () => subscription.unsubscribe();
  }, [form, saver]);

  // Fin de session (ici ou dans un autre onglet) : enregistrer d'abord
  useEffect(() => sessionStore.beforeEnd(() => saver.flush()), [saver]);

  // Fermeture ou rechargement de la page : envoi qui survit à la page
  useEffect(() => {
    const onPageHide = () => {
      const key = latest.current.formKey;
      if (!key || !saver.hasUnsavedChanges) return;
      if (saveDraftOnUnload(key, snapshot())) saver.markSaved();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [saver, snapshot]);

  // Départ vers une autre page de l'application : enregistrer ce qui ne l'est pas encore
  useEffect(
    () => () => {
      void saver.flush();
      saver.dispose();
    },
    [saver],
  );

  const resume = useCallback(() => {
    if (!pending) return;
    form.reset(pending.data as TValues, { keepDefaultValues: true });
    setResumedVersion(pending.baseVersion);
    setFound(null);
    saver.markSaved();
    saver.setReady(true);
  }, [form, pending, saver]);

  const discard = useCallback(async () => {
    const key = latest.current.formKey;
    setFound(null);
    saver.setReady(true);
    if (key) await deleteDraft(key).catch(() => undefined);
  }, [saver]);

  const clear = useCallback(async () => {
    await saver.clear();
    setResumedVersion(undefined);
  }, [saver]);

  const conflict =
    pending !== null &&
    pending.baseVersion !== null &&
    baseVersion !== null &&
    pending.baseVersion !== baseVersion;

  return {
    pending,
    conflict,
    status,
    savedAt,
    expectedVersion: resumedVersion === undefined ? baseVersion : resumedVersion,
    resume,
    discard,
    clear,
  };
}
