import { NextResponse } from 'next/server';
import { simulateResultSchema } from '@/lib/schema';

type ServerState = {
  records: Array<{
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
  }>;
  globalRevision: number;
};

function getState(): ServerState {
  const g = globalThis as typeof globalThis & { __yy60_server_state?: ServerState };
  if (!g.__yy60_server_state) throw new Error('server state not initialized');
  return g.__yy60_server_state;
}

// 模拟服务端收到另一台设备的补交：目标记录版本号 +1，活动数据被调整
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { recordId?: string };
  const recordId = body.recordId ?? 'ACT-0325';
  const state = getState();
  const record = state.records.find((item) => item.id === recordId);
  if (!record) {
    return NextResponse.json({ error: 'record_not_found' }, { status: 404 });
  }
  record.revision += 1;
  record.activity = Math.round(record.activity * 1.05 * 10) / 10;
  record.status = '复核中';
  state.globalRevision += 1;
  return NextResponse.json(simulateResultSchema.parse({ entity: { ...record }, serverRevision: state.globalRevision }));
}
