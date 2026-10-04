import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConflictError, fetchEvidence, simulateServerChange, submitQueueItem } from './api';
import type { EvidenceResponse } from './schema';

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';
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
  revision: number;
};

export type QueueItemType = 'revision' | 'record_status' | 'verify' | 'finding_request' | 'finding_close' | 'issuance_check';
export type QueueItemStatus = 'pending' | 'submitting' | 'confirmed' | 'conflict' | 'failed';

export type QueueItem = {
  id: string;
  type: QueueItemType;
  entityId: string;
  payload: Record<string, string | number | boolean>;
  baseRevision: number;
  status: QueueItemStatus;
  order: number;
  createdAt: string;
  confirmedAt?: string;
  resultRevision?: number;
  duplicate?: boolean;
  resolution?: 'normal' | 'adopt' | 'rebase';
  error?: string;
  serverEntity?: Record<string, unknown>;
  serverRevision?: number;
};

export type NetworkMode = 'online' | 'offline';

const ACTOR = '沈楠';

const defaultRecords: CarbonRecord[] = [
  { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
  { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.11, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
  { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.68, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
  { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
  { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
];

const defaultFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', revision: 1 },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', revision: 1 },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', revision: 1 }
];

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isBrowserOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, boolean>;
  queue: QueueItem[];
  networkMode: NetworkMode;
  processing: boolean;
  serverRevision: number;
  lastSyncedAt: string | null;
  pendingServerChanges: string[];
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  requestEvidence: (findingId: string) => void;
  closeFinding: (findingId: string) => void;
  toggleIssuanceCheck: (id: string) => void;
  reviseValue: (id: string, value: number, reason: string) => void;
  setNetworkMode: (mode: NetworkMode) => void;
  processQueue: () => Promise<void>;
  resolveConflict: (itemId: string, choice: 'adopt' | 'rebase') => void;
  hydrateFromServer: (server: EvidenceResponse) => void;
  syncFromServer: () => Promise<void>;
  simulateChange: (recordId: string) => Promise<void>;
};

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => {
      /** 入队：断网留本机，联网后由 processQueue 按序补交 */
      const enqueue = (input: Omit<QueueItem, 'id' | 'status' | 'order' | 'createdAt'>) => {
        const item: QueueItem = {
          ...input,
          id: uuid(),
          status: 'pending',
          order: get().queue.length ? Math.max(...get().queue.map((q) => q.order)) + 1 : 1,
          createdAt: new Date().toISOString()
        };
        set((state) => ({ queue: [...state.queue, item] }));
        if (get().networkMode === 'online') void get().processQueue();
      };

      /** 服务端确认后，把本地实体版本号对齐到服务端结果 */
      const alignLocalRevision = (item: QueueItem, revision: number) => {
        if (item.type === 'issuance_check') return;
        set((state) => {
          if (item.type === 'finding_request' || item.type === 'finding_close') {
            return { findings: state.findings.map((finding) => finding.id === item.entityId ? { ...finding, revision } : finding) };
          }
          return { records: state.records.map((record) => record.id === item.entityId ? { ...record, revision } : record) };
        });
      };

      /** 把服务端状态合并进本地；存在未结补交项的实体不覆盖（队列稍后对账） */
      const mergeServerState = (server: EvidenceResponse) => {
        const busyEntities = new Set(
          get().queue
            .filter((q) => q.status === 'pending' || q.status === 'submitting' || q.status === 'failed' || q.status === 'conflict')
            .map((q) => q.entityId)
        );
        const hasPendingIssuance = get().queue.some(
          (q) => q.type === 'issuance_check' && ['pending', 'submitting', 'failed', 'conflict'].includes(q.status)
        );
        set((state) => ({
          records: state.records.map((record) => {
            const remote = server.records.find((r) => r.id === record.id);
            if (remote && remote.revision > record.revision && !busyEntities.has(record.id)) {
              return { ...remote };
            }
            return record;
          }),
          findings: state.findings.map((finding) => {
            const remote = server.findings.find((f) => f.id === finding.id);
            if (remote && remote.revision > finding.revision && !busyEntities.has(finding.id)) {
              return { ...remote };
            }
            return finding;
          }),
          issuanceChecks: hasPendingIssuance ? state.issuanceChecks : { ...server.issuanceChecks },
          serverRevision: server.serverRevision,
          lastSyncedAt: server.serverTime
        }));
      };

      return {
        records: defaultRecords,
        findings: defaultFindings,
        selectedRecordId: 'ACT-0318',
        sampledIds: ['ACT-0318', 'ACT-0337'],
        issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false },
        queue: [],
        networkMode: isBrowserOnline() ? 'online' : 'offline',
        processing: false,
        serverRevision: 100,
        lastSyncedAt: null,
        pendingServerChanges: [],

        selectRecord: (id) => set({ selectedRecordId: id }),
        toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),

        startCorrection: (id) => {
          const record = get().records.find((r) => r.id === id);
          if (!record) return;
          set((state) => ({ records: state.records.map((r) => r.id === id ? { ...r, status: '复核中', revision: r.revision + 1 } : r) }));
          enqueue({ type: 'record_status', entityId: id, payload: { status: '复核中' }, baseRevision: record.revision });
        },

        verifyRecord: (id) => {
          const record = get().records.find((r) => r.id === id);
          if (!record) return;
          set((state) => ({ records: state.records.map((r) => r.id === id ? { ...r, status: '已核验', revision: r.revision + 1 } : r) }));
          enqueue({ type: 'verify', entityId: id, payload: {}, baseRevision: record.revision });
        },

        batchVerify: () => {
          const targets = get().records.filter((record) => get().sampledIds.includes(record.id) && record.status !== '需补证');
          set((state) => ({
            records: state.records.map((record) =>
              targets.some((t) => t.id === record.id) ? { ...record, status: '已核验', revision: record.revision + 1 } : record
            )
          }));
          for (const record of targets) {
            enqueue({ type: 'verify', entityId: record.id, payload: {}, baseRevision: record.revision });
          }
        },

        requestEvidence: (findingId) => {
          const finding = get().findings.find((f) => f.id === findingId);
          if (!finding) return;
          set((state) => ({ findings: state.findings.map((f) => f.id === findingId ? { ...f, status: '补证中', revision: f.revision + 1 } : f) }));
          enqueue({ type: 'finding_request', entityId: findingId, payload: {}, baseRevision: finding.revision });
        },

        closeFinding: (findingId) => {
          const finding = get().findings.find((f) => f.id === findingId);
          if (!finding) return;
          set((state) => ({ findings: state.findings.map((f) => f.id === findingId ? { ...f, status: '已关闭', revision: f.revision + 1 } : f) }));
          enqueue({ type: 'finding_close', entityId: findingId, payload: {}, baseRevision: finding.revision });
        },

        toggleIssuanceCheck: (id) => {
          const current = Boolean(get().issuanceChecks[id]);
          set((state) => ({ issuanceChecks: { ...state.issuanceChecks, [id]: !current } }));
          enqueue({ type: 'issuance_check', entityId: id, payload: { value: !current }, baseRevision: get().serverRevision });
        },

        reviseValue: (id, value, reason) => {
          const record = get().records.find((r) => r.id === id);
          if (!record) return;
          set((state) => ({
            records: state.records.map((r) => r.id === id ? { ...r, activity: value, revision: r.revision + 1, status: '复核中' } : r)
          }));
          enqueue({ type: 'revision', entityId: id, payload: { value, reason }, baseRevision: record.revision });
        },

        setNetworkMode: (mode) => {
          set({ networkMode: mode });
          if (mode === 'online') {
            void (async () => {
              // 先补交断网期间模拟的服务端变更（另一台设备的补交），再处理本端队列
              for (const recordId of get().pendingServerChanges) {
                try {
                  await simulateServerChange(recordId);
                } catch {
                  /* 网络仍不可用，稍后随同步重试 */
                }
              }
              set({ pendingServerChanges: [] });
              await get().syncFromServer().catch(() => undefined);
              await get().processQueue();
            })();
          }
        },

        /** 按序补交：确认项跳过，失败/冲突项阻断队列，恢复后从断点续作 */
        processQueue: async () => {
          const state = get();
          if (state.processing || state.networkMode === 'offline') return;
          set({ processing: true });
          try {
            const items = get().queue
              .filter((q) => q.status === 'pending' || q.status === 'failed')
              .sort((a, b) => a.order - b.order);
            for (const item of items) {
              if (get().networkMode === 'offline') break;
              set((s) => ({ queue: s.queue.map((q) => q.id === item.id ? { ...q, status: 'submitting', error: undefined } : q) }));
              try {
                const result = await submitQueueItem({
                  key: item.id,
                  type: item.type,
                  entityId: item.entityId,
                  baseRevision: item.baseRevision,
                  payload: item.payload,
                  actor: ACTOR
                });
                set((s) => ({
                  queue: s.queue.map((q) =>
                    q.id === item.id
                      ? {
                          ...q,
                          status: 'confirmed',
                          confirmedAt: result.recordedAt,
                          resultRevision: result.revision,
                          duplicate: result.duplicate === true,
                          resolution: 'normal'
                        }
                      : q
                  ),
                  serverRevision: result.serverRevision
                }));
                if (result.revision) alignLocalRevision(item, result.revision);
              } catch (error) {
                if (error instanceof ConflictError) {
                  // 冲突：本机旧值不覆盖服务端新版本，待核验员处理
                  set((s) => ({
                    queue: s.queue.map((q) =>
                      q.id === item.id
                        ? { ...q, status: 'conflict', serverEntity: error.serverEntity, serverRevision: error.serverRevision }
                        : q
                    )
                  }));
                  break;
                }
                const message = error instanceof Error ? error.message : '补交失败';
                set((s) => ({ queue: s.queue.map((q) => q.id === item.id ? { ...q, status: 'failed', error: message } : q) }));
                break;
              }
            }
          } finally {
            set({ processing: false });
          }
        },

        /** 冲突处理：采用服务端版本，或基于服务端新版本重新提交本机修订 */
        resolveConflict: (itemId, choice) => {
          const item = get().queue.find((q) => q.id === itemId);
          if (!item || item.status !== 'conflict' || !item.serverEntity) return;
          if (choice === 'adopt') {
            const serverEntity = item.serverEntity as Record<string, unknown>;
            set((state) => ({
              records:
                item.type === 'finding_request' || item.type === 'finding_close'
                  ? state.records
                  : state.records.map((r) => (r.id === item.entityId ? { ...r, ...(serverEntity as Partial<CarbonRecord>) } : r)),
              findings:
                item.type === 'finding_request' || item.type === 'finding_close'
                  ? state.findings.map((f) => (f.id === item.entityId ? { ...f, ...(serverEntity as Partial<Finding>) } : f))
                  : state.findings,
              queue: state.queue.map((q) =>
                q.id === item.id
                  ? { ...q, status: 'confirmed', confirmedAt: new Date().toISOString(), resultRevision: item.serverRevision, resolution: 'adopt' }
                  : q
              )
            }));
          } else {
            set((state) => ({
              queue: state.queue.map((q) =>
                q.id === item.id
                  ? {
                      ...q,
                      id: uuid(),
                      baseRevision: item.serverRevision ?? q.baseRevision,
                      status: 'pending',
                      serverEntity: undefined,
                      serverRevision: undefined,
                      error: undefined,
                      resolution: 'rebase'
                    }
                  : q
              )
            }));
          }
          void get().processQueue();
        },

        hydrateFromServer: (server) => mergeServerState(server),

        syncFromServer: async () => {
          const server = await fetchEvidence();
          mergeServerState(server);
        },

        simulateChange: async (recordId) => {
          if (get().networkMode === 'online') {
            const result = await simulateServerChange(recordId);
            const busy = get().queue.some(
              (q) => q.entityId === recordId && ['pending', 'submitting', 'failed', 'conflict'].includes(q.status)
            );
            set((state) => ({
              records: busy ? state.records : state.records.map((r) => (r.id === recordId ? { ...result.entity } : r)),
              serverRevision: result.serverRevision,
              lastSyncedAt: new Date().toISOString()
            }));
            return;
          }
          // 断网期间：本地先模拟服务端已收到另一台设备的补交，恢复网络后补发给服务端
          if (get().pendingServerChanges.includes(recordId)) return;
          set((state) => ({
            records: state.records.map((r) =>
              r.id === recordId
                ? { ...r, activity: Math.round(r.activity * 1.05 * 10) / 10, status: '复核中', revision: r.revision + 1 }
                : r
            ),
            pendingServerChanges: [...state.pendingServerChanges, recordId]
          }));
        }
      };
    },
    { name: 'yy60-carbon-evidence' }
  )
);
