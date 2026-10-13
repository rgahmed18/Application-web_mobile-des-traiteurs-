'use client';

import { invitationAcceptResultSchema, type PublicInvitation } from '@traiteur/shared';
import { CheckCircle2Icon, UserRoundCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { publicEnv } from '@/lib/env/public';

/** Choix du mot de passe (nouveau compte) ou confirmation (compte existant). */
export function ActivationForm({
  token,
  invitation,
}: {
  token: string;
  invitation: PublicInvitation;
}) {
  const t = useTranslations('invitation');
  const tr = useTranslations('staff.roles');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mismatch = !invitation.hasPassword && confirm !== '' && confirm !== password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invitation.hasPassword && password !== confirm) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `${publicEnv().PUBLIC_API_URL}/public/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ password }),
          referrerPolicy: 'no-referrer',
        },
      );
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          json && typeof json === 'object' && 'code' in json && typeof json.code === 'string'
            ? json.code
            : '';
        setError(
          code === 'INVALID_CREDENTIALS'
            ? t('errors.wrongPassword')
            : code === 'VALIDATION_ERROR'
              ? t('errors.weakPassword')
              : code === 'INVITATION_EXPIRED'
                ? t('expired.description')
                : response.status === 429
                  ? t('errors.tooMany')
                  : t('errors.generic'),
        );
        return;
      }
      setDone(invitationAcceptResultSchema.parse(json).phone);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2Icon className="size-12 text-emerald-600" aria-hidden />
        <h1 className="text-2xl font-semibold">{t('done.title')}</h1>
        <p className="text-muted-foreground">
          {t('done.description', { name: invitation.traiteurName })}
        </p>
        <Button asChild size="lg">
          <Link href={`/admin/login?identifier=${encodeURIComponent(done)}`}>
            {t('done.login')}
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <Card>
        <CardHeader className="gap-2">
          <UserRoundCheckIcon className="size-8 text-primary" aria-hidden />
          <CardTitle className="text-xl">
            {t('title', { name: invitation.firstName, traiteur: invitation.traiteurName })}
          </CardTitle>
          <CardDescription>
            {t('role', { role: tr(`${invitation.role}.label`) })}
            <span className="mt-1 block">{tr(`${invitation.role}.hint`)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
            <p className="text-sm text-muted-foreground">
              {invitation.hasPassword ? t('existingAccount') : t('newAccount')}{' '}
              <span dir="ltr">{invitation.phone}</span>
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="activation-password">
                {invitation.hasPassword ? t('currentPassword') : t('newPassword')}
              </Label>
              <PasswordInput
                id="activation-password"
                value={password}
                autoComplete={invitation.hasPassword ? 'current-password' : 'new-password'}
                onChange={(event) => setPassword(event.target.value)}
              />
              {!invitation.hasPassword && (
                <p className="text-sm text-muted-foreground">{t('passwordHint')}</p>
              )}
            </div>
            {!invitation.hasPassword && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="activation-confirm">{t('confirmPassword')}</Label>
                <PasswordInput
                  id="activation-confirm"
                  value={confirm}
                  autoComplete="new-password"
                  aria-invalid={mismatch}
                  onChange={(event) => setConfirm(event.target.value)}
                />
                {mismatch && <p className="text-sm text-destructive">{t('errors.mismatch')}</p>}
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={pending || password === '' || mismatch}>
              {t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
