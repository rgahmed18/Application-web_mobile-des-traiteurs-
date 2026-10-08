import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Convertit un schéma Zod en schéma OpenAPI pour Swagger : la documentation
 * reste alignée sur la validation réelle, sans DTO dupliqués.
 */
export function zodToOpenApi(schema: z.ZodType, io: 'input' | 'output' = 'input'): SchemaObject {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    io,
    target: 'openapi-3.0',
    unrepresentable: 'any',
  });
  // Les deux formats décrivent le même JSON Schema (OpenAPI 3.0) ; seul le typage diffère.
  return jsonSchema as SchemaObject;
}
