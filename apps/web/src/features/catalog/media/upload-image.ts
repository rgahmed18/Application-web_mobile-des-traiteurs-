import { completedUploadSchema, uploadTicketSchema } from '@traiteur/shared';

import { apiRequest } from '@/lib/api/client';

import { prepareImageForUpload } from './image-preparation';

export type UploadStage = 'preparing' | 'uploading' | 'processing';

export interface UploadProgress {
  stage: UploadStage;
  /** Pourcentage de l'envoi (étape « uploading »). */
  percent: number;
}

/** Envoi direct au stockage avec suivi de la progression (fetch ne la fournit pas). */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Envoi refusé par le stockage (HTTP ${request.status})`));
    request.onerror = () => reject(new Error('Envoi interrompu'));
    request.send(body);
  });
}

/**
 * Photo du catalogue : préparation dans le navigateur, URL d'envoi, envoi direct au stockage,
 * puis traitement par l'API. Retourne la clé à enregistrer sur le plat ou la formule.
 */
export async function uploadCatalogImage(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<string> {
  onProgress({ stage: 'preparing', percent: 0 });
  const prepared = await prepareImageForUpload(file);

  const ticket = await apiRequest('/catalog/uploads', {
    method: 'POST',
    body: { contentType: 'image/jpeg', size: prepared.size },
    schema: uploadTicketSchema,
  });
  onProgress({ stage: 'uploading', percent: 0 });
  await putWithProgress(ticket.uploadUrl, ticket.headers, prepared, (percent) =>
    onProgress({ stage: 'uploading', percent }),
  );

  onProgress({ stage: 'processing', percent: 100 });
  const completed = await apiRequest(`/catalog/uploads/${ticket.uploadId}/complete`, {
    method: 'POST',
    schema: completedUploadSchema,
  });
  return completed.imageKey;
}
