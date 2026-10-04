import { z } from 'zod';

export const recordSchema = z.object({
  id: z.string(),
  source: z.string(),
  activity: z.number(),
  unit: z.string(),
  factor: z.number(),
  factorUnit: z.string(),
  timeRange: z.string(),
  evidenceCount: z.number(),
  anomaly: z.number(),
  owner: z.string(),
  status: z.enum(['待核验', '复核中', '已核验', '需补证']),
  revision: z.number()
});

export const findingSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  type: z.enum(['缺失证据', '单位不一致', '时间范围', '异常波动']),
  title: z.string(),
  detail: z.string(),
  assignee: z.string(),
  due: z.string(),
  status: z.enum(['开放', '补证中', '已关闭']),
  revision: z.number()
});

export const evidenceResponseSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    methodology: z.string(),
    vintage: z.string(),
    verifier: z.string()
  }),
  summary: z.object({
    period: z.string(),
    reduction: z.number(),
    evidenceRate: z.number(),
    openFindings: z.number(),
    sampled: z.number()
  }),
  records: z.array(recordSchema),
  findings: z.array(findingSchema),
  issuanceChecks: z.record(z.boolean()),
  serverRevision: z.number(),
  serverTime: z.string()
});

export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;

export const queueSubmitSchema = z.object({
  key: z.string(),
  type: z.enum(['revision', 'record_status', 'verify', 'finding_request', 'finding_close', 'issuance_check']),
  entityId: z.string(),
  baseRevision: z.number(),
  payload: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  actor: z.string()
});

export type QueueSubmit = z.infer<typeof queueSubmitSchema>;

export const queueResultSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean().optional(),
  revision: z.number().optional(),
  recordedAt: z.string(),
  serverRevision: z.number()
});

export const conflictSchema = z.object({
  conflict: z.literal(true),
  reason: z.literal('revision_mismatch'),
  serverRevision: z.number(),
  serverEntity: z.record(z.unknown()),
  serverTime: z.string()
});

export const simulateResultSchema = z.object({
  entity: recordSchema,
  serverRevision: z.number()
});
