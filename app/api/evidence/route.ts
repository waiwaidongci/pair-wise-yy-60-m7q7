import { NextResponse } from 'next/server';
import { evidenceResponseSchema, queueSubmitSchema, type QueueSubmit } from '@/lib/schema';

type ServerRecord = {
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
  status: '待核验' | '复核中' | '已核验' | '需补证';
  revision: number;
};

type ServerFinding = {
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

type IdempotencyResult = { accepted: true; revision: number; recordedAt: string };

type ServerState = {
  records: ServerRecord[];
  findings: ServerFinding[];
  issuanceChecks: Record<string, boolean>;
  idempotency: Map<string, IdempotencyResult>;
  globalRevision: number;
};

function seedState(): ServerState {
  return {
    records: [
      { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
      { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.11, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
      { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.68, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
      { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
      { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
    ],
    findings: [
      { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', revision: 1 },
      { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', revision: 1 },
      { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', revision: 1 }
    ],
    issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false },
    idempotency: new Map(),
    globalRevision: 100
  };
}

function getState(): ServerState {
  const g = globalThis as typeof globalThis & { __yy60_server_state?: ServerState };
  if (!g.__yy60_server_state) g.__yy60_server_state = seedState();
  return g.__yy60_server_state;
}

function publicView(state: ServerState) {
  return {
    project: {
      id: 'CN-ER-2026-041',
      name: '临港工业园区能效提升项目',
      methodology: 'CMS-052-V01',
      vintage: '2026 监测年度',
      verifier: '华碳认证 · 核验组 B'
    },
    summary: {
      period: '2026 年第三监测期',
      reduction: 18426,
      evidenceRate: 92,
      openFindings: state.findings.filter((finding) => finding.status !== '已关闭').length,
      sampled: 18
    },
    records: state.records,
    findings: state.findings,
    issuanceChecks: state.issuanceChecks,
    serverRevision: state.globalRevision,
    serverTime: new Date().toISOString()
  };
}

function locateEntity(state: ServerState, type: QueueSubmit['type'], entityId: string): { revision: number } | null {
  if (type === 'issuance_check') return { revision: state.globalRevision };
  if (type === 'finding_request' || type === 'finding_close') {
    return state.findings.find((finding) => finding.id === entityId) ?? null;
  }
  return state.records.find((record) => record.id === entityId) ?? null;
}

function applyMutation(state: ServerState, item: QueueSubmit) {
  const recordedAt = new Date().toISOString();
  if (item.type === 'revision') {
    const record = state.records.find((r) => r.id === item.entityId);
    if (!record) return null;
    record.activity = Number(item.payload.value);
    record.status = '复核中';
    record.revision += 1;
    state.globalRevision += 1;
    return { revision: record.revision, recordedAt };
  }
  if (item.type === 'record_status') {
    const record = state.records.find((r) => r.id === item.entityId);
    if (!record) return null;
    record.status = item.payload.status as ServerRecord['status'];
    record.revision += 1;
    state.globalRevision += 1;
    return { revision: record.revision, recordedAt };
  }
  if (item.type === 'verify') {
    const record = state.records.find((r) => r.id === item.entityId);
    if (!record) return null;
    record.status = '已核验';
    record.revision += 1;
    state.globalRevision += 1;
    return { revision: record.revision, recordedAt };
  }
  if (item.type === 'finding_request') {
    const finding = state.findings.find((f) => f.id === item.entityId);
    if (!finding) return null;
    finding.status = '补证中';
    finding.revision += 1;
    state.globalRevision += 1;
    return { revision: finding.revision, recordedAt };
  }
  if (item.type === 'finding_close') {
    const finding = state.findings.find((f) => f.id === item.entityId);
    if (!finding) return null;
    finding.status = '已关闭';
    finding.revision += 1;
    state.globalRevision += 1;
    return { revision: finding.revision, recordedAt };
  }
  state.issuanceChecks[item.entityId] = Boolean(item.payload.value);
  state.globalRevision += 1;
  return { revision: state.globalRevision, recordedAt };
}

export async function GET() {
  const state = getState();
  return NextResponse.json(evidenceResponseSchema.parse(publicView(state)));
}

export async function POST(request: Request) {
  const body = queueSubmitSchema.parse(await request.json());
  const state = getState();

  // 幂等：同一补交键只生效一次，重复补交不生成第二版
  const seen = state.idempotency.get(body.key);
  if (seen) {
    return NextResponse.json({
      accepted: true,
      duplicate: true,
      revision: seen.revision,
      recordedAt: seen.recordedAt,
      serverRevision: state.globalRevision
    });
  }

  const entity = locateEntity(state, body.type, body.entityId);
  if (!entity) {
    return NextResponse.json({ accepted: false, error: 'entity_not_found' }, { status: 404 });
  }

  // 版本乐观锁：服务端已有新版本时，本机旧值不得覆盖
  if (body.type !== 'issuance_check' && entity.revision > body.baseRevision) {
    const serverEntity =
      body.type === 'finding_request' || body.type === 'finding_close'
        ? state.findings.find((f) => f.id === body.entityId)
        : state.records.find((r) => r.id === body.entityId);
    return NextResponse.json(
      {
        conflict: true,
        reason: 'revision_mismatch',
        serverRevision: entity.revision,
        serverEntity,
        serverTime: new Date().toISOString()
      },
      { status: 409 }
    );
  }

  const result = applyMutation(state, body);
  if (!result) {
    return NextResponse.json({ accepted: false, error: 'entity_not_found' }, { status: 404 });
  }
  state.idempotency.set(body.key, { accepted: true, revision: result.revision, recordedAt: result.recordedAt });

  return NextResponse.json({
    accepted: true,
    revision: result.revision,
    recordedAt: result.recordedAt,
    serverRevision: state.globalRevision
  });
}
