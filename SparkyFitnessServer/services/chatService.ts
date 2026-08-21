import chatRepository from '../models/chatRepository.js';
import measurementRepository from '../models/measurementRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import { log } from '../config/logging.js';
import { getDefaultModel, getOpenAiCompatibleBaseUrl } from '../ai/config.js';
import {
  dispatchAiRequest,
  requiresApiKey,
  type DispatchErrorCategory,
  type ProviderConfig,
} from '../ai/providerDispatch.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import { TtlCache } from '../utils/ttlCache.js';
import { isWaterLogText } from '../utils/waterLogText.js';
import coachProfileService from './coachProfileService.js';
import {
  buildChatToolConfigurationMetadata,
  resolveEffectiveChatToolProfile,
} from './chatToolConfigurationService.js';
import {
  assertOutboundUrlShapeAndLiteralAllowed,
  createGuardedFetch,
  deriveAiNetworkPolicy,
  OutboundUrlBlockedError,
  requiresUserSuppliedAiUrl,
} from '../utils/outboundUrlPolicy.js';
import {
  todayInZone,
  DatabaseCustomCategories,
  AiServiceSettings,
  SparkyChatHistory,
  SparkyChatHistoryMutator,
  TestAiServiceConnectionRequest,
  ChatToolCategorySlug,
  CHAT_TOOL_CATEGORY_SLUGS,
  isChatToolCategorySlug,
  type AskUserInput,
} from '@workspace/shared';

interface ChatMessagePart {
  // AI SDK tool parts arrive as `tool-<toolName>`; only sparky_ask_user is
  // interpreted (see mapMessagePart), the rest fall through to text.
  type: 'text' | 'image' | 'image_url' | 'file' | string;
  text?: string;
  content?: string;
  mimeType?: string;
  mediaType?: string;
  url?: string;
  image?: string;
  image_url?: { url: string };
  input?: unknown;
  output?: unknown;
}

interface ProcessedMessagePart {
  type: 'text' | 'image';
  text?: string;
  image?: string;
}

interface ChatMessage {
  role: string;
  content?: string | ChatMessagePart[];
  parts?: ChatMessagePart[];
  metadata?: unknown;
}

import { generateText, streamText, stepCountIs, hasToolCall } from 'ai';
import type { JSONValue, LanguageModelUsage, UIMessageChunk } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  buildChatbotTools,
  buildChatToolSurface,
  resolveCategories,
  COACH_MEMORY_TOOL_NAME,
  ENABLE_TOOLS_TOOL_NAME,
  ASK_USER_TOOL_NAME,
  type ChatToolProfile,
} from '../ai/tools/index.js';
import { CATEGORY_SUMMARIES } from '../ai/tools/metaTools.js';
import { isToolErrorText } from '../ai/tools/errors.js';
import coachEventService, {
  type CoachEventDomain,
} from './coachEventService.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_AGENTIC_STEPS = 15;
// Tighter agent-loop ceiling for the 'core' profile (small/local models with
// no prompt cache): every step re-processes the full prefix from scratch, so
// 15 runaway steps on a confused 3B model is pure token burn. Core-profile
// flows are simple log/read round-trips; 8 steps covers lookup → log → confirm
// with room to spare.
const CORE_PROFILE_MAX_AGENTIC_STEPS = 8;

// Sampling temperature for the 'core' tool profile — resolved only for
// self-hosted services the user flagged as small/local (see
// prepareChatContext). Small models emit noticeably steadier tool-call JSON at
// a low temperature, and this chat is tool-orchestration first, prose second.
// Cloud providers and full-profile self-hosted services keep their
// provider-tuned defaults (no temperature set).
const CORE_PROFILE_CHAT_TEMPERATURE = 0.2;

// Retries per chat request on persistent provider errors. Each retry re-sends the
// full request (system + tools + history), so a high count multiplies token cost
// on a hard provider outage. 3 covers transient blips without a runaway 5×.
const MAX_PROVIDER_RETRIES = 3;
// A single retry for core-profile (cache-less local) backends: with no prompt
// cache each retry re-processes the entire prefix, and a struggling local
// server rarely recovers on the 3rd identical attempt anyway.
const CORE_PROFILE_MAX_PROVIDER_RETRIES = 1;

// Hard wall-clock cap on one chat request (the agent loop as a whole is
// unbounded otherwise — the chat path never had a timeout, unlike
// providerDispatch.ts). Generous: a slow local model streaming a long answer
// with several tool round-trips can legitimately take minutes.
const CHAT_REQUEST_TIMEOUT_MS = 5 * 60_000;

async function handleAiServiceSettings(
  action: string,
  serviceData: Partial<AiServiceSettings> & { api_key?: string },
  authenticatedUserId: string
) {
  try {
    if (action === 'save_ai_service_settings') {
      serviceData.user_id = authenticatedUserId; // Ensure user_id is set from authenticated user
      // Allow creating services without API keys - they can be added later via update
      // API key validation happens when actually using the service (in processChatMessage)
      // This enables the override workflow where users create a service and add API key later
      const result = await chatRepository.upsertAiServiceSetting(serviceData);
      if (!result) {
        throw new Error('AI service setting not found.');
      }

      // Sync active state to user_preferences
      if (serviceData.is_active !== undefined) {
        const currentPrefs =
          await preferenceRepository.getUserPreferences(authenticatedUserId);
        if (serviceData.is_active) {
          // Auto-select this service only when no provider is selected yet, so
          // the user's first enabled service powers AI features immediately.
          // Enabling a second service must not hijack an existing selection —
          // the active-provider dropdown (Settings or chat) is the authoritative
          // way to *change* the active provider; enable only toggles availability.
          if (!currentPrefs?.active_ai_service_id) {
            await preferenceRepository.updateUserPreferences(
              authenticatedUserId,
              {
                active_ai_service_id: result.id,
              }
            );
          }
        } else if (
          currentPrefs &&
          currentPrefs.active_ai_service_id === result.id
        ) {
          await preferenceRepository.updateUserPreferences(
            authenticatedUserId,
            {
              active_ai_service_id: null,
            }
          );
        }
      }

      const {
        encrypted_api_key: _encrypted_api_key,
        api_key_iv: _api_key_iv,
        api_key_tag: _api_key_tag,
        ...safeSetting
      } = result as Record<string, unknown>;
      return {
        message: 'AI service settings saved successfully.',
        setting: safeSetting,
      };
    }
    // Add other actions if needed in the future
    throw new Error('Unsupported action for AI service settings.');
  } catch (error) {
    log(
      'error',
      `Error handling AI service settings for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function getAiServiceSettings(
  authenticatedUserId: string,
  targetUserId: string
) {
  try {
    const settings =
      await chatRepository.getAiServiceSettingsByUserId(targetUserId);
    return settings || []; // Return empty array if no settings found
  } catch (error) {
    log(
      'error',
      `Error fetching AI service settings for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    return []; // Return empty array on error
  }
}

async function getActiveAiServiceSetting(
  authenticatedUserId: string,
  targetUserId: string
) {
  try {
    const setting =
      await chatRepository.getActiveAiServiceSetting(targetUserId);
    if (setting) {
      const source = setting.source || 'unknown';
      log(
        'debug',
        `Active AI service setting for user ${targetUserId} (source: ${source})`
      );
    }
    return setting; // Returns null if no active setting found
  } catch (error) {
    log(
      'error',
      `Error fetching active AI service setting for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    return null; // Return null on error
  }
}

async function getActiveAiServiceSettingForBackend(
  authenticatedUserId: string,
  targetUserId: string
) {
  const active = await getActiveAiServiceSetting(
    authenticatedUserId,
    targetUserId
  );
  if (!active?.id) return null;
  return chatRepository.getAiServiceSettingForBackend(
    String(active.id),
    targetUserId
  );
}

async function deleteAiServiceSetting(authenticatedUserId: string, id: string) {
  try {
    // Verify that the setting belongs to the authenticated user before deleting
    const setting = await chatRepository.getAiServiceSettingById(
      id,
      authenticatedUserId
    );
    if (!setting) {
      throw new Error('AI service setting not found.');
    }
    const success = await chatRepository.deleteAiServiceSetting(
      id,
      authenticatedUserId
    );
    if (!success) {
      throw new Error('AI service setting not found.');
    }
    return { message: 'AI service setting deleted successfully.' };
  } catch (error) {
    log(
      'error',
      `Error deleting AI service setting ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function clearOldChatHistory(authenticatedUserId: string) {
  try {
    await chatRepository.clearOldChatHistory(authenticatedUserId);
    return { message: 'Old chat history cleared successfully.' };
  } catch (error) {
    log(
      'error',
      `Error clearing old chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function getSparkyChatHistory(
  authenticatedUserId: string,
  targetUserId: string
) {
  try {
    const history = await chatRepository.getChatHistoryByUserId(targetUserId);
    return history;
  } catch (error) {
    log(
      'error',
      `Error fetching chat history for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function getSparkyChatHistoryEntry(
  authenticatedUserId: string,
  id: string
) {
  try {
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(
      id,
      authenticatedUserId
    );
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    const entry = await chatRepository.getChatHistoryEntryById(
      id,
      authenticatedUserId
    );
    return entry;
  } catch (error) {
    log(
      'error',
      `Error fetching chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function updateSparkyChatHistoryEntry(
  authenticatedUserId: string,
  id: string,
  updateData: SparkyChatHistoryMutator
) {
  try {
    // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(id);
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    if (entryOwnerId !== authenticatedUserId) {
      throw new Error(
        'Forbidden: You do not have permission to update this chat history entry.'
      );
    }
    const updatedEntry = await chatRepository.updateChatHistoryEntry(
      id,
      authenticatedUserId,
      updateData
    );
    if (!updatedEntry) {
      throw new Error(
        'Chat history entry not found or not authorized to update.'
      );
    }
    return updatedEntry;
  } catch (error) {
    log(
      'error',
      `Error updating chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function deleteSparkyChatHistoryEntry(
  authenticatedUserId: string,
  id: string
) {
  try {
    // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(id);
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    if (entryOwnerId !== authenticatedUserId) {
      throw new Error(
        'Forbidden: You do not have permission to delete this chat history entry.'
      );
    }
    const success = await chatRepository.deleteChatHistoryEntry(
      id,
      authenticatedUserId
    );
    if (!success) {
      throw new Error('Chat history entry not found.');
    }
    return { message: 'Chat history entry deleted successfully.' };
  } catch (error) {
    log(
      'error',
      `Error deleting chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function clearAllSparkyChatHistory(authenticatedUserId: string) {
  try {
    await chatRepository.clearAllChatHistory(authenticatedUserId);
    return { message: 'All chat history cleared successfully.' };
  } catch (error) {
    log(
      'error',
      `Error clearing all chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function saveSparkyChatHistory(
  authenticatedUserId: string,
  historyData: Partial<SparkyChatHistory> & {
    messageType?: 'user' | 'assistant';
    parts?: ChatMessagePart[];
  }
) {
  try {
    // Ensure the history is saved for the authenticated user
    historyData.user_id = authenticatedUserId;
    await chatRepository.saveChatHistory(historyData);
    return { message: 'Chat history saved successfully.' };
  } catch (error) {
    log(
      'error',
      `Error saving chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
/**
 * Loads the per-user chat context shared by the blocking and streaming paths:
 * the system prompt (custom categories + timezone) and the in-process tool
 * registry. Everything is scoped to the authenticated user — chat tool calls
 * always act as the logged-in actor, matching the previous MCP behavior.
 */
// Per-user cache of the two DB lookups behind every chat turn. Timezone and
// custom categories change rarely (settings edits), so a short TTL keeps a
// multi-turn conversation from re-querying both on each message while a
// settings change still lands within a minute. Never cache auth/permission
// state or secrets here.
const chatContextInputsCache = new TtlCache<{
  chatTz: string;
  customCategoriesList: string;
}>(60_000);

// The agent loop's stop conditions, shared by the streaming and non-streaming
// chat paths so they can't drift.
//
// - Step ceiling: tighter for cache-less core-profile backends, where every
//   step re-processes the full prefix.
// - sparky_ask_user: the model is offering the user quick-reply chips, so the
//   turn is over — without this the echoed tool result would come straight back
//   and the model would answer its own question. Harmless on the non-streaming
//   path (no chip UI there): the question simply degrades to plain text.
export function buildChatStopConditions(toolProfile: ChatToolProfile) {
  return [
    stepCountIs(
      toolProfile === 'core'
        ? CORE_PROFILE_MAX_AGENTIC_STEPS
        : MAX_AGENTIC_STEPS
    ),
    hasToolCall(ASK_USER_TOOL_NAME),
  ];
}

// Builds the prepareStep callback that implements the sparky_enable_tools
// escalation: if a prior step in this request called it with category slugs,
// widen activeTools for the next step to include those categories' tools (on
// top of the turn's base selection). Returning {} when nothing was requested
// lets the outer generateText/streamText-level activeTools apply unchanged.
// Exported for unit testing; only wired into the auto-classification path
// (manual category selections are a strict ceiling — see prepareChatContext).
export function buildEscalationPrepareStep(
  toolNamesByCategory: Record<ChatToolCategorySlug, string[]>,
  baseActiveTools: string[]
) {
  return ({
    steps,
  }: {
    steps: Array<{
      toolCalls?: Array<{ toolName: string; input?: unknown }>;
    }>;
  }) => {
    const requested = new Set<ChatToolCategorySlug>();
    for (const step of steps) {
      for (const call of step.toolCalls ?? []) {
        if (call.toolName !== ENABLE_TOOLS_TOOL_NAME) continue;
        const categories = (call.input as { categories?: unknown })?.categories;
        if (!Array.isArray(categories)) continue;
        for (const c of categories) {
          if (isChatToolCategorySlug(c)) requested.add(c);
        }
      }
    }
    if (requested.size === 0) return {};
    const extra = [...requested].flatMap((slug) => toolNamesByCategory[slug]);
    return { activeTools: [...new Set([...baseActiveTools, ...extra])] };
  };
}

async function prepareChatContext(
  authenticatedUserId: string,
  serviceType: string,
  chatToolProfile?: string | null,
  activeToolCategories?: readonly string[],
  // True when allowedToolCategories came from the user's explicit in-chat
  // selector. That selection remains a strict ceiling, while the per-turn
  // classifier is allowed to narrow the actually composed tool surface.
  categoriesAreManual = false,
  serviceSystemPrompt?: string | null,
  allowAskUser = true,
  allowedToolCategories?: readonly string[]
) {
  const { chatTz, customCategoriesList } =
    await chatContextInputsCache.getOrLoad(authenticatedUserId, async () => {
      const [customCategories, tz] = await Promise.all([
        measurementRepository.getCustomCategories(authenticatedUserId),
        loadUserTimezone(authenticatedUserId),
      ]);
      return {
        chatTz: tz,
        customCategoriesList:
          customCategories.length > 0
            ? customCategories
                .map(
                  (cat: DatabaseCustomCategories) =>
                    `- ${cat.name} (${cat.measurement_type}, ${cat.frequency})`
                )
                .join('\n')
            : 'None',
      };
    });

  // Per-service chat tool profile. 'core' trims the tool surface for small/local
  // models and is honored for every self-hosted service type (ollama,
  // openai_compatible, custom) — the backends with weak models and no prompt
  // cache, where the 35-tool block is the dominant per-turn token cost. Cloud
  // provider types always get the full set, so a stale 'core' there can never
  // trim it. The default stays 'full' everywhere: openai_compatible/custom can
  // point at powerful endpoints, and silently dropping 15 tools would degrade
  // answer quality for those users.
  const toolProfile = resolveEffectiveChatToolProfile(
    serviceType,
    chatToolProfile
  );

  const allowedCategories = resolveCategories(
    toolProfile,
    categoriesAreManual ? allowedToolCategories : undefined
  );
  const requestedCategories = resolveCategories(
    toolProfile,
    activeToolCategories
  );
  let selectedCategories = new Set(
    [...requestedCategories].filter((category) =>
      allowedCategories.has(category)
    )
  );
  // If classification failed or produced only categories outside the user's
  // configured ceiling, retain the configured surface. This never widens past
  // the selector, and it avoids presenting an empty tool set.
  if (selectedCategories.size === 0) {
    selectedCategories = allowedCategories;
  }

  // Two tool-loading modes:
  //
  // - Manual selection (categoriesAreManual): a strict ceiling. Compose only
  //   the categories relevant to this turn after intersecting them with the
  //   user's configured selector. No escalation tool is exposed, so an
  //   underspecified reply cannot jump to a stale domain from older history.
  //
  // - Auto-classification: self-healing. Compose the full surface once and
  //   narrow what's *sent* per turn via activeTools; the always-present
  //   sparky_enable_tools (+ widening prepareStep) lets a capable model pull
  //   in a category the classifier missed. The breakpoint sits on the
  //   escalation tool, which is always in activeTools, so caching stays stable.
  let tools: ReturnType<typeof buildChatbotTools>;
  let activeToolNames: string[] | undefined;
  let prepareStep: ReturnType<typeof buildEscalationPrepareStep> | undefined;

  if (categoriesAreManual) {
    tools = buildChatbotTools(
      authenticatedUserId,
      chatTz,
      toolProfile,
      true,
      [...selectedCategories],
      // Quick-reply chips: full profile only (the small local models 'core'
      // exists for pick tools unreliably from a wider surface).
      allowAskUser && toolProfile === 'full'
    );
    activeToolNames = undefined; // every composed tool is sent
    prepareStep = undefined; // no mid-request widening
  } else {
    const surface = buildChatToolSurface(authenticatedUserId, chatTz);
    tools = surface.tools;
    activeToolNames = [
      ...new Set(
        [...selectedCategories].flatMap(
          (slug: ChatToolCategorySlug) => surface.toolNamesByCategory[slug]
        )
      ),
      // Long-term memory is application-wide context, not a health-data
      // category. Keep explicit remember/forget requests and automatic
      // stable-fact capture available on every turn.
      COACH_MEMORY_TOOL_NAME,
      ENABLE_TOOLS_TOOL_NAME,
      // Quick-reply chips: full profile only. The tool belongs to no category,
      // so it is never pulled in by the classifier — it has to be added here.
      ...(allowAskUser && toolProfile === 'full' ? [ASK_USER_TOOL_NAME] : []),
    ];
    prepareStep = buildEscalationPrepareStep(
      surface.toolNamesByCategory,
      activeToolNames
    );
  }

  const sentToolCount = activeToolNames?.length ?? Object.keys(tools).length;
  log(
    'info',
    `Loaded ${sentToolCount}/${Object.keys(tools).length} active tools for chatbot (profile=${toolProfile}, mode=${
      categoriesAreManual ? 'manual' : 'auto'
    }${
      activeToolCategories && activeToolCategories.length > 0
        ? `, activeCategories=${[...selectedCategories].join(',')}`
        : ''
    }${
      categoriesAreManual && allowedToolCategories
        ? `, allowedCategories=${[...allowedCategories].join(',')}`
        : ''
    }): ${(activeToolNames ?? Object.keys(tools)).join(', ')}`
  );

  // Ollama's default server-side context window is 4096 tokens and overflow is
  // truncated *silently* (it chops the prompt head, mangling tool schemas and
  // the system prompt — looks like a "dumb model"). We connect over the
  // OpenAI-compatible endpoint, which ignores a per-request num_ctx, so we can
  // only warn. The 'full' profile is the risky combo; 'core' is the mitigation.
  if (serviceType === 'ollama' && toolProfile === 'full') {
    log(
      'warn',
      `Ollama chat is using the 'full' tool profile (${sentToolCount} active tools), which plus the system prompt and history usually exceeds Ollama's default 4096-token context and gets truncated silently. Raise it (OLLAMA_CONTEXT_LENGTH=16384 or num_ctx in the Modelfile) and/or switch this service to the 'core' tool profile.`
    );
  }

  return {
    systemPromptContent: buildFinalSystemPrompt(
      getSystemPrompt(
        chatTz,
        customCategoriesList,
        toolProfile,
        [...selectedCategories],
        !categoriesAreManual,
        [...allowedCategories]
      ),
      serviceSystemPrompt
    ),
    tools,
    activeToolNames,
    prepareStep,
    toolProfile,
    selectedCategories: [...selectedCategories],
  };
}

/**
 * Appends the per-service custom system_prompt (from ai_service_settings) to
 * the base MD prompt. The base prompt contains all tool-use rules and must
 * never be replaced. The custom prompt lets admins/users layer persona or
 * voice customizations on top (e.g. "Address the user as 'swoldier'").
 *
 * Cache-stability: the custom prompt changes only when the service config is
 * edited, not per-turn, so it doesn't violate the prefix-caching invariant.
 */
function buildFinalSystemPrompt(
  basePrompt: string,
  serviceSystemPrompt?: string | null
): string {
  const trimmed = serviceSystemPrompt?.trim();
  if (!trimmed) return basePrompt;
  return `${basePrompt}\n\n## Additional Instructions\n${trimmed}`;
}

// INVARIANT — keep the request prefix (system prompt + tool schemas) stable
// across turns. Prompt caching (Anthropic breakpoint, OpenAI cache key, Gemini
// auto-cache) and Ollama's KV-cache reuse only kick in when a new request is a
// byte-for-byte prefix extension of the previous one. So this prompt must NOT
// embed per-request values (timestamps, request ids, live totals, entry
// counts). The only inputs here are the day string (changes at most once a day)
// and the user's custom-category list (changes only when they edit categories);
// both are acceptable. If a future feature needs per-turn context, inject it as
// a message, never into this system prompt.
export function getSystemPrompt(
  chatTz: string,
  customCategoriesList: string,
  profile: ChatToolProfile = 'full',
  activeCategories?: readonly string[],
  // When true (auto-classification), dormant domains are reachable via the
  // sparky_enable_tools escalation tool. When false, only the turn-scoped
  // active categories are composed. allowedCategories distinguishes the
  // user's configured ceiling from categories merely dormant for this turn.
  allowEscalation = true,
  allowedCategories?: readonly string[]
): string {
  const suffix = profile === 'core' ? 'core' : 'full';
  const filePath = path.join(__dirname, '../prompts', `chatbot-${suffix}.md`);
  let content = readFileSync(filePath, 'utf-8').trim();

  // Read modular sub-templates based on activeCategories
  // If activeCategories is empty/undefined, default to all categories
  const categories =
    activeCategories && activeCategories.length > 0
      ? new Set(activeCategories)
      : new Set<string>([
          'food',
          'exercise',
          'checkin',
          'goals',
          'reports',
          'coaching',
          'vision',
          'profile',
        ]);

  if (categories.has('checkin')) {
    const checkinPath = path.join(
      __dirname,
      '../prompts',
      `chatbot-${suffix}-checkin.md`
    );
    if (existsSync(checkinPath)) {
      content += '\n\n' + readFileSync(checkinPath, 'utf-8').trim();
    }
  }

  if (categories.has('food')) {
    const foodPath = path.join(
      __dirname,
      '../prompts',
      `chatbot-${suffix}-food.md`
    );
    if (existsSync(foodPath)) {
      content += '\n\n' + readFileSync(foodPath, 'utf-8').trim();
    }
  }

  if (categories.has('vision') && suffix === 'full') {
    const visionPath = path.join(
      __dirname,
      '../prompts',
      `chatbot-${suffix}-vision.md`
    );
    if (existsSync(visionPath)) {
      content += '\n\n' + readFileSync(visionPath, 'utf-8').trim();
    }
  }

  content += `

## Conversation continuity
- An underspecified reply continues only the immediately preceding assistant turn.
- Never use an older topic, proposal, entity, or tool domain to interpret the latest reply.
- Switch domains only when the user's latest message explicitly introduces the new subject.`;

  // List domains this turn's tool selection left dormant. In manual mode,
  // distinguish turn-scoped narrowing from categories the user actually
  // disabled in the selector.
  const dormant = CHAT_TOOL_CATEGORY_SLUGS.filter(
    (slug) => !categories.has(slug)
  );
  if (dormant.length > 0) {
    if (allowEscalation) {
      const dormantList = dormant
        .map((slug) => `- ${slug}: ${CATEGORY_SUMMARIES[slug]}`)
        .join('\n');
      content +=
        '\n\n## Additional capabilities available on request\n' +
        "The following tool categories are not currently loaded, but you can enable them mid-conversation by calling sparky_enable_tools if the user's request needs them:\n" +
        dormantList;
    } else {
      const allowed = new Set(allowedCategories ?? activeCategories ?? []);
      const turnDormant = dormant.filter((slug) => allowed.has(slug));
      const userRestricted = dormant.filter((slug) => !allowed.has(slug));
      if (turnDormant.length > 0) {
        content +=
          '\n\n## Turn-scoped tool set\n' +
          'Tools outside the latest classified domain are intentionally not loaded for this turn. Do not resume an older domain or claim to have used one of its tools.';
      }
      if (userRestricted.length > 0) {
        const restrictedList = userRestricted
          .map((slug) => `- ${slug}: ${CATEGORY_SUMMARIES[slug]}`)
          .join('\n');
        content +=
          '\n\n## User-restricted tool set\n' +
          'The user disabled these categories in the in-chat tool selector. Do not attempt or claim these capabilities:\n' +
          restrictedList +
          '\n\nIf the latest request explicitly needs one, tell the user to enable that category in the selector and retry.';
      }
    }
  }

  // Replace placeholders dynamically
  return content
    .replace(/\${today}/g, todayInZone(chatTz))
    .replace(/\${customCategories}/g, customCategoriesList);
}

// OpenAI's 24h extended retention is only supported on the gpt-5.1+ families
// (per @ai-sdk/openai), and the adapter forwards the field without gating, so
// other models may reject it. Mirror the adapter's own family check.
const RETENTION_24H_MODEL_PREFIXES = [
  'gpt-5.1',
  'gpt-5.2',
  'gpt-5.3',
  'gpt-5.4',
  'gpt-5.5',
];

// Only the canonical 'openai' service type receives prompt-cache options.
// OpenAI-compatible services still need the SDK-only systemMessageMode override:
// reasoning-model IDs otherwise convert Sparky's system prompt to `developer`,
// which older compatible gateways may not recognize as system instructions.
// (Anthropic caches on the tools — see ai/tools/index.ts; Gemini auto-caches.)
export function buildChatProviderOptions(
  serviceType: string,
  userId: string,
  modelName: string
): Record<string, Record<string, JSONValue>> | undefined {
  if (serviceType === 'openai_compatible') {
    return { openai: { systemMessageMode: 'system' } };
  }
  if (serviceType !== 'openai') return undefined;
  const openai: Record<string, JSONValue> = {
    promptCacheKey: `sparky-chat-${userId}`,
  };
  if (RETENTION_24H_MODEL_PREFIXES.some((p) => modelName.startsWith(p))) {
    openai.promptCacheRetention = '24h';
  }
  return { openai };
}

interface LlmMessage {
  role: string;
  content: string | ProcessedMessagePart[];
}

// Vision images are stored as base64 data URLs and re-sent inside the context
// window on every turn until they age out, costing ~1-2K+ uncached tokens each,
// each turn. The model only needs to *see* an image on the turn it arrives; for
// earlier turns the assistant's text reply normally captured the analysis. Strip
// image parts from every message except the latest user turn. One exception is a
// short confirmation immediately following an image ("log it", "logge es"):
// those words depend on the image, and a prior assistant reply may not have named
// the product. In that case retain only the most recent preceding user image.
// A turn that was image-only keeps a short placeholder so it never becomes empty
// (some providers reject empty messages); turns with accompanying text just lose
// the image.
const IMAGE_FOLLOW_UP_PATTERN =
  /^(?:yes|yeah|yep|ok(?:ay)?|do it|add it|log it|ja|jep|okay|ok|mach(?: das)?|füg(?:e)? (?:es|das) hinzu|trag(?:e)? (?:es|das) ein|logg?(?:e)? (?:es|das))(?:[.!? ]*)$/i;

export function isImageFollowUpText(value: string): boolean {
  return IMAGE_FOLLOW_UP_PATTERN.test(value.trim());
}

function messageText(message: LlmMessage): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
    .trim();
}

function stripHistoricalImages(messages: LlmMessage[]): LlmMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  let retainedPreviousImageIndex = -1;
  if (
    lastUserIndex >= 0 &&
    isImageFollowUpText(messageText(messages[lastUserIndex]))
  ) {
    for (let i = lastUserIndex - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue;
      const candidateContent = messages[i].content;
      if (
        Array.isArray(candidateContent) &&
        candidateContent.some((part) => part.type === 'image')
      ) {
        retainedPreviousImageIndex = i;
      }
      break;
    }
  }

  return messages.map((msg, index) => {
    if (
      index === lastUserIndex ||
      index === retainedPreviousImageIndex ||
      !Array.isArray(msg.content)
    ) {
      return msg;
    }
    const withoutImages = msg.content.filter((part) => part.type !== 'image');
    if (withoutImages.length === msg.content.length) {
      return msg;
    }
    return {
      ...msg,
      content:
        withoutImages.length > 0
          ? withoutImages
          : [{ type: 'text' as const, text: '[image omitted]' }],
    };
  });
}

// Token budget for the conversation-history window. A token budget is steadier
// than a fixed message count: 20 short turns and 20 turns full of long pastes or
// tool dumps cost wildly different amounts, and a count can't tell them apart.
const CONTEXT_TOKEN_BUDGET = 6000;
// Tighter history window for the 'core' profile, which is only resolved for
// Ollama services the user has flagged as small/local (see prepareChatContext).
// Their context window is often just 4096-8192 tokens, so a smaller *intact*
// history beats a larger one that Ollama silently truncates. Cloud providers
// and full-profile Ollama keep the full CONTEXT_TOKEN_BUDGET.
const CORE_PROFILE_CONTEXT_TOKEN_BUDGET = 2000;
// Flat per-image cost. A base64 data URL is tens of KB of characters but bills as
// roughly a fixed number of vision tokens, so char-based estimation would
// massively overcount it. Past images are already stripped, so in practice this
// only covers the current turn's image (which is always kept regardless).
const IMAGE_TOKEN_ESTIMATE = 1500;
// Rough English chars-per-token, plus a small fixed per-message structural cost
// (role markers, delimiters) so a long run of tiny messages still bounds.
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

function estimateMessageTokens(
  content: string | ProcessedMessagePart[]
): number {
  if (typeof content === 'string') {
    return PER_MESSAGE_OVERHEAD + Math.ceil(content.length / CHARS_PER_TOKEN);
  }
  let total = PER_MESSAGE_OVERHEAD;
  for (const part of content) {
    total +=
      part.type === 'image'
        ? IMAGE_TOKEN_ESTIMATE
        : Math.ceil((part.text?.length ?? 0) / CHARS_PER_TOKEN);
  }
  return total;
}

// Keep the most recent messages whose estimated tokens fit the budget, walking
// newest-first. The final (current-turn) message is always kept even if it alone
// blows the budget — we never drop the user's actual question.
function trimToTokenBudget(
  messages: LlmMessage[],
  budget: number
): LlmMessage[] {
  let used = 0;
  let startIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i].content);
    const isCurrentTurn = i === messages.length - 1;
    if (!isCurrentTurn && used + cost > budget) {
      break;
    }
    used += cost;
    startIndex = i;
  }
  return messages.slice(startIndex);
}

// ---------------------------------------------------------------------------
// Helpers shared by the blocking (processChatMessage) and streaming
// (processChatMessageStream) paths. These blocks used to be duplicated in
// both functions and drifted; keep changes here so both paths stay in sync.
// ---------------------------------------------------------------------------

// The service-setting fields the provider factory needs.
interface ChatAiServiceConfig {
  service_type: string;
  api_key?: string | null;
  custom_url?: string | null;
  model_name?: string | null;
  planning_model_name?: string | null;
  is_public?: boolean | null;
  source?: string | null;
}

const TRAINING_PLANNER_SYSTEM_PROMPT = `
Training-program execution contract:
- Before describing an existing Speediance workout or plan, read it with the canonical manager tool. Exact exercises, set types, weights, dates, and cycle weeks must come from a successful tool result.
- For simple edits or cloning, use sparky_manage_speediance_workouts action=transform. For an A/B or multi-week Speediance program, use one action=create_plan so workouts are written before the native plan is replaced.
- Never submit a new Speediance workout name to sparky_manage_workout_plans. That native tool accepts existing presets only; action=create_plan on the Speediance manager is the canonical creation path.
- When the user already explicitly requested the write, or the latest reply unambiguously accepts the operation proposed in the immediately preceding assistant turn, execute it now. Do not ask for the same confirmation again. If a recoverable tool error names a canonical next tool, follow that route within the current turn instead of repeating the failed call or falling back to another proposal.
- Never say that a workout or plan was created, changed, scheduled, activated, or already contains a feature unless the corresponding read/write tool succeeded in this turn. If a tool fails, report that failure and do not turn the intended change into prose that sounds completed.
- A plan proposal is not a completed plan. Clearly distinguish proposed from verified and written state.`;

interface AssistantExecutionContext {
  modelPurpose?: 'chat' | 'training_planner';
  turnDomains: ChatToolCategorySlug[];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assistantExecutionContext(
  metadata: unknown
): AssistantExecutionContext | null {
  const root = recordValue(metadata);
  if (!root) return null;
  const custom = recordValue(root.custom);
  const nested = recordValue(custom?.assistantExecution);
  const execution = nested ?? root;
  const modelPurpose =
    execution.modelPurpose === 'training_planner' ||
    execution.modelPurpose === 'chat'
      ? execution.modelPurpose
      : undefined;
  const turnDomains = Array.isArray(execution.turnDomains)
    ? execution.turnDomains.filter(isChatToolCategorySlug)
    : [];
  if (!modelPurpose && turnDomains.length === 0) return null;
  return { modelPurpose, turnDomains };
}

function latestAssistantExecutionContext(
  messages: readonly ChatMessage[]
): AssistantExecutionContext | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return assistantExecutionContext(messages[index].metadata);
    }
  }
  return null;
}

export function isTrainingPlanningTurn(
  messages: readonly ChatMessage[],
  currentTurnDomains?: readonly string[]
): boolean {
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user');
  const userText = latestUser ? extractMessageText(latestUser).trim() : '';
  const directPlanning =
    /\b(?:trainings?plan|workout\s*plan|training program|workout (?:bauen|erstellen|anpassen|ändern|aendern|bearbeiten|klonen|planen)|speediance(?:-|\s)*(?:workout|training|plan)|aufwärms[aä]tze?|warm-?up sets?|periodisier|hypertroph|muskelaufbau|\ba\s*\/\s*b\b|übungen? austausch|replace exercise|adjust sets?)\b/i;
  if (directPlanning.test(userText)) return true;

  const previousTurn = latestAssistantExecutionContext(messages);
  if (previousTurn?.modelPurpose !== 'training_planner') return false;

  // Continue a planner turn from its persisted structured state, not from a
  // hard-coded list of confirmation phrases or a keyword found in old prose.
  // A clearly introduced non-training domain always overrides that state.
  const explicitDomains = currentTurnDomains?.length
    ? currentTurnDomains.filter(isChatToolCategorySlug)
    : classifyByKeywords(userText);
  return !explicitDomains.some(
    (domain) =>
      domain !== 'exercise' && domain !== 'coaching' && domain !== 'reports'
  );
}

export function resolveChatModelName(
  aiService: ChatAiServiceConfig,
  planningTurn: boolean
): string {
  const normalModel =
    aiService.model_name?.trim() || getDefaultModel(aiService.service_type);
  if (!planningTurn) return normalModel;
  const configuredPlanner = aiService.planning_model_name?.trim();
  if (configuredPlanner) return configuredPlanner;
  return aiService.service_type === 'openai' ? 'gpt-5.4' : normalModel;
}

// Resolves the AI SDK model instance for a chat service: native adapters for
// openai/anthropic/google, and the OpenAI-compatible base-URL ladder for
// everything else. Self-hosted types get the SSRF-guarded fetch.
function createChatModelInstance(
  aiService: ChatAiServiceConfig,
  modelName: string,
  networkPolicy: ReturnType<typeof deriveAiNetworkPolicy>
): Parameters<typeof generateText>[0]['model'] {
  const apiKey = aiService.api_key ?? undefined;

  if (aiService.service_type === 'openai') {
    return createOpenAI({ apiKey })(modelName);
  }
  if (aiService.service_type === 'anthropic') {
    return createAnthropic({ apiKey })(modelName);
  }
  if (aiService.service_type === 'google') {
    return createGoogleGenerativeAI({ apiKey })(modelName);
  }
  if (
    aiService.service_type === 'ollama' ||
    aiService.service_type === 'openai_compatible' ||
    aiService.service_type === 'custom' ||
    aiService.service_type === 'mistral' ||
    aiService.service_type === 'groq' ||
    aiService.service_type === 'openrouter' ||
    aiService.service_type === 'xai' ||
    aiService.service_type === 'meta'
  ) {
    if (
      requiresUserSuppliedAiUrl(aiService.service_type) &&
      !aiService.custom_url?.trim()
    ) {
      throw new Error(
        `Custom URL is required for service type: ${aiService.service_type}`
      );
    }
    // Connect as OpenAI-compatible
    const baseURL = getOpenAiCompatibleBaseUrl(
      aiService.service_type,
      aiService.custom_url
    );
    const providerOptions: Parameters<typeof createOpenAI>[0] = {
      baseURL,
      apiKey: apiKey || 'no-key',
    };
    if (requiresUserSuppliedAiUrl(aiService.service_type)) {
      providerOptions.fetch = createGuardedFetch(networkPolicy);
    }
    return createOpenAI(providerOptions).chat(modelName);
  }
  throw new Error(`Unsupported service type: ${aiService.service_type}`);
}

// The AI SDK part type for a sparky_ask_user tool call, as it comes back from
// the client (and out of saved history).
const ASK_USER_PART_TYPE = `tool-${ASK_USER_TOOL_NAME}`;

// Replays a quick-reply tool call as plain text so the model remembers the
// question it asked and what the chips meant.
//
// Tool parts are stripped from the LLM window (only text and image survive
// mapMessagePart), which is what keeps an unanswered tool_use from ever
// reaching a provider. But an assistant turn whose only content was the ask
// tool call then collapses to nothing, and the model sees a bare "75g each"
// with no idea what it answered — it re-asks, or invents what happened. Turning
// the call into text keeps the transcript valid AND keeps the context intact.
function askUserPartToText(part: ChatMessagePart): string | null {
  const input = part.input as
    | { question?: unknown; options?: unknown }
    | undefined;
  const question = typeof input?.question === 'string' ? input.question : '';
  const options = Array.isArray(input?.options)
    ? input.options.filter((o): o is string => typeof o === 'string')
    : [];
  if (!question && options.length === 0) return null;
  const asked = question || 'Offered the user these options';
  return options.length > 0
    ? `${asked} (options offered: ${options.join(' | ')})`
    : asked;
}

function normalizeQuickReplyText(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function latestUserAnsweredQuickReply(
  messages: readonly ChatMessage[]
): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;

  const answer = normalizeQuickReplyText(
    extractMessageText(messages[latestUserIndex])
  );
  if (!answer) return false;

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const parts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [];
    for (const part of parts) {
      if (part.type !== ASK_USER_PART_TYPE) continue;
      const options = (part.input as { options?: unknown } | undefined)
        ?.options;
      if (!Array.isArray(options)) continue;
      return options.some((option) => {
        if (typeof option !== 'string') return false;
        const normalizedOption = normalizeQuickReplyText(option);
        return (
          normalizedOption.length > 0 &&
          ` ${answer} `.includes(` ${normalizedOption} `)
        );
      });
    }
  }
  return false;
}

// How much of a past tool result to replay. Enough to carry the identifiers a
// follow-up turn needs (a food's id, the matched name, its serving units)
// without dragging whole diaries back into every subsequent request.
const REPLAYED_TOOL_RESULT_CHARS = 600;

// Replays a completed tool call from an earlier turn as plain text.
//
// Tool parts are stripped from the LLM window (only text and image survive this
// mapper), which is what keeps an unanswered tool_use from ever reaching a
// provider. The cost is amnesia: the model could not see what it had already
// looked up or logged, so on the next turn it would re-ask, re-log, invent a
// result it never got, or — after the user answered a quick reply — emit a
// half-formed call because the food id from the previous turn's lookup was
// gone. Replaying the call as text restores that memory while keeping the
// transcript provider-safe (there is no tool_use block, just prose).
function toolPartToText(part: ChatMessagePart): string | null {
  const toolName = part.type.slice('tool-'.length);
  if (!toolName) return null;

  const input =
    part.input === undefined ? '' : JSON.stringify(part.input).slice(0, 300);
  const rawOutput =
    typeof part.output === 'string'
      ? part.output
      : part.output === undefined
        ? ''
        : JSON.stringify(part.output);
  const output =
    rawOutput.length > REPLAYED_TOOL_RESULT_CHARS
      ? `${rawOutput.slice(0, REPLAYED_TOOL_RESULT_CHARS)}…[truncated]`
      : rawOutput;

  if (!input && !output) return null;
  return `[Earlier this conversation you called ${toolName}(${input}) and it returned: ${output || '(no output)'}]`;
}

// Maps one client message part to a CoreMessage part; unknown parts fall back
// to text.
function mapMessagePart(part: ChatMessagePart): ProcessedMessagePart {
  if (part.type === 'text') {
    return { type: 'text' as const, text: part.text || part.content || '' };
  }
  if (part.type === ASK_USER_PART_TYPE) {
    return { type: 'text' as const, text: askUserPartToText(part) ?? '' };
  }
  if (part.type.startsWith('tool-')) {
    return { type: 'text' as const, text: toolPartToText(part) ?? '' };
  }
  if (
    part.type === 'image' ||
    part.type === 'image_url' ||
    (part.type === 'file' &&
      (part.mimeType?.startsWith('image/') ||
        part.mediaType?.startsWith('image/') ||
        part.url?.startsWith('data:image/')))
  ) {
    // Handle both base64 data URLs and remote URLs
    const url = part.image_url?.url || part.image || part.url || '';
    return { type: 'image' as const, image: url };
  }
  // Fallback: treat unknown parts as text
  return { type: 'text' as const, text: String(part.text || '') };
}

// Maps client chat messages (parts arrays or plain strings) to CoreMessages.
function toCoreMessages(messages: ChatMessage[]): LlmMessage[] {
  return messages.map((msg) => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const partsSource = Array.isArray(msg.parts)
      ? msg.parts
      : Array.isArray(msg.content)
        ? (msg.content as ChatMessagePart[])
        : null;

    if (partsSource) {
      const parts = partsSource
        .map(mapMessagePart)
        .filter(
          (p) =>
            p.type === 'image' ||
            (p.type === 'text' && p.text && p.text.trim() !== '')
        );
      if (parts.length > 0) {
        return { role, content: parts };
      }
    }

    if (typeof msg.content === 'string' && msg.content.trim() !== '') {
      return { role, content: msg.content };
    }
    return { role, content: '' };
  });
}

// Applies the context-window controls in order: drop trailing empty assistant
// messages some clients send, strip historical images, trim to the profile's
// token budget, and ensure the window starts with a user message (some models
// reject assistant-first history).
function buildLlmWindow(
  conversationMessages: LlmMessage[],
  toolProfile: ChatToolProfile
): LlmMessage[] {
  const msgs = [...conversationMessages];
  while (
    msgs.length > 0 &&
    msgs[msgs.length - 1].role === 'assistant' &&
    (!msgs[msgs.length - 1].content ||
      (Array.isArray(msgs[msgs.length - 1].content) &&
        msgs[msgs.length - 1].content.length === 0))
  ) {
    msgs.pop();
  }

  const llmMessages = trimToTokenBudget(
    stripHistoricalImages(msgs),
    toolProfile === 'core'
      ? CORE_PROFILE_CONTEXT_TOKEN_BUDGET
      : CONTEXT_TOKEN_BUDGET
  );

  while (llmMessages.length > 0 && llmMessages[0].role !== 'user') {
    llmMessages.shift();
  }
  return llmMessages;
}

// Persistent coach context is application-controlled and may change whenever
// the user edits their profile, so it is injected after history trimming and
// directly before the latest user request. Keeping the authoritative snapshot
// near the current request prevents stale totals in older chat turns from
// taking precedence without destabilizing the cacheable system prompt.
export async function prependPersistentCoachContext(
  userId: string,
  messages: LlmMessage[]
): Promise<LlmMessage[]> {
  const context = await coachProfileService.getPersistentChatContext(userId);
  if (!context) return messages;
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) {
    return [...messages, { role: 'user', content: context }];
  }
  return [
    ...messages.slice(0, latestUserIndex),
    { role: 'user', content: context },
    ...messages.slice(latestUserIndex),
  ];
}

// Derives the display text and parts for saving a user message to history.
function describeUserMessage(msg?: LlmMessage): {
  content: string;
  parts: ChatMessagePart[];
} {
  const content = Array.isArray(msg?.content)
    ? msg.content
        .filter((p: ChatMessagePart) => p.type === 'text')
        .map((p: ChatMessagePart) => p.text || '')
        .join(' ') || '[Image message]'
    : (msg?.content as string) || 'Message sent';
  const parts: ChatMessagePart[] = Array.isArray(msg?.content)
    ? msg.content
    : [{ type: 'text' as const, text: String(msg?.content || '') }];
  return { content, parts };
}

// Keyword rules for instant classification. Kept deliberately moderate
// (stems and a handful of high-signal synonyms) rather than exhaustive:
// wide-net keyword lists trade recall for false positives ("I ran out of
// milk" would match exercise), and vocabulary is unbounded across users and
// languages anyway. The LLM fallback (below) and the sparky_enable_tools
// escalation tool (see ai/tools/metaTools.ts) exist specifically to catch
// what this tier misses, so this list does not need to be — and should not
// try to be — complete.
const KEYWORD_RULES: { category: ChatToolCategorySlug; keywords: RegExp }[] = [
  {
    category: 'exercise',
    keywords:
      /\b(run|ran|running|walk|walked|walking|jog|jogged|jogging|lift|lifted|lifting|workout|workouts|exercise|exercises|reps|sets|cardio|strength|gym|heart rate|bpm|vo2\s*max|vo2max|treadmill|squats?|bench press|swim|swam|swimming|bike|biking|cycling|cycled|yoga|hike[ds]?|hiking|steps|push-?ups?|pull-?ups?|training|trained|worked out)\b/i,
  },
  {
    category: 'food',
    keywords:
      /\b(eat|ate|eating|food|foods|meal|meals|water|drink|drank|drinking|ml|oz|cup|cups|breakfast|lunch|dinner|snack|snacks|calories?|kcal|macro|macros|protein|carbs|fat|banana|apple|chicken|nutrition|nutrients?|coffee|tea|juice|smoothie|recipe)\b/i,
  },
  {
    category: 'checkin',
    keywords:
      /\b(weigh(?:t|ts|ed|ing|s)?|height|waist|hips|neck|body fat|fat%|percentage|checkin|check-in|scale|bmi|mood|sleep|slept|nap|fasting|fasted|measurements?|measured)\b/i,
  },
  {
    category: 'goals',
    keywords:
      /\b(goal|goals|target|targets|set goal|set goals|objectives?|milestones?)\b/i,
  },
  {
    category: 'reports',
    keywords:
      /\b(report|reports|summar(?:y|ies|ize|ise|ized|ised|izing)|progress|tdee|chart|charts|analytics|recap|overview|trends?|graphs?|stats?|statistics|analy(?:ze|sis|tics)|averages?|compare|comparison|how (?:am|did|was|have) i)\b/i,
  },
  {
    category: 'coaching',
    keywords:
      /\b(advice|advise|tips?|motivat\w*|recommend\w*|suggest\w*|coach(?:ing)?|plan)\b/i,
  },
  {
    category: 'vision',
    keywords: /\b(photo|picture|image|label|scan|barcode)\b/i,
  },
  {
    category: 'profile',
    keywords:
      /\b(profile|habit|habits|preference|preferences|settings|timezone|unit|units)\b/i,
  },
  {
    category: 'medications',
    keywords:
      /\b(medication|medications|medicine|medicines|medikament|medikamente|medikamenten|tablette|tabletten|dose|dosage|dosis)\b/i,
  },
];

function extractMessageText(msg: ChatMessage): string {
  const partsSource = Array.isArray(msg.parts)
    ? msg.parts
    : Array.isArray(msg.content)
      ? (msg.content as ChatMessagePart[])
      : null;

  if (partsSource) {
    return partsSource
      .filter((p) => p.type === 'text')
      .map((p) => p.text || p.content || '')
      .join(' ');
  }

  if (typeof msg.content === 'string') {
    return msg.content;
  }

  return '';
}

// True when a message carries an image part. Deterministic signal (unlike
// text keywords or the LLM fallback, an attached image is unambiguous), so
// it's applied directly rather than routed through classification.
function hasImageParts(msg: ChatMessage): boolean {
  const partsSource = Array.isArray(msg.parts)
    ? msg.parts
    : Array.isArray(msg.content)
      ? (msg.content as ChatMessagePart[])
      : null;
  return (
    partsSource?.some((p) => p.type === 'image' || p.type === 'image_url') ??
    false
  );
}

// Pure keyword classification step, exported for unit testing. Intentionally
// moderate (see KEYWORD_RULES comment): it favors precision over exhaustive
// recall, and readily returns multiple categories for one message (e.g.
// "summarize what I ate" -> food + reports) since an extra loaded category is
// cheap but a missing one is fatal.
export function classifyByKeywords(text: string): ChatToolCategorySlug[] {
  const matched = new Set<ChatToolCategorySlug>();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.test(text)) {
      matched.add(rule.category);
    }
  }
  return Array.from(matched);
}

async function classifyUserIntent(
  messages: ChatMessage[],
  modelInstance: Parameters<typeof generateText>[0]['model'],
  providerOptions?: Record<string, Record<string, JSONValue>>
): Promise<ChatToolCategorySlug[]> {
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user');
  if (!lastUserMessage) return [];

  const text = extractMessageText(lastUserMessage);

  // 1. Deterministic + keyword signals (instant, 0ms). An attached image
  // always implies vision (+ food, the dominant meal-photo case) regardless
  // of accompanying text.
  const matchedCategories = new Set<ChatToolCategorySlug>(
    classifyByKeywords(text)
  );
  if (hasImageParts(lastUserMessage)) {
    matchedCategories.add('vision');
    matchedCategories.add('food');
  }

  // If we matched multiple clear keywords (e.g. food + exercise), return them immediately.
  if (matchedCategories.size > 0) {
    log(
      'info',
      `[chatService] Keyword classifier matched: ${Array.from(matchedCategories).join(', ')}`
    );
    return Array.from(matchedCategories);
  }

  // 2. LLM Fallback (if keyword classifier is unsure/empty)
  try {
    // Look at last 2 turns to see context (e.g. user answering a question from assistant)
    const contextMessages = messages.slice(-2).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: extractMessageText(m),
    }));

    const previousExecution = latestAssistantExecutionContext(messages);
    const structuredPreviousDomains = previousExecution?.turnDomains.length
      ? previousExecution.turnDomains.join(', ')
      : 'none';
    const classificationPrompt = `Analyze the two-message conversation below and determine which health tracking domains are relevant to the user's latest reply. Choose all that apply.

The immediately preceding assistant turn has these application-recorded domains: ${structuredPreviousDomains}.
- If the latest reply is underspecified, it continues only that immediately preceding assistant turn and inherits its recorded domains.
- An explicit new subject in the latest reply overrides the preceding domains.
- Never use any older conversation topic to classify the latest reply.

Available domains:
- exercise: tracking workouts, logging sets/reps, running, cardio, strength, steps.
- food: logging meals, lookup foods/nutrition, tracking water intake.
- checkin: logging daily check-ins, weight, height, body fat, or other body measurements.
- goals: viewing or changing goals/targets.
- reports: viewing progress charts, summaries, TDEE, or reports.
- coaching: general coaching advice, guidance, tips, or motivation.
- profile: changing settings, preferences, timezone, habits, or profile details.
- medications: viewing or logging medicines, medication schedules, doses, or adherence.

Your response must contain ONLY the matched domain names as a comma-separated list (e.g., "exercise, food" or "checkin" or "none"). Do not include any other text.`;

    const { text: resultText } = await generateText({
      model: modelInstance,
      system: classificationPrompt,
      messages: contextMessages,
      providerOptions,
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(10000), // 10s timeout to prevent hanging the chat turn
    });

    log(
      'info',
      `[chatService] LLM intent classifier output: "${resultText.trim()}"`
    );

    const parts = resultText
      .toLowerCase()
      .split(',')
      .map((t) => t.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''));

    const categoriesList: ChatToolCategorySlug[] = [];
    const validCategories: ChatToolCategorySlug[] = [
      'exercise',
      'food',
      'checkin',
      'goals',
      'reports',
      'coaching',
      'profile',
      'vision',
      'medications',
    ];
    for (const cat of validCategories) {
      if (parts.includes(cat)) {
        categoriesList.push(cat);
      }
    }

    if (categoriesList.length > 0) {
      return categoriesList;
    }
    // LLM classified confidently as "none of the above" (general chit-chat).
    // Load the cheap coaching surface; sparky_enable_tools rescues the model
    // mid-turn if it turns out to need something else.
    return ['coaching'];
  } catch (error) {
    log('error', '[chatService] Error in LLM intent classification:', error);
  }

  // Classification itself failed (not just "no match") — we know nothing, so
  // defer to the profile's default set (resolveCategories in ai/tools/index.ts)
  // rather than guessing a fixed subset. sparky_enable_tools covers any gap.
  return [];
}

export function resolveTurnToolCategories(
  messages: readonly ChatMessage[],
  classifiedCategories: readonly ChatToolCategorySlug[],
  allowedCategories?: readonly string[]
): ChatToolCategorySlug[] | undefined {
  const inheritedDomains =
    latestAssistantExecutionContext(messages)?.turnDomains;
  const requested =
    classifiedCategories.length > 0
      ? [...classifiedCategories]
      : inheritedDomains && inheritedDomains.length > 0
        ? inheritedDomains
        : undefined;
  if (!requested) return allowedCategories?.filter(isChatToolCategorySlug);
  if (!allowedCategories || allowedCategories.length === 0) return requested;

  const allowed = new Set(allowedCategories.filter(isChatToolCategorySlug));
  const constrained = requested.filter((category) => allowed.has(category));
  return constrained.length > 0
    ? constrained
    : allowedCategories.filter(isChatToolCategorySlug);
}

async function resolveChatTurnRuntime(
  messages: ChatMessage[],
  aiService: ChatAiServiceConfig,
  authenticatedUserId: string,
  actorIsAdmin: boolean,
  toolCategories?: readonly string[]
) {
  const networkPolicy = deriveAiNetworkPolicy(aiService, actorIsAdmin);
  const normalModelName = resolveChatModelName(aiService, false);
  const normalModelInstance = createChatModelInstance(
    aiService,
    normalModelName,
    networkPolicy
  );
  const categoriesAreManual = Boolean(
    toolCategories && toolCategories.length > 0
  );
  let activeCategories: readonly string[] | undefined = toolCategories;
  if (!process.env.VITEST) {
    const classifiedCategories = await classifyUserIntent(
      messages,
      normalModelInstance,
      buildChatProviderOptions(
        aiService.service_type,
        authenticatedUserId,
        normalModelName
      )
    );
    activeCategories = resolveTurnToolCategories(
      messages,
      classifiedCategories,
      toolCategories
    );
  }

  const planningTurn = isTrainingPlanningTurn(messages, activeCategories);
  const modelName = resolveChatModelName(aiService, planningTurn);
  const modelInstance =
    modelName === normalModelName
      ? normalModelInstance
      : createChatModelInstance(aiService, modelName, networkPolicy);

  return {
    planningTurn,
    modelName,
    modelInstance,
    categoriesAreManual,
    activeCategories,
  };
}

async function processChatMessage(
  messages: ChatMessage[],
  serviceConfigId: string,
  userId: string,
  authenticatedUserId: string,
  actorIsAdmin = false,
  toolCategories?: readonly string[],
  interactionOptions?: { allowAskUser?: boolean }
) {
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid messages format.');
    }
    if (!serviceConfigId) {
      throw new Error('AI service configuration ID is missing.');
    }
    const aiService = await chatRepository.getAiServiceSettingForBackend(
      serviceConfigId,
      userId
    );
    if (!aiService) {
      throw new Error('AI service setting not found for the provided ID.');
    }

    const source = aiService.source || 'unknown';
    log(
      'info',
      `Processing chat message for user ${userId} using AI service from ${source} (ID: ${serviceConfigId})`
    );

    if (requiresApiKey(aiService.service_type) && !aiService.api_key) {
      throw new Error('API key missing for selected AI service.');
    }

    const {
      planningTurn,
      modelName,
      modelInstance,
      categoriesAreManual,
      activeCategories,
    } = await resolveChatTurnRuntime(
      messages,
      aiService,
      authenticatedUserId,
      actorIsAdmin,
      toolCategories
    );

    const {
      systemPromptContent,
      tools,
      activeToolNames,
      prepareStep,
      toolProfile,
      selectedCategories,
    } = await prepareChatContext(
      authenticatedUserId,
      aiService.service_type,
      aiService.chat_tool_profile,
      activeCategories,
      categoriesAreManual,
      aiService.system_prompt,
      interactionOptions?.allowAskUser !== false &&
        !latestUserAnsweredQuickReply(messages),
      toolCategories
    );
    const chatToolMetadata = buildChatToolConfigurationMetadata(
      serviceConfigId,
      toolProfile,
      toolCategories
    );

    const chatProviderOptions = buildChatProviderOptions(
      aiService.service_type,
      authenticatedUserId,
      modelName
    );
    const effectiveSystemPrompt = planningTurn
      ? `${systemPromptContent}\n${TRAINING_PLANNER_SYSTEM_PROMPT}`
      : systemPromptContent;

    // Map conversation history messages to CoreMessage format, then apply the
    // shared context-window controls (image strip, token budget, user-first).
    const conversationMessages = toCoreMessages(messages);
    const llmMessages = await prependPersistentCoachContext(
      authenticatedUserId,
      buildLlmWindow(conversationMessages, toolProfile)
    );
    const { content: userMessageContent, parts: userMessageParts } =
      describeUserMessage(
        conversationMessages[conversationMessages.length - 1]
      );

    const executedToolsList: ExecutedToolCall[] = [];
    const toolOutcomes: ChatToolOutcome[] = [];
    type BlockingGenerationMessages = NonNullable<
      Parameters<typeof generateText>[0]['messages']
    >;
    const captureStep: NonNullable<
      Parameters<typeof generateText>[0]['onStepFinish']
    > = ({ toolCalls, toolResults }) => {
      collectToolOutcomes(
        toolCalls ?? [],
        toolResults ?? [],
        executedToolsList,
        toolOutcomes
      );
      if (toolResults && toolResults.length > 0) {
        const sizes = toolResults
          .map(
            (toolResult) =>
              `${toolResult.toolName}=${String(toolResult.output ?? '').length}c`
          )
          .join(' ');
        log('info', `[chat] tool result sizes: ${sizes}`);
      }
    };
    const runGeneration = (generationMessages: BlockingGenerationMessages) =>
      generateText({
        model: modelInstance,
        system: effectiveSystemPrompt,
        messages: generationMessages,
        tools,
        // Narrows the published/sent tool schemas to this turn's classified
        // categories; sparky_enable_tools lets the model escalate mid-request
        // via prepareStep if it turns out to need a dormant category.
        activeTools: activeToolNames,
        prepareStep,
        providerOptions: chatProviderOptions,
        // Low temperature only for small local models (core profile); cloud and
        // full-profile Ollama keep provider defaults.
        ...(toolProfile === 'core' && {
          temperature: CORE_PROFILE_CHAT_TEMPERATURE,
        }),
        // Tighter retry ceiling for cache-less core-profile backends, where every
        // retry re-processes the full prefix.
        stopWhen: buildChatStopConditions(toolProfile),
        maxRetries:
          toolProfile === 'core'
            ? CORE_PROFILE_MAX_PROVIDER_RETRIES
            : MAX_PROVIDER_RETRIES,
        abortSignal: AbortSignal.timeout(CHAT_REQUEST_TIMEOUT_MS),
        onStepFinish: captureStep,
      });

    let result = await runGeneration(llmMessages as BlockingGenerationMessages);
    let repairedFoodDiaryWrite = false;
    if (needsFoodDiaryRepair(messages, result.text, toolOutcomes)) {
      repairedFoodDiaryWrite = true;
      log(
        'warn',
        '[chat] A requested food diary write ended after lookup without a verified entry; retrying the food tool workflow once.'
      );
      result = await runGeneration([
        ...llmMessages,
        ...result.response.messages,
        { role: 'user', content: FOOD_LOG_REPAIR_PROMPT },
      ] as BlockingGenerationMessages);
    }

    const usage = result.totalUsage ?? result.usage;
    log(
      'info',
      `[chat] provider=${aiService.service_type} model=${modelName} cacheReadTokens=${usage?.inputTokenDetails?.cacheReadTokens ?? 0} inputTokens=${usage?.inputTokens ?? 0} noCacheTokens=${usage?.inputTokenDetails?.noCacheTokens ?? 0} cacheWriteTokens=${usage?.inputTokenDetails?.cacheWriteTokens ?? 0} outputTokens=${usage?.outputTokens ?? 0} totalTokens=${usage?.totalTokens ?? 0}`
    );

    // Save history dynamically to DB (replacing frontend client-side saves)
    await chatRepository
      .saveChatHistory({
        user_id: userId,
        content: userMessageContent,
        messageType: 'user',
        metadata: chatToolMetadata,
        parts: userMessageParts,
      })
      .catch((err: unknown) =>
        log('error', 'Failed to save user chat history:', err)
      );

    const quickReply = quickReplyFromToolCalls(executedToolsList, toolOutcomes);
    let finalContent = quickReply
      ? renderQuickReply(quickReply.input)
      : result.text.trim();
    if (!finalContent) {
      if (toolOutcomes.length > 0) {
        finalContent = fallbackFromToolOutcomes(toolOutcomes);
        log(
          'info',
          '[chat] LLM returned empty text; used the verified tool result as fallback.'
        );
      } else {
        finalContent = EMPTY_RESPONSE_ERROR_TEXT;
      }
    }
    if (repairedFoodDiaryWrite) {
      const verifiedFoodDiaryWrite =
        latestSuccessfulFoodDiaryWrite(toolOutcomes);
      if (verifiedFoodDiaryWrite) {
        // After a repair attempt, only the tool's write confirmation may claim
        // success. This prevents a second fluent hallucination from masking a
        // missing diary row.
        finalContent = verifiedFoodDiaryWrite.output;
      } else if (
        !result.text.trim() ||
        assistantClaimsFoodDiaryWrite(result.text)
      ) {
        finalContent = unconfirmedFoodLogText(result.text);
      }
    }
    finalContent = verifiedTrainingPlannerText(
      finalContent,
      toolOutcomes,
      planningTurn
    );

    if (finalContent) {
      const assistantParts: Record<string, unknown>[] = [
        { type: 'text', text: finalContent },
      ];
      if (quickReply) {
        assistantParts.push({
          type: ASK_USER_PART_TYPE,
          toolCallId: quickReply.toolCallId,
          state: 'output-available',
          input: quickReply.input,
          output: '',
        });
      }
      await chatRepository
        .saveChatHistory({
          user_id: userId,
          content: finalContent,
          messageType: 'assistant',
          metadata: buildAssistantExecutionMetadata(
            toolOutcomes,
            planningTurn,
            modelName,
            selectedCategories
          ),
          parts: assistantParts,
        })
        .catch((err: unknown) =>
          log('error', 'Failed to save assistant chat history:', err)
        );
    }

    const mutationDomains = successfulMutationDomains(toolOutcomes);
    for (const domain of mutationDomains) {
      coachEventService.publish(authenticatedUserId, domain);
    }

    return {
      content: finalContent,
      action: actionFromOutcomes(toolOutcomes),
      executedTools: executedToolsList,
      toolOutcomes,
      mutationDomains,
      quickReply: quickReply?.input ?? null,
    };
  } catch (error) {
    log('error', `Error processing chat message for user ${userId}:`, error);
    throw error;
  }
}
const FOOD_OPTIONS_PROMPT = `You are Sparky, an AI nutrition and wellness coach. Your task is to generate minimum 3 realistic food options in JSON format when requested. Respond ONLY with a JSON array of FoodOption objects, including detailed nutritional information for EVERY field (calories, protein, carbs, fat, saturated_fat, polyunsaturated_fat, monounsaturated_fat, trans_fat, cholesterol, sodium, potassium, dietary_fiber, sugars, vitamin_a, vitamin_c, calcium, iron). **CRITICAL: You MUST estimate and populate every single micro-nutritional field. Do NOT default to 0 or leave blank any nutritional field if a realistic scientific estimation can be made based on the food type. Use your biochemical and culinary knowledge to calculate typical distributions.** Do NOT include any other text.
**CRITICAL: When a unit is specified in the request (e.g., 'GENERATE_FOOD_OPTIONS:apple in piece'), ensure the \`serving_unit\` in the generated \`FoodOption\` objects matches the requested unit exactly, if it's a common and logical unit for that food. If not, provide a common and realistic serving unit.**`;

const FOOD_OPTIONS_TEMPERATURE = 0.7;

// 'no_ai_configured' is the only category this service mints itself; every
// dispatch failure passes its category through unchanged for the route's
// HTTP-status map.
export type FoodOptionsErrorCategory =
  | DispatchErrorCategory
  | 'no_ai_configured';

export type FoodOptionsResult =
  | { success: true; content: string }
  | { success: false; category: FoodOptionsErrorCategory; error: string };

async function processFoodOptionsRequest(
  foodName: string,
  unit: string,
  authenticatedUserId: string,
  serviceConfigId: string,
  actorIsAdmin = false
): Promise<FoodOptionsResult> {
  if (!serviceConfigId) {
    return {
      success: false,
      category: 'no_ai_configured',
      error: 'AI service configuration ID is missing.',
    };
  }
  const aiService = await chatRepository.getAiServiceSettingForBackend(
    serviceConfigId,
    authenticatedUserId
  );
  if (!aiService) {
    return {
      success: false,
      category: 'no_ai_configured',
      error: 'AI service setting not found for the provided ID.',
    };
  }
  const source = aiService.source || 'unknown';
  log(
    'info',
    `Processing food options request for user ${authenticatedUserId} using AI service from ${source} (ID: ${serviceConfigId})`
  );

  // Dispatch reads everything from the decrypted backend detail. The helper
  // enforces the supported-provider, api-key, and custom-url checks and
  // reports each as a category the route maps to an HTTP status.
  const provider: ProviderConfig = {
    service_type: aiService.service_type,
    api_key: aiService.api_key ?? undefined,
    model_name: aiService.model_name ?? undefined,
    custom_url: aiService.custom_url ?? undefined,
    timeout: aiService.timeout ?? undefined,
  };

  const prompt = `${FOOD_OPTIONS_PROMPT}\n\nGENERATE_FOOD_OPTIONS:${foodName} in ${unit}`;

  const result = await dispatchAiRequest({
    provider,
    networkPolicy: deriveAiNetworkPolicy(aiService, actorIsAdmin),
    prompt,
    parseJson: true,
    temperature: FOOD_OPTIONS_TEMPERATURE,
  });

  if (!result.ok) {
    log(
      result.category === 'refused' || result.category === 'no_content'
        ? 'warn'
        : 'error',
      `Food options: ${provider.service_type} failed for user ${authenticatedUserId} (${result.category}): ${result.detail}`
    );
    return { success: false, category: result.category, error: result.detail };
  }
  return { success: true, content: result.text };
}

// Minimal completion used only to confirm a provider config actually works.
const TEST_CONNECTION_PROMPT = 'Reply with the single word: OK.';
// A short timeout so an unreachable custom URL fails in ~15s rather than hanging
// for the 90s/120s dispatch defaults. Retry behavior is safe: only HTTP 429 is
// retried; timeouts and 401/403 return immediately.
const TEST_CONNECTION_TIMEOUT_MS = 15_000;
// Types without preset models point at user-hosted servers with no reliable
// default, so a blank effective model would let dispatch substitute a
// meaningless getDefaultModel default the UI never intends.
const NO_PRESET_SERVICE_TYPES = new Set([
  'ollama',
  'openai_compatible',
  'custom',
]);

export type TestConnectionResult =
  | { ok: true }
  | { ok: false; category: DispatchErrorCategory; detail: string };

function statusError(message: string, statusCode: number): Error {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

/**
 * Run a minimal live completion against a provider config to verify it works,
 * without persisting anything. Returns `{ ok: true }` or `{ ok: false, category,
 * detail }`; the route returns HTTP 200 for both so the UI can show a friendly,
 * category-specific toast. Throws (with `.statusCode`) only for the security
 * gates the UI never legitimately triggers. See routes/chatRoutes for gate #1.
 */
async function testAiServiceConnection(
  payload: TestAiServiceConnectionRequest,
  userId: string,
  isAdmin: boolean
): Promise<TestConnectionResult> {
  const serviceType = payload.service_type;
  let apiKey = payload.api_key?.trim() || undefined;
  let customUrl = payload.custom_url?.trim() || undefined;
  let modelName = payload.model_name?.trim() || undefined;

  // Stored-key fallback: the api_key field is blank by design on edit (the key
  // is encrypted server-side and never sent to the browser), so a test on a
  // saved service must reuse the stored, decrypted key.
  if (payload.id && !apiKey) {
    const stored = await chatRepository.getDecryptedAiServiceSettingById(
      payload.id,
      userId
    );
    if (stored) {
      // Gate #2 (global-key protection): /chat is authenticate-only and the RLS
      // SELECT policy returns every is_public row to any authenticated user, so
      // a non-admin must not be able to make the server decrypt the operator's
      // global key and POST it to an attacker-supplied custom_url.
      if (stored.is_public && !isAdmin) {
        throw statusError(
          'Only administrators can test global AI service settings.',
          403
        );
      }
      // Gate #3 (provider-mismatch protection): only reuse the stored key when
      // the stored row's provider matches the requested one. Switching a saved
      // OpenAI service to 'custom' and leaving the key blank must NOT send the
      // stored OpenAI key to a different provider/URL.
      if (stored.service_type === serviceType) {
        apiKey = stored.api_key ?? undefined;
        customUrl = customUrl ?? stored.custom_url ?? undefined;
        modelName = modelName ?? stored.model_name ?? undefined;
      }
    }
  }

  // Gate #4 (SSRF): a test fires an outbound POST to the effective custom URL, so
  // a non-admin must not aim it at a private/internal address (localhost, RFC1918,
  // link-local, cloud metadata). The URL is validated post-fallback so a stored
  // value is checked too. Admins (trusted operator) and the ALLOW_PRIVATE_NETWORK_AI
  // opt-in bypass this, keeping self-hosted setups like local Ollama working.
  if (customUrl) {
    const networkPolicy = deriveAiNetworkPolicy({ source: 'user' }, isAdmin);
    try {
      assertOutboundUrlShapeAndLiteralAllowed(customUrl, networkPolicy);
    } catch (error) {
      // Policy denials (private/internal address) are 403; a URL fetch could
      // never use (malformed, wrong scheme, credentials) is a plain 400.
      throw statusError(
        error instanceof Error
          ? error.message
          : 'Custom AI service URLs must be public http(s) endpoints. Private or internal addresses are not allowed.',
        error instanceof OutboundUrlBlockedError ? 403 : 400
      );
    }
  }

  // Validate after fallback: a no-preset type with a blank effective model would
  // otherwise dispatch with a meaningless getDefaultModel default.
  if (NO_PRESET_SERVICE_TYPES.has(serviceType) && !modelName) {
    throw statusError('A model name is required for this service type.', 400);
  }

  const provider: ProviderConfig = {
    service_type: serviceType,
    api_key: apiKey,
    model_name: modelName,
    custom_url: customUrl,
  };

  const result = await dispatchAiRequest({
    provider,
    networkPolicy: deriveAiNetworkPolicy(
      { is_public: false, source: 'user' },
      isAdmin
    ),
    prompt: TEST_CONNECTION_PROMPT,
    temperature: 0,
    timeoutMs: TEST_CONNECTION_TIMEOUT_MS,
  });

  if (!result.ok) {
    log(
      'warn',
      `Test connection: ${serviceType} failed for user ${userId} (${result.category}): ${result.detail}`
    );
    return { ok: false, category: result.category, detail: result.detail };
  }
  return { ok: true };
}
const EMPTY_RESPONSE_ERROR_TEXT =
  'The AI service returned an empty response. Please try again.';

interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ParsedQuickReply {
  toolCallId: string;
  input: AskUserInput;
}

export interface ChatToolOutcome {
  toolCallId: string;
  name: string;
  action: string | null;
  foodDiaryWrite: boolean;
  success: boolean;
  mutationDomain: CoachEventDomain | null;
  output: string;
}

const FOOD_MUTATIONS = new Set([
  'log_food',
  'log_external_food',
  'create_food',
  'log_meal',
  'delete_entry',
  'delete_food',
  'update_entry',
  'update_food_variant',
  'copy_from_yesterday',
  'save_as_meal_template',
  'log_water',
]);
const FOOD_DIARY_WRITE_ACTIONS = new Set([
  'log_food',
  'log_external_food',
  'log_meal',
  'copy_from_yesterday',
]);
const FOOD_LOG_REPAIR_PROMPT =
  "Internal execution check: the previous answer claimed that food was logged, but no successful diary write was confirmed. Continue the user's original request now. If create_food already succeeded without logging, use the Food ID from its tool result and call log_food; do not create the food again. Call sparky_manage_food until its result explicitly confirms the diary entry. Never claim success from a catalog-only creation or from your own text.";
const UNCONFIRMED_FOOD_LOG_TEXT =
  'The food diary entry could not be confirmed, so nothing is being reported as logged. Please try again.';
const UNCONFIRMED_FOOD_LOG_TEXT_DE =
  'Der Tagebucheintrag konnte nicht bestätigt werden. Deshalb melde ich das Essen nicht als geloggt. Bitte versuche es erneut.';
const EXERCISE_MUTATIONS = new Set([
  'create_exercise',
  'log_exercise',
  'log_workout_preset',
  'update_exercise_entry',
  'delete_exercise_entry',
  'create_workout_preset',
]);
const CHECKIN_MUTATIONS = new Set([
  'log_biometrics',
  'log_custom_metric',
  'create_category',
  'log_mood',
  'log_fasting',
  'log_sleep',
]);

function mutationDomainFor(
  toolName: string,
  action: string | null
): CoachEventDomain | null {
  if (toolName === 'sparky_schedule_speediance_workout') {
    return 'exercise';
  }
  if (
    toolName === 'sparky_manage_speediance_workouts' &&
    action !== 'list' &&
    action !== 'get'
  ) {
    return 'exercise';
  }
  if (toolName === 'sparky_manage_workout_plans' && action !== 'list') {
    return 'exercise';
  }
  if (toolName === 'sparky_manage_training_feedback' && action !== 'context') {
    return 'exercise';
  }
  if (!action) return null;
  if (toolName === 'sparky_manage_food' && FOOD_MUTATIONS.has(action)) {
    return action === 'log_water' ? 'water' : 'nutrition';
  }
  if (toolName === 'sparky_manage_exercise' && EXERCISE_MUTATIONS.has(action)) {
    return 'exercise';
  }
  if (toolName === 'sparky_manage_checkin' && CHECKIN_MUTATIONS.has(action)) {
    return 'checkin';
  }
  if (toolName === 'sparky_manage_habits' && action === 'log_habit') {
    return 'checkin';
  }
  if (toolName === 'sparky_manage_coach_memory' && action !== 'list') {
    return 'coach';
  }
  return null;
}

function collectToolOutcomes(
  calls: readonly {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }[],
  results: readonly {
    toolCallId: string;
    toolName: string;
    output: unknown;
  }[],
  executedTools: ExecutedToolCall[],
  outcomes: ChatToolOutcome[]
): void {
  for (const call of calls) {
    const args =
      call.input && typeof call.input === 'object'
        ? (call.input as Record<string, unknown>)
        : {};
    executedTools.push({ name: call.toolName, args });
    // Do not log arguments: meals, measurements, notes, and memories may
    // contain private health information.
    log('info', `Agent executed tool call: ${call.toolName}`);
  }
  for (const result of results) {
    const call = calls.find(
      (candidate) => candidate.toolCallId === result.toolCallId
    );
    const args =
      call?.input && typeof call.input === 'object'
        ? (call.input as Record<string, unknown>)
        : {};
    const output = typeof result.output === 'string' ? result.output : '';
    const action = typeof args.action === 'string' ? args.action : null;
    outcomes.push({
      toolCallId: result.toolCallId,
      name: result.toolName,
      action,
      foodDiaryWrite:
        result.toolName === 'sparky_manage_food' &&
        (FOOD_DIARY_WRITE_ACTIONS.has(action ?? '') ||
          (action === 'create_food' &&
            Boolean(args.meal_type_id || args.meal_type))),
      success: Boolean(output) && !isToolErrorText(output),
      mutationDomain: mutationDomainFor(result.toolName, action),
      output,
    });
  }
}

function isSuccessfulFoodDiaryWrite(outcome: ChatToolOutcome): boolean {
  return outcome.success && outcome.foodDiaryWrite;
}

function latestSuccessfulFoodDiaryWrite(
  outcomes: readonly ChatToolOutcome[]
): ChatToolOutcome | null {
  return [...outcomes].reverse().find(isSuccessfulFoodDiaryWrite) ?? null;
}

function assistantClaimsFoodDiaryWrite(text: string): boolean {
  const mutationWord =
    '(?:logged|recorded|added|saved|geloggt|eingetragen|erfasst)';
  const negative = new RegExp(
    `\\b(?:not|never|nicht|kein(?:e|en|er|es)?|couldn['’]?t|could not|failed|fehlgeschlagen|konnte[^.!?\\n]{0,20}nicht)\\b[^.!?\\n]{0,80}\\b${mutationWord}\\b`,
    'i'
  );
  if (negative.test(text)) return false;
  return (
    new RegExp(`(?:^|\\n)\\s*(?:✅\\s*)?${mutationWord}\\b`, 'im').test(text) ||
    new RegExp(
      `\\b(?:i(?:['’]ve| have)?|ich habe|successfully|erfolgreich|wurde)\\b[^.!?\\n]{0,120}\\b${mutationWord}\\b`,
      'i'
    ).test(text)
  );
}

function userRequestedFoodDiaryWrite(
  messages: readonly ChatMessage[]
): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;

  const userText = extractMessageText(messages[latestUserIndex]).trim();
  // Water uses a different mutation contract. Treating "300ml" or an
  // explicit water message as food can launch the food-only repair prompt and
  // accidentally resume a previously discussed meal.
  if (isWaterLogText(userText)) return false;
  if (
    /\?$/.test(userText) &&
    /\b(?:was|wann|wie|welche|what|when|which|did|habe ich)\b/i.test(userText)
  ) {
    return false;
  }
  if (
    /\b(?:logged|log(?:ge|gen|ging)?|logg(?:e|en|t|te)?|eintrag(?:en|e|t)?|erfass(?:e|en|t)?|gegessen|verzehrt|consum(?:e|ed)|ate|eaten|add|record|track)\b/i.test(
      userText
    ) ||
    /\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|stück|stueck|pieces?|slices?|servings?|portion(?:en)?|brötchen|broetchen)\b/i.test(
      userText
    )
  ) {
    return true;
  }

  if (
    !/^(?:ja|yes|yep|ok(?:ay)?|passt|mach(?: das)?|bitte|genau)[.! ]*$/i.test(
      userText
    )
  ) {
    return false;
  }
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    return /\b(?:log\w*|logg\w*|eintrag\w*|erfass\w*|tagebuch|diary)\b/i.test(
      extractMessageText(message)
    );
  }
  return false;
}

function needsFoodDiaryRepair(
  messages: readonly ChatMessage[],
  assistantText: string,
  outcomes: readonly ChatToolOutcome[]
): boolean {
  const attemptedFoodLookup = outcomes.some(
    (outcome) =>
      outcome.name === 'sparky_manage_food' &&
      outcome.action === 'lookup_food_nutrition'
  );
  return (
    userRequestedFoodDiaryWrite(messages) &&
    !latestSuccessfulFoodDiaryWrite(outcomes) &&
    (assistantClaimsFoodDiaryWrite(assistantText) || attemptedFoodLookup)
  );
}

function unconfirmedFoodLogText(assistantText: string): string {
  return /\b(?:ich|geloggt|eingetragen|erfasst|tagebuch)\b/i.test(assistantText)
    ? UNCONFIRMED_FOOD_LOG_TEXT_DE
    : UNCONFIRMED_FOOD_LOG_TEXT;
}

function parseAskUserInput(
  value: Record<string, unknown>
): AskUserInput | null {
  const mode = value.mode;
  const question = value.question;
  const options = value.options;
  if (
    (mode !== 'ask' && mode !== 'choose') ||
    typeof question !== 'string' ||
    !question.trim() ||
    !Array.isArray(options) ||
    options.length < 2 ||
    !options.every((option): option is string =>
      Boolean(typeof option === 'string' && option.trim())
    )
  ) {
    return null;
  }
  return {
    mode,
    question: question.trim(),
    options: options.map((option) => option.trim()),
  };
}

function quickReplyFromToolCalls(
  calls: readonly ExecutedToolCall[],
  outcomes: readonly ChatToolOutcome[]
): ParsedQuickReply | null {
  const call = [...calls]
    .reverse()
    .find((candidate) => candidate.name === ASK_USER_TOOL_NAME);
  if (!call) return null;
  const input = parseAskUserInput(call.args);
  if (!input) return null;
  const outcome = [...outcomes]
    .reverse()
    .find((candidate) => candidate.name === ASK_USER_TOOL_NAME);
  if (!outcome) return null;
  return { toolCallId: outcome.toolCallId, input };
}

function renderQuickReply(input: AskUserInput): string {
  return [
    input.question,
    '',
    ...input.options.map((option, index) => `${index + 1}. ${option}`),
  ].join('\n');
}

function successfulMutationDomains(
  outcomes: readonly ChatToolOutcome[]
): CoachEventDomain[] {
  return [
    ...new Set(
      outcomes.flatMap((outcome) =>
        outcome.success && outcome.mutationDomain
          ? [outcome.mutationDomain]
          : []
      )
    ),
  ];
}

function fallbackFromToolOutcomes(
  outcomes: readonly ChatToolOutcome[]
): string {
  const userVisibleOutcomes = outcomes.filter(
    (outcome) => outcome.name !== ASK_USER_TOOL_NAME
  );
  const successfulMutation = [...userVisibleOutcomes]
    .reverse()
    .find((outcome) => outcome.success && outcome.mutationDomain);
  if (successfulMutation) return successfulMutation.output;
  const failedMutation = [...userVisibleOutcomes]
    .reverse()
    .find((outcome) => !outcome.success && outcome.mutationDomain);
  if (failedMutation) return failedMutation.output || EMPTY_RESPONSE_ERROR_TEXT;
  const successfulResult = [...userVisibleOutcomes]
    .reverse()
    .find((outcome) => outcome.success);
  return successfulResult?.output || EMPTY_RESPONSE_ERROR_TEXT;
}

function toolErrorCode(output: string): string | null {
  return /^Error \[([A-Z_]+)\]:/.exec(output)?.[1] ?? null;
}

function buildAssistantExecutionMetadata(
  outcomes: readonly ChatToolOutcome[],
  planningTurn: boolean,
  modelName: string,
  turnDomains: readonly ChatToolCategorySlug[]
): Record<string, unknown> {
  const assistantExecution: AssistantExecutionContext = {
    modelPurpose: planningTurn ? 'training_planner' : 'chat',
    turnDomains: [...turnDomains],
  };
  return {
    ...assistantExecution,
    modelName,
    toolAudit: outcomes.map((outcome) => ({
      toolName: outcome.name,
      action: outcome.action,
      success: outcome.success,
      mutationDomain: outcome.mutationDomain,
      errorCode: toolErrorCode(outcome.output),
    })),
    // assistant-ui preserves application metadata only beneath `custom`.
    // Keep this minimal copy so the next live web turn receives the same
    // structured continuation state as a reloaded web or Telegram turn.
    custom: { assistantExecution },
  };
}

function assistantClaimsTrainingMutation(text: string): boolean {
  const negative =
    /\b(?:nicht|kein(?:e|en|er|es)?|fehlgeschlagen|konnte[^.!?\n]{0,30}nicht|not|failed|could not|couldn['’]?t)\b/i;
  if (negative.test(text)) return false;
  return /\b(?:ich habe|wurde|ist jetzt|erfolgreich|successfully|i(?:'ve| have))\b[^.!?\n]{0,140}\b(?:erstellt|angelegt|geändert|aendern|angepasst|aktualisiert|gespeichert|eingeplant|aktiviert|hinzugefügt|ueberarbeitet|überarbeitet|created|changed|updated|saved|scheduled|activated|added|modified)\b/i.test(
    text
  );
}

function assistantClaimsVerifiedTrainingState(text: string): boolean {
  return /\b(?:plan|workout|training|aufwärms[aä]tze?|warm-?up sets?)\b[^.!?\n]{0,100}\b(?:enthält|enthaelt|hat bereits|ist aktiv|is active|already (?:has|contains)|contains)\b/i.test(
    text
  );
}

function isTrainingManagerOutcome(outcome: ChatToolOutcome): boolean {
  return (
    outcome.name === 'sparky_manage_speediance_workouts' ||
    outcome.name === 'sparky_manage_workout_plans' ||
    outcome.name === 'sparky_schedule_speediance_workout'
  );
}

export function verifiedTrainingPlannerText(
  text: string,
  outcomes: readonly ChatToolOutcome[],
  planningTurn: boolean
): string {
  if (!planningTurn || !text.trim()) return text;
  const managerOutcomes = outcomes.filter(isTrainingManagerOutcome);
  const successfulMutation = managerOutcomes.some(
    (outcome) => outcome.success && outcome.mutationDomain === 'exercise'
  );
  if (assistantClaimsTrainingMutation(text) && !successfulMutation) {
    const failure = [...managerOutcomes]
      .reverse()
      .find((outcome) => !outcome.success && outcome.mutationDomain);
    return (
      failure?.output ||
      'Die Trainingsänderung wurde in diesem Durchlauf nicht durch einen erfolgreichen Schreibvorgang bestätigt. Es wurde deshalb nichts als abgeschlossen gemeldet.'
    );
  }
  const successfulVerification = managerOutcomes.some(
    (outcome) => outcome.success
  );
  if (assistantClaimsVerifiedTrainingState(text) && !successfulVerification) {
    return 'Den aktuellen Trainingszustand konnte ich in diesem Durchlauf nicht verifizieren. Ich melde daher keine Plan- oder Warm-up-Eigenschaft als bestätigt.';
  }
  return text;
}

function actionFromOutcomes(outcomes: readonly ChatToolOutcome[]): string {
  const successful = outcomes.filter((outcome) => outcome.success);
  if (
    successful.some(
      (outcome) =>
        outcome.name === 'sparky_manage_food' &&
        ['log_food', 'log_external_food', 'log_meal'].includes(
          outcome.action ?? ''
        )
    )
  ) {
    return 'food_added';
  }
  if (successful.some((outcome) => outcome.mutationDomain === 'exercise')) {
    return 'exercise_added';
  }
  if (
    successful.some(
      (outcome) =>
        outcome.name === 'sparky_manage_habits' &&
        outcome.action === 'log_habit'
    )
  ) {
    return 'habit_logged';
  }
  if (successful.some((outcome) => outcome.mutationDomain === 'checkin')) {
    return 'measurement_added';
  }
  if (
    successful.some(
      (outcome) =>
        outcome.name === 'sparky_manage_food' &&
        outcome.action === 'food_options'
    )
  ) {
    return 'food_options';
  }
  if (
    successful.some(
      (outcome) =>
        outcome.name === 'sparky_manage_exercise' &&
        outcome.action === 'exercise_options'
    )
  ) {
    return 'exercise_options';
  }
  return 'advice';
}

// Some providers (notably Gemini via MALFORMED_FUNCTION_CALL) end a tool-calling
// turn with finishReason 'error' and an empty completion instead of a thrown
// error, so the stream closes cleanly and clients render nothing. Inject an
// explicit error chunk so the UI surfaces a failure instead of staying silent.
function withVerifiedCompletionGuard(
  stream: ReadableStream<UIMessageChunk>,
  toolOutcomes: readonly ChatToolOutcome[],
  planningTurn: boolean
): ReadableStream<UIMessageChunk> {
  let sawText = false;
  let bufferedText = '';
  const bufferedTextChunks: UIMessageChunk[] = [];
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (planningTurn && chunk.type.startsWith('text-')) {
          bufferedTextChunks.push(chunk);
          if (chunk.type === 'text-delta') {
            bufferedText += chunk.delta;
            if (chunk.delta.trim()) sawText = true;
          }
          return;
        }
        if (chunk.type === 'text-delta' && chunk.delta.trim()) sawText = true;
        if (chunk.type === 'finish') {
          if (planningTurn && sawText) {
            const verified = verifiedTrainingPlannerText(
              bufferedText,
              toolOutcomes,
              true
            );
            if (verified === bufferedText) {
              for (const textChunk of bufferedTextChunks) {
                controller.enqueue(textChunk);
              }
            } else {
              const id = `verified-planner-result-${Date.now()}`;
              controller.enqueue({ type: 'text-start', id });
              controller.enqueue({ type: 'text-delta', id, delta: verified });
              controller.enqueue({ type: 'text-end', id });
            }
          }
          if (sawText) {
            controller.enqueue(chunk);
            return;
          }
          if (
            toolOutcomes.some((outcome) => outcome.name === ASK_USER_TOOL_NAME)
          ) {
            controller.enqueue(chunk);
            return;
          }
          const fallback = fallbackFromToolOutcomes(toolOutcomes);
          if (
            toolOutcomes.length > 0 &&
            fallback !== EMPTY_RESPONSE_ERROR_TEXT
          ) {
            const id = `verified-tool-result-${Date.now()}`;
            controller.enqueue({ type: 'text-start', id });
            controller.enqueue({ type: 'text-delta', id, delta: fallback });
            controller.enqueue({ type: 'text-end', id });
            sawText = true;
          } else {
            controller.enqueue({
              type: 'error',
              errorText: EMPTY_RESPONSE_ERROR_TEXT,
            });
          }
        }
        controller.enqueue(chunk);
      },
    })
  );
}

// Shape provider usage into the keys @assistant-ui/react-ai-sdk's
// getThreadMessageTokenUsage reads off the streamed message metadata, so the
// chat UI can surface per-message token counts. cacheReadTokens is the
// cached-input figure; the adapter's normalizeUsage drops undefined fields, so
// providers reporting partial or no usage stay safe.
//
// Nest under `custom`: assistant-ui's fromThreadMessageLike normalization keeps
// only known metadata keys (`custom`, `steps`, `unstable_*`, ...) and discards
// unknown top-level keys, so a bare `{ usage }` would be stripped before it
// reaches the thread message. `metadata.custom.usage` survives, and the adapter
// reads exactly that path.
export function mapUsageToMetadata(
  u: LanguageModelUsage,
  assistantExecution?: AssistantExecutionContext | null
) {
  return {
    custom: {
      usage: {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.totalTokens,
        cachedInputTokens: u.inputTokenDetails?.cacheReadTokens,
      },
      ...(assistantExecution && { assistantExecution }),
    },
  };
}

async function processChatMessageStream(
  messages: ChatMessage[],
  serviceConfigId: string,
  userId: string,
  authenticatedUserId: string,
  actorIsAdmin = false,
  toolCategories?: readonly string[]
) {
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid messages format.');
    }
    if (!serviceConfigId) {
      throw new Error('AI service configuration ID is missing.');
    }
    const aiService = await chatRepository.getAiServiceSettingForBackend(
      serviceConfigId,
      userId
    );
    if (!aiService) {
      throw new Error('AI service setting not found for the provided ID.');
    }

    const {
      planningTurn,
      modelName,
      modelInstance,
      categoriesAreManual,
      activeCategories,
    } = await resolveChatTurnRuntime(
      messages,
      aiService,
      authenticatedUserId,
      actorIsAdmin,
      toolCategories
    );

    log(
      'info',
      `Streaming chat message with service: ${aiService.service_type}, model: ${modelName}`
    );

    const {
      systemPromptContent,
      tools,
      activeToolNames,
      prepareStep,
      toolProfile,
      selectedCategories,
    } = await prepareChatContext(
      authenticatedUserId,
      aiService.service_type,
      aiService.chat_tool_profile,
      activeCategories,
      categoriesAreManual,
      aiService.system_prompt,
      !latestUserAnsweredQuickReply(messages),
      toolCategories
    );
    const chatToolMetadata = buildChatToolConfigurationMetadata(
      serviceConfigId,
      toolProfile,
      toolCategories
    );

    const chatProviderOptions = buildChatProviderOptions(
      aiService.service_type,
      authenticatedUserId,
      modelName
    );
    const effectiveSystemPrompt = planningTurn
      ? `${systemPromptContent}\n${TRAINING_PLANNER_SYSTEM_PROMPT}`
      : systemPromptContent;

    // Map client messages to CoreMessage format, then apply the shared
    // context-window controls (image strip, token budget, user-first).
    const conversationMessages = toCoreMessages(messages);
    const llmMessages = await prependPersistentCoachContext(
      authenticatedUserId,
      buildLlmWindow(conversationMessages, toolProfile)
    );

    log(
      'debug',
      `[DEBUG] AI Transmission: Preparing ${llmMessages.length} messages. Last message content structure: ${JSON.stringify(llmMessages[llmMessages.length - 1]?.content || '').substring(0, 200)}`
    );

    const { content: userMessageContent } = describeUserMessage(
      llmMessages[llmMessages.length - 1]
    );

    const executedToolsList: ExecutedToolCall[] = [];
    const toolOutcomes: ChatToolOutcome[] = [];
    const result = streamText({
      model: modelInstance,
      system: effectiveSystemPrompt,
      messages: llmMessages as NonNullable<
        Parameters<typeof streamText>[0]['messages']
      >,
      tools,
      // Narrows the published/sent tool schemas to this turn's classified
      // categories; sparky_enable_tools lets the model escalate mid-request
      // via prepareStep if it turns out to need a dormant category.
      activeTools: activeToolNames,
      prepareStep,
      providerOptions: chatProviderOptions,
      // Low temperature only for small local models (core profile); cloud and
      // full-profile Ollama keep provider defaults.
      ...(toolProfile === 'core' && {
        temperature: CORE_PROFILE_CHAT_TEMPERATURE,
      }),
      // Tighter retry ceiling for cache-less core-profile backends, where every
      // retry re-processes the full prefix.
      stopWhen: buildChatStopConditions(toolProfile),
      maxRetries:
        toolProfile === 'core'
          ? CORE_PROFILE_MAX_PROVIDER_RETRIES
          : MAX_PROVIDER_RETRIES,
      abortSignal: AbortSignal.timeout(CHAT_REQUEST_TIMEOUT_MS),
      onStepFinish({ toolCalls, toolResults }) {
        collectToolOutcomes(
          toolCalls ?? [],
          toolResults ?? [],
          executedToolsList,
          toolOutcomes
        );
        if (toolResults && toolResults.length > 0) {
          const sizes = toolResults
            .map((r) => `${r.toolName}=${String(r.output ?? '').length}c`)
            .join(' ');
          log('info', `[chat] tool result sizes: ${sizes}`);
        }
      },
      onFinish: async ({
        text,
        finishReason,
        usage,
        totalUsage,
        toolCalls,
      }) => {
        const verifiedText = verifiedTrainingPlannerText(
          text.trim() ||
            (toolOutcomes.length > 0
              ? fallbackFromToolOutcomes(toolOutcomes)
              : ''),
          toolOutcomes,
          planningTurn
        );
        const observedUsage = totalUsage ?? usage;
        log(
          'info',
          `[chat] provider=${aiService.service_type} model=${modelName} cacheReadTokens=${observedUsage?.inputTokenDetails?.cacheReadTokens ?? 0} inputTokens=${observedUsage?.inputTokens ?? 0} noCacheTokens=${observedUsage?.inputTokenDetails?.noCacheTokens ?? 0} cacheWriteTokens=${observedUsage?.inputTokenDetails?.cacheWriteTokens ?? 0} outputTokens=${observedUsage?.outputTokens ?? 0} totalTokens=${observedUsage?.totalTokens ?? 0}`
        );

        // Get the last user message from conversationMessages to ensure parts are captured
        const lastUserMessage = [...conversationMessages]
          .reverse()
          .find((msg) => msg.role === 'user');

        const userMessageParts = Array.isArray(lastUserMessage?.content)
          ? lastUserMessage.content
          : [
              {
                type: 'text' as const,
                text: String(lastUserMessage?.content || ''),
              },
            ];

        // Save to DB on completion
        await chatRepository
          .saveChatHistory({
            user_id: userId,
            content: userMessageContent,
            messageType: 'user',
            metadata: chatToolMetadata,
            parts: userMessageParts,
          })
          .catch((err: unknown) =>
            log('error', 'Failed to save user chat history:', err)
          );

        // A turn that ends on a quick-reply call carries the question in the
        // tool call, so it must be persisted too — otherwise the chips (and the
        // question they answer) vanish on reload, and the reloaded transcript
        // reads as if the user answered a question nobody asked.
        const askCall = toolCalls?.find(
          (call) => call.toolName === ASK_USER_TOOL_NAME
        );

        if (!verifiedText && !askCall) {
          log(
            'warn',
            `Skipping empty assistant chat history for user ${userId} (finishReason: ${finishReason})`
          );
          return;
        }

        const assistantParts: Record<string, unknown>[] = [];
        if (verifiedText) {
          assistantParts.push({ type: 'text', text: verifiedText });
        }
        if (askCall) {
          assistantParts.push({
            type: ASK_USER_PART_TYPE,
            toolCallId: askCall.toolCallId,
            state: 'output-available',
            input: askCall.input,
            output: '',
          });
        }

        await chatRepository
          .saveChatHistory({
            user_id: userId,
            // The question is the user-visible content when the model let the
            // chips speak for it.
            content:
              verifiedText ||
              askUserPartToText({
                type: ASK_USER_PART_TYPE,
                input: askCall?.input,
              }) ||
              '',
            messageType: 'assistant',
            metadata: buildAssistantExecutionMetadata(
              toolOutcomes,
              planningTurn,
              modelName,
              selectedCategories
            ),
            parts: assistantParts,
          })
          .catch((err: unknown) =>
            log('error', 'Failed to save assistant chat history:', err)
          );

        for (const domain of successfulMutationDomains(toolOutcomes)) {
          coachEventService.publish(authenticatedUserId, domain);
        }
      },
    });

    return {
      stream: withVerifiedCompletionGuard(
        result.toUIMessageStream({
          messageMetadata: ({ part }) =>
            part.type === 'finish'
              ? mapUsageToMetadata(
                  part.totalUsage,
                  assistantExecutionContext(
                    buildAssistantExecutionMetadata(
                      toolOutcomes,
                      planningTurn,
                      modelName,
                      selectedCategories
                    )
                  )
                )
              : undefined,
        }),
        toolOutcomes,
        planningTurn
      ),
    };
  } catch (error) {
    log(
      'error',
      `Error in processChatMessageStream for user ${userId}:`,
      error
    );
    throw error;
  }
}
export { handleAiServiceSettings };
export { getAiServiceSettings };
export { getActiveAiServiceSetting };
export { getActiveAiServiceSettingForBackend };
export { deleteAiServiceSetting };
export { clearOldChatHistory };
export { getSparkyChatHistory };
export { getSparkyChatHistoryEntry };
export { updateSparkyChatHistoryEntry };
export { deleteSparkyChatHistoryEntry };
export { clearAllSparkyChatHistory };
export { saveSparkyChatHistory };
export { processChatMessage };
export { processFoodOptionsRequest };
export { testAiServiceConnection };
export { processChatMessageStream };
export default {
  handleAiServiceSettings,
  getAiServiceSettings,
  getActiveAiServiceSetting,
  getActiveAiServiceSettingForBackend,
  deleteAiServiceSetting,
  clearOldChatHistory,
  getSparkyChatHistory,
  getSparkyChatHistoryEntry,
  updateSparkyChatHistoryEntry,
  deleteSparkyChatHistoryEntry,
  clearAllSparkyChatHistory,
  saveSparkyChatHistory,
  processChatMessage,
  processFoodOptionsRequest,
  testAiServiceConnection,
  processChatMessageStream,
};
