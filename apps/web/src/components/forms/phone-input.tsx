import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';

/** Téléphone : clavier numérique sur mobile, chiffres de gauche à droite même en arabe. */
export function PhoneInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  return <Input {...props} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" />;
}
