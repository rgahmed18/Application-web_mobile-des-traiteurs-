'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';

/** Mot de passe avec bouton « afficher / masquer » (saisie plus sûre sur téléphone). */
export function PasswordInput(props: Omit<ComponentProps<typeof InputGroupInput>, 'type'>) {
  const t = useTranslations('auth.login');
  const [visible, setVisible] = useState(false);
  const label = visible ? t('hidePassword') : t('showPassword');

  return (
    <InputGroup>
      <InputGroupInput {...props} type={visible ? 'text' : 'password'} dir="ltr" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label={label}
          title={label}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
