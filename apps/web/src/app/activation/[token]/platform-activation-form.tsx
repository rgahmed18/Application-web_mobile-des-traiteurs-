'use client';

import { activationAcceptResultSchema, type PublicActivation } from '@traiteur/shared';
import { CheckCircle2Icon, ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { publicEnv } from '@/lib/env/public';

/**
 * Compte de la plateforme : choix du mot de passe (lien de 24 h, une seule fois). La double
 * authentification sera demandée à la première connexion.
 */
export function PlatformActivationForm({
  token,
  activation,
}: {
  token: string;
  activation: PublicActivation;
}) {
  const t = useTranslations('platformActivation');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const mismatch = confirm !== '' && confirm !== password;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `${publicEnv().PUBLIC_API_URL}/public/activations/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ password }),
          referrerPolicy: 'no-referrer',
        },
      );
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          response.status === 400
            ? t('errors.weakPassword')
            : response.status === 429
              ? t('errors.tooMany')
              : response.status === 404
                ? t('invalid.description')
                : t('errors.generic'),
        );
        return;
      }
      setPhone(activationAcceptResultSchema.parse(json).phone);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setPending(false);
    }
  };

  if (phone) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2Icon className="size-12 text-emerald-600" aria-hidden />
        <h1 className="text-2xl font-semibold">{t('done.title')}</h1>
        <p className="text-muted-foreground">{t('done.description')}</p>
        <Button asChild size="lg">
          <Link href={`/admin/login?identifier=${encodeURIComponent(phone)}`}>
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
          <ShieldCheckIcon className="size-8 text-indigo-600" aria-hidden />
          <CardTitle className="text-xl">{t('title', { name: activation.firstName })}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
            <p className="text-sm text-muted-foreground">
              {t('identifier')} <span dir="ltr">{activation.phone}</span>
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="platform-password">{t('newPassword')}</Label>
              <PasswordInput
                id="platform-password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">{t('passwordHint')}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="platform-confirm">{t('confirmPassword')}</Label>
              <PasswordInput
                id="platform-confirm"
                value={confirm}
                autoComplete="new-password"
                aria-invalid={mismatch}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {mismatch && <p className="text-sm text-destructive">{t('errors.mismatch')}</p>}
            </div>
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
