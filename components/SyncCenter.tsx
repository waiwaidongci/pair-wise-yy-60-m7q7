import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Switch,
  Tooltip,
  Typography
} from '@mui/material';
import {
  CheckCircleOutlineOutlined,
  CloudQueueOutlined,
  CloudSyncOutlined,
  CloudUploadOutlined,
  ErrorOutlineOutlined,
  HistoryOutlined,
  RefreshOutlined,
  ScienceOutlined,
  SyncProblemOutlined,
  WifiOffOutlined
} from '@mui/icons-material';
import { useCarbonStore, type QueueItem, type QueueItemType } from '@/lib/store';

const drawerWidth = 440;

const TYPE_LABELS: Record<QueueItemType, string> = {
  revision: '数据修订',
  record_status: '状态复核',
  verify: '核验通过',
  finding_request: '发起补证',
  finding_close: '关闭发现项',
  issuance_check: '签发确认'
};

const CHECK_LABELS: Record<string, string> = {
  evidence: '证据与计算链完整',
  calculation: '计算过程复核通过',
  revisions: '历史修订未覆盖原始数据',
  methodology: '方法学与监测计划匹配'
};

const STATUS_META: Record<QueueItem['status'], { label: string; color: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  pending: { label: '待补交', color: 'default' },
  submitting: { label: '补交中', color: 'info' },
  confirmed: { label: '已确认', color: 'success' },
  conflict: { label: '冲突待处理', color: 'error' },
  failed: { label: '补交失败', color: 'warning' }
};

type DiffField = { key: string; label: string };

const RECORD_FIELDS: DiffField[] = [
  { key: 'revision', label: '版本号' },
  { key: 'source', label: '数据来源' },
  { key: 'activity', label: '活动数据' },
  { key: 'factor', label: '排放因子' },
  { key: 'timeRange', label: '时间范围' },
  { key: 'evidenceCount', label: '证据数量' },
  { key: 'anomaly', label: '异常波动' },
  { key: 'owner', label: '负责人' },
  { key: 'status', label: '核验状态' }
];

const FINDING_FIELDS: DiffField[] = [
  { key: 'revision', label: '版本号' },
  { key: 'title', label: '标题' },
  { key: 'status', label: '状态' },
  { key: 'assignee', label: '负责人' },
  { key: 'due', label: '截止' },
  { key: 'detail', label: '详情' }
];

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function payloadSummary(item: QueueItem): string {
  if (item.type === 'revision') return `修订为 ${item.payload.value}（${item.payload.reason}）`;
  if (item.type === 'record_status') return `状态调整为「${item.payload.status}」`;
  if (item.type === 'verify') return '核验通过';
  if (item.type === 'finding_request') return '发起补证';
  if (item.type === 'finding_close') return '关闭发现项';
  return `${CHECK_LABELS[item.entityId] ?? item.entityId} → ${item.payload.value ? '已确认' : '取消确认'}`;
}

function formatField(key: string, value: unknown, entity?: Record<string, unknown>): string {
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'activity' && entity) return `${Number(value).toLocaleString()} ${String(entity.unit ?? '')}`;
  if (key === 'factor' && entity) return `${value} ${String(entity.factorUnit ?? '')}`;
  if (key === 'anomaly') return `${Number(value) > 0 ? '+' : ''}${value}%`;
  return String(value);
}

export default function SyncCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useCarbonStore();
  const [conflictItemId, setConflictItemId] = useState<string | null>(null);

  const counts = useMemo(() => ({
    pending: store.queue.filter((q) => q.status === 'pending').length,
    submitting: store.queue.filter((q) => q.status === 'submitting').length,
    failed: store.queue.filter((q) => q.status === 'failed').length,
    conflict: store.queue.filter((q) => q.status === 'conflict').length,
    confirmed: store.queue.filter((q) => q.status === 'confirmed').length
  }), [store.queue]);

  const activeItems = store.queue
    .filter((q) => q.status !== 'confirmed')
    .sort((a, b) => a.order - b.order);
  const confirmedItems = store.queue
    .filter((q) => q.status === 'confirmed')
    .sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));

  const conflictItem = store.queue.find((q) => q.id === conflictItemId && q.status === 'conflict') ?? null;
  const conflictFields = conflictItem
    ? conflictItem.type === 'finding_request' || conflictItem.type === 'finding_close'
      ? FINDING_FIELDS
      : RECORD_FIELDS
    : [];
  const localEntity = conflictItem
    ? conflictItem.type === 'finding_request' || conflictItem.type === 'finding_close'
      ? (store.findings.find((f) => f.id === conflictItem.entityId) as unknown as Record<string, unknown> | undefined)
      : (store.records.find((r) => r.id === conflictItem.entityId) as unknown as Record<string, unknown> | undefined)
    : undefined;

  /** 本机提交的建议值：在当前实体上应用队列项的载荷（断网期间可能已被服务端模拟值覆盖） */
  const proposedEntity = conflictItem && localEntity
    ? (() => {
        const base = { ...localEntity };
        switch (conflictItem.type) {
          case 'revision':
            return { ...base, activity: conflictItem.payload.value, revision: conflictItem.baseRevision + 1, status: '复核中' };
          case 'record_status':
            return { ...base, status: conflictItem.payload.status, revision: conflictItem.baseRevision + 1 };
          case 'verify':
            return { ...base, status: '已核验', revision: conflictItem.baseRevision + 1 };
          case 'finding_request':
            return { ...base, status: '补证中', revision: conflictItem.baseRevision + 1 };
          case 'finding_close':
            return { ...base, status: '已关闭', revision: conflictItem.baseRevision + 1 };
          default:
            return base;
        }
      })()
    : undefined;

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        variant="temporary"
        ModalProps={{ keepMounted: true }}
        sx={{ '& .MuiDrawer-paper': { width: drawerWidth, maxWidth: '100vw', pt: '62px', boxSizing: 'border-box' } }}
      >
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography fontWeight={850} fontSize={15}>补交与同步中心</Typography>
              <Typography variant="caption" color="text.secondary">断网留本机 · 恢复按序补交 · 冲突不覆盖服务端新版本</Typography>
            </Box>
            <IconButton onClick={onClose}><CloudQueueOutlined /></IconButton>
          </Stack>

          <Box sx={{ mt: 1.5, p: 1.4, border: '1px solid', borderColor: store.networkMode === 'online' ? '#bcd9cf' : '#e3c9a8', borderRadius: 1, bgcolor: store.networkMode === 'online' ? '#f1f8f5' : '#fdf6ec' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center">
                {store.networkMode === 'online' ? <CloudSyncOutlined color="primary" fontSize="small" /> : <WifiOffOutlined color="warning" fontSize="small" />}
                <Typography fontSize={13} fontWeight={750}>{store.networkMode === 'online' ? '在线 · 可按序补交' : '断网 · 操作留本机'}</Typography>
              </Stack>
              <Switch
                size="small"
                checked={store.networkMode === 'online'}
                onChange={(_, checked) => store.setNetworkMode(checked ? 'online' : 'offline')}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" mt={.6}>
              {store.networkMode === 'online'
                ? '关闭开关可模拟现场断网：期间修订、核验、补证与签发确认全部先保留在本机。'
                : '断网期间不产生任何服务端版本；恢复网络后将按队列顺序自动补交。'}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} mt={1.4}>
            <Button size="small" variant="contained" startIcon={<CloudUploadOutlined />} disabled={store.networkMode === 'offline' || store.processing || (counts.pending + counts.failed + counts.submitting === 0)} onClick={() => void store.processQueue()}>
              {store.processing ? '补交中…' : '立即补交'}
            </Button>
            <Button size="small" startIcon={<RefreshOutlined />} disabled={store.networkMode === 'offline'} onClick={() => void store.syncFromServer()}>同步服务端</Button>
            <Tooltip title="模拟另一台设备已向服务端补交，使目标记录版本 +1；断网时先在本机模拟，恢复网络后补发给服务端">
              <Button size="small" startIcon={<ScienceOutlined />} onClick={() => void store.simulateChange('ACT-0325')}>模拟新版本</Button>
            </Tooltip>
          </Stack>

          <Stack direction="row" spacing={.8} mt={1.4} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`待补交 ${counts.pending}`} variant="outlined" />
            <Chip size="small" label={`补交中 ${counts.submitting}`} color="info" variant="outlined" />
            <Chip size="small" label={`失败 ${counts.failed}`} color="warning" variant="outlined" />
            <Chip size="small" label={`冲突 ${counts.conflict}`} color="error" variant="outlined" />
            <Chip size="small" label={`已确认 ${counts.confirmed}`} color="success" variant="outlined" />
          </Stack>
          {store.lastSyncedAt && <Typography variant="caption" color="text.secondary" display="block" mt={.8}>最近同步：{formatTime(store.lastSyncedAt)}</Typography>}
          {store.processing && <LinearProgress sx={{ mt: 1, height: 3, borderRadius: 2 }} />}
        </Box>

        <Divider />

        <Box sx={{ px: 2, py: 1.2, overflowY: 'auto' }}>
          {activeItems.length === 0 && confirmedItems.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
              <HistoryOutlined sx={{ fontSize: 34, opacity: .5 }} />
              <Typography fontSize={12.5} mt={1}>暂无补交项。</Typography>
              <Typography variant="caption" display="block" mt={.5}>断网期间的修订、核验、补证和签发确认会先留存在这里，恢复网络后按序补交。</Typography>
            </Box>
          )}

          {activeItems.length > 0 && (
            <>
              <Typography variant="overline" color="text.secondary" fontWeight={750}>本批补交（按序）</Typography>
              {activeItems.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <Box key={item.id} sx={{ py: 1.3, borderBottom: '1px solid #edf0ef' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Stack direction="row" spacing={.8} alignItems="center">
                        <Chip size="small" label={TYPE_LABELS[item.type]} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                        <Typography fontSize={12.5} fontWeight={750}>{item.entityId}</Typography>
                      </Stack>
                      <Chip size="small" label={meta.label} color={meta.color} sx={{ height: 20, fontSize: 11 }} />
                    </Stack>
                    <Typography fontSize={11.5} color="text.secondary" mt={.6}>{payloadSummary(item)}</Typography>
                    <Stack direction="row" spacing={.8} alignItems="center" mt={.6} flexWrap="wrap" useFlexGap>
                      <Typography variant="caption" color="text.secondary">登记于 {formatTime(item.createdAt)}</Typography>
                      <Typography variant="caption" color="text.secondary">· 基于 V{item.baseRevision}</Typography>
                      {item.status === 'conflict' && <Typography variant="caption" color="error">· 服务端已有 V{item.serverRevision}，本机旧值未覆盖</Typography>}
                      {item.status === 'failed' && <Typography variant="caption" color="warning.main">· {item.error ?? '补交失败'}</Typography>}
                    </Stack>
                    {item.status === 'conflict' && (
                      <Button size="small" color="error" variant="outlined" sx={{ mt: .8 }} startIcon={<SyncProblemOutlined />} onClick={() => setConflictItemId(item.id)}>
                        处理冲突（核验员）
                      </Button>
                    )}
                    {item.status === 'failed' && (
                      <Button size="small" color="warning" variant="outlined" sx={{ mt: .8 }} onClick={() => void store.processQueue()}>
                        从本项继续补交
                      </Button>
                    )}
                  </Box>
                );
              })}
            </>
          )}

          {confirmedItems.length > 0 && (
            <>
              <Typography variant="overline" color="text.secondary" fontWeight={750} display="block" mt={activeItems.length ? 2 : 0}>已确认（同批结果）</Typography>
              {confirmedItems.map((item) => (
                <Box key={item.id} sx={{ py: 1.1, borderBottom: '1px solid #edf0ef', opacity: .85 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" spacing={.8} alignItems="center">
                      <CheckCircleOutlineOutlined color="success" sx={{ fontSize: 16 }} />
                      <Typography fontSize={12.5} fontWeight={700}>{TYPE_LABELS[item.type]} · {item.entityId}</Typography>
                    </Stack>
                    <Chip size="small" label={`V${item.resultRevision ?? '-'}`} color="success" sx={{ height: 20, fontSize: 11 }} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" mt={.4}>
                    {formatTime(item.confirmedAt)} 确认
                    {item.duplicate ? ' · 重复补交，未生成第二版' : ''}
                    {item.resolution === 'adopt' ? ' · 已采用服务端版本' : item.resolution === 'rebase' ? ' · 已基于服务端新版本重新提交' : ''}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </Box>
      </Drawer>

      <Dialog open={Boolean(conflictItem)} onClose={() => setConflictItemId(null)} maxWidth="md" fullWidth>
        {conflictItem && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <ErrorOutlineOutlined color="error" />
                <Typography fontWeight={850}>补交冲突：服务端已有新版本</Typography>
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                服务端已存在 V{conflictItem.serverRevision}，本机补交基于 V{conflictItem.baseRevision}。本机旧值不会覆盖服务端新版本；请核验员选择处理方式，处理后该项才计入签发准备，此前继续挡住签发检查。
              </Alert>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.2 }}>
                {[
                  { title: `服务端版本 V${conflictItem.serverRevision}`, entity: conflictItem.serverEntity, tone: '#f4f9f6' },
                  { title: `本机提交（基于 V${conflictItem.baseRevision}）`, entity: proposedEntity, tone: '#fdf7f0' }
                ].map((column) => (
                  <Box key={column.title} sx={{ border: '1px solid #e3e8e6', borderRadius: 1, bgcolor: column.tone, p: 1.2 }}>
                    <Typography fontSize={12.5} fontWeight={800} mb={.8}>{column.title}</Typography>
                    {conflictFields.map((field) => {
                      const serverValue = formatField(field.key, (conflictItem.serverEntity as Record<string, unknown> | undefined)?.[field.key], conflictItem.serverEntity);
                      const localValue = formatField(field.key, proposedEntity?.[field.key], proposedEntity);
                      const diff = serverValue !== localValue;
                      const value = column.entity ? (column.entity as Record<string, unknown>)[field.key] : undefined;
                      return (
                        <Box key={field.key} sx={{ py: .45, borderTop: '1px solid rgba(0,0,0,.06)' }}>
                          <Typography variant="caption" color="text.secondary">{field.label}</Typography>
                          <Typography fontSize={12.5} fontWeight={diff ? 750 : 400} color={diff ? 'error.main' : 'text.primary'}>
                            {formatField(field.key, value, column.entity as Record<string, unknown> | undefined)}
                            {diff && <Typography component="span" variant="caption" color="error.main"> · 差异</Typography>}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 2.4, pb: 2 }}>
              <Button onClick={() => setConflictItemId(null)}>稍后处理</Button>
              <Button variant="outlined" onClick={() => { store.resolveConflict(conflictItem.id, 'rebase'); setConflictItemId(null); }}>
                基于服务端新版本重新提交本机修订
              </Button>
              <Button variant="contained" color="primary" onClick={() => { store.resolveConflict(conflictItem.id, 'adopt'); setConflictItemId(null); }}>
                采用服务端版本
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
