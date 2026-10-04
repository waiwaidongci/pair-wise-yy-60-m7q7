'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import {
  AccountTreeOutlined,
  AssessmentOutlined,
  AssignmentTurnedInOutlined,
  CheckCircleOutlined,
  CloudDoneOutlined,
  CloudOffOutlined,
  DashboardOutlined,
  DifferenceOutlined,
  FactCheckOutlined,
  FindInPageOutlined,
  GppMaybeOutlined,
  MenuOutlined,
  NotificationsNoneOutlined,
  PublishOutlined,
  RuleOutlined,
  ScienceOutlined,
  TaskAltOutlined
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { fetchEvidence } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { reconciliationBlocked, SYNC_META, isActive } from '@/lib/sync';
import { useCarbonStore } from '@/lib/store';
import SyncPanel from './SyncPanel';

const drawerWidth = 232;

type View = 'overview' | 'verify' | 'issuance';

function SyncBadge({ state, batchId, onClick }: { state: import('@/lib/sync').SyncState; batchId?: string; onClick?: () => void }) {
  if (state === 'clean') return null;
  const meta = SYNC_META[state];
  return (
    <Tooltip title={batchId && (state === 'confirmed' || state === 'conflict') ? `${meta.label} · 批次 ${batchId}` : meta.label}>
      <Chip
        size="small" onClick={onClick} clickable={Boolean(onClick)}
        icon={state === 'conflict' ? <DifferenceOutlined style={{ fontSize: 13 }} /> : state === 'confirmed' ? <CheckCircleOutlined style={{ fontSize: 13 }} /> : state === 'local' ? <CloudOffOutlined style={{ fontSize: 13 }} /> : state === 'failed' ? <PublishOutlined style={{ fontSize: 13 }} /> : undefined}
        label={`${meta.label}${batchId && state === 'confirmed' ? ` ${batchId.slice(-6)}` : ''}`}
        sx={{ height: 20, fontSize: 10, fontWeight: 750, color: meta.color, bgcolor: meta.bgcolor, '& .MuiChip-icon': { color: meta.color } }}
      />
    </Tooltip>
  );
}

export default function EvidenceWorkbench({ initialView }: { initialView: View }) {
  const [view] = useState<View>(initialView);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [recordFilter, setRecordFilter] = useState('全部');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [syncExpanded, setSyncExpanded] = useState(false);
  const [supplementDrafts, setSupplementDrafts] = useState<Record<string, string>>({});
  const store = useCarbonStore();
  const { data, isLoading } = useQuery({ queryKey: ['carbon-api'], queryFn: fetchEvidence });
  const online = !store.simulatedOffline && (typeof navigator === 'undefined' || navigator.onLine !== false);

  // 服务端数据回来后按版本对账：无在途操作则采用新版，有在途且版本落后则转冲突
  useEffect(() => {
    if (data) store.reconcileFromServer(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const selected = store.records.find((record) => record.id === store.selectedRecordId) ?? store.records[0];
  const visibleRecords = useMemo(() => recordFilter === '全部' ? store.records : store.records.filter((record) => record.status === recordFilter), [recordFilter, store.records]);
  const totalReduction = store.records.reduce((total, record) => total + record.activity * record.factor / (record.unit === 'kWh' ? 1000 : record.unit === 'L' ? 1000 : 1), 0);
  const openFindings = store.findings.filter((item) => item.status !== '已关闭');
  const reconciliation = reconciliationBlocked(store.records, store.findings, store.outbox);
  const issuanceBlocked = reconciliation.hasActive || reconciliation.hasConflict || openFindings.length > 0;
  const allIssuanceChecked = Object.values(store.issuanceChecks).every(Boolean) && !issuanceBlocked;
  const activeOps = store.outbox.filter((op) => isActive(op.status) || op.status === 'conflict');
  const batchSummary = store.outbox.reduce<Record<string, { confirmed: number; duplicate: number; active: number; conflict: number }>>((acc, op) => {
    const item = acc[op.batchId] ?? { confirmed: 0, duplicate: 0, active: 0, conflict: 0 };
    if (op.status === 'confirmed') item.confirmed += 1;
    if (op.status === 'duplicate') item.duplicate += 1;
    if (isActive(op.status)) item.active += 1;
    if (op.status === 'conflict') item.conflict += 1;
    acc[op.batchId] = item;
    return acc;
  }, {});
  const latestBatchId = Object.keys(batchSummary).sort().at(-1);
  const latestBatch = latestBatchId ? batchSummary[latestBatchId] : null;

  const expandSync = () => setSyncExpanded(true);

  const nav = [
    { id: 'overview', label: '监测期总览', href: '/', icon: DashboardOutlined },
    { id: 'verify', label: '证据与抽样核验', href: '/verify', icon: FindInPageOutlined },
    { id: 'issuance', label: '签发准备', href: '/issuance', icon: AssessmentOutlined }
  ];

  const navDrawer = (
    <Box sx={{ width: drawerWidth, bgcolor: '#f8faf9', height: '100%' }}>
      <Box sx={{ p: 2.2, pt: 3 }}>
        <Typography variant="overline" color="text.secondary">当前项目</Typography>
        <Typography fontWeight={800} fontSize={13} mt={.5}>{data?.project.name ?? '临港工业园区能效提升项目'}</Typography>
        <Typography variant="caption" color="text.secondary">{data?.project.id ?? 'CN-ER-2026-041'}</Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1.2 }}>
        {nav.map(({ id, label, href, icon: Icon }) => (
          <ListItemButton key={id} component={Link} href={href} selected={view === id} sx={{ borderRadius: 1, mb: .4, '&.Mui-selected': { bgcolor: '#e4f1ec', color: '#12664f' } }}>
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13, fontWeight: view === id ? 750 : 500 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 2, mt: 2 }}>
        <Box sx={{ p: 1.3, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'white' }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}><ScienceOutlined color="primary" fontSize="small" /><Typography fontSize={12} fontWeight={750}>核验状态</Typography></Stack>
          <LinearProgress variant="determinate" value={78} sx={{ height: 5, borderRadius: 2 }} />
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>78% 证据已完成初审</Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: '#173a31', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
        <Toolbar sx={{ minHeight: '62px !important', gap: 1.4 }}>
          <IconButton color="inherit" sx={{ display: { md: 'none' } }} onClick={() => setMobileOpen(true)}><MenuOutlined /></IconButton>
          <Box sx={{ width: 36, height: 36, borderRadius: 1, border: '1px solid #80b6a6', display: 'grid', placeItems: 'center' }}>
            <AccountTreeOutlined fontSize="small" />
          </Box>
          <Box>
            <Typography fontSize={15} fontWeight={800}>碳减排项目监测核验</Typography>
            <Typography fontSize={10} color="#a9c5bc">MRV Evidence & Issuance Readiness</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={online ? '已联网：修订与补录将自动按序补交' : '断网：处理先留本机，恢复网络后按序补交'}>
            <Chip
              size="small"
              icon={online ? <CloudDoneOutlined style={{ fontSize: 15 }} /> : <CloudOffOutlined style={{ fontSize: 15 }} />}
              label={online ? '已联网' : '断网暂存'}
              sx={{ color: online ? '#9fd8c4' : '#ffdda7', borderColor: online ? '#3f7d69' : '#a87935', bgcolor: 'rgba(255,255,255,.05)' }}
              variant="outlined"
            />
          </Tooltip>
          <Tooltip title="打开出箱对账队列">
            <Chip
              size="small" clickable onClick={expandSync}
              icon={<PublishOutlined style={{ fontSize: 15 }} />}
              label={activeOps.length > 0 ? `补交队列 ${activeOps.length}` : latestBatch ? `本批已确认 ${latestBatch.confirmed}` : '对账已对齐'}
              sx={{
                color: reconciliation.hasConflict ? '#ffb3a3' : reconciliation.hasActive ? '#ffdda7' : '#9fd8c4',
                borderColor: reconciliation.hasConflict ? '#a85844' : reconciliation.hasActive ? '#a87935' : '#3f7d69',
                bgcolor: 'rgba(255,255,255,.05)'
              }}
              variant="outlined"
            />
          </Tooltip>
          <Chip size="small" label={`${openFindings.length} 项发现开放`} sx={{ color: '#ffdda7', borderColor: '#a87935', bgcolor: 'rgba(255,255,255,.05)' }} variant="outlined" />
          <IconButton color="inherit"><NotificationsNoneOutlined /></IconButton>
          <Avatar sx={{ width: 30, height: 30, bgcolor: '#e1a45d', fontSize: 12 }}>沈</Avatar>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px', boxSizing: 'border-box', borderRightColor: '#dce4e0' } }}>{navDrawer}</Drawer>
      <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px' } }}>{navDrawer}</Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: '#f2f5f3', pt: '62px' }}>
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1640, mx: 'auto' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={2.4}>
            <Box>
              <Typography variant="overline" color="text.secondary" fontWeight={750}>CN-ER-2026-041 / {data?.summary.period ?? '第三监测期'}</Typography>
              <Typography variant="h5" fontWeight={850} mt={.3}>{view === 'overview' ? '监测期总览' : view === 'verify' ? '证据与抽样核验' : '签发准备'}</Typography>
              <Typography variant="body2" color="text.secondary" mt={.5}>{view === 'overview' ? '汇总活动数据、排放因子、证据完整度和异常波动。' : view === 'verify' ? '逐项核对来源、单位、时间范围，并保留修订链。' : '关闭发现项并完成签发前完整性门禁。'}</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<AssignmentTurnedInOutlined />}>导入监测数据</Button>
              <Tooltip title={allIssuanceChecked ? '' : '还有未确认补交、版本冲突或开放发现项'}>
                <span>
                  <Button variant="contained" startIcon={<TaskAltOutlined />} disabled={view !== 'issuance' || !allIssuanceChecked}>提交签发准备</Button>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
          {isLoading && <LinearProgress />}

          <SyncPanel expanded={syncExpanded} onExpandedChange={setSyncExpanded} />

          {(reconciliation.hasConflict || reconciliation.hasActive || latestBatch) && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1.4 }} flexWrap="wrap" useFlexGap>
              {reconciliation.hasConflict && (
                <Alert
                  severity="error" icon={<GppMaybeOutlined fontSize="small" />}
                  action={<Button size="small" color="inherit" onClick={expandSync}>去处理</Button>}
                  sx={{ flex: '1 1 320px', py: .3 }}
                >
                  {reconciliation.conflictingRecords.length + reconciliation.conflictingFindings.length} 项版本冲突未处理，继续挡住签发检查：
                  {[...reconciliation.conflictingRecords.map((r) => r.id), ...reconciliation.conflictingFindings.map((f) => f.id)].join('、')}
                </Alert>
              )}
              {reconciliation.hasActive && !reconciliation.hasConflict && (
                <Alert severity="warning" sx={{ flex: '1 1 320px', py: .3 }}>
                  {activeOps.filter((op) => isActive(op.status)).length} 条修订/补录尚未经服务端确认，先完成对账再计入签发准备。
                </Alert>
              )}
              {latestBatch && latestBatch.confirmed > 0 && (
                <Alert severity="success" icon={<CheckCircleOutlined fontSize="small" />} sx={{ flex: '1 1 320px', py: .3 }}>
                  同批 {latestBatchId}：{latestBatch.confirmed} 项已确认{latestBatch.duplicate ? `，${latestBatch.duplicate} 次重复补交已合并不再出版本` : ''}{latestBatch.active ? `，${latestBatch.active} 项待续交` : ''}{latestBatch.conflict ? `，${latestBatch.conflict} 项冲突待处理` : ''}。各页显示同批结果。
                </Alert>
              )}
            </Stack>
          )}

          {view === 'overview' && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 1.4, mb: 2 }}>
                {[
                  { label: '减排量', value: data?.summary.reduction.toLocaleString() ?? '18,426', unit: 'tCO₂e', note: '较上期 +6.4%' },
                  { label: '证据完整度', value: `${data?.summary.evidenceRate ?? 92}%`, unit: '', note: '5 份证据待补充' },
                  { label: '开放发现项', value: `${openFindings.length}`, unit: '项', note: '1 项阻塞签发' },
                  { label: '抽样任务', value: `${store.sampledIds.length} / 18`, unit: '', note: '完成率 67%' }
                ].map((item) => <Card elevation={0} variant="outlined" key={item.label}><CardContent sx={{ p: 1.8, '&:last-child': { pb: 1.8 } }}><Typography variant="caption" color="text.secondary">{item.label}</Typography><Stack direction="row" alignItems="baseline" spacing={.6} mt={.5}><Typography variant="h5" fontWeight={850}>{item.value}</Typography><Typography fontSize={12} color="text.secondary">{item.unit}</Typography></Stack><Typography fontSize={11} color="text.secondary" mt={.7}>{item.note}</Typography></CardContent></Card>)}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.55fr) minmax(300px, .7fr)' }, gap: 1.5 }}>
                <Card elevation={0} variant="outlined">
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1.6 }}>
                    <Box><Typography fontWeight={800} fontSize={14}>活动数据与计算链</Typography><Typography fontSize={11} color="text.secondary">选择记录查看公式、来源证据和修订版本</Typography></Box>
                    <Tabs value={recordFilter} onChange={(_, value) => setRecordFilter(value)} variant="scrollable"><Tab value="全部" label="全部" /><Tab value="待核验" label="待核验" /><Tab value="需补证" label="需补证" /><Tab value="已核验" label="已核验" /></Tabs>
                  </Stack>
                  <Divider />
                  <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ minWidth: 840 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .7fr', gap: 1, px: 1.7, py: 1, bgcolor: '#f7f9f8', color: 'text.secondary', fontSize: 11, fontWeight: 750 }}>
                        <span>数据来源</span><span>活动数据</span><span>排放因子</span><span>时间范围</span><span>证据</span><span>状态</span>
                      </Box>
                      {visibleRecords.map((record) => (
                        <Box key={record.id} role="button" tabIndex={0} onClick={() => store.selectRecord(record.id)} sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .7fr', gap: 1, px: 1.7, py: 1.25, borderTop: '1px solid #e8ecea', cursor: 'pointer', bgcolor: selected.id === record.id ? '#eff7f3' : 'white', '&:hover': { bgcolor: '#f6faf8' } }}>
                          <Box><Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography><Stack direction="row" spacing={.6} alignItems="center" mt={.2} flexWrap="wrap" useFlexGap><Typography fontSize={10} color="text.secondary">{record.id} · {record.owner} · V{record.revision}{record.serverRevision !== undefined && record.serverRevision !== record.revision ? ` / 服务端 V${record.serverRevision}` : ''}</Typography><SyncBadge state={record.syncState} batchId={record.confirmedBatch} onClick={record.syncState === 'conflict' ? expandSync : undefined} /></Stack>{record.syncState === 'conflict' && <Typography fontSize={10} color="#9a3b2c" mt={.3}>服务端 V{record.conflict?.serverRevision}：{record.conflict?.serverValue.toLocaleString()} {record.unit}，待核验员处理</Typography>}</Box>
                          <Box><Typography fontSize={12}>{record.activity.toLocaleString()} {record.unit}</Typography><Typography fontSize={10} color={record.anomaly > 5 ? 'secondary.main' : 'text.secondary'}>异常 {record.anomaly > 0 ? '+' : ''}{record.anomaly}%</Typography></Box>
                          <Typography fontSize={12}>{record.factor} <small>{record.factorUnit}</small></Typography>
                          <Typography fontSize={11}>{record.timeRange}</Typography>
                          <Typography fontSize={12}>{record.evidenceCount} 项</Typography>
                          <Chip size="small" label={record.status} color={record.status === '已核验' ? 'success' : record.status === '需补证' ? 'warning' : 'default'} variant={record.status === '已核验' ? 'filled' : 'outlined'} />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Card>
                <Stack spacing={1.5}>
                  <Card elevation={0} variant="outlined"><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={800} fontSize={14}>计算链展开</Typography><Stack direction="row" spacing={.6}><Chip size="small" label={selected.id} /><SyncBadge state={selected.syncState} batchId={selected.confirmedBatch} onClick={selected.syncState === 'conflict' ? expandSync : undefined} /></Stack></Stack>
                    {selected.syncState === 'conflict' && <Alert severity="error" icon={<DifferenceOutlined fontSize="small" />} sx={{ mt: 1, py: .2 }} action={<Button size="small" color="inherit" onClick={expandSync}>处理冲突</Button>}>本机 {selected.conflict?.localValue.toLocaleString()} {selected.unit}（V{selected.conflict?.localRevision}）vs 服务端 {selected.conflict?.serverValue.toLocaleString()} {selected.unit}（V{selected.conflict?.serverRevision}）</Alert>}
                    <Box sx={{ mt: 1.5, p: 1.3, bgcolor: '#f4f7f5', fontFamily: 'monospace', borderRadius: 1, fontSize: 11 }}>
                    <Box>活动数据 = {selected.activity.toLocaleString()} {selected.unit}</Box>
                    <Box mt={.6}>排放因子 = {selected.factor} {selected.factorUnit}</Box>
                    <Box mt={.6}>换算系数 = 0.001</Box>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ color: '#14644f', fontWeight: 800 }}>减排量 = {(selected.activity * selected.factor / 1000).toFixed(2)} tCO₂e</Box>
                  </Box><Stack direction="row" spacing={1} mt={1.5}><Button size="small" variant="outlined" onClick={() => { setCorrectionOpen(true); setCorrectionValue(String(selected.activity)); }}>修订数据</Button><Button size="small">查看证据</Button></Stack></CardContent></Card>
                  <Card elevation={0} variant="outlined"><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={800} fontSize={14}>核验发现项</Typography><Chip size="small" label={`${openFindings.length} 开放`} /></Stack>{openFindings.slice(0, 3).map((finding) => <Box key={finding.id} sx={{ py: 1, borderTop: '1px solid #edf0ef' }}><Stack direction="row" spacing={1}><Alert severity={finding.syncState === 'conflict' ? 'error' : finding.status === '补证中' ? 'warning' : 'error'} sx={{ p: .2, '& .MuiAlert-icon': { mr: .3, fontSize: 17 } }} /><Box><Typography fontSize={12} fontWeight={700}>{finding.title}</Typography><Typography fontSize={10} color="text.secondary" mt={.3}>{finding.assignee} · {finding.due}</Typography><Stack direction="row" spacing={.6} mt={.4}><SyncBadge state={finding.syncState} batchId={finding.confirmedBatch} onClick={finding.syncState === 'conflict' ? expandSync : undefined} /></Stack></Box></Stack></Box>)}
                  <Button component={Link} href="/verify" size="small" sx={{ mt: .5 }}>去核验页补录 / 处理</Button>
                  </CardContent></Card>
                </Stack>
              </Box>
            </>
          )}

          {view === 'verify' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 340px' }, gap: 1.5 }}>
              <Card elevation={0} variant="outlined">
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ p: 1.6 }}>
                  <Box><Typography fontWeight={800} fontSize={14}>证据矩阵与抽样任务</Typography><Typography fontSize={11} color="text.secondary">已抽取 {store.sampledIds.length} 条高价值记录</Typography></Box>
                  <Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => useCarbonStore.setState((state) => ({ sampledIds: store.records.filter((item) => Math.abs(item.anomaly) > 5).map((item) => item.id) }))}>按异常抽样</Button><Button variant="contained" onClick={store.batchVerify}>批量核验</Button></Stack>
                </Stack><Divider />
                {store.records.map((record) => (
                  <Box key={record.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '22px minmax(210px, 1.3fr) .8fr .8fr .8fr auto' }, alignItems: 'center', gap: 1.2, px: 1.6, py: 1.3, borderTop: '1px solid #edf0ef' }}>
                    <input type="checkbox" checked={store.sampledIds.includes(record.id)} onChange={() => store.toggleSample(record.id)} aria-label={`抽样 ${record.id}`} />
                    <Box><Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography><Stack direction="row" spacing={.6} alignItems="center" mt={.2} flexWrap="wrap" useFlexGap><Typography fontSize={10} color="text.secondary">{record.id} · 证据 {record.evidenceCount} 份 · V{record.revision}{record.serverRevision !== undefined && record.serverRevision !== record.revision ? ` / 服务端 V${record.serverRevision}` : ''}</Typography><SyncBadge state={record.syncState} batchId={record.confirmedBatch} onClick={record.syncState === 'conflict' ? expandSync : undefined} /></Stack></Box>
                    <Box><Typography variant="caption" color="text.secondary">来源</Typography><Typography fontSize={11}>原始计量记录</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">单位</Typography><Typography fontSize={11}>{record.unit} / {record.factorUnit}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">时间范围</Typography><Typography fontSize={11}>{record.timeRange.includes('至') ? '已覆盖整期' : '待检查'}</Typography></Box>
                    <Stack direction="row" spacing={.7}><Button size="small" variant="outlined" onClick={() => store.startCorrection(record.id)}>复核</Button><Button size="small" variant="contained" disabled={record.status === '需补证'} onClick={() => store.verifyRecord(record.id)}>通过</Button></Stack>
                  </Box>
                ))}
              </Card>
              <Stack spacing={1.5}>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={.5}><Typography fontWeight={800} fontSize={14}>发现项闭环</Typography><Chip size="small" label={`${openFindings.length} 开放`} /></Stack>
                  {store.findings.map((finding) => (
                    <Box key={finding.id} sx={{ borderTop: '1px solid #edf0ef', py: 1.2, bgcolor: finding.syncState === 'conflict' ? '#fdf5f2' : 'transparent' }}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Typography fontSize={12} fontWeight={700}>{finding.title}</Typography>
                        <Chip size="small" label={finding.status} color={finding.status === '已关闭' ? 'success' : finding.status === '补证中' ? 'warning' : 'error'} />
                      </Stack>
                      <Typography fontSize={10.5} color="text.secondary" mt={.5}>{finding.detail}</Typography>
                      <Stack direction="row" spacing={.6} mt={.7} flexWrap="wrap" useFlexGap>
                        <SyncBadge state={finding.syncState} batchId={finding.confirmedBatch} onClick={finding.syncState === 'conflict' ? expandSync : undefined} />
                        {finding.confirmedBatch && finding.syncState === 'confirmed' && <Typography fontSize={9.5} color="text.secondary" sx={{ alignSelf: 'center' }}>同批 {finding.confirmedBatch} 已确认 · 服务端 V{finding.serverRev ?? finding.rev}</Typography>}
                      </Stack>
                      {finding.syncState === 'conflict' && (
                        <Alert severity="error" icon={<DifferenceOutlined fontSize="small" />} sx={{ mt: .8, py: .2, '& .MuiAlert-message': { width: '100%' } }} action={<Button size="small" color="inherit" onClick={expandSync}>处理</Button>}>
                          服务端 V{finding.conflict?.serverRev} 状态「{finding.conflict?.serverStatus}」{finding.conflict?.serverNote ? ` · ${finding.conflict.serverNote}` : ''}；与本机补录冲突，未处理前继续挡住签发。
                        </Alert>
                      )}
                      {finding.notes && <Typography fontSize={10} color="#12664f" mt={.7}>本机补录：{finding.notes}</Typography>}
                      {finding.status !== '已关闭' && (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={.7} mt={.9}>
                          <TextField
                            size="small" fullWidth placeholder="补录补证进展（断网先留本机，恢复后按序补交）"
                            value={supplementDrafts[finding.id] ?? ''}
                            onChange={(event) => setSupplementDrafts((drafts) => ({ ...drafts, [finding.id]: event.target.value }))}
                            disabled={finding.syncState === 'conflict' || finding.syncState === 'submitting'}
                          />
                          <Button
                            size="small" variant="outlined" sx={{ whiteSpace: 'nowrap' }}
                            disabled={finding.syncState === 'conflict' || !(supplementDrafts[finding.id] ?? '').trim() || finding.syncState === 'submitting'}
                            onClick={() => {
                              const note = (supplementDrafts[finding.id] ?? '').trim();
                              if (!note) return;
                              store.enqueueFindingSupplement(finding.id, note);
                              setSupplementDrafts((drafts) => ({ ...drafts, [finding.id]: '' }));
                            }}
                          >补录入队</Button>
                          <Button size="small" sx={{ whiteSpace: 'nowrap' }} disabled={finding.syncState === 'conflict' || finding.syncState === 'submitting'} onClick={() => store.closeFinding(finding.id)}>关闭</Button>
                        </Stack>
                      )}
                    </Box>
                  ))}
                </CardContent></Card>
                <Alert severity="info">修订与补录先进入本机出箱队列并按序补交，重复补交不生成第二版；服务端有新版本时需核验员处理冲突后才能计入签发准备。</Alert>
              </Stack>
            </Box>
          )}

          {view === 'issuance' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' }, gap: 1.5 }}>
              <Stack spacing={1.5}>
                <Card elevation={0} variant="outlined">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box><Typography fontWeight={800} fontSize={14}>对账状态（计入签发的前提）</Typography><Typography fontSize={11} color="text.secondary">所有修订与发现项补录须同批确认；冲突须由核验员处理。</Typography></Box>
                      <Button size="small" variant="outlined" onClick={expandSync}>打开补交队列</Button>
                    </Stack>
                    <Box sx={{ overflowX: 'auto', mt: 1.3 }}>
                      <Box sx={{ minWidth: 640 }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 1fr 1.1fr', gap: 1, px: 1, py: .8, bgcolor: '#f7f9f8', fontSize: 10.5, fontWeight: 750, color: 'text.secondary' }}>
                          <span>记录 / 发现项</span><span>本机版本</span><span>服务端版本</span><span>对账结果</span>
                        </Box>
                        {store.records.map((record) => (
                          <Box key={record.id} sx={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 1fr 1.1fr', gap: 1, px: 1, py: .9, borderTop: '1px solid #edf0ef', alignItems: 'center' }}>
                            <Typography fontSize={11.5} fontWeight={700}>{record.id} 数据修订</Typography>
                            <Typography fontSize={11}>V{record.revision} · {record.activity.toLocaleString()}</Typography>
                            <Typography fontSize={11} color={record.syncState === 'conflict' ? '#9a3b2c' : 'text.primary'}>V{record.serverRevision ?? record.revision}{record.syncState === 'conflict' ? ` · ${(record.serverActivity ?? 0).toLocaleString()}` : ''}</Typography>
                            <SyncBadge state={record.syncState} batchId={record.confirmedBatch} onClick={record.syncState === 'conflict' ? expandSync : undefined} />
                          </Box>
                        ))}
                        {store.findings.map((finding) => (
                          <Box key={finding.id} sx={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 1fr 1.1fr', gap: 1, px: 1, py: .9, borderTop: '1px solid #edf0ef', alignItems: 'center' }}>
                            <Typography fontSize={11.5} fontWeight={700}>{finding.id} {finding.title}</Typography>
                            <Typography fontSize={11}>V{finding.rev} · {finding.status}</Typography>
                            <Typography fontSize={11} color={finding.syncState === 'conflict' ? '#9a3b2c' : 'text.primary'}>V{finding.serverRev ?? finding.rev} · {finding.serverStatus ?? finding.status}</Typography>
                            <SyncBadge state={finding.syncState} batchId={finding.confirmedBatch} onClick={finding.syncState === 'conflict' ? expandSync : undefined} />
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    {issuanceBlocked && (
                      <Alert severity={reconciliation.hasConflict ? 'error' : 'warning'} sx={{ mt: 1.3 }} icon={reconciliation.hasConflict ? <GppMaybeOutlined /> : undefined}>
                        {reconciliation.hasConflict
                          ? <>有 {reconciliation.conflictingRecords.length + reconciliation.conflictingFindings.length} 项版本冲突未处理，签发检查继续被挡住：{[...reconciliation.conflictingRecords.map((r) => r.id), ...reconciliation.conflictingFindings.map((f) => f.id)].join('、')}</>
                          : reconciliation.hasActive
                            ? `还有 ${activeOps.filter((op) => isActive(op.status)).length} 条修订/补录待补交确认，失败后从已确认记录继续。`
                            : `还有 ${openFindings.length} 个开放发现项，关闭并经服务端确认后才能计入签发准备。`}
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                <Card elevation={0} variant="outlined">
                  <CardContent>
                    <Typography fontWeight={800} fontSize={14}>签发前完整性检查</Typography>
                    <Typography fontSize={11} color="text.secondary" mb={1.5}>对账对齐后，所有门禁项必须确认，开放发现项必须关闭。</Typography>
                    {[
                      { id: 'evidence', title: '证据与计算链完整', detail: '活动数据、排放因子、来源证据与修订说明可追溯，且补交已同批确认。' },
                      { id: 'calculation', title: '计算过程复核通过', detail: '单位和换算系数一致，关键公式由核验员确认。' },
                      { id: 'revisions', title: '历史修订未覆盖原始数据', detail: '所有数据均有版本号和修订原因；冲突已由核验员处理。' },
                      { id: 'methodology', title: '方法学与监测计划匹配', detail: `项目采用 ${data?.project.methodology ?? 'CMS-052-V01'}。` }
                    ].map((item) => (
                      <Box key={item.id} component="label" sx={{ display: 'flex', gap: 1.3, alignItems: 'flex-start', borderTop: '1px solid #edf0ef', py: 1.5, cursor: issuanceBlocked ? 'not-allowed' : 'pointer', opacity: issuanceBlocked ? .62 : 1 }}>
                        <input type="checkbox" checked={store.issuanceChecks[item.id]} disabled={issuanceBlocked} onChange={() => store.toggleIssuanceCheck(item.id)} />
                        <Box><Typography fontSize={12.5} fontWeight={700}>{item.title}</Typography><Typography fontSize={10.5} color="text.secondary" mt={.4}>{item.detail}{issuanceBlocked && '（对账未对齐，暂不可确认）'}</Typography></Box>
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              </Stack>
              <Stack spacing={1.5}>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Typography fontWeight={800} fontSize={14}>签发就绪度</Typography>
                  <Stack direction="row" alignItems="baseline" spacing={1} mt={1}>
                    <Typography variant="h4" fontWeight={850}>{Math.round(Object.values(store.issuanceChecks).filter(Boolean).length / 4 * 70 + (issuanceBlocked ? 0 : 30))}%</Typography>
                    <Typography fontSize={11} color="text.secondary">完成度</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={Object.values(store.issuanceChecks).filter(Boolean).length / 4 * 100} sx={{ height: 7, borderRadius: 3, mt: 1 }} />
                  <Typography fontSize={11} color="text.secondary" mt={1.2}>
                    {reconciliation.hasConflict ? `${reconciliation.conflictingRecords.length + reconciliation.conflictingFindings.length} 项冲突待处理` : reconciliation.hasActive ? `${activeOps.filter((op) => isActive(op.status)).length} 条补交未确认` : `${openFindings.length} 个开放发现项`}。
                  </Typography>
                  {latestBatch && <Typography fontSize={10} color="#12664f" mt={.6}>同批 {latestBatchId}：确认 {latestBatch.confirmed} / 重复合并 {latestBatch.duplicate}{latestBatch.conflict ? ` / 冲突 ${latestBatch.conflict}` : ''}{latestBatch.active ? ` / 待续交 ${latestBatch.active}` : ''}</Typography>}
                </CardContent></Card>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Stack direction="row" justifyContent="space-between"><Typography fontWeight={800} fontSize={14}>版本与核验意见</Typography></Stack>
                  {store.outbox.filter((op) => op.status === 'confirmed' || op.status === 'duplicate' || op.resolution).slice(-5).reverse().map((op) => (
                    <Stack key={op.id} direction="row" spacing={1.2} sx={{ borderTop: '1px solid #edf0ef', py: 1.1 }}>
                      <Chip size="small" label={`V${op.serverRevision ?? '?'}`} color={op.resolution === 'server' ? 'secondary' : 'success'} variant="outlined" />
                      <Box>
                        <Typography fontSize={11.5} fontWeight={700}>{op.kind === 'revision' ? '数据修订' : op.kind === 'findingClose' ? '关闭发现项' : '发现项补录'} · {op.targetId}</Typography>
                        <Typography fontSize={10.5} color="text.secondary">
                          {op.status === 'duplicate' ? '重复补交已合并，不生成第二版' : `批次 ${op.batchId} 已确认`}
                          {op.resolutionNote ? ` · 核验意见：${op.resolutionNote}` : op.reason ? ` · ${op.reason}` : op.note ? ` · ${op.note}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                  {store.outbox.length === 0 && <Typography fontSize={11} color="text.secondary" mt={1}>暂无本批次补交记录。</Typography>}
                </CardContent></Card>
                <Alert severity={allIssuanceChecked ? 'success' : reconciliation.hasConflict ? 'error' : 'warning'}>
                  {allIssuanceChecked ? '对账已对齐、全部门禁已完成，可提交签发准备。' : reconciliation.hasConflict ? '冲突发现项处理前，签发检查不可确认。' : '完成对账、关闭开放发现项并完成所有检查后可提交。'}
                </Alert>
              </Stack>
            </Box>
          )}
        </Box>
      </Box>

      <Tooltip title="核验记录会写入审计链"><Button sx={{ position: 'fixed', bottom: 18, right: 18, zIndex: 5 }} variant="contained" size="small" startIcon={<FactCheckOutlined />}>操作均留痕</Button></Tooltip>
      {correctionOpen && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 60, bgcolor: 'rgba(15,25,22,.4)', display: 'grid', placeItems: 'center', p: 2 }} onMouseDown={() => setCorrectionOpen(false)}>
          <Card sx={{ width: 'min(520px, 100%)' }} onMouseDown={(event) => event.stopPropagation()}><CardContent sx={{ p: 2.2 }}>
            <Typography variant="h6" fontWeight={800}>修订活动数据</Typography>
            <Typography variant="body2" color="text.secondary" mt={.5}>当前值 {selected.activity.toLocaleString()} {selected.unit}。{online ? '将以服务端 V' + (selected.serverRevision ?? selected.revision) + ' 为基线提交' : '断网期间先留本机，恢复网络后按序补交'}，重复补交不会生成第二版。</Typography>
            <TextField fullWidth size="small" label={`修订值 / ${selected.unit}`} value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} margin="normal" />
            <TextField fullWidth size="small" label="修订原因" multiline rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} margin="normal" />
            {!correctionReason.trim() && <Alert severity="warning">必须填写修订原因。</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end" mt={2}><Button onClick={() => setCorrectionOpen(false)}>取消</Button><Button variant="contained" disabled={!correctionReason.trim() || !Number(correctionValue) || selected.syncState === 'conflict'} onClick={() => { store.enqueueRevision(selected.id, Number(correctionValue), correctionReason); setCorrectionOpen(false); setCorrectionReason(''); setCorrectionValue(''); }}>{online ? '生成新版本' : '留本机待补交'}</Button></Stack>
          </CardContent></Card>
        </Box>
      )}
    </Box>
  );
}
