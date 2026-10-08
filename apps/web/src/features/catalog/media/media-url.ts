import { imageVariantPath, type ImageVariant } from '@traiteur/shared';

import { publicEnv } from '@/lib/env/public';

/** URL publique d'une photo du catalogue, dans la taille demandée. */
export function mediaUrl(imageKey: string, variant: ImageVariant): string {
  return `${publicEnv.NEXT_PUBLIC_MEDIA_URL.replace(/\/+$/, '')}/${imageVariantPath(imageKey, variant)}`;
}
