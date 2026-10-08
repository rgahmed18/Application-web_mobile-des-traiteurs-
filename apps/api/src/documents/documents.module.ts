import { Global, Module } from '@nestjs/common';

import { DocumentLinesService } from './document-lines.service';

@Global()
@Module({
  providers: [DocumentLinesService],
  exports: [DocumentLinesService],
})
export class DocumentsModule {}
