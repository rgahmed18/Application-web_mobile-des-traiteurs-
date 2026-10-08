import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/** Identifiant de route au format UUID (sinon erreur de validation claire). */
export const uuidParam = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Identifiant invalide' }),
});
