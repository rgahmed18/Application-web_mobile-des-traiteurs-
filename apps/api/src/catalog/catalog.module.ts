import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { BuffetsController } from './buffets/buffets.controller';
import { BuffetsService } from './buffets/buffets.service';
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
import { PublicCatalogController } from './public/public-catalog.controller';
import { PublicCatalogService } from './public/public-catalog.service';

/**
 * Catalogue du traiteur : catégories, plats, formules, buffets, matériel, services annexes,
 * listes et photos ; catalogue public en lecture seule pour le site client.
 */
@Module({
  controllers: [
    CatalogController,
    BuffetsController,
    CategoriesController,
    CatalogListsController,
    DishesController,
    EquipmentController,
    PackagesController,
    ExtraServicesController,
    PublicCatalogController,
  ],
  providers: [
    BuffetsService,
    CategoriesService,
    CatalogListsService,
    DishesService,
    EquipmentService,
    PackagesService,
    ExtraServicesService,
    MediaService,
    PublicCatalogService,
  ],
  exports: [MediaService],
})
export class CatalogModule {}
