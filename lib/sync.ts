// 断网出箱队列与可续作对账的共享类型 / 元数据

export type SyncState =
  | 'clean'        // 无待处理事项，与服务端一致
  | 'local'        // 已留本机，等待补交
  | 'submitting'   // 正在补交
  | 'confirmed'    // 服务端已确认（同批结果）
  | 'conflict'     // 服务端有新版本，等待核验员处理
  | 'failed';      // 上次补交失败，等待重试

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';

export type RevisionConflictSnapshot = {
  kind: 'revision';
  localValue: number;
  serverValue: number;
  localReason: string;
  serverReason: string;
  baseRevision: number;
  localRevision: number;
  serverRevision: number;
  serverEditor: string;
};

export type FindingConflictSnapshot = {
  kind: 'finding';
  localStatus: '开放' | '补证中' | '已关闭';
  serverStatus: '开放' | '补证中' | '已关闭';
  localNote: string;
  serverNote: string;
  baseRevision: number;
  localRev: number;
  serverRev: number;
  serverEditor: string;
};

export type ConflictSnapshot = RevisionConflictSnapshot | FindingConflictSnapshot;

export type CarbonRecord = {
  id: string;
  source: string;
  activity: number;
  unit: string;
  factor: number;
  factorUnit: string;
  timeRange: string;
  evidenceCount: number;
  anomaly: number;
  owner: string;
  status: RecordStatus;
  revision: number;
  // 对账字段
  serverRevision?: number;
  serverActivity?: number;
  serverReason?: string;
  serverEditor?: string;
  pendingOpId?: string;
  syncState: SyncState;
  confirmedBatch?: string;
  conflict?: RevisionConflictSnapshot;
};

export type Finding = {
  id: string;
  recordId: string;
  type: '缺失证据' | '单位不一致' | '时间范围' | '异常波动';
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: '开放' | '补证中' | '已关闭';
  notes: string;
  // 对账字段
  serverStatus?: '开放' | '补证中' | '已关闭';
  serverRev?: number;
  serverNote?: string;
  serverEditor?: string;
  rev: number;
  pendingOpId?: string;
  syncState: SyncState;
  confirmedBatch?: string;
  conflict?: FindingConflictSnapshot;
};

export type OutboxKind = 'revision' | 'findingSupplement' | 'findingClose';

export type OutboxOp = {
  id: string;
  batchId: string;
  kind: OutboxKind;
  targetId: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  // revision
  value?: number;
  reason?: string;
  // 补交依据的本机/服务端基线版本（用于冲突检测与重复补交幂等）
  baseRevision?: number;
  // findingSupplement
  note?: string;
  // findingClose
  closeTo?: '已关闭';
  status: 'queued' | 'inflight' | 'confirmed' | 'conflict' | 'duplicate' | 'failed';
  serverRevision?: number;
  confirmedAt?: string;
  resolution?: 'server' | 'reapply';
  resolutionNote?: string;
};

export type SubmitPayload = {
  opId: string;
  batchId: string;
  kind: OutboxKind;
  targetId: string;
  actor: string;
  value?: number;
  reason?: string;
  baseRevision?: number;
  note?: string;
  closeTo?: '已关闭';
};

export type SubmitOk = {
  outcome: 'confirmed' | 'duplicate';
  serverRevision: number;
  status?: '开放' | '补证中' | '已关闭';
  value?: number;
  reason?: string;
  note?: string;
  editor: string;
  recordedAt: string;
};

export type ConflictPayload = {
  outcome: 'conflict';
  conflict: ConflictSnapshot;
  serverRevision: number;
};

export const SYNC_META: Record<SyncState, { label: string; color: '#166b55' | '#b4642f' | '#8a6d1d' | '#9a3b2c' | '#1565c0' | '#667a73'; bgcolor: string }> = {
  clean: { label: '与服务端一致', color: '#667a73', bgcolor: '#eef1f0' },
  local: { label: '本机暂存', color: '#8a6d1d', bgcolor: '#fbf3dc' },
  submitting: { label: '补交中', color: '#1565c0', bgcolor: '#e5f0fb' },
  confirmed: { label: '已确认', color: '#166b55', bgcolor: '#e4f1ec' },
  conflict: { label: '版本冲突', color: '#9a3b2c', bgcolor: '#f9e7e2' },
  failed: { label: '补交失败', color: '#b4642f', bgcolor: '#fbece3' }
};

export const OUTBOX_STATUS_META: Record<OutboxOp['status'], { label: string; color: string; bgcolor: string }> = {
  queued: { label: '待补交', color: '#8a6d1d', bgcolor: '#fbf3dc' },
  inflight: { label: '补交中', color: '#1565c0', bgcolor: '#e5f0fb' },
  confirmed: { label: '已确认', color: '#166b55', bgcolor: '#e4f1ec' },
  conflict: { label: '冲突待处理', color: '#9a3b2c', bgcolor: '#f9e7e2' },
  duplicate: { label: '重复已合并', color: '#667a73', bgcolor: '#eef1f0' },
  failed: { label: '补交失败', color: '#b4642f', bgcolor: '#fbece3' }
};

export const ACTIVE_STATUSES = ['queued', 'inflight', 'failed'] as const;
export const OPEN_FINDING_STATUSES = ['开放', '补证中'] as const;

export function isActive(status: OutboxOp['status']) {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isOpenFinding(status: Finding['status']) {
  return (OPEN_FINDING_STATUSES as readonly string[]).includes(status);
}

export function makeOpId() {
  return `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export function makeBatchId() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `B${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export const OP_KIND_LABEL: Record<OutboxKind, string> = {
  revision: '数据修订',
  findingSupplement: '发现项补录',
  findingClose: '关闭发现项'
};

// 出箱顺序：同目标按创建时间，整体按创建时间补交
export function orderedOutbox(ops: OutboxOp[]) {
  return [...ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function reconciliationBlocked(records: CarbonRecord[], findings: Finding[], outbox: OutboxOp[]) {
  const active = outbox.filter((op) => isActive(op.status) || op.status === 'conflict');
  return {
    hasActive: outbox.some((op) => isActive(op.status)),
    hasConflict: records.some((r) => r.syncState === 'conflict') || findings.some((f) => f.syncState === 'conflict'),
    activeOps: active,
    conflictingRecords: records.filter((r) => r.syncState === 'conflict'),
    conflictingFindings: findings.filter((f) => f.syncState === 'conflict'),
    openFindings: findings.filter((f) => isOpenFinding(f.status))
  };
}
