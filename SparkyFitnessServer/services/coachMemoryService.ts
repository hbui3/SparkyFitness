import type {
  CoachMemory,
  CoachMemoryResponse,
  CreateCoachMemoryRequest,
  UpdateCoachMemoryRequest,
} from '@workspace/shared';
import coachMemoryRepository from '../models/coachMemoryRepository.js';

function toResponse(memory: CoachMemory): CoachMemoryResponse {
  return {
    id: memory.id,
    category: memory.category,
    content: memory.content,
    source: memory.source,
    active: memory.active,
    pinned: memory.pinned,
    createdAt: memory.created_at.toISOString(),
    updatedAt: memory.updated_at.toISOString(),
  };
}

async function listMemories(userId: string): Promise<CoachMemoryResponse[]> {
  return (await coachMemoryRepository.listMemories(userId)).map(toResponse);
}

async function listActiveMemories(
  userId: string
): Promise<CoachMemoryResponse[]> {
  return (await coachMemoryRepository.listMemories(userId, true)).map(
    toResponse
  );
}

async function createMemory(
  userId: string,
  input: CreateCoachMemoryRequest,
  source: 'user' | 'coach' = 'user'
): Promise<CoachMemoryResponse> {
  const existing = await coachMemoryRepository.findActiveDuplicate(
    userId,
    input.category,
    input.content
  );
  if (existing) return toResponse(existing);
  return toResponse(
    await coachMemoryRepository.createMemory(userId, input, source)
  );
}

async function updateMemory(
  userId: string,
  memoryId: string,
  input: UpdateCoachMemoryRequest
): Promise<CoachMemoryResponse | null> {
  const updated = await coachMemoryRepository.updateMemory(
    userId,
    memoryId,
    input
  );
  return updated ? toResponse(updated) : null;
}

async function deleteMemory(
  userId: string,
  memoryId: string
): Promise<boolean> {
  return coachMemoryRepository.deleteMemory(userId, memoryId);
}

export default {
  listMemories,
  listActiveMemories,
  createMemory,
  updateMemory,
  deleteMemory,
};
