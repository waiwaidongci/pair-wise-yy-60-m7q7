import ky, { HTTPError } from 'ky';
import { evidenceResponseSchema } from './schema';
import type { SubmitOk, SubmitPayload, ConflictPayload } from './sync';

const client = ky.create({ timeout: 10_000, retry: { limit: 0 } });

export async function fetchEvidence() {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

export async function resetServer() {
  return client.post('/api/evidence', { json: { action: 'reset' } }).json<{ reset: boolean }>();
}

export async function advanceServerVersion(recordId: string) {
  return client.post('/api/evidence', { json: { action: 'advanceRevision', recordId } }).json<{ revision: number }>();
}

// 补交单条出箱操作。成功返回 confirmed / duplicate；版本冲突抛出带 conflict 的错误。
export async function submitOutboxOp(payload: SubmitPayload): Promise<SubmitOk> {
  try {
    return await client.post('/api/evidence', { json: payload }).json<SubmitOk>();
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 409) {
      const body = await error.response.json<ConflictPayload>();
      const conflictError = new Error('版本冲突') as Error & { conflictResponse?: ConflictPayload };
      conflictError.conflictResponse = body;
      throw conflictError;
    }
    throw error;
  }
}
