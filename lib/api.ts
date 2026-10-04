import ky, { HTTPError } from 'ky';
import {
  conflictSchema,
  evidenceResponseSchema,
  queueResultSchema,
  simulateResultSchema,
  type EvidenceResponse,
  type QueueSubmit
} from './schema';

// 补交由本地队列驱动，ky 不自动重试（重试会由队列带着幂等键续作）
const client = ky.create({ timeout: 10_000, retry: { limit: 0 } });

export class ConflictError extends Error {
  constructor(
    public serverRevision: number,
    public serverEntity: Record<string, unknown>,
    public serverTime: string
  ) {
    super('revision_mismatch');
  }
}

export async function fetchEvidence(): Promise<EvidenceResponse> {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

export async function submitQueueItem(input: QueueSubmit) {
  try {
    const payload = await client.post('/api/evidence', { json: input }).json<unknown>();
    return queueResultSchema.parse(payload);
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 409) {
      const data = conflictSchema.parse(await error.response.json());
      throw new ConflictError(data.serverRevision, data.serverEntity, data.serverTime);
    }
    throw error;
  }
}

export async function simulateServerChange(recordId: string) {
  const payload = await client.post('/api/evidence/simulate', { json: { recordId } }).json<unknown>();
  return simulateResultSchema.parse(payload);
}
