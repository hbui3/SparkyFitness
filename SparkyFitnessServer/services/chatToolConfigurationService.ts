import {
  CHAT_TOOL_CATEGORY_SLUGS,
  CORE_CHAT_TOOL_CATEGORY_SLUGS,
  normalizeChatToolCategories,
  type ChatToolCategorySlug,
} from '@workspace/shared';
import { requiresUserSuppliedAiUrl } from '../utils/outboundUrlPolicy.js';
import type { ChatToolProfile } from '../ai/tools/index.js';

const CHAT_TOOL_CONFIGURATION_METADATA_KEY = 'chatToolConfiguration';
const CHAT_TOOL_CONFIGURATION_VERSION = 1;

interface ChatHistoryRuntimeEntry {
  message_type?: unknown;
  metadata?: unknown;
}

interface StoredChatToolConfiguration {
  version: number;
  serviceConfigId: string;
  toolCategories: ChatToolCategorySlug[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolves the effective profile exactly as the chat runtime does. Cloud
 * providers always use the full surface; only user-URL providers may opt into
 * the smaller core profile.
 */
export function resolveEffectiveChatToolProfile(
  serviceType: string,
  configuredProfile?: unknown
): ChatToolProfile {
  return requiresUserSuppliedAiUrl(serviceType) && configuredProfile === 'core'
    ? 'core'
    : 'full';
}

/** Returns the actual configured category set for a turn in canonical order. */
export function resolveConfiguredChatToolCategories(
  profile: ChatToolProfile,
  selectedCategories?: readonly string[]
): ChatToolCategorySlug[] {
  const selected = new Set(
    normalizeChatToolCategories(selectedCategories) ??
      (profile === 'core'
        ? CORE_CHAT_TOOL_CATEGORY_SLUGS
        : CHAT_TOOL_CATEGORY_SLUGS)
  );
  return CHAT_TOOL_CATEGORY_SLUGS.filter((slug) => selected.has(slug));
}

/**
 * Stored on each user chat turn so non-web channels can reuse the exact
 * category selection that the web chat used for the same AI service.
 */
export function buildChatToolConfigurationMetadata(
  serviceConfigId: string,
  profile: ChatToolProfile,
  selectedCategories?: readonly string[]
): Record<string, StoredChatToolConfiguration> {
  return {
    [CHAT_TOOL_CONFIGURATION_METADATA_KEY]: {
      version: CHAT_TOOL_CONFIGURATION_VERSION,
      serviceConfigId,
      toolCategories: resolveConfiguredChatToolCategories(
        profile,
        selectedCategories
      ),
    },
  };
}

/**
 * Finds the latest persisted selection for the active service. If there has
 * not been a web turn for that service yet, returns the same Full/Core default
 * that the web selector displays.
 */
export function resolveChatToolCategoriesFromHistory(
  history: readonly ChatHistoryRuntimeEntry[],
  serviceConfigId: string,
  serviceType: string,
  configuredProfile?: unknown
): ChatToolCategorySlug[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.message_type !== 'user' || !isRecord(entry.metadata)) continue;
    const stored = entry.metadata[CHAT_TOOL_CONFIGURATION_METADATA_KEY];
    if (!isRecord(stored) || stored.serviceConfigId !== serviceConfigId) {
      continue;
    }
    const categories = normalizeChatToolCategories(stored.toolCategories);
    if (categories) {
      return resolveConfiguredChatToolCategories('full', categories);
    }
  }

  return resolveConfiguredChatToolCategories(
    resolveEffectiveChatToolProfile(serviceType, configuredProfile)
  );
}
