import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { DishesController } from './dishes/dishes.controller';
import { DishesService } from './dishes/dishes.service';
import { ExtraServicesController } from './extra-services/extra-services.controller';
import { ExtraServicesService } from './extra-services/extra-services.service';
import { MEDIA_QUEUE, MediaCleanupProcessor } from './media/media-cleanup.processor';
import { MediaService } from './media/media.service';
import { PackagesController } from './packages/packages.controller';
import { PackagesService } from './packages/packages.service';

/** Catalogue du traiteur : catégories, plats, formules, services annexes et photos. */
@Module({
  imports: [BullModule.registerQueue({ name: MEDIA_QUEUE })],
  controllers: [
    CatalogController,
    CategoriesController,
    DishesController,
    PackagesController,
    ExtraServicesController,
  ],
  providers: [
    CategoriesService,
    DishesService,
    PackagesService,
    ExtraServicesService,
    MediaService,
    MediaCleanupProcessor,
  ],
})
export class CatalogModule {}
