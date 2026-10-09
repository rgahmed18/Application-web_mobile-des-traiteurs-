import { createNestConfig } from '@traiteur/config/eslint/nest';

const WRITE_METHODS =
  'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany';
const NESTED_WRITES =
  'create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set';
const LINES_MESSAGE =
  'Les lignes de commande et de devis ne s’écrivent que via DocumentLinesService ' +
  '(src/documents) : il recalcule les totaux dans la même transaction.';

export default [
  ...createNestConfig(import.meta.dirname),
  {
    // Fichiers volontairement fautifs, vérifiés par src/documents/document-lines.lint.spec.ts
    ignores: ['test/lint-fixtures/**'],
  },
  {
    // Lignes de commande et de devis : un seul module autorisé à les écrire.
    files: ['**/*.ts'],
    ignores: ['src/documents/document-lines.ts', 'test/integration/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // prisma.orderItem.create(...), tx.quoteLine.deleteMany(...)
          selector: `CallExpression[callee.property.name=/^(${WRITE_METHODS})$/][callee.object.property.name=/^(orderItem|quoteLine)$/]`,
          message: LINES_MESSAGE,
        },
        {
          // prisma.order.update({ data: { items: { create: ... } } }), idem pour quote.lines
          selector: `CallExpression[callee.object.property.name=/^(order|quote)$/] Property[key.name=/^(items|lines)$/] > ObjectExpression > Property[key.name=/^(${NESTED_WRITES})$/]`,
          message: LINES_MESSAGE,
        },
      ],
    },
  },
  {
    // Scripts en ligne de commande : l'affichage console est leur sortie normale
    files: ['prisma/seed.ts', 'prisma/scripts/**', 'prisma/lib/**'],
    rules: { 'no-console': 'off' },
  },
];
