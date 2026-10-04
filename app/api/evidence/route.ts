import { NextResponse } from 'next/server';
import { evidenceResponseSchema } from '@/lib/schema';
import type { SubmitPayload } from '@/lib/sync';

type ServerRecord = {
  id: string; source: string; activity: number; unit: string; factor: number;
  factorUnit: string; timeRange: string; evidenceCount: number; anomaly: number;
  owner: string; status: '待核验' | '复核中' | '已核验' | '需补证';
  revision: number; lastEditor?: string; lastReason?: string;
};

type ServerFinding = {
  id: string; recordId: string;
  type: '缺失证据' | '单位不一致' | '时间范围' | '异常波动';
  title: string; detail: string; assignee: string; due: string;
  status: '开放' | '补证中' | '已关闭'; rev: number; lastNote?: string; lastEditor?: string;
};

// 进程内模拟服务端真值；重启或 reset 后回到初始
function initialRecords(): ServerRecord[] {
  return [
    { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
    { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
    { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
    { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
    { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
  ];
}

function initialFindings(): ServerFinding[] {
  return [
    { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', rev: 1 },
    { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', rev: 1 },
    { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', rev: 1 }
  ];
}

const serverState = {
  records: initialRecords(),
  findings: initialFindings(),
  // 已确认操作：opId -> 确认结果，用于重复补交幂等，不生成第二版
  confirmedOps: new Map<string, { opId: string; kind: SubmitPayload['kind']; targetId: string; serverRevision: number }>()
};

export async function GET() {
  return NextResponse.json(evidenceResponseSchema.parse({
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
      openFindings: serverState.findings.filter((f) => f.status !== '已关闭').length,
      sampled: 18
    },
    records: serverState.records,
    findings: serverState.findings.map(({ id, status, rev, lastNote }) => ({ id, status, rev, lastNote }))
  }));
}

export async function POST(request: Request) {
  const body = await request.json() as Partial<SubmitPayload> & { action?: string; recordId?: string };

  if (body.action === 'reset') {
    serverState.records = initialRecords();
    serverState.findings = initialFindings();
    serverState.confirmedOps.clear();
    return NextResponse.json({ reset: true });
  }

  // 演示：模拟"服务端有新版本"——另一核验端先改了同一记录
  if (body.action === 'advanceRevision' && body.recordId) {
    const record = serverState.records.find((item) => item.id === body.recordId);
    if (record) {
      record.revision += 1;
      record.activity = Math.round(record.activity * 0.972 * 10) / 10;
      record.lastEditor = '华碳认证 · 复核台';
      record.lastReason = '复核台依据纸质校准表更新计量值（服务端先行版本）';
    }
    return NextResponse.json({ revision: record?.revision ?? null });
  }

  const { opId, batchId, kind, targetId, actor } = body;
  if (!opId || !batchId || !kind || !targetId || !actor) {
    return NextResponse.json({ accepted: false, error: '缺少补交字段' }, { status: 400 });
  }

  // 重复补交：同一 opId 已确认过，直接回原结果，不生成第二版
  const seen = serverState.confirmedOps.get(opId);
  if (seen) {
    if (seen.kind === 'revision') {
      const record = serverState.records.find((item) => item.id === seen.targetId);
      return NextResponse.json({
        outcome: 'duplicate',
        serverRevision: seen.serverRevision,
        value: record?.activity,
        reason: record?.lastReason,
        editor: record?.lastEditor ?? actor,
        recordedAt: new Date().toISOString()
      });
    }
    const finding = serverState.findings.find((item) => item.id === seen.targetId);
    return NextResponse.json({
      outcome: 'duplicate',
      serverRevision: seen.serverRevision,
      status: finding?.status,
      note: finding?.lastNote,
      editor: finding?.lastEditor ?? actor,
      recordedAt: new Date().toISOString()
    });
  }

  const recordedAt = new Date().toISOString();

  if (kind === 'revision') {
    const record = serverState.records.find((item) => item.id === targetId);
    if (!record) return NextResponse.json({ accepted: false }, { status: 404 });
    // 基线版本落后于服务端：新版本存在，拒绝旧值盖回，返回双方版本与差异
    if (typeof body.baseRevision === 'number' && body.baseRevision < record.revision) {
      return NextResponse.json({
        outcome: 'conflict',
        serverRevision: record.revision,
        conflict: {
          kind: 'revision',
          localValue: body.value,
          serverValue: record.activity,
          localReason: body.reason ?? '',
          serverReason: record.lastReason ?? '',
          baseRevision: body.baseRevision,
          localRevision: body.baseRevision + 1,
          serverRevision: record.revision,
          serverEditor: record.lastEditor ?? '服务端'
        }
      }, { status: 409 });
    }
    if (typeof body.value !== 'number' || !body.reason) {
      return NextResponse.json({ accepted: false, error: '修订缺少数值或原因' }, { status: 400 });
    }
    record.revision += 1;
    record.activity = body.value;
    record.lastEditor = actor;
    record.lastReason = body.reason;
    serverState.confirmedOps.set(opId, { opId, kind, targetId, serverRevision: record.revision });
    return NextResponse.json({
      outcome: 'confirmed',
      serverRevision: record.revision,
      value: record.activity,
      reason: record.lastReason,
      editor: record.lastEditor,
      recordedAt
    });
  }

  const finding = serverState.findings.find((item) => item.id === targetId);
  if (!finding) return NextResponse.json({ accepted: false }, { status: 404 });
  if (typeof body.baseRevision === 'number' && body.baseRevision < finding.rev) {
    return NextResponse.json({
      outcome: 'conflict',
      serverRevision: finding.rev,
      conflict: {
        kind: 'finding',
        localStatus: kind === 'findingClose' ? '已关闭' : '补证中',
        serverStatus: finding.status,
        localNote: body.note ?? '',
        serverNote: finding.lastNote ?? '',
        baseRevision: body.baseRevision,
        localRev: body.baseRevision + 1,
        serverRev: finding.rev,
        serverEditor: finding.lastEditor ?? '服务端'
      }
    }, { status: 409 });
  }

  if (kind === 'findingSupplement') {
    finding.status = '补证中';
    finding.rev += 1;
    finding.lastNote = body.note ?? finding.lastNote;
    finding.lastEditor = actor;
  } else {
    finding.status = '已关闭';
    finding.rev += 1;
    finding.lastEditor = actor;
  }
  serverState.confirmedOps.set(opId, { opId, kind, targetId, serverRevision: finding.rev });
  return NextResponse.json({
    outcome: 'confirmed',
    serverRevision: finding.rev,
    status: finding.status,
    note: finding.lastNote,
    editor: finding.lastEditor,
    recordedAt
  });
}
