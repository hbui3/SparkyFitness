import { describe, expect, it } from 'vitest';
import {
  CHAT_TOOL_CATEGORY_SLUGS,
  CORE_CHAT_TOOL_CATEGORY_SLUGS,
} from '@workspace/shared';
import {
  buildChatToolConfigurationMetadata,
  resolveChatToolCategoriesFromHistory,
  resolveEffectiveChatToolProfile,
} from '../services/chatToolConfigurationService.js';

describe('chatToolConfigurationService', () => {
  it('uses core only for self-hosted service types', () => {
    expect(resolveEffectiveChatToolProfile('ollama', 'core')).toBe('core');
    expect(resolveEffectiveChatToolProfile('openai', 'core')).toBe('full');
  });

  it('persists a canonical per-service category selection', () => {
    expect(
      buildChatToolConfigurationMetadata('ai-1', 'full', [
        'coaching',
        'reports',
        'coaching',
      ])
    ).toEqual({
      chatToolConfiguration: {
        version: 1,
        serviceConfigId: 'ai-1',
        toolCategories: ['reports', 'coaching'],
      },
    });
  });

  it('restores the latest selection for the same AI service', () => {
    const history = [
      {
        message_type: 'user',
        metadata: {
          chatToolConfiguration: {
            version: 1,
            serviceConfigId: 'ai-1',
            toolCategories: ['exercise'],
          },
        },
      },
      {
        message_type: 'user',
        metadata: {
          chatToolConfiguration: {
            version: 1,
            serviceConfigId: 'ai-2',
            toolCategories: ['food'],
          },
        },
      },
    ];

    expect(
      resolveChatToolCategoriesFromHistory(history, 'ai-1', 'openai', 'full')
    ).toEqual(['exercise']);
  });

  it('falls back to the same Full/Core defaults shown by web chat', () => {
    expect(
      resolveChatToolCategoriesFromHistory([], 'ai-1', 'openai', 'core')
    ).toEqual([...CHAT_TOOL_CATEGORY_SLUGS]);
    expect(
      resolveChatToolCategoriesFromHistory([], 'ai-1', 'ollama', 'core')
    ).toEqual([...CORE_CHAT_TOOL_CATEGORY_SLUGS]);
  });
});
