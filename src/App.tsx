import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ActionIcon,
  AppShell,
  AppShellHeader,
  AppShellMain,
  AppShellNavbar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAnchor,
  IconCheck,
  IconCube,
  IconHistory,
  IconLayoutBoardSplit,
  IconLock,
  IconPlayerPlay,
  IconPrinter,
  IconRefresh,
  IconRulerMeasure,
  IconRoute,
  IconShip,
  IconUsers
} from '@tabler/icons-react';
import * as THREE from 'three';
import { useGetVoyageQuery, type Cargo } from './api';
import {
  acceptComment,
  acceptLimit,
  addComment,
  calculateStability,
  deckSlotKey,
  detectConflicts,
  diffCargo,
  latestVersion,
  lockPlan,
  moveCargo,
  rejectComment,
  selectCargo,
  setViewMode,
  store,
  updateLashing,
  type CargoDiff,
  type PlanVersion,
  type RootState
} from './store';

const nav = [
  { path: '/', label: '航次总览', icon: <IconShip size={17} /> },
  { path: '/stowage', label: '配载与货位', icon: <IconLayoutBoardSplit size={17} /> },
  { path: '/compare', label: '方案对比', icon: <IconHistory size={17} /> },
  { path: '/print', label: '配载图与清单', icon: <IconPrinter size={17} /> }
];

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><Group gap="xs">{actions}</Group></div>;
}

/** 主甲板缩略货位图：按实际货位动态成格，可高亮新旧版本中发生变化的槽位 */
function MiniDeck({ cargo, variant, changedKeys }: { cargo: Cargo[]; variant: 'old' | 'new'; changedKeys?: Set<string> }) {
  const deck = cargo.filter((item) => item.deck === '主甲板');
  const bays = Array.from(new Set(deck.map((item) => item.bay))).sort((a, b) => a - b);
  const rows = Array.from(new Set(deck.map((item) => item.row))).sort((a, b) => a - b);
  return <div className="mini-deck" style={{ gridTemplateColumns: `repeat(${Math.max(bays.length, 1)}, 1fr)` }}>
    {bays.flatMap((bay) => rows.map((row) => {
      const item = deck.find((cargoItem) => cargoItem.bay === bay && cargoItem.row === row);
      const changed = item && changedKeys?.has(deckSlotKey(item));
      return <div key={`${bay}-${row}`} className={changed ? `changed ${variant}-deck` : ''} style={item && !changed ? { background: item.color } : undefined} title={item ? `${item.bill} · B${bay}/R${row}` : `B${bay}/R${row}`}>{item?.bill.slice(-3)}</div>;
    }))}
  </div>;
}

function ThreeHold({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const activeId = useSelector((root: RootState) => root.stowage.activeCargoId);
  const dispatch = useDispatch();
  const [rotation, setRotation] = useState({ theta: .65, phi: 1.05 });
  void rotation;
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce7e3');
    scene.fog = new THREE.Fog('#dce7e3', 38, 88);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 200);
    scene.add(new THREE.HemisphereLight('#ffffff', '#4b625b', 2.4));
    const light = new THREE.DirectionalLight('#fff5dd', 3.3);
    light.position.set(22, 38, 20);
    light.castShadow = true;
    scene.add(light);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ color: '#4c7c86', roughness: .72 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.15;
    scene.add(water);
    const hullMat = new THREE.MeshStandardMaterial({ color: '#214c46', roughness: .55, metalness: .18 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#8b928d', roughness: .9 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(56, 5.5, 18), hullMat);
    hull.position.y = 2.2;
    hull.castShadow = true;
    scene.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(56, .45, 18), deckMat);
    deck.position.y = 5.15;
    deck.receiveShadow = true;
    scene.add(deck);
    for (let x = -24; x <= 24; x += 4) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, 18), new THREE.MeshBasicMaterial({ color: '#b8c8c3' }));
      line.position.set(x, 5.4, 0);
      scene.add(line);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 14), new THREE.MeshStandardMaterial({ color: '#e6e5df' }));
    bridge.position.set(21, 8.7, 0);
    scene.add(bridge);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 16), new THREE.MeshStandardMaterial({ color: '#c26843' }));
    stack.position.set(18, 14.2, 0);
    scene.add(stack);
    const boxes: THREE.Mesh[] = [];
    cargo.filter((item) => item.type === '集装箱').forEach((item) => {
      const geometry = item.dimension.startsWith('20') ? new THREE.BoxGeometry(2.35, 2.3, 2.3) : new THREE.BoxGeometry(4.5, 2.3, 2.3);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: .68 }));
      mesh.position.set((item.bay - 20) * 2.2, item.deck === '主甲板' ? 6.7 + item.tier * 2.45 : 2.1 + item.tier * 2.45, (item.row - 4) * 2.5);
      mesh.castShadow = true;
      mesh.userData.id = item.id;
      boxes.push(mesh);
      scene.add(mesh);
    });
    const heavy = cargo.find((item) => item.type === '重大件');
    if (heavy) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.4, 3), new THREE.MeshStandardMaterial({ color: heavy.color }));
      mesh.position.set((heavy.bay - 20) * 2.2, 6.7, 1.2);
      mesh.userData.id = heavy.id;
      boxes.push(mesh);
      scene.add(mesh);
      const center = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 8.5, 12), new THREE.MeshStandardMaterial({ color: '#e9b54d' }));
      center.position.set((heavy.bay - 20) * 2.2, 7.95, 1.2);
      center.rotation.z = Math.PI / 2;
      scene.add(center);
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let theta = .65;
    let phi = 1.05;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      theta += (event.clientX - lastX) * .007;
      phi = Math.max(.5, Math.min(1.55, phi + (event.clientY - lastY) * .005));
      lastX = event.clientX;
      lastY = event.clientY;
      setRotation({ theta, phi });
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(boxes)[0];
      if (hit?.object.userData.id) dispatch(selectCargo(String(hit.object.userData.id)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const radius = compact ? 68 : 61;
      camera.position.set(Math.sin(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius + 15, Math.cos(theta) * Math.sin(phi) * radius);
      camera.lookAt(0, 7, 0);
      boxes.forEach((box) => { box.material = box.material as THREE.MeshStandardMaterial; (box.material as THREE.MeshStandardMaterial).emissive = box.userData.id === activeId ? new THREE.Color('#1a5c4b') : new THREE.Color('#000000'); });
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      renderer.dispose();
    };
  }, [activeId, cargo, compact, dispatch]);
  return <div ref={containerRef} className="three-hold"><canvas ref={canvasRef} /><div className="three-legend"><span><i style={{ background: '#2b7c75' }} />集装箱</span><span><i style={{ background: '#b64f49' }} />重大件</span><span><i style={{ background: '#e9b54d' }} />吊点</span></div><div className="three-hint">拖动旋转 · 点击货箱选择</div><div className="orientation">艏 <span>→</span> 艉</div></div>;
}

function SectionView() {
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const dispatch = useDispatch();
  return <div className="section-view"><div className="section-labels"><span>第 3 层</span><span>第 2 层</span><span>第 1 层</span><span>舱底</span></div><div className="section-grid">{Array.from({ length: 9 * 4 }).map((_, index) => { const tier = 4 - Math.floor(index / 9); const row = index % 9; const item = cargo.find((cargoItem) => cargoItem.tier === tier && cargoItem.row === row); return <button key={index} className={item ? 'occupied' : ''} style={item ? { background: item.color } : undefined} onClick={() => item && dispatch(selectCargo(item.id))} title={item ? `${item.id} · ${item.weight}t` : `空货位 R${row} T${tier}`}>{item?.bill.slice(-3)}</button>; })}</div><div className="section-axis">舱内横向剖面 · 鼠标悬停查看重量</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.stowage);
  const { data } = useGetVoyageQuery();
  const dispatch = useDispatch();
  const latest = latestVersion(state.versions);
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo);
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  return <div className="page">
    <PageHeading eyebrow={`${data?.id ?? 'V-2609-17'} / 航次审阅`} title="多用途船舶配载校核" description={`${data?.vessel ?? '海岳轮'} · ${data?.route ?? '上海 → 釜山 → 温哥华'} · 计划离港 ${data?.departure ?? '10-02 14:00'}`} actions={<><Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>{state.viewMode === '3d' ? '二维剖面' : '三维视角'}</Button><Tooltip label={conflicts.length ? '仍有配载冲突，处理后才能形成审阅结论' : '把当前草稿冻结为只读版本，之后编辑进入新草稿'} disabled={false}><Button color="teal" leftSection={<IconLock size={16} />} disabled={conflicts.length > 0} onClick={() => dispatch(lockPlan())}>{latest ? `锁定草稿 V${state.planRevision}` : '锁定配载版本'}</Button></Tooltip></>} />
    {conflicts.length > 0 && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{conflicts.length} 项配载冲突待处理</strong><span>{conflicts.map((item) => item.title).join('、')}（冲突清零前不能锁定，已锁定版本不受影响）</span></div>}
    {latest && <div className="locked-banner"><IconLock size={16} /><span>最近锁定版本 <strong>V{latest.revision}</strong>（{latest.lockedAt}）为只读，当前编辑的是草稿 V{state.planRevision}，拖货与意见处理不会改动旧版本。</span></div>}
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">{[
      ['总货重', `${stability.total.toFixed(1)} t`, '设计上限 3560 t', 'ok'],
      ['稳性裕度', `${stability.stability.toFixed(1)}%`, stability.stability > 70 ? '符合航次要求' : '低于控制线', stability.stability > 70 ? 'ok' : 'bad'],
      ['纵倾状态', stability.trim, `Lcg ${stability.longitudinal.toFixed(2)} m`, 'ok'],
      ['主甲板载荷', `${stability.deckLoad.toFixed(1)} t`, '局部强度已校核', 'ok']
    ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}</SimpleGrid>
    <div className="overview-grid">
      <Card padding={0} className="scene-card"><div className="panel-title"><div><strong>{state.viewMode === '3d' ? '三维货位与航次分布' : '舱内横向剖面'}</strong><Text size="xs" c="dimmed">货箱颜色对应目的港与货类</Text></div><Group gap={6}><Badge color="teal" variant="light">草稿 V{state.planRevision}</Badge>{latest && <Badge color="gray" variant="light">基线 V{latest.revision}</Badge>}</Group></div>{state.viewMode === '3d' ? <ThreeHold /> : <SectionView />}</Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>当前货位</strong><Text size="xs" c="dimmed">{active.id}</Text></div><Badge color={active.hazmat !== '无' ? 'orange' : 'gray'}>{active.hazmat === '无' ? '普通货' : '危险品'}</Badge></div><Stack gap={6} mt="sm"><Text fw={700}>{active.bill} · {active.type}</Text><Text size="xs" c="dimmed">{active.dimension}</Text><SimpleGrid cols={2} spacing="xs"><div className="mini-stat"><span>重量</span><strong>{active.weight} t</strong></div><div className="mini-stat"><span>卸货港</span><strong>{active.port}</strong></div><div className="mini-stat"><span>货位</span><strong>Bay {active.bay} / Row {active.row} / Tier {active.tier}</strong></div><div className="mini-stat"><span>绑扎</span><strong>{active.lashing}</strong></div></SimpleGrid></Stack></Card>
        <Card padding="md"><div className="panel-title"><div><strong>重量分布</strong><Text size="xs" c="dimmed">按横向货位统计（草稿）</Text></div><IconRulerMeasure size={18} /></div><div className="weight-bars">{[2, 4, 6, 8, 10, 12, 14].map((bay) => { const weight = state.cargo.filter((item) => item.bay === bay).reduce((sum, item) => sum + item.weight, 0); return <div key={bay}><span>{weight.toFixed(0)}t</span><i style={{ height: `${Math.max(8, weight / 1.2)}px` }} /><small>B{bay}</small></div>; })}</div></Card>
        <Card padding="md"><div className="panel-title"><div><strong>角色限制条件</strong><Text size="xs" c="dimmed">{state.comments.filter((item) => item.status === '待确认').length} 项待确认 · 草稿意见</Text></div><IconUsers size={18} /></div>{state.comments.slice(0, 3).map((comment) => <div className="limit-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role}</Text><Text size="xs" c="dimmed">{comment.content}</Text></div><Badge size="xs" color={comment.status === '待确认' ? 'orange' : 'teal'}>{comment.status}</Badge></div>)}</Card>
      </Stack>
    </div>
  </div>;
}

function Stowage() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const latest = latestVersion(state.versions);
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  const conflicts = detectConflicts(state.cargo);
  const stability = calculateStability(state.cargo);
  const [bay, setBay] = useState(active.bay);
  const [row, setRow] = useState(active.row);
  const [tier, setTier] = useState(active.tier);
  const [dragId, setDragId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { setBay(active.bay); setRow(active.row); setTier(active.tier); }, [active.bay, active.row, active.tier]);
  const slots = useMemo(() => Array.from({ length: 28 }).map((_, index) => ({ id: `slot-${index}`, bay: 4 + Math.floor(index / 4), row: index % 4, tier: 0, label: `B${4 + Math.floor(index / 4)} R${index % 4}` })), []);
  return <div className="page">
    <PageHeading eyebrow={`配载工作区 / 草稿 V${state.planRevision}${latest ? ` · 基线 V${latest.revision}` : ''}`} title="货位安排与冲突校核" description="拖动货箱排序，或输入目标货位精确调整；修改只进入当前草稿，已锁定版本保持不变。" actions={<Badge size="lg" color={conflicts.length ? 'orange' : 'teal'} leftSection={<IconCheck size={14} />}>{conflicts.length ? `${conflicts.length} 项冲突` : '校验通过'}</Badge>} />
    <div className="stowage-grid">
      <Card padding={0} className="cargo-list-panel"><div className="panel-title"><div><strong>货物清单</strong><Text size="xs" c="dimmed">{state.cargo.length} 票 · 可拖拽</Text></div><TextInput size="xs" placeholder="搜索提单号" /></div><ScrollArea h={600}><div className="cargo-list">{state.cargo.map((item) => <button draggable onDragStart={() => setDragId(item.id)} key={item.id} className={state.activeCargoId === item.id ? 'active' : ''} onClick={() => dispatch(selectCargo(item.id))}><i style={{ background: item.color }} /><div><strong>{item.bill}</strong><span>{item.type} · {item.weight}t · {item.port}</span></div><Badge size="xs" color={item.hazmat === '无' ? 'gray' : 'orange'}>{item.hazmat === '无' ? `B${item.bay}` : 'DG'}</Badge></button>)}</div></ScrollArea></Card>
      <Card padding={0} className="deck-panel"><div className="panel-title"><div><strong>主甲板货位图</strong><Text size="xs" c="dimmed">将货物拖入槽位，或点击槽位选择</Text></div><Group gap="xs"><Badge color="teal">稳性 {stability.stability.toFixed(1)}%</Badge><Badge color="gray">{stability.trim}</Badge></Group></div><div className="deck-layout"><div className="bridge-shape">驾驶台</div><div className="slot-grid">{slots.map((slot) => { const occupied = state.cargo.find((item) => item.deck === '主甲板' && item.bay === slot.bay && item.row === slot.row); return <button key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragId) dispatch(moveCargo({ id: dragId, bay: slot.bay, row: slot.row, tier: occupied?.tier ?? 1 })); setDragId(null); }} className={occupied ? 'occupied' : ''} style={occupied ? { background: occupied.color } : undefined} onClick={() => { if (occupied) { dispatch(selectCargo(occupied.id)); setRow(slot.row); setBay(slot.bay); } }}><small>{slot.label}</small>{occupied && <strong>{occupied.bill.slice(-3)}<span>{occupied.weight}t</span></strong>}</button>; })}</div><div className="deck-axis">左舷 ← 横向 Row → 右舷</div></div></Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>精确调整</strong><Text size="xs" c="dimmed">{active.id} · 草稿 V{state.planRevision}</Text></div><IconCube size={18} /></div><Stack gap="sm" mt="md"><NumberInput label="Bay 纵向货位" min={1} max={20} value={bay} onChange={(value) => setBay(Number(value))} /><NumberInput label="Row 横向货位" min={0} max={8} value={row} onChange={(value) => setRow(Number(value))} /><NumberInput label="Tier 堆码层" min={0} max={4} value={tier} onChange={(value) => setTier(Number(value))} /><Button color="teal" onClick={() => dispatch(moveCargo({ id: active.id, bay, row, tier }))}>应用货位调整</Button><Divider /><Select label="绑扎状态" data={['已绑扎', '待绑扎', '需复核']} value={active.lashing} onChange={(value) => value && dispatch(updateLashing({ id: active.id, lashing: value as Cargo['lashing'] }))} /></Stack></Card>
        <Card padding="md" className={conflicts.length ? 'conflict-card' : ''}><div className="panel-title"><div><strong>实时冲突</strong><Text size="xs" c="dimmed">重心、稳性、隔离与堆码</Text></div><IconAlertTriangle size={18} /></div>{conflicts.map((item) => <button className="conflict-row" key={item.id} onClick={() => dispatch(selectCargo(item.cargoId))}><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}{!conflicts.length && <Text size="sm" c="teal" mt="md">当前草稿未发现冲突，可形成审阅结论。</Text>}</Card>
      </Stack>
    </div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>角色条件与审批</strong><Text size="xs" c="dimmed">船长、码头和货主代表可对草稿提出限制；锁定时的意见状态会原样冻结进只读版本</Text></div><IconUsers size={18} /></div><div className="comments-grid">{state.comments.map((item) => <div className="comment-card" key={item.id}><Group justify="space-between"><Badge size="xs">{item.role}</Badge><Text size="xs" c="dimmed">{item.author}</Text></Group><Text size="sm" mt="xs">{item.content}</Text><Group gap="xs" mt="sm"><Button size="compact-xs" color="teal" disabled={item.status !== '待确认'} onClick={() => dispatch(acceptComment(item.id))}>接受</Button><Button size="compact-xs" variant="default" disabled={item.status !== '待确认'} onClick={() => dispatch(rejectComment(item.id))}>退回</Button></Group></div>)}</div><Group mt="md" align="flex-start"><Textarea flex={1} minRows={2} placeholder="输入新的限制条件或调整意见（只影响当前草稿）" value={comment} onChange={(event) => setComment(event.currentTarget.value)} /><Button color="teal" onClick={() => { if (comment.trim()) { dispatch(addComment({ cargoId: active.id, author: '本次负责人', role: '船长', content: comment })); setComment(''); } }}>提交条件</Button></Group></Card>
  </div>;
}

const diffKindLabel: Record<CargoDiff['kind'], { label: string; color: string }> = {
  moved: { label: '货位调整', color: 'teal' },
  modified: { label: '绑扎/信息变更', color: 'orange' },
  added: { label: '新增货物', color: 'blue' },
  removed: { label: '移除货物', color: 'red' }
};

/** 只读审阅结论：展示锁定当时的条件接受、冲突记录与各方意见 */
function LockedConclusion({ version }: { version: PlanVersion }) {
  return <Card padding="md" mt="md" className="locked-conclusion">
    <div className="panel-title"><div><strong>审阅结论 V{version.revision}（只读版本）</strong><Text size="xs" c="dimmed">锁定于 {version.lockedAt} · 记录冲突 {version.conflicts.length} 项 · 后续草稿调整不会改写本版本</Text></div><Badge color="teal" leftSection={<IconLock size={12} />}>已冻结</Badge></div>
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="md">
      <div><Text size="xs" fw={800} c="dimmed" mb={6}>锁定时接受的条件（{version.acceptedLimits.length}）</Text>{version.acceptedLimits.map((limit) => <div className="conclusion-row" key={limit}><IconCheck size={14} color="#237162" /><Text size="xs">{limit}</Text></div>)}{!version.acceptedLimits.length && <Text size="xs" c="dimmed">无</Text>}</div>
      <div><Text size="xs" fw={800} c="dimmed" mb={6}>船长 / 码头 / 货主意见（{version.comments.length}）</Text>{version.comments.map((comment) => <div className="conclusion-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role} <Badge size="xs" ml={4} color={comment.status === '已接受' ? 'teal' : comment.status === '已退回' ? 'red' : 'orange'}>{comment.status}</Badge></Text><Text size="xs" c="dimmed">{comment.content}</Text></div></div>)}{!version.comments.length && <Text size="xs" c="dimmed">无</Text>}</div>
    </SimpleGrid>
  </Card>;
}

function Compare() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const latest = latestVersion(state.versions);
  const base = state.versions.find((version) => String(version.revision) === baseRevision) ?? latest;
  const draftConflicts = detectConflicts(state.cargo);
  const stabilityDraft = calculateStability(state.cargo);
  const diffs = useMemo(() => (base ? diffCargo(base.cargo, state.cargo) : []), [base, state.cargo]);
  const stabilityBase = base ? calculateStability(base.cargo) : null;
  const changedIds = new Set(diffs.map((diff) => diff.cargoId));
  const oldChanged = new Set(base ? base.cargo.filter((item) => changedIds.has(item.id) && item.deck === '主甲板').map(deckSlotKey) : []);
  const newChanged = new Set(state.cargo.filter((item) => changedIds.has(item.id) && item.deck === '主甲板').map(deckSlotKey));
  return <div className="page">
    <PageHeading eyebrow={base ? `PLAN BASELINE / V${base.revision} → 草稿 V${state.planRevision}` : 'PLAN BASELINE / 尚无锁定版本'} title="配载方案对比" description="选定只读锁定版本与当前草稿逐票比较货位、绑扎等差异；锁定版本的审阅结论不再随草稿变化。" actions={<>{state.versions.length > 0 && <Select size="xs" w={210} value={base ? String(base.revision) : null} onChange={setBaseRevision} data={state.versions.map((version) => ({ value: String(version.revision), label: `基线 V${version.revision} · ${version.lockedAt}` }))} />}<Tooltip label={draftConflicts.length ? '草稿仍有冲突，不能形成审阅结论' : undefined} disabled={!draftConflicts.length}><Button color="teal" leftSection={<IconLock size={16} />} disabled={draftConflicts.length > 0} onClick={() => setAcceptOpen(true)}>形成审阅结论</Button></Tooltip></>} />
    {!base ? <Card padding="lg" className="empty-locked"><Group gap="md" wrap="nowrap"><ThemeIcon size={42} color="teal" variant="light"><IconLock size={22} /></ThemeIcon><div><strong>尚无锁定版本</strong><Text size="sm" c="dimmed" display="block">形成审阅结论后，当时的货位、冲突、条件接受和船长 / 码头 / 货主意见会冻结为只读版本；之后拖货、改绑扎或处理意见进入新草稿，旧版本内容不再变化。请先在配载页清零冲突。</Text></div></Group></Card> : <>
      <div className="compare-summary"><div><span>当前草稿</span><strong>V{state.planRevision}</strong><small>总重 {stabilityDraft.total.toFixed(1)}t · 编辑于 {state.draftSavedAt}</small></div><span className="compare-arrow">→</span><div><span>只读基线</span><strong>V{base.revision}</strong><small>总重 {stabilityBase!.total.toFixed(1)}t · 锁定 {base.lockedAt}</small></div><Badge color={diffs.length ? 'teal' : 'gray'} variant="light">{diffs.length} 票货物变化</Badge></div>
      <div className="compare-grid"><Card padding={0}><div className="panel-title"><div><strong>V{base.revision} 基线（只读）</strong><Text size="xs" c="dimmed">锁定于 {base.lockedAt}</Text></div></div><MiniDeck cargo={base.cargo} variant="old" changedKeys={oldChanged} /></Card><Card padding={0}><div className="panel-title"><div><strong>V{state.planRevision} 草稿</strong><Text size="xs" c="dimmed">当前编辑 · {state.draftSavedAt} 自动保存</Text></div></div><MiniDeck cargo={state.cargo} variant="new" changedKeys={newChanged} /></Card></div>
      <Card padding="md" mt="md"><div className="panel-title"><div><strong>参数差异</strong><Text size="xs" c="dimmed">草稿相对 V{base.revision} 的实际变化，随编辑实时更新</Text></div><Badge>{diffs.length} 项</Badge></div>{diffs.length ? <Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>货物</Table.Th><Table.Th>类型</Table.Th><Table.Th>字段</Table.Th><Table.Th>V{base.revision}（锁定）</Table.Th><Table.Th>V{state.planRevision}（草稿）</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{diffs.flatMap((diff) => { const kind = diffKindLabel[diff.kind]; const head = <Table.Td key="cargo" rowSpan={Math.max(diff.changes.length, 1)}>{diff.bill}<Text size="xs" c="dimmed" display="block">{diff.cargoId}</Text></Table.Td>; const badge = <Table.Td key="kind" rowSpan={Math.max(diff.changes.length, 1)}><Badge size="xs" color={kind.color}>{kind.label}</Badge></Table.Td>; if (!diff.changes.length) return [<Table.Tr key={diff.cargoId}>{head}{badge}<Table.Td>整票货物</Table.Td><Table.Td><Text c="red" td="line-through">{diff.kind === 'removed' ? '在船' : '—'}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{diff.kind === 'added' ? '加入草稿' : '已移除'}</Text></Table.Td></Table.Tr>]; return diff.changes.map((change, index) => <Table.Tr key={`${diff.cargoId}-${change.field}`}>{index === 0 && head}{index === 0 && badge}<Table.Td>{change.field}</Table.Td><Table.Td><Text c="red" td="line-through">{change.before}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{change.after}</Text></Table.Td></Table.Tr>); })}</Table.Tbody></Table> : <Text size="sm" c="dimmed" p="md">草稿与 V{base.revision} 完全一致，暂无差异。</Text>}</Card>
      <LockedConclusion version={base} />
    </>}
    <Modal opened={acceptOpen} onClose={() => setAcceptOpen(false)} title={`形成配载审阅结论 · 锁定草稿 V${state.planRevision}`} centered><Stack><Text size="sm" c="dimmed">接受后生成新的只读版本，保留当前货位、冲突、条件接受与船长、码头、货主意见；之后的拖货、绑扎调整和意见处理进入新草稿。</Text>{['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'].map((limit) => <Checkbox key={limit} label={limit} checked={state.acceptedLimits.includes(limit)} onChange={() => dispatch(acceptLimit(limit))} />)}{draftConflicts.length > 0 && <Text size="xs" c="red">草稿仍有 {draftConflicts.length} 项冲突，清零后才能锁定（已有锁定版本不受影响）。</Text>}<Button color="teal" disabled={state.acceptedLimits.length < 3 || draftConflicts.length > 0} onClick={() => { dispatch(lockPlan()); setBaseRevision(null); setAcceptOpen(false); }}>接受并锁定 V{state.planRevision}</Button></Stack></Modal>
  </div>;
}

function PrintPlan() {
  const { data } = useGetVoyageQuery();
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const latest = latestVersion(state.versions);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedValue = selected ?? (latest ? `v${latest.revision}` : 'draft');
  const isDraft = selectedValue === 'draft';
  const version = isDraft ? null : state.versions.find((item) => `v${item.revision}` === selectedValue) ?? null;
  const cargo = isDraft ? state.cargo : version!.cargo;
  const comments = isDraft ? state.comments : version!.comments;
  const acceptedLimits = isDraft ? state.acceptedLimits : version!.acceptedLimits;
  const stability = calculateStability(cargo);
  const deck = cargo.filter((item) => item.deck === '主甲板');
  const bays = Array.from(new Set(deck.map((item) => item.bay))).sort((a, b) => a - b);
  const rows = Array.from(new Set(deck.map((item) => item.row))).sort((a, b) => a - b);
  const options = [{ value: 'draft', label: `草稿 V${state.planRevision} · 编辑于 ${state.draftSavedAt}` }, ...state.versions.map((item) => ({ value: `v${item.revision}`, label: `锁定版本 V${item.revision} · ${item.lockedAt}` }))];
  return <div className="page print-page">
    <PageHeading eyebrow="STOWAGE PLAN / PRINT" title="配载图与卸货清单" description="可选择草稿或任一只读锁定版本打印；打印内容固定为所选版本，不随后续编辑变化。" actions={<><Button variant="default" leftSection={<IconPlayerPlay size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>预览剖面</Button><Button color="teal" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>打印配载包</Button></>} />
    <Card padding="sm" mb="md" className="print-toolbar"><Group gap="sm"><Text size="sm" fw={700}>打印版本</Text><Select size="xs" w={320} value={selectedValue} onChange={setSelected} data={options} /><Text size="xs" c="dimmed">{isDraft ? '草稿尚未锁定，打印内容会反映最近一次自动保存。' : `只读版本，锁定于 ${version!.lockedAt}，内容不可更改。`}</Text></Group></Card>
    <Card padding="xl" className="print-sheet">
      <div className="print-header"><div><Text size="xs" c="dimmed">VESSEL STOWAGE PLAN</Text><h1>{data?.vessel ?? '海岳轮'} · {data?.id ?? 'V-2609-17'}</h1><p>{data?.route}</p><p className="print-meta">打印内容：{isDraft ? <b>草稿 V{state.planRevision}</b> : <b>只读锁定版本 V{version!.revision}（{version!.lockedAt}）</b>} ｜ 当前草稿：V{state.planRevision}（{state.draftSavedAt} 自动保存） ｜ 最近锁定版本：{latest ? `V${latest.revision}（${latest.lockedAt}）` : '无'}</p></div><div className={isDraft ? 'print-stamp draft-stamp' : 'print-stamp'}>{isDraft ? `草稿 V${state.planRevision}` : `只读版本 V${version!.revision}`}<br />{isDraft ? '未锁定' : '已锁定'}</div></div>
      <div className="print-kpis"><div><span>总货重</span><strong>{stability.total.toFixed(1)} t</strong></div><div><span>稳性裕度</span><strong>{stability.stability.toFixed(1)}%</strong></div><div><span>纵倾</span><strong>{stability.trim}</strong></div><div><span>主甲板载荷</span><strong>{stability.deckLoad.toFixed(1)} t</strong></div></div>
      <h3>主甲板配载图{!isDraft && <span className="print-suffix"> · V{version!.revision} 锁定时货位</span>}</h3>
      <div className="print-deck" style={{ gridTemplateColumns: `repeat(${Math.max(bays.length, 1)}, 1fr)` }}>{bays.flatMap((bay) => rows.map((row) => { const item = deck.find((cargoItem) => cargoItem.bay === bay && cargoItem.row === row); return <div key={`${bay}-${row}`} className={item ? 'filled' : ''} style={item ? { borderTopColor: item.color } : undefined}><span>{item ? item.bill.slice(-3) : ''}</span><small>{item ? `${item.weight}t` : `B${bay}/R${row}`}</small>{item?.hazmat !== '无' && item && <b>DG</b>}</div>; }))}</div>
      <h3>卸货顺序与绑扎清单</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>顺序</Table.Th><Table.Th>提单号</Table.Th><Table.Th>货位</Table.Th><Table.Th>货类</Table.Th><Table.Th>重量</Table.Th><Table.Th>卸货港</Table.Th><Table.Th>危险品 / 绑扎</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[...cargo].sort((a, b) => (a.port === '釜山' ? -1 : 1) - (b.port === '釜山' ? -1 : 1)).map((item, index) => <Table.Tr key={item.id}><Table.Td>{index + 1}</Table.Td><Table.Td fw={700}>{item.bill}</Table.Td><Table.Td>B{item.bay}/R{item.row}/T{item.tier}</Table.Td><Table.Td>{item.type}</Table.Td><Table.Td>{item.weight} t</Table.Td><Table.Td>{item.port}</Table.Td><Table.Td><Badge size="xs" color={item.hazmat !== '无' ? 'orange' : 'gray'}>{item.hazmat}</Badge> <Text span size="xs">{item.lashing}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <h3>{isDraft ? `草稿意见与条件接受（V${state.planRevision} · 尚未锁定）` : `审阅结论（只读 V${version!.revision} · 锁定于 ${version!.lockedAt}）`}</h3>
      <div className="print-review"><div><Text size="xs" fw={800} c="dimmed" mb={6}>接受的条件（{acceptedLimits.length}）</Text>{acceptedLimits.map((limit) => <div className="conclusion-row" key={limit}><IconCheck size={14} color="#237162" /><Text size="xs">{limit}</Text></div>)}{!acceptedLimits.length && <Text size="xs" c="dimmed">无</Text>}{!isDraft && <Text size="xs" c="dimmed" mt={8}>锁定时记录冲突 {version!.conflicts.length} 项。</Text>}</div><div><Text size="xs" fw={800} c="dimmed" mb={6}>船长 / 码头 / 货主意见（{comments.length}）</Text>{comments.map((comment) => <div className="conclusion-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role} <Badge size="xs" ml={4} color={comment.status === '已接受' ? 'teal' : comment.status === '已退回' ? 'red' : 'orange'}>{comment.status}</Badge></Text><Text size="xs" c="dimmed">{comment.content}</Text></div></div>)}{!comments.length && <Text size="xs" c="dimmed">无</Text>}</div></div>
      <div className="print-signatures"><div>配载负责人：____________</div><div>船长确认：____________</div><div>码头代表：____________</div><div>日期：2026-09-29</div></div>
    </Card>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.stowage);
  const latest = latestVersion(state.versions);
  const stability = calculateStability(state.cargo);
  return <AppShell header={{ height: 62 }} navbar={{ width: 224, breakpoint: 'sm' }} padding={0}>
    <AppShellHeader className="app-header"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><ThemeIcon color="teal" variant="light"><IconShip size={19} /></ThemeIcon><div className="brand-copy"><strong>船舶配载校核台</strong><span>Stowage & Voyage Review</span></div></Group><Group gap="sm" visibleFrom="sm"><Badge variant="light" color="teal">海岳轮</Badge><Text size="xs" c="dimmed">V-2609-17 · 草稿 V{state.planRevision}</Text><Badge color={latest ? 'teal' : 'orange'}>{latest ? `锁定 V${latest.revision}` : '审阅中'}</Badge></Group><ActionIcon variant="subtle" color="gray"><IconAnchor size={18} /></ActionIcon></Group></AppShellHeader>
    <AppShellNavbar p="xs" className="app-nav"><div className="voyage-card"><Text size="xs" c="dimmed">当前航次</Text><Text fw={800}>上海 → 温哥华</Text><Text size="xs" c="dimmed">经停釜山 · 10-02 离港</Text><Progress value={stability.stability} color={stability.stability > 70 ? 'teal' : 'orange'} size="sm" mt="sm" /><Text size="xs" mt={4}>草稿稳性裕度 {stability.stability.toFixed(1)}%</Text></div>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}<div className="nav-foot"><IconRoute size={16} /><Text size="xs">{latest ? <>最近锁定：方案 V{latest.revision}<br />{latest.lockedAt}</> : '基线：尚无锁定版本'}<br />草稿 V{state.planRevision}：{state.draftSavedAt} 自动保存</Text></div></AppShellNavbar>
    <AppShellMain>{children}</AppShellMain>
  </AppShell>;
}

export default function App() {
  return <BrowserRouter><Shell><Routes><Route path="/" element={<Overview />} /><Route path="/stowage" element={<Stowage />} /><Route path="/compare" element={<Compare />} /><Route path="/print" element={<PrintPlan />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell></BrowserRouter>;
}
