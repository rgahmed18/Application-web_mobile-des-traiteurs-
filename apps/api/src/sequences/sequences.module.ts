import { Global, Module } from '@nestjs/common';

import { DocumentSequenceService } from './document-sequence.service';

@Global()
@Module({
  providers: [DocumentSequenceService],
  exports: [DocumentSequenceService],
})
export class SequencesModule {}
