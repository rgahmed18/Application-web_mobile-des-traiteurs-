import { createNestConfig } from '@traiteur/config/eslint/nest';

export default [
  ...createNestConfig(import.meta.dirname),
  {
    // Scripts en ligne de commande : l'affichage console est leur sortie normale
    files: ['prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
];
