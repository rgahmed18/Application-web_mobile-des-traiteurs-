/**
 * Envoi du lien d'un devis depuis le téléphone (ou l'ordinateur) du traiteur : WhatsApp, SMS
 * ou e-mail s'ouvrent avec un message déjà rédigé, dans la langue du devis.
 */
export interface ShareInput {
  locale: 'fr' | 'ar';
  firstName: string;
  reference: string;
  url: string;
  /** Date de fin de validité déjà mise en forme (« 24/10/2026 »). */
  validUntil: string;
}

export function shareMessage({
  locale,
  firstName,
  reference,
  url,
  validUntil,
}: ShareInput): string {
  return locale === 'ar'
    ? `السلام عليكم ${firstName}، تجدون عرض السعر ${reference} على الرابط التالي: ${url} (صالح إلى غاية ${validUntil}).`
    : `Bonjour ${firstName}, voici votre devis ${reference} : ${url} (valable jusqu’au ${validUntil}).`;
}

export function shareSubject({ locale, reference }: Pick<ShareInput, 'locale' | 'reference'>) {
  return locale === 'ar' ? `عرض السعر ${reference}` : `Votre devis ${reference}`;
}

/** Chiffres seuls, indicatif compris (« +212 661-23 45 67 » → « 212661234567 »). */
function digits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}`;
}

export function smsUrl(phone: string, text: string): string {
  return `sms:+${digits(phone)}?body=${encodeURIComponent(text)}`;
}

export function mailtoUrl(subject: string, text: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
