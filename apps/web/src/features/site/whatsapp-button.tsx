'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/** Lien WhatsApp vers un numéro E.164, avec un message prérempli. */
export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/** Logo WhatsApp (tracé simplifié). */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

/**
 * Bouton WhatsApp flottant en bas de l'écran, bien visible (vert, ombre, léger mouvement sans
 * « réduire les animations ») : icône seule sur téléphone, avec son libellé sur grand écran.
 */
export function WhatsAppButton({ phone }: { phone: string }) {
  const t = useTranslations('site.whatsapp');
  return (
    <a
      href={whatsappUrl(phone, t('message'))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('label')}
      className={cn(
        'site-bob fixed end-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 inline-flex h-14 min-w-14 items-center justify-center gap-2 rounded-2xl bg-[#25d366] px-0 font-bold text-[#06301a] shadow-[0_12px_30px_-8px_rgb(0_0_0/0.45)] transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-[#25d366]/40 focus-visible:outline-none md:bottom-6 md:px-5',
      )}
      data-testid="whatsapp-button"
    >
      <WhatsAppIcon className="size-7" />
      <span className="hidden md:inline">{t('short')}</span>
    </a>
  );
}
