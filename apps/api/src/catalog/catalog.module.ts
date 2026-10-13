import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { DishesController } from './dishes/dishes.controller';
import { DishesService } from './dishes/dishes.service';
import { ExtraServicesController } from './extra-services/extra-services.controller';
import { ExtraServicesService } from './extra-services/extra-services.service';
import { MediaService } from './media/media.service';
import { PackagesController } from './packages/packages.controller';
import { PackagesService } from './packages/packages.service';

/** Catalogue du traiteur : catégories, plats, formules, services annexes et photos. */
@Module({
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
  ],
  exports: [MediaService],
})
export class CatalogModule {}
