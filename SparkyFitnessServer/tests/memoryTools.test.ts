import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMemoryTools } from '../ai/tools/memoryTools.js';
import coachMemoryService from '../services/coachMemoryService.js';
import coachProfileService from '../services/coachProfileService.js';

vi.mock('../services/coachMemoryService.js', () => ({
  default: {
    listMemories: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
  },
}));

vi.mock('../services/coachProfileService.js', () => ({
  default: { getCoachProfile: vi.fn() },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const toolOptions = { toolCallId: 'memory-call-1', messages: [] };
const savedMemory = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'routine' as const,
  content: 'Strength training is Tuesday and Thursday evening.',
  source: 'coach' as const,
  active: true,
  pinned: false,
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-19T10:00:00.000Z',
};

describe('sparky_manage_coach_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      enabled: true,
      memoryEnabled: true,
      autoMemoryEnabled: false,
    } as Awaited<ReturnType<typeof coachProfileService.getCoachProfile>>);
    vi.mocked(coachMemoryService.createMemory).mockResolvedValue(savedMemory);
  });

  it('requires confirmation before saving an inferred fact when automatic capture is off', async () => {
    const tool = buildMemoryTools('user-1').sparky_manage_coach_memory;

    const result = await tool.execute!(
      {
        action: 'remember',
        category: 'routine',
        content: savedMemory.content,
        pinned: false,
        user_confirmed: false,
      },
      toolOptions
    );

    expect(result).toContain('Automatic memory is disabled');
    expect(coachMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it('stores a stable fact without another prompt when automatic capture is on', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      enabled: true,
      memoryEnabled: true,
      autoMemoryEnabled: true,
    } as Awaited<ReturnType<typeof coachProfileService.getCoachProfile>>);
    const tool = buildMemoryTools('user-1').sparky_manage_coach_memory;

    const result = await tool.execute!(
      {
        action: 'remember',
        category: 'routine',
        content: savedMemory.content,
        pinned: false,
        user_confirmed: false,
      },
      toolOptions
    );

    expect(coachMemoryService.createMemory).toHaveBeenCalledWith(
      'user-1',
      {
        category: 'routine',
        content: savedMemory.content,
        pinned: false,
      },
      'coach'
    );
    expect(result).toContain('Remembered [routine]');
  });
});
