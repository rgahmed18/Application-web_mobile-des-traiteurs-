import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PublicQuotesController } from './public-quotes.controller';
import { QUOTES_QUEUE, QuoteExpiryProcessor } from './quote-expiry.processor';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

/** Devis : versions, envoi, lien public, accord en ligne ou manuel, expiration. */
@Module({
  imports: [BullModule.registerQueue({ name: QUOTES_QUEUE })],
  controllers: [QuotesController, PublicQuotesController],
  providers: [QuotesService, QuoteExpiryProcessor],
})
export class QuotesModule {}
