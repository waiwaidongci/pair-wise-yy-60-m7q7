'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  CloudDoneOutlined,
  CloudOffOutlined,
  DifferenceOutlined,
  ExpandLess,
  ExpandMore,
  GppMaybeOutlined,
  PublishOutlined,
  RestartAltOutlined
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { advanceServerVersion, resetServer } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import {
  OP_KIND_LABEL,
  OUTBOX_STATUS_META,
  orderedOutbox,
  type OutboxOp
} from '@/lib/sync';
import { useCarbonStore } from '@/lib/store';

function StatusChip({ status }: { status: OutboxOp['status'] }) {
  const meta = OUTBOX_STATUS_META[status];
  return <Chip size="small" label={meta.label} sx={{ color: meta.color, bgcolor: meta.bgcolor, height: 22, fontSize: 10.5, fontWeight: 700 }} />;
}

function ConflictDialog({ opId, onClose }: { opId: string | null; onClose: () => void }) {
  const { outbox, records, findings, resolveConflict } = useCarbonStore();
  const op = outbox.find((item) => item.id === opId);
  const [note, setNote] = useState('');

  useEffect(() => { setNote(''); }, [opId]);

  if (!op) return null;
  const record = op.kind === 'revision' ? records.find((r) => r.id === op.targetId) : undefined;
  const finding = op.kind !== 'revision' ? findings.find((f) => f.id === op.targetId) : undefined;
  const conflict = record?.conflict ?? finding?.conflict;
  if (!conflict) return null;

  const serverColumn = conflict.kind === 'revision' ? {
    tag: `服务端 V${conflict.serverRevision}`,
    editor: conflict.serverEditor,
    lines: [`活动数据：${conflict.serverValue.toLocaleString()} ${record?.unit ?? ''}`, `修订原因：${conflict.serverReason || '（无说明）'}`]
  } : {
    tag: `服务端 V${conflict.serverRev}`,
    editor: conflict.serverEditor,
    lines: [`发现项状态：${conflict.serverStatus}`, `补录说明：${conflict.serverNote || '（无说明）'}`]
  };

  const localColumn = conflict.kind === 'revision' ? {
    tag: `本机草稿 V${conflict.localRevision}（基于 V${conflict.baseRevision}）`,
    editor: '本机 · 沈楠',
    lines: [`活动数据：${conflict.localValue.toLocaleString()} ${record?.unit ?? ''}`, `修订原因：${conflict.localReason || '（无说明）'}`]
  } : {
    tag: `本机草稿 V${conflict.localRev}（基于 V${conflict.baseRevision}）`,
    editor: '本机 · 沈楠',
    lines: [`发现项状态：${conflict.localStatus}`, `补录说明：${conflict.localNote || '（无说明）'}`]
  };

  const canResolve = note.trim().length > 0;

  return (
    <Dialog open={Boolean(opId)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <DifferenceOutlined color="error" />
          <Box>
            <Typography fontSize={15} fontWeight={800}>版本冲突 · {OP_KIND_LABEL[op.kind]} {op.targetId}</Typography>
            <Typography fontSize={11} color="text.secondary">服务端已有新版本，本机旧值不会盖回；请核验员核对双方版本后处理。</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.2, mt: 1 }}>
          {[localColumn, serverColumn].map((column, index) => (
            <Box key={index} sx={{ border: '1px solid', borderColor: index === 0 ? '#e3c9bd' : '#bcd8cd', borderRadius: 1, p: 1.3, bgcolor: index === 0 ? '#fdf5f2' : '#f3f9f6' }}>
              <Chip size="small" label={column.tag} sx={{ height: 20, fontSize: 10, fontWeight: 800, color: index === 0 ? '#9a3b2c' : '#12664f', bgcolor: 'transparent', border: '1px solid currentColor' }} />
              <Typography fontSize={10} color="text.secondary" mt={.8}>操作人：{column.editor}</Typography>
              {column.lines.map((line, lineIndex) => <Typography key={lineIndex} fontSize={11.5} mt={.7}>{line}</Typography>)}
            </Box>
          ))}
        </Box>
        <Typography fontSize={11} color="text.secondary" mt={1.3}>
          {conflict.kind === 'revision'
            ? `差异：${Math.abs(conflict.localValue - conflict.serverValue).toLocaleString()} ${record?.unit ?? ''}（本机 ${conflict.localValue > conflict.serverValue ? '偏高' : '偏低'}）`
            : `差异：本机「${conflict.localStatus}」 vs 服务端「${conflict.serverStatus}」`}
        </Typography>
        <TextField
          fullWidth size="small" margin="normal" multiline rows={2}
          label="核验员处理意见（必填）" value={note} onChange={(event) => setNote(event.target.value)}
          placeholder="说明采用哪一版及依据，处理后该事项才计入签发准备"
        />
        {!canResolve && <Alert severity="warning" sx={{ py: 0 }}>未填写处理意见前不能计入签发准备。</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.4, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>稍后处理</Button>
        <Tooltip title="放弃本机草稿，记录与发现项按服务端新版本计入，冲突操作标记为已处理">
          <span><Button variant="outlined" color="primary" disabled={!canResolve} onClick={() => { resolveConflict(op!.id, 'server', note.trim()); onClose(); }}>采用服务端版本</Button></span>
        </Tooltip>
        <Tooltip title="以服务端最新版为基线，把本机修订重新排队续交，仍按同批结果确认，不生成重复版本">
          <span><Button variant="contained" color="primary" disabled={!canResolve} startIcon={<PublishOutlined />} onClick={() => { resolveConflict(op!.id, 'reapply', note.trim()); onClose(); }}>以新版为基线续交本机值</Button></span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}

export default function SyncPanel({ expanded, onExpandedChange }: { expanded: boolean; onExpandedChange: (value: boolean) => void }) {
  const store = useCarbonStore();
  const qc = useQueryClient();
  const [conflictOpId, setConflictOpId] = useState<string | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState('');

  const online = !store.simulatedOffline && (typeof navigator === 'undefined' || navigator.onLine !== false);

  // 恢复网络 / 启动时按序补交
  useEffect(() => {
    const goOnline = () => { void store.flushQueue(); };
    window.addEventListener('online', goOnline);
    return () => window.removeEventListener('online', goOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (online) void store.flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.simulatedOffline]);

  const ops = orderedOutbox(store.outbox);
  const counts = useMemo(() => ({
    queued: ops.filter((op) => op.status === 'queued').length,
    inflight: ops.filter((op) => op.status === 'inflight').length,
    failed: ops.filter((op) => op.status === 'failed').length,
    conflict: ops.filter((op) => op.status === 'conflict').length,
    confirmed: ops.filter((op) => op.status === 'confirmed').length,
    duplicate: ops.filter((op) => op.status === 'duplicate').length
  }), [ops]);

  const batches = useMemo(() => {
    const map = new Map<string, OutboxOp[]>();
    for (const op of ops) {
      map.set(op.batchId, [...(map.get(op.batchId) ?? []), op]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ops]);

  const conflictOps = ops.filter((op) => op.status === 'conflict');
  const queuedRevisionTarget = ops.find((op) => op.status === 'queued' && op.kind === 'revision')?.targetId;

  const refreshServerView = () => qc.invalidateQueries({ queryKey: ['carbon-api'] });

  return (
    <Card elevation={0} variant="outlined" sx={{ mb: 1.6, overflow: 'visible', borderColor: counts.conflict || counts.failed ? '#e0b4a6' : '#dce4e0' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1, md: 1.4 }}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ p: 1.2, px: 1.6, cursor: 'pointer' }}
        onClick={() => onExpandedChange(!expanded)}
      >
        <Stack direction="row" spacing={.8} alignItems="center">
          {online ? <CloudDoneOutlined sx={{ color: '#166b55', fontSize: 20 }} /> : <CloudOffOutlined color="disabled" sx={{ fontSize: 20 }} />}
          <Box>
            <Typography fontSize={12.5} fontWeight={800}>{online ? '已联网 · 出箱对账' : '断网处理中 · 本机暂存'}</Typography>
            <Typography fontSize={10} color="text.secondary">断网先留本机，恢复后按序补交；重复补交不生成第二版</Typography>
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={.7} flexWrap="wrap" useFlexGap onClick={(event) => event.stopPropagation()}>
          {counts.queued > 0 && <Chip size="small" label={`待补交 ${counts.queued}`} sx={{ bgcolor: '#fbf3dc', color: '#8a6d1d', height: 22, fontSize: 10.5 }} />}
          {counts.inflight > 0 && <Chip size="small" label={`补交中 ${counts.inflight}`} sx={{ bgcolor: '#e5f0fb', color: '#1565c0', height: 22, fontSize: 10.5 }} />}
          {counts.failed > 0 && <Chip size="small" label={`失败待续 ${counts.failed}`} sx={{ bgcolor: '#fbece3', color: '#b4642f', height: 22, fontSize: 10.5 }} />}
          {counts.conflict > 0 && <Chip size="small" icon={<GppMaybeOutlined sx={{ fontSize: 14 }} />} label={`冲突待核验 ${counts.conflict}`} sx={{ bgcolor: '#f9e7e2', color: '#9a3b2c', height: 22, fontSize: 10.5, fontWeight: 800 }} onDelete={() => setConflictOpId(conflictOps[0]?.id ?? null)} deleteIcon={<DifferenceOutlined sx={{ fontSize: 14 }} />} />}
          {(counts.confirmed > 0 || counts.duplicate > 0) && <Chip size="small" label={`本批已确认 ${counts.confirmed}${counts.duplicate ? `（含重复合并 ${counts.duplicate}）` : ''}`} sx={{ bgcolor: '#e4f1ec', color: '#12664f', height: 22, fontSize: 10.5 }} />}
          <Button
            size="small" variant="contained" disabled={online && counts.queued + counts.failed + counts.inflight === 0}
            startIcon={<PublishOutlined />}
            onClick={(event) => { event.stopPropagation(); void store.flushQueue(); }}
          >
            {online ? '立即补交' : '当前断网'}
          </Button>
          <IconButton size="small" onClick={() => onExpandedChange(!expanded)}>{expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
        </Stack>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Divider />
        <Box sx={{ p: 1.6 }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {ops.length === 0 && <Alert severity="success" sx={{ py: .6 }}>出箱队列为空：修订与发现项补录均已与服务端对齐。</Alert>}
              {batches.map(([batchId, batchOps]) => {
                const terminal = batchOps.every((op) => op.status === 'confirmed' || op.status === 'duplicate');
                return (
                  <Box key={batchId} sx={{ mb: 1.4, border: '1px solid #e8ecea', borderRadius: 1, overflow: 'hidden' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.3, py: .8, bgcolor: batchId === store.currentBatch ? '#f2f8f5' : '#f7f9f8' }}>
                      <Typography fontSize={11} fontWeight={800}>同批批次 {batchId}</Typography>
                      {batchId === store.currentBatch && <Chip size="small" label="本批" sx={{ height: 18, fontSize: 9.5, bgcolor: '#e4f1ec', color: '#12664f' }} />}
                      <Box sx={{ flex: 1 }} />
                      {terminal
                        ? <Button size="small" onClick={() => store.dismissBatch(batchId)}>归档本批结果</Button>
                        : <Typography fontSize={10} color="text.secondary">批次仍有未确认事项，续交沿用本批</Typography>}
                    </Stack>
                    {batchOps.map((op) => {
                      const meta = OUTBOX_STATUS_META[op.status];
                      const recordTarget = op.kind === 'revision' ? store.records.find((r) => r.id === op.targetId) : undefined;
                      const findingTarget = op.kind !== 'revision' ? store.findings.find((f) => f.id === op.targetId) : undefined;
                      const targetLabel = recordTarget ? recordTarget.source : findingTarget ? findingTarget.title : '';
                      return (
                        <Box key={op.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'auto minmax(0,1fr) auto' }, gap: 1, alignItems: 'center', px: 1.3, py: .9, borderTop: '1px solid #edf0ef' }}>
                          <StatusChip status={op.status} />
                          <Box minWidth={0}>
                            <Typography fontSize={11.5} fontWeight={700}>{OP_KIND_LABEL[op.kind]} · {op.targetId}{targetLabel ? ` ${targetLabel}` : ''}</Typography>
                            <Typography fontSize={10} color="text.secondary" noWrap>
                              {op.kind === 'revision' ? `值 ${op.value?.toLocaleString()} · 基于 V${op.baseRevision}${op.reason ? ` · ${op.reason}` : ''}` : op.kind === 'findingSupplement' ? `补录：${op.note ?? ''}` : '关闭发现项'}
                              {op.attempts > 0 ? ` · 已尝试 ${op.attempts} 次` : ''}
                              {op.serverRevision ? ` · 服务端 V${op.serverRevision}` : ''}
                              {op.confirmedAt ? ` · ${new Date(op.confirmedAt).toLocaleTimeString('zh-CN', { hour12: false })} 确认` : ''}
                            </Typography>
                            {op.lastError && <Typography fontSize={10} color="#b4642f" mt={.3}>{op.lastError}</Typography>}
                            {op.resolution && <Typography fontSize={10} color="#12664f" mt={.3}>核验员已处理：{op.resolution === 'server' ? '采用服务端版本' : '以新版为基线续交'}{op.resolutionNote ? ` · ${op.resolutionNote}` : ''}</Typography>}
                          </Box>
                          <Stack direction="row" spacing={.6}>
                            {op.status === 'conflict' && <Button size="small" color="error" variant="outlined" startIcon={<DifferenceOutlined />} onClick={() => setConflictOpId(op.id)}>处理冲突</Button>}
                            {op.status === 'failed' && <Button size="small" variant="outlined" disabled={!online} onClick={() => void store.flushQueue()}>从该条续交</Button>}
                            {(op.status === 'confirmed' || op.status === 'duplicate') && op.status === 'duplicate' && <Chip size="small" label="重复补交已合并" sx={{ height: 22, fontSize: 10, bgcolor: meta.bgcolor, color: meta.color }} />}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
              {counts.failed > 0 && (
                <Alert severity="warning" sx={{ mt: .5 }}>
                  补交在失败处中断：下次恢复网络后从最早一条未确认操作继续，已确认的记录不会重交。
                </Alert>
              )}
            </Box>

            <Box sx={{ width: { xs: '100%', lg: 286 }, flexShrink: 0 }}>
              <Box sx={{ border: '1px dashed #cfd9d4', borderRadius: 1, p: 1.3, bgcolor: '#fbfcfb' }}>
                <Typography fontSize={11.5} fontWeight={800} mb={.9}>现场环境模拟</Typography>
                <Stack spacing={1}>
                  <Button
                    fullWidth size="small" variant={online ? 'outlined' : 'contained'}
                    color={online ? 'warning' : 'success'}
                    startIcon={online ? <CloudOffOutlined /> : <CloudDoneOutlined />}
                    onClick={() => store.setSimulatedOffline(online)}
                  >
                    {online ? '切换为断网' : '恢复网络并按序补交'}
                  </Button>
                  <Button fullWidth size="small" variant="outlined" disabled={store.failNextSubmit} onClick={() => store.setFailNextSubmit(true)}>
                    {store.failNextSubmit ? '下一条补交将失败（已设）' : '模拟下一条补交失败'}
                  </Button>
                  <Divider>
                    <Typography fontSize={9.5} color="text.secondary">服务端新版本演练</Typography>
                  </Divider>
                  <Select size="small" value={advanceTarget || queuedRevisionTarget || store.records[0]?.id || ''} onChange={(event) => setAdvanceTarget(event.target.value)}>
                    {store.records.map((record) => <MenuItem key={record.id} value={record.id} dense>{record.id} · {record.source.slice(0, 12)}（V{record.serverRevision ?? record.revision}）</MenuItem>)}
                  </Select>
                  <Button
                    fullWidth size="small" variant="outlined" color="error" startIcon={<DifferenceOutlined />}
                    onClick={async () => {
                      const id = advanceTarget || queuedRevisionTarget || store.records[0]?.id;
                      if (!id) return;
                      await advanceServerVersion(id);
                      refreshServerView();
                    }}
                  >
                    模拟服务端先行出新版本
                  </Button>
                  <Button fullWidth size="small" startIcon={<RestartAltOutlined />} onClick={async () => { await resetServer(); store.resetAll(); refreshServerView(); }}>重置演示数据</Button>
                </Stack>
              </Box>
              <Typography fontSize={10} color="text.secondary" mt={1} lineHeight={1.7}>
                建议演练：①断网；②改一条数据并补录一个发现项；③恢复网络前点"服务端出新版本"；④恢复网络，可看到双方版本与差异；⑤处理冲突后再通过签发门禁。
              </Typography>
            </Box>
          </Stack>
        </Box>
      </Collapse>
      <ConflictDialog opId={conflictOpId} onClose={() => setConflictOpId(null)} />
    </Card>
  );
}
