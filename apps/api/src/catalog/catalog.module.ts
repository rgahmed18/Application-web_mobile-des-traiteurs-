import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CategoriesController } from './categories/categories.controller';
import { CatalogListsController } from './lists/catalog-lists.controller';
import { CatalogListsService } from './lists/catalog-lists.service';
import { CategoriesService } from './categories/categories.service';
import { DishesController } from './dishes/dishes.controller';
import { EquipmentController } from './equipment/equipment.controller';
import { EquipmentService } from './equipment/equipment.service';
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
    CatalogListsController,
    DishesController,
    EquipmentController,
    PackagesController,
    ExtraServicesController,
  ],
  providers: [
    CategoriesService,
    CatalogListsService,
    DishesService,
    EquipmentService,
    PackagesService,
    ExtraServicesService,
    MediaService,
  ],
  exports: [MediaService],
})
export class CatalogModule {}
