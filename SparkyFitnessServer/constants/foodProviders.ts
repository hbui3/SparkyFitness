// Server-facing alias of the shared provider list (see
// @workspace/shared `FOOD_PROVIDER_TYPES` for the rationale behind keeping
// this code-level rather than derived from the `external_provider_types`
// table).
import { FOOD_PROVIDER_TYPES } from '@workspace/shared';

export const VALID_PROVIDER_TYPES = FOOD_PROVIDER_TYPES;

export type ProviderType = (typeof VALID_PROVIDER_TYPES)[number];

export function isValidProviderType(value: string): value is ProviderType {
  return (VALID_PROVIDER_TYPES as readonly string[]).includes(value);
}
