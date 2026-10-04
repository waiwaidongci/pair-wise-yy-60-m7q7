import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { submitOutboxOp } from './api';
import {
  isActive,
  isOpenFinding,
  makeBatchId,
  makeOpId,
  orderedOutbox,
  type CarbonRecord,
  type ConflictSnapshot,
  type Finding,
  type FindingConflictSnapshot,
  type OutboxKind,
  type OutboxOp,
  type RevisionConflictSnapshot,
  type SyncState
} from './sync';
import type { EvidenceResponse } from './schema';

const ACTOR = '沈楠';

function createInitialRecords(): CarbonRecord[] {
  return [
    { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3, serverRevision: 3, serverActivity: 428650, syncState: 'clean' },
    { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2, serverRevision: 2, serverActivity: 2038.4, syncState: 'clean' },
    { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4, serverRevision: 4, serverActivity: 1846, syncState: 'clean' },
    { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1, serverRevision: 1, serverActivity: 182460, syncState: 'clean' },
    { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1, serverRevision: 1, serverActivity: 62.8, syncState: 'clean' }
  ];
}

function createInitialFindings(): Finding[] {
  return [
    { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', notes: '', rev: 1, serverStatus: '开放', serverRev: 1, serverNote: '', syncState: 'clean' },
    { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', notes: '', rev: 1, serverStatus: '补证中', serverRev: 1, serverNote: '', syncState: 'clean' },
    { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', notes: '', rev: 1, serverStatus: '开放', serverRev: 1, serverNote: '', syncState: 'clean' }
  ];
}

type PendingRef = { opId?: string; conflict?: ConflictSnapshot };

function stateFromPending(op: OutboxOp | undefined, hasConflict: boolean): SyncState {
  if (hasConflict) return 'conflict';
  if (!op) return 'clean';
  if (op.status === 'inflight') return 'submitting';
  if (op.status === 'failed') return 'failed';
  if (op.status === 'queued') return 'local';
  if (op.status === 'confirmed' || op.status === 'duplicate') return 'confirmed';
  return 'clean';
}

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  outbox: OutboxOp[];
  currentBatch: string | null;
  simulatedOffline: boolean;
  failNextSubmit: boolean;
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, boolean>;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  toggleIssuanceCheck: (id: string) => void;
  setSimulatedOffline: (value: boolean) => void;
  setFailNextSubmit: (value: boolean) => void;
  enqueueRevision: (id: string, value: number, reason: string) => void;
  enqueueFindingSupplement: (findingId: string, note: string) => void;
  closeFinding: (findingId: string) => void;
  flushQueue: () => Promise<void>;
  reconcileFromServer: (data: EvidenceResponse) => void;
  resolveConflict: (opId: string, resolution: 'server' | 'reapply', note: string) => void;
  dismissBatch: (batchId: string) => void;
  resetAll: () => void;
};

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => {
      let flushing = false;

      const isOnline = () => {
        const { simulatedOffline } = get();
        if (simulatedOffline) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        return true;
      };

      // 同一批：当前批次仍有未完结操作（含冲突、失败）就归入，否则开新批
      const nextBatchId = () => {
        const { outbox, currentBatch } = get();
        const batchOpen = currentBatch && outbox.some((op) => op.batchId === currentBatch &&
          ['queued', 'inflight', 'failed', 'conflict'].includes(op.status));
        if (batchOpen) return currentBatch as string;
        return makeBatchId();
      };

      const recalcRecord = (record: CarbonRecord, outbox: OutboxOp[]): CarbonRecord => {
        const op = record.pendingOpId ? outbox.find((item) => item.id === record.pendingOpId) : undefined;
        const syncState = stateFromPending(op, Boolean(record.conflict));
        return { ...record, syncState };
      };

      const recalcFinding = (finding: Finding, outbox: OutboxOp[]): Finding => {
        const op = finding.pendingOpId ? outbox.find((item) => item.id === finding.pendingOpId) : undefined;
        const syncState = stateFromPending(op, Boolean(finding.conflict));
        return { ...finding, syncState };
      };

      const recalcAll = (partial: Partial<State>): Partial<State> => {
        const outbox = partial.outbox ?? get().outbox;
        const records = (partial.records ?? get().records).map((r) => recalcRecord(r, outbox));
        const findings = (partial.findings ?? get().findings).map((f) => recalcFinding(f, outbox));
        return { ...partial, records, findings };
      };

      const enqueue = (kind: OutboxKind, targetId: string, extra: Partial<OutboxOp>) => {
        const batchId = nextBatchId();
        const op: OutboxOp = {
          id: makeOpId(),
          batchId,
          kind,
          targetId,
          createdAt: new Date().toISOString(),
          attempts: 0,
          status: 'queued',
          ...extra
        };
        set(recalcAll({ outbox: [...get().outbox, op], currentBatch: batchId }));
        return op;
      };

      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      // 从最早一条未完结操作开始按序补交；失败即停，已确认的不会重复提交
      const flushQueue = async () => {
        if (flushing) return;
        flushing = true;
        try {
          while (isOnline()) {
            const next = orderedOutbox(get().outbox).find((op) => isActive(op.status));
            if (!next) break;
            set(recalcAll({ outbox: get().outbox.map((op) => op.id === next.id ? { ...op, status: 'inflight', lastError: undefined } : op) }));
            await wait(450);
            if (!isOnline()) {
              // 补交途中断网：本条退回待补交，其余顺序不变
              set(recalcAll({ outbox: get().outbox.map((op) => op.id === next.id ? { ...op, status: 'queued' } : op) }));
              break;
            }
            if (get().failNextSubmit) {
              set({ failNextSubmit: false });
              set(recalcAll({ outbox: get().outbox.map((op) => op.id === next.id ? { ...op, status: 'failed', attempts: op.attempts + 1, lastError: '网络故障，服务端未确认；恢复后从该条继续，已确认记录不重交' } : op) }));
              break;
            }
            try {
              const result = await submitOutboxOp({
                opId: next.id,
                batchId: next.batchId,
                kind: next.kind,
                targetId: next.targetId,
                actor: ACTOR,
                value: next.value,
                reason: next.reason,
                baseRevision: next.baseRevision,
                note: next.note,
                closeTo: next.closeTo
              });
              applyOutcome(next.id, result.outcome, result);
            } catch (error) {
              const conflictResponse = (error as { conflictResponse?: { outcome: 'conflict'; conflict: ConflictSnapshot; serverRevision: number } }).conflictResponse;
              if (conflictResponse) {
                applyConflict(next.id, conflictResponse);
                break; // 冲突发现项继续挡住，核验员处理后才继续
              }
              set(recalcAll({ outbox: get().outbox.map((op) => op.id === next.id ? { ...op, status: 'failed', attempts: op.attempts + 1, lastError: error instanceof Error ? error.message : '补交失败' } : op) }));
              break;
            }
          }
        } finally {
          flushing = false;
        }
      };

      const applyOutcome = (opId: string, outcome: 'confirmed' | 'duplicate', result: {
        serverRevision: number;
        status?: '开放' | '补证中' | '已关闭';
        value?: number;
        reason?: string;
        note?: string;
        editor: string;
        recordedAt: string;
      }) => {
        const op = get().outbox.find((item) => item.id === opId);
        if (!op) return;
        let records = get().records;
        let findings = get().findings;
        if (op.kind === 'revision') {
          records = records.map((record) => record.id === op.targetId ? {
            ...record,
            activity: result.value ?? op.value ?? record.activity,
            revision: result.serverRevision,
            serverRevision: result.serverRevision,
            serverActivity: result.value ?? op.value ?? record.activity,
            serverReason: result.reason ?? op.reason,
            serverEditor: result.editor,
            conflict: undefined,
            pendingOpId: op.id
          } : record);
        } else {
          findings = findings.map((finding) => finding.id === op.targetId ? {
            ...finding,
            status: result.status ?? (op.kind === 'findingClose' ? '已关闭' : '补证中'),
            rev: result.serverRevision,
            serverStatus: result.status ?? (op.kind === 'findingClose' ? '已关闭' : '补证中'),
            serverRev: result.serverRevision,
            serverNote: result.note ?? finding.serverNote,
            serverEditor: result.editor,
            conflict: undefined,
            pendingOpId: op.id
          } : finding);
        }
        const outbox = get().outbox.map((item) => item.id === opId ? {
          ...item,
          status: outcome,
          serverRevision: result.serverRevision,
          confirmedAt: result.recordedAt,
          lastError: undefined
        } : item);
        records = records.map((r) => r.id === op.targetId ? { ...r, confirmedBatch: op.batchId, syncState: 'confirmed' as SyncState } : r);
        findings = findings.map((f) => f.id === op.targetId ? { ...f, confirmedBatch: op.batchId, syncState: 'confirmed' as SyncState } : f);
        set({ records, findings, outbox });
      };

      const applyConflict = (opId: string, body: { conflict: ConflictSnapshot; serverRevision: number }) => {
        const op = get().outbox.find((item) => item.id === opId);
        if (!op) return;
        let records = get().records;
        let findings = get().findings;
        if (body.conflict.kind === 'revision') {
          const snapshot = body.conflict as RevisionConflictSnapshot;
          records = records.map((record) => record.id === op.targetId ? {
            ...record,
            serverRevision: body.serverRevision,
            serverActivity: snapshot.serverValue,
            serverReason: snapshot.serverReason,
            serverEditor: snapshot.serverEditor,
            conflict: snapshot,
            pendingOpId: op.id
          } : record);
        } else {
          const snapshot = body.conflict as FindingConflictSnapshot;
          findings = findings.map((finding) => finding.id === op.targetId ? {
            ...finding,
            serverStatus: snapshot.serverStatus,
            serverRev: body.serverRevision,
            serverNote: snapshot.serverNote,
            serverEditor: snapshot.serverEditor,
            conflict: snapshot,
            pendingOpId: op.id
          } : finding);
        }
        const outbox = get().outbox.map((item) => item.id === opId ? { ...item, status: 'conflict' as const, serverRevision: body.serverRevision } : item);
        set(recalcAll({ records, findings, outbox }));
      };

      // GET 回来的服务端版本对账：无在途修订就采用；有在途修订且服务端已推进则转冲突，不允许旧值盖回
      const reconcileFromServer = (data: EvidenceResponse) => {
        const state = get();
        let records = state.records;
        let findings = state.findings;
        for (const server of data.records) {
          records = records.map((record) => {
            if (record.id !== server.id) return record;
            const op = record.pendingOpId ? state.outbox.find((item) => item.id === record.pendingOpId && item.kind === 'revision') : undefined;
            const base = { ...record, serverRevision: server.revision, serverActivity: server.activity, serverReason: server.lastReason, serverEditor: server.lastEditor };
            if (op && ['queued', 'inflight', 'failed'].includes(op.status)) {
              if (server.revision > (op.baseRevision ?? 0)) {
                const snapshot: RevisionConflictSnapshot = {
                  kind: 'revision',
                  localValue: op.value ?? record.activity,
                  serverValue: server.activity,
                  localReason: op.reason ?? '',
                  serverReason: server.lastReason ?? '',
                  baseRevision: op.baseRevision ?? server.revision,
                  localRevision: record.revision,
                  serverRevision: server.revision,
                  serverEditor: server.lastEditor ?? '服务端'
                };
                return { ...base, conflict: snapshot };
              }
              return base;
            }
            if (record.conflict) return base;
            const adopted = { ...base, activity: server.activity, revision: server.revision, conflict: undefined };
            if (record.syncState === 'confirmed') return adopted;
            return { ...adopted, pendingOpId: undefined };
          });
        }
        for (const server of data.findings) {
          findings = findings.map((finding) => {
            if (finding.id !== server.id) return finding;
            const op = finding.pendingOpId ? state.outbox.find((item) => item.id === finding.pendingOpId && item.kind !== 'revision') : undefined;
            const base = { ...finding, serverStatus: server.status, serverRev: server.rev, serverNote: server.lastNote ?? '', serverEditor: undefined };
            if (op && ['queued', 'inflight', 'failed'].includes(op.status)) {
              if (server.rev > (op.baseRevision ?? 0)) {
                const snapshot: FindingConflictSnapshot = {
                  kind: 'finding',
                  localStatus: finding.status,
                  serverStatus: server.status,
                  localNote: op.note ?? '',
                  serverNote: server.lastNote ?? '',
                  baseRevision: op.baseRevision ?? server.rev,
                  localRev: finding.rev,
                  serverRev: server.rev,
                  serverEditor: '服务端'
                };
                return { ...base, conflict: snapshot };
              }
              return base;
            }
            if (finding.conflict) return base;
            const adopted = { ...base, status: server.status, rev: server.rev, conflict: undefined };
            if (finding.syncState === 'confirmed') return adopted;
            return { ...adopted, pendingOpId: undefined };
          });
        }
        // GET 发现的版本冲突同样把出箱操作置为冲突，等待核验员处理（不再反复补交）
        const conflictOpIds = new Set<string>();
        for (const record of records) if (record.conflict && record.pendingOpId) conflictOpIds.add(record.pendingOpId);
        for (const finding of findings) if (finding.conflict && finding.pendingOpId) conflictOpIds.add(finding.pendingOpId);
        const outbox = conflictOpIds.size
          ? state.outbox.map((op) => conflictOpIds.has(op.id) && op.status !== 'conflict'
            ? { ...op, status: 'conflict' as const }
            : op)
          : state.outbox;
        set(recalcAll({ records, findings, outbox }));
      };

      const resolveConflict = (opId: string, resolution: 'server' | 'reapply', note: string) => {
        const state = get();
        const old = state.outbox.find((op) => op.id === opId);
        if (!old) return;
        let records = state.records;
        let findings = state.findings;
        let outbox = state.outbox;

        if (resolution === 'server') {
          if (old.kind === 'revision') {
            records = records.map((record) => record.id === old.targetId ? {
              ...record,
              activity: record.serverActivity ?? record.activity,
              revision: record.serverRevision ?? record.revision,
              conflict: undefined,
              pendingOpId: undefined
            } : record);
          } else {
            findings = findings.map((finding) => finding.id === old.targetId ? {
              ...finding,
              status: finding.serverStatus ?? finding.status,
              rev: finding.serverRev ?? finding.rev,
              conflict: undefined,
              pendingOpId: undefined
            } : finding);
          }
          outbox = outbox.map((op) => op.id === opId ? { ...op, status: 'confirmed' as const, resolution: 'server' as const, resolutionNote: note, confirmedAt: new Date().toISOString() } : op);
        } else {
          // 以服务端最新版为基线，把本机修订重新入队续交（不生成重复版本）
          const newOp = enqueueLike(old, note);
          if (old.kind === 'revision') {
            records = records.map((record) => record.id === old.targetId ? { ...record, conflict: undefined, pendingOpId: newOp.id } : record);
          } else {
            findings = findings.map((finding) => finding.id === old.targetId ? { ...finding, conflict: undefined, pendingOpId: newOp.id } : finding);
          }
          outbox = get().outbox.map((op) => op.id === opId ? { ...op, status: 'duplicate' as const, resolution: 'reapply' as const, resolutionNote: note } : op);
        }
        set(recalcAll({ records, findings, outbox }));
        if (resolution === 'reapply') void flushQueue();
      };

      // 基于冲突操作构造一条改基后的新操作（沿用同批）
      const enqueueLike = (old: OutboxOp, note: string): OutboxOp => {
        const state = get();
        const baseRevision = old.kind === 'revision'
          ? state.records.find((r) => r.id === old.targetId)?.serverRevision
          : state.findings.find((f) => f.id === old.targetId)?.serverRev;
        const op: OutboxOp = {
          ...old,
          id: makeOpId(),
          createdAt: new Date().toISOString(),
          attempts: 0,
          status: 'queued',
          baseRevision,
          lastError: undefined,
          serverRevision: undefined,
          confirmedAt: undefined,
          resolution: undefined,
          resolutionNote: undefined,
          note: old.kind === 'findingSupplement' && note ? (old.note ? `${old.note}；${note}` : note) : old.note
        };
        set(recalcAll({ outbox: [...get().outbox, op] }));
        return op;
      };

      const dismissBatch = (batchId: string) => {
        const remaining = get().outbox.filter((op) => op.batchId !== batchId);
        const removedIds = new Set(get().outbox.filter((op) => op.batchId === batchId).map((op) => op.id));
        set(recalcAll({
          outbox: remaining,
          currentBatch: get().currentBatch === batchId ? null : get().currentBatch,
          records: get().records.map((record) => removedIds.has(record.pendingOpId ?? '') ? { ...record, pendingOpId: undefined, confirmedBatch: undefined } : record),
          findings: get().findings.map((finding) => removedIds.has(finding.pendingOpId ?? '') ? { ...finding, pendingOpId: undefined, confirmedBatch: undefined } : finding)
        }));
      };

      return {
        records: createInitialRecords(),
        findings: createInitialFindings(),
        outbox: [],
        currentBatch: null,
        simulatedOffline: false,
        failNextSubmit: false,
        selectedRecordId: 'ACT-0318',
        sampledIds: ['ACT-0318', 'ACT-0337'],
        issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false },

        selectRecord: (id) => set({ selectedRecordId: id }),
        toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),
        startCorrection: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '复核中' } : record) })),
        verifyRecord: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '已核验' } : record) })),
        batchVerify: () => set((state) => ({ records: state.records.map((record) => state.sampledIds.includes(record.id) && record.status !== '需补证' ? { ...record, status: '已核验' } : record) })),
        toggleIssuanceCheck: (id) => set((state) => ({ issuanceChecks: { ...state.issuanceChecks, [id]: !state.issuanceChecks[id] } })),
        setSimulatedOffline: (value) => set({ simulatedOffline: value }),
        setFailNextSubmit: (value) => set({ failNextSubmit: value }),

        // 断网处理先留本机：修订进入出箱队列，本机立即看到草稿值
        enqueueRevision: (id, value, reason) => {
          const record = get().records.find((item) => item.id === id);
          if (!record) return;
          const baseRevision = record.serverRevision ?? record.revision;
          const op = enqueue('revision', id, { value, reason, baseRevision });
          set(recalcAll({
            records: get().records.map((item) => item.id === id ? {
              ...item,
              activity: value,
              revision: item.revision + 1,
              status: '复核中',
              pendingOpId: op.id
            } : item)
          }));
          if (isOnline()) void flushQueue();
        },

        // 发现项补录同样进队列，断网先留本机，避免重复补录产生第二版
        enqueueFindingSupplement: (findingId, note) => {
          const finding = get().findings.find((item) => item.id === findingId);
          if (!finding) return;
          const baseRevision = finding.serverRev ?? finding.rev;
          const op = enqueue('findingSupplement', findingId, { note, baseRevision });
          set(recalcAll({
            findings: get().findings.map((item) => item.id === findingId ? {
              ...item,
              status: '补证中',
              notes: note ? (item.notes ? `${item.notes}；${note}` : note) : item.notes,
              rev: item.rev + 1,
              pendingOpId: op.id
            } : item)
          }));
          if (isOnline()) void flushQueue();
        },

        closeFinding: (findingId) => {
          const finding = get().findings.find((item) => item.id === findingId);
          if (!finding || !isOpenFinding(finding.status)) return;
          const baseRevision = finding.serverRev ?? finding.rev;
          const op = enqueue('findingClose', findingId, { closeTo: '已关闭', baseRevision });
          set(recalcAll({
            findings: get().findings.map((item) => item.id === findingId ? { ...item, status: '已关闭', pendingOpId: op.id } : item)
          }));
          if (isOnline()) void flushQueue();
        },

        flushQueue,
        reconcileFromServer,
        resolveConflict,
        dismissBatch,
        resetAll: () => set(recalcAll({
          records: createInitialRecords(),
          findings: createInitialFindings(),
          outbox: [],
          currentBatch: null,
          simulatedOffline: false,
          failNextSubmit: false,
          issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false }
        }))
      };
    },
    {
      name: 'yy60-carbon-evidence-v2',
      version: 2,
      partialize: (state) => ({
        records: state.records,
        findings: state.findings,
        outbox: state.outbox,
        currentBatch: state.currentBatch,
        simulatedOffline: state.simulatedOffline,
        failNextSubmit: state.failNextSubmit,
        selectedRecordId: state.selectedRecordId,
        sampledIds: state.sampledIds,
        issuanceChecks: state.issuanceChecks
      })
    }
  )
);
