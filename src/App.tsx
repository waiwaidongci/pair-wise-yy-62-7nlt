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
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAnchor,
  IconBoxMultiple,
  IconCheck,
  IconCube,
  IconFileDescription,
  IconHistory,
  IconLayoutBoardSplit,
  IconLock,
  IconMap2,
  IconPrinter,
  IconRefresh,
  IconRulerMeasure,
  IconRoute,
  IconShip,
  IconUsers
} from '@tabler/icons-react';
import * as THREE from 'three';
import { useGetVoyageQuery, type Cargo, type CargoType } from './api';
import {
  acceptComment,
  acceptLimit,
  addComment,
  calculateStability,
  detectConflicts,
  diffCargo,
  findVersionView,
  getLatestVersion,
  listVersionViews,
  lockPlan,
  moveCargo,
  rejectComment,
  selectCargo,
  setViewMode,
  store,
  updateLashing,
  versionLabel,
  type ConflictIssue,
  type RootState,
  type VersionView
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

/** 页头版本标识：始终同时标明当前草稿与最近锁定版本 */
function VersionBadges({ planRevision, latest, size = 'sm' }: { planRevision: number; latest: VersionView | null; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return <>
    <Badge size={size} variant="light" color="orange">草稿 V{planRevision}{latest ? ` · 基于锁定 V${latest.revision}` : ''}</Badge>
    {latest && <Badge size={size} variant="light" color="teal" leftSection={<IconLock size={12} />}>最近锁定 V{latest.revision} · {latest.lockedAt}</Badge>}
  </>;
}

/** 锁定后提示：当前工作区是新草稿，旧审阅结论只读 */
function DraftNotice({ latest }: { latest: VersionView | null }) {
  if (!latest) return null;
  return <div className="info-banner"><IconLock size={16} /><strong>已进入锁定后的新草稿</strong><span>锁定 V{latest.revision} 的货位、冲突、条件接受与船长/码头/货主意见已定格只读；拖货、改绑扎或处理意见只作用于当前草稿，不影响旧版本。</span></div>;
}

/** 按主甲板 B4–B10 / R0–R3 的 28 槽位生成占用图，标出两个版本间变化的货位 */
function deckSlotMap(cargo: VersionView['cargo']) {
  const map = new Map<number, VersionView['cargo'][number]>();
  cargo.forEach((item) => {
    if (item.deck !== '主甲板') return;
    const bayIndex = item.bay - 4;
    if (bayIndex < 0 || bayIndex > 6 || item.row < 0 || item.row > 3) return;
    map.set(bayIndex * 4 + item.row, item);
  });
  return map;
}

function MiniDeck({ view, changedSlots, tone }: { view: VersionView; changedSlots: Set<number>; tone: 'old' | 'new' }) {
  const slots = deckSlotMap(view.cargo);
  return <div className={`mini-deck ${tone}-deck`}>{Array.from({ length: 28 }).map((_, index) => {
    const item = slots.get(index);
    const changed = changedSlots.has(index);
    return <div key={index} className={changed ? 'changed' : ''} style={item && !changed ? { background: item.color } : undefined} title={item ? `${item.bill} · ${item.weight}t` : `B${4 + Math.floor(index / 4)}/R${index % 4}`}>{item?.bill.slice(-3) ?? ''}</div>;
  })}</div>;
}

function ThreeHold({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const activeId = useSelector((root: RootState) => root.stowage.activeCargoId);
  const dispatch = useDispatch();
  const [rotation, setRotation] = useState({ theta: .65, phi: 1.05 });
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
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo);
  const hasBlocking = conflicts.some((item) => item.level === 'high');
  const latest = getLatestVersion(state);
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  return <div className="page">
    <PageHeading eyebrow={`${data?.id ?? 'V-2609-17'} / 航次审阅`} title="多用途船舶配载校核" description={`${data?.vessel ?? '海岳轮'} · ${data?.route ?? '上海 → 釜山 → 温哥华'} · 计划离港 ${data?.departure ?? '10-02 14:00'}`} actions={<><VersionBadges planRevision={state.planRevision} latest={latest} /><Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>{state.viewMode === '3d' ? '二维剖面' : '三维视角'}</Button><Button color="teal" leftSection={<IconLock size={16} />} disabled={hasBlocking} onClick={() => dispatch(lockPlan())}>{hasBlocking ? '存在阻断冲突，无法锁定' : `形成审阅结论 V${state.planRevision}`}</Button></>} />
    {latest && <DraftNotice latest={latest} />}
    {conflicts.length > 0 && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{conflicts.length} 项配载冲突待处理</strong><span>{conflicts.map((item) => item.title).join('、')}</span></div>}
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">{[
      ['总货重', `${stability.total.toFixed(1)} t`, '设计上限 3560 t', 'ok'],
      ['稳性裕度', `${stability.stability.toFixed(1)}%`, stability.stability > 70 ? '符合航次要求' : '低于控制线', stability.stability > 70 ? 'ok' : 'bad'],
      ['纵倾状态', stability.trim, `Lcg ${stability.longitudinal.toFixed(2)} m`, 'ok'],
      ['主甲板载荷', `${stability.deckLoad.toFixed(1)} t`, '局部强度已校核', 'ok']
    ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}</SimpleGrid>
    <div className="overview-grid">
      <Card padding={0} className="scene-card"><div className="panel-title"><div><strong>{state.viewMode === '3d' ? '三维货位与航次分布' : '舱内横向剖面'}</strong><Text size="xs" c="dimmed">货箱颜色对应目的港与货类</Text></div><Badge color="orange" variant="light">草稿 V{state.planRevision}</Badge></div>{state.viewMode === '3d' ? <ThreeHold /> : <SectionView />}</Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>当前货位</strong><Text size="xs" c="dimmed">{active.id}</Text></div><Badge color={active.hazmat !== '无' ? 'orange' : 'gray'}>{active.hazmat === '无' ? '普通货' : '危险品'}</Badge></div><Stack gap={6} mt="sm"><Text fw={700}>{active.bill} · {active.type}</Text><Text size="xs" c="dimmed">{active.dimension}</Text><SimpleGrid cols={2} spacing="xs"><div className="mini-stat"><span>重量</span><strong>{active.weight} t</strong></div><div className="mini-stat"><span>卸货港</span><strong>{active.port}</strong></div><div className="mini-stat"><span>货位</span><strong>Bay {active.bay} / Row {active.row} / Tier {active.tier}</strong></div><div className="mini-stat"><span>绑扎</span><strong>{active.lashing}</strong></div></SimpleGrid></Stack></Card>
        <Card padding="md"><div className="panel-title"><div><strong>重量分布</strong><Text size="xs" c="dimmed">按横向货位统计</Text></div><IconRulerMeasure size={18} /></div><div className="weight-bars">{[2, 4, 6, 8, 10, 12, 14].map((bay) => { const weight = state.cargo.filter((item) => item.bay === bay).reduce((sum, item) => sum + item.weight, 0); return <div key={bay}><span>{weight.toFixed(0)}t</span><i style={{ height: `${Math.max(8, weight / 1.2)}px` }} /><small>B{bay}</small></div>; })}</div></Card>
        <Card padding="md"><div className="panel-title"><div><strong>角色限制条件</strong><Text size="xs" c="dimmed">{state.comments.filter((item) => item.status === '待确认').length} 项待确认</Text></div><IconUsers size={18} /></div>{state.comments.slice(0, 3).map((comment) => <div className="limit-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role}</Text><Text size="xs" c="dimmed">{comment.content}</Text></div><Badge size="xs" color={comment.status === '待确认' ? 'orange' : 'teal'}>{comment.status}</Badge></div>)}</Card>
      </Stack>
    </div>
  </div>;
}

function Stowage() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
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
    <PageHeading eyebrow={`配载工作区 / 草稿 V${state.planRevision}`} title="货位安排与冲突校核" description="拖动货箱排序，或输入目标货位精确调整；系统即时重算重量分布。" actions={<><VersionBadges planRevision={state.planRevision} latest={getLatestVersion(state)} /><Badge size="lg" color={conflicts.length ? 'orange' : 'teal'} leftSection={<IconCheck size={14} />}>{conflicts.length ? `${conflicts.length} 项冲突` : '校验通过'}</Badge></>} />
    {getLatestVersion(state) && <DraftNotice latest={getLatestVersion(state)} />}
    <div className="stowage-grid">
      <Card padding={0} className="cargo-list-panel"><div className="panel-title"><div><strong>货物清单</strong><Text size="xs" c="dimmed">{state.cargo.length} 票 · 可拖拽</Text></div><TextInput size="xs" placeholder="搜索提单号" /></div><ScrollArea h={600}><div className="cargo-list">{state.cargo.map((item) => <button draggable onDragStart={() => setDragId(item.id)} key={item.id} className={state.activeCargoId === item.id ? 'active' : ''} onClick={() => dispatch(selectCargo(item.id))}><i style={{ background: item.color }} /><div><strong>{item.bill}</strong><span>{item.type} · {item.weight}t · {item.port}</span></div><Badge size="xs" color={item.hazmat === '无' ? 'gray' : 'orange'}>{item.hazmat === '无' ? `B${item.bay}` : 'DG'}</Badge></button>)}</div></ScrollArea></Card>
      <Card padding={0} className="deck-panel"><div className="panel-title"><div><strong>主甲板货位图</strong><Text size="xs" c="dimmed">将货物拖入槽位，或点击槽位选择</Text></div><Group gap="xs"><Badge color="teal">稳性 {stability.stability.toFixed(1)}%</Badge><Badge color="gray">{stability.trim}</Badge></Group></div><div className="deck-layout"><div className="bridge-shape">驾驶台</div><div className="slot-grid">{slots.map((slot) => { const occupied = state.cargo.find((item) => item.deck === '主甲板' && item.bay === slot.bay && item.row === slot.row); return <button key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragId) dispatch(moveCargo({ id: dragId, bay: slot.bay, row: slot.row, tier: occupied?.tier ?? 1 })); setDragId(null); }} className={occupied ? 'occupied' : ''} style={occupied ? { background: occupied.color } : undefined} onClick={() => { if (occupied) { dispatch(selectCargo(occupied.id)); setRow(slot.row); setBay(slot.bay); } }}><small>{slot.label}</small>{occupied && <strong>{occupied.bill.slice(-3)}<span>{occupied.weight}t</span></strong>}</button>; })}</div><div className="deck-axis">左舷 ← 横向 Row → 右舷</div></div></Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>精确调整</strong><Text size="xs" c="dimmed">{active.id}</Text></div><IconCube size={18} /></div><Stack gap="sm" mt="md"><NumberInput label="Bay 纵向货位" min={1} max={20} value={bay} onChange={(value) => setBay(Number(value))} /><NumberInput label="Row 横向货位" min={0} max={8} value={row} onChange={(value) => setRow(Number(value))} /><NumberInput label="Tier 堆码层" min={0} max={4} value={tier} onChange={(value) => setTier(Number(value))} /><Button color="teal" onClick={() => dispatch(moveCargo({ id: active.id, bay, row, tier }))}>应用货位调整</Button><Divider /><Select label="绑扎状态" data={['已绑扎', '待绑扎', '需复核']} value={active.lashing} onChange={(value) => value && dispatch(updateLashing({ id: active.id, lashing: value as Cargo['lashing'] }))} /></Stack></Card>
        <Card padding="md" className={conflicts.length ? 'conflict-card' : ''}><div className="panel-title"><div><strong>实时冲突</strong><Text size="xs" c="dimmed">重心、稳性、隔离与堆码</Text></div><IconAlertTriangle size={18} /></div>{conflicts.map((item) => <button className="conflict-row" key={item.id} onClick={() => dispatch(selectCargo(item.cargoId))}><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}{!conflicts.length && <Text size="sm" c="teal" mt="md">当前方案未发现冲突。</Text>}</Card>
      </Stack>
    </div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>角色条件与审批</strong><Text size="xs" c="dimmed">船长、码头和货主代表可对方案提出限制</Text></div><IconUsers size={18} /></div><div className="comments-grid">{state.comments.map((item) => <div className="comment-card" key={item.id}><Group justify="space-between"><Badge size="xs">{item.role}</Badge><Text size="xs" c="dimmed">{item.author}</Text></Group><Text size="sm" mt="xs">{item.content}</Text><Group gap="xs" mt="sm"><Button size="compact-xs" color="teal" disabled={item.status !== '待确认'} onClick={() => dispatch(acceptComment(item.id))}>接受</Button><Button size="compact-xs" variant="default" disabled={item.status !== '待确认'} onClick={() => dispatch(rejectComment(item.id))}>退回</Button></Group></div>)}</div><Group mt="md" align="flex-start"><Textarea flex={1} minRows={2} placeholder="输入新的限制条件或调整意见" value={comment} onChange={(event) => setComment(event.currentTarget.value)} /><Button color="teal" onClick={() => { if (comment.trim()) { dispatch(addComment({ cargoId: active.id, author: '本次负责人', role: '船长', content: comment })); setComment(''); } }}>提交条件</Button></Group></Card>
  </div>;
}

function ChangeKindBadge({ kind }: { kind: string }) {
  const map: Record<string, { color: string; label: string }> = {
    moved: { color: 'blue', label: '移动货位' },
    modified: { color: 'orange', label: '属性变更' },
    added: { color: 'teal', label: '新加入' },
    removed: { color: 'red', label: '已移除' }
  };
  const meta = map[kind] ?? map.modified;
  return <Badge size="xs" color={meta.color} variant="light">{meta.label}</Badge>;
}

function FrozenOpinions({ view }: { view: VersionView }) {
  const pending = view.comments.filter((item) => item.status === '待确认').length;
  return <Card padding="md">
    <div className="panel-title" style={{ padding: 0, borderBottom: 0 }}><div><strong>{versionLabel(view)} · 审阅意见快照（只读）</strong><Text size="xs" c="dimmed">{view.lockedAt ?? '当前工作草稿'} · {pending} 项待确认</Text></div><IconUsers size={18} /></div>
    <div className="frozen-opinions">{view.comments.map((item) => <div className="limit-row" key={item.id}><div><Text size="xs" fw={700}>{item.author} · {item.role}</Text><Text size="xs" c="dimmed">{item.content}</Text></div><Badge size="xs" color={item.status === '待确认' ? 'orange' : item.status === '已接受' ? 'teal' : 'red'}>{item.status}</Badge></div>)}</div>
    {view.acceptedLimits.length > 0 && <div className="accepted-limits"><Text size="xs" fw={700} mt="xs">条件接受（{view.acceptedLimits.length}）</Text>{view.acceptedLimits.map((limit) => <Text key={limit} size="xs" c="teal" className="limit-line"><IconCheck size={11} />{limit}</Text>)}</div>}
  </Card>;
}

function ConflictSnapshot({ title, conflicts }: { title: string; conflicts: ConflictIssue[] }) {
  return <Card padding="md">
    <div className="panel-title" style={{ padding: 0, borderBottom: 0 }}><div><strong>{title}</strong><Text size="xs" c="dimmed">{conflicts.length ? `定格时存在 ${conflicts.length} 项冲突` : '定格时无冲突'}</Text></div><IconAlertTriangle size={18} /></div>
    {conflicts.map((item) => <div className="limit-row" key={item.id}><div><Text size="xs" fw={700}>{item.title}</Text><Text size="xs" c="dimmed">{item.detail}</Text></div><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge></div>)}
    {!conflicts.length && <Text size="xs" c="teal" mt="xs">形成审阅结论时校验通过。</Text>}
  </Card>;
}

function Compare() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const views = listVersionViews(state);
  const latest = getLatestVersion(state);
  const draft = views[views.length - 1];
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);

  // 默认基线：最近锁定版本；还没有锁定版本时使用系统初始基线
  const baselineIdResolved = baselineId ?? (latest ? latest.id : views[0].id);
  const baseline = findVersionView(state, baselineIdResolved);
  const changes = useMemo(() => diffCargo(baseline.cargo, draft.cargo), [baseline, draft]);
  const blockingCount = draft.conflicts.filter((item) => item.level === 'high').length;

  // 槽位占用变化（含装/卸货位）
  const changedSlots = useMemo(() => {
    const before = deckSlotMap(baseline.cargo);
    const after = deckSlotMap(draft.cargo);
    const slots = new Set<number>();
    for (let index = 0; index < 28; index += 1) {
      const oldItem = before.get(index)?.id;
      const newItem = after.get(index)?.id;
      if (oldItem !== newItem) slots.add(index);
    }
    return slots;
  }, [baseline, draft]);

  const oldStability = calculateStability(baseline.cargo);
  const newStability = calculateStability(draft.cargo);

  return <div className="page">
    <PageHeading eyebrow={`PLAN COMPARE / ${versionLabel(baseline)} → 草稿 V${state.planRevision}`} title="配载方案对比" description="选择一个只读版本作为基线，查看当前草稿相对旧版本改了哪些货；旧版本的冲突、条件接受与意见不会随后续调整变化。" actions={<><Select size="xs" w={210} value={baseline.id} onChange={(value) => value && setBaselineId(value)} data={views.slice(0, -1).map((item) => ({ value: item.id, label: `${versionLabel(item)}${item.lockedAt ? ` · ${item.lockedAt}` : ''}` }))} aria-label="选择基线版本" /><Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setAcceptOpen(true)}>形成审阅结论</Button></>} />
    {latest && <DraftNotice latest={latest} />}
    <div className="compare-summary">
      <div><span>基线版本（只读）</span><strong>{versionLabel(baseline)}</strong><small>总重 {oldStability.total.toFixed(1)}t · 稳性 {oldStability.stability.toFixed(1)}%</small></div>
      <span className="compare-arrow">→</span>
      <div><span>当前草稿</span><strong>V{state.planRevision}</strong><small>总重 {newStability.total.toFixed(1)}t · 稳性 {newStability.stability.toFixed(1)}% · {state.draftSavedAt}</small></div>
      <Badge color={changes.length ? 'teal' : 'gray'} variant="light">{changes.length} 项货物变化</Badge>
      {baseline.kind === 'baseline' && <Text size="xs" c="dimmed">尚无锁定版本，使用系统初始基线；在下方“形成审阅结论”后即生成首个只读版本。</Text>}
    </div>
    <div className="compare-grid">
      <Card padding={0}><div className="panel-title"><div><strong>{versionLabel(baseline)}</strong><Text size="xs" c="dimmed">{baseline.lockedAt ?? baseline.lockedBy}</Text></div><Badge variant="light" color="teal">只读</Badge></div><MiniDeck view={baseline} changedSlots={changedSlots} tone="old" /></Card>
      <Card padding={0}><div className="panel-title"><div><strong>草稿 V{state.planRevision}（候选）</strong><Text size="xs" c="dimmed">当前编辑 · {state.draftSavedAt} 自动保存</Text></div><Badge variant="light" color="orange">草稿</Badge></div><MiniDeck view={draft} changedSlots={changedSlots} tone="new" /></Card>
    </div>
    <Card padding="md" mt="md">
      <div className="panel-title" style={{ padding: 0, borderBottom: 0, marginBottom: 10 }}><div><strong>货物差异</strong><Text size="xs" c="dimmed">新草稿相对基线改动的货：货位移动、绑扎/重量/危险品/卸货港变更、新加与移除</Text></div><Badge color={changes.length ? 'teal' : 'gray'}>{changes.length} 项</Badge></div>
      <Table verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>提单</Table.Th><Table.Th>类型</Table.Th><Table.Th>字段</Table.Th><Table.Th>{versionLabel(baseline)}</Table.Th><Table.Th>草稿 V{state.planRevision}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{changes.map((change, index) => <Table.Tr key={`${change.cargoId}-${change.field}-${index}`}><Table.Td fw={700}>{change.bill}<Text size="xs" c="dimmed" component="div">{change.cargoId}</Text></Table.Td><Table.Td><ChangeKindBadge kind={change.kind} /></Table.Td><Table.Td>{change.field}</Table.Td><Table.Td><Text c="red" td={change.kind === 'moved' ? 'line-through' : undefined}>{change.before}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{change.after}</Text></Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
      {!changes.length && <Text size="sm" c="dimmed" ta="center" py="md">草稿与基线完全一致，没有货物变化。</Text>}
    </Card>
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
      <FrozenOpinions view={baseline} />
      <ConflictSnapshot title={`${versionLabel(baseline)} · 冲突快照（只读）`} conflicts={baseline.conflicts} />
    </SimpleGrid>
    <Modal opened={acceptOpen} onClose={() => setAcceptOpen(false)} title={`形成配载审阅结论 · V${state.planRevision}`} centered size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">锁定后当前草稿将定格为只读版本 V{state.planRevision}：保留当时的货位、冲突、条件接受与船长/码头/货主意见；随后拖货、改绑扎或处理意见进入新草稿 V{state.planRevision + 1}，旧版本不再变化。</Text>
        {blockingCount > 0 && <div className="warning-banner"><IconAlertTriangle size={16} /><span>当前草稿存在 {blockingCount} 项阻断级冲突，处理前无法锁定。</span></div>}
        <div><Text fw={700} size="sm">随结论定格的货物变化（相对{versionLabel(baseline)}，{changes.length} 项）</Text>{changes.slice(0, 5).map((change, index) => <Text key={index} size="xs" c="dimmed" className="limit-line"><ChangeKindBadge kind={change.kind} />{change.bill} · {change.field}：{change.before} → {change.after}</Text>)}{changes.length > 5 && <Text size="xs" c="dimmed">其余 {changes.length - 5} 项见上方差异表。</Text>}</div>
        <Divider />
        <Text fw={700} size="sm">条件接受</Text>
        {['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'].map((limit) => <Checkbox key={limit} label={limit} checked={state.acceptedLimits.includes(limit)} onChange={() => dispatch(acceptLimit(limit))} />)}
        <Group justify="flex-end"><Button variant="default" onClick={() => setAcceptOpen(false)}>退回修改</Button><Button color="teal" leftSection={<IconLock size={15} />} disabled={blockingCount > 0 || state.acceptedLimits.length < 3} onClick={() => { dispatch(lockPlan()); setBaselineId(null); setAcceptOpen(false); }}>接受并锁定 V{state.planRevision}</Button></Group>
      </Stack>
    </Modal>
  </div>;
}

function PrintPlan() {
  const { data } = useGetVoyageQuery();
  const state = useSelector((root: RootState) => root.stowage);
  const views = listVersionViews(state);
  const latest = getLatestVersion(state);
  // 默认打印最近锁定版本；没有锁定版本时打印当前草稿
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdResolved = selectedId ?? (latest ? latest.id : 'draft');
  const view = findVersionView(state, selectedIdResolved);
  const stability = calculateStability(view.cargo);
  const isDraft = view.kind === 'draft';
  const sortedCargo = useMemo(() => [...view.cargo].sort((a, b) => (a.port === '釜山' ? -1 : 1) - (b.port === '釜山' ? -1 : 1)), [view.cargo]);
  return <div className="page print-page">
    <PageHeading eyebrow="STOWAGE PLAN / PRINT" title="配载图与卸货清单" description="选择草稿或任一已锁定的只读版本打印；页头标明当前草稿与最近锁定版本。" actions={<><Select size="xs" w={260} value={view.id} onChange={(value) => value && setSelectedId(value)} data={[...views.slice(0, -1).map((item) => ({ value: item.id, label: `${versionLabel(item)}${item.lockedAt ? ` · ${item.lockedAt}` : ''}` })), { value: 'draft', label: `当前草稿 V${state.planRevision} · ${state.draftSavedAt}` }]} aria-label="选择打印版本" /><Button color="teal" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>打印此版本</Button></>} />
    {isDraft
      ? <div className="info-banner print-hide"><IconFileDescription size={16} /><strong>正在打印未锁定草稿 V{state.planRevision}</strong><span>{latest ? `最近锁定版本为 V${latest.revision}（${latest.lockedAt}）。正式配载包建议先在对比页“形成审阅结论”。` : '尚无锁定版本，当前内容为工作草稿。'}</span></div>
      : <div className="info-banner locked print-hide"><IconLock size={16} /><strong>正在打印只读{versionLabel(view)}</strong><span>定格于 {view.lockedAt} · {view.lockedBy}；货位、冲突、条件接受与意见均为当时记录，不随后续草稿变化。</span></div>}
    <Card padding="xl" className="print-sheet">
      <div className="print-header"><div><Text size="xs" c="dimmed">VESSEL STOWAGE PLAN</Text><h1>{data?.vessel ?? '海岳轮'} · {data?.id ?? 'V-2609-17'}</h1><p>{data?.route}</p><div className="print-versionline">打印版本：<strong>{versionLabel(view)}</strong>{view.lockedAt ? ` · ${view.lockedAt}` : ` · 草稿自动保存 ${state.draftSavedAt}`}{latest && <>　|　当前草稿：<strong>V{state.planRevision}</strong>　最近锁定版本：<strong>V{latest.revision}</strong></>}</div></div><div className={`print-stamp ${isDraft ? 'draft-stamp' : ''}`}>{isDraft ? `草稿 V${state.planRevision}` : `锁定 V${view.revision}`}<br />{isDraft ? '未锁定 · 仅供校核' : '审阅结论 · 只读'}</div></div>
      <div className="print-kpis"><div><span>总货重</span><strong>{stability.total.toFixed(1)} t</strong></div><div><span>稳性裕度</span><strong>{stability.stability.toFixed(1)}%</strong></div><div><span>纵倾</span><strong>{stability.trim}</strong></div><div><span>主甲板载荷</span><strong>{stability.deckLoad.toFixed(1)} t</strong></div></div>
      <h3>主甲板配载图</h3>
      <div className="print-deck">{Array.from({ length: 28 }).map((_, index) => { const row = index % 4; const bay = 4 + Math.floor(index / 4); const item = view.cargo.find((cargo) => cargo.deck === '主甲板' && cargo.bay === bay && cargo.row === row); return <div key={index} className={item ? 'filled' : ''} style={item ? { borderTopColor: item.color } : undefined}><span>{item ? item.bill.slice(-3) : ''}</span><small>{item ? `${item.weight}t` : `B${bay}/R${row}`}</small>{item?.hazmat !== '无' && item && <b>DG</b>}</div>; })}</div>
      <h3>卸货顺序与绑扎清单</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>顺序</Table.Th><Table.Th>提单号</Table.Th><Table.Th>货位</Table.Th><Table.Th>货类</Table.Th><Table.Th>重量</Table.Th><Table.Th>卸货港</Table.Th><Table.Th>危险品 / 绑扎</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{sortedCargo.map((item, index) => <Table.Tr key={item.id}><Table.Td>{index + 1}</Table.Td><Table.Td fw={700}>{item.bill}</Table.Td><Table.Td>B{item.bay}/R{item.row}/T{item.tier}</Table.Td><Table.Td>{item.type}</Table.Td><Table.Td>{item.weight} t</Table.Td><Table.Td>{item.port}</Table.Td><Table.Td><Badge size="xs" color={item.hazmat !== '无' ? 'orange' : 'gray'}>{item.hazmat}</Badge> <Text span size="xs">{item.lashing}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <div className="print-appendix">
        <h3>审阅意见与条件接受{isDraft ? '（当前草稿）' : `（锁定 V${view.revision} 时定格）`}</h3>
        <Table striped><Table.Thead><Table.Tr><Table.Th>角色</Table.Th><Table.Th>提出人</Table.Th><Table.Th>意见 / 条件</Table.Th><Table.Th>状态</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{view.comments.map((item) => <Table.Tr key={item.id}><Table.Td><Badge size="xs">{item.role}</Badge></Table.Td><Table.Td>{item.author}</Table.Td><Table.Td>{item.content}</Table.Td><Table.Td>{item.status}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        {view.acceptedLimits.length > 0 && <ul className="print-limits">{view.acceptedLimits.map((limit) => <li key={limit}>{limit}</li>)}</ul>}
        {view.conflicts.length > 0 && <div className="print-conflicts"><strong>定格时冲突记录（{view.conflicts.length}）：</strong>{view.conflicts.map((item) => <span key={item.id} className={item.level === 'high' ? 'high' : 'medium'}>[{item.level === 'high' ? '阻断' : '预警'}] {item.title}：{item.detail}</span>)}</div>}
      </div>
      <div className="print-signatures"><div>配载负责人：____________</div><div>船长确认：____________</div><div>码头代表：____________</div><div>日期：2026-09-29</div></div>
    </Card>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  const latest = getLatestVersion(state);
  return <AppShell header={{ height: 62 }} navbar={{ width: 224, breakpoint: 'sm' }} padding={0}>
    <AppShellHeader className="app-header"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><ThemeIcon color="teal" variant="light"><IconShip size={19} /></ThemeIcon><div className="brand-copy"><strong>船舶配载校核台</strong><span>Stowage & Voyage Review</span></div></Group><Group gap="sm" visibleFrom="sm"><Badge variant="light" color="teal">海岳轮</Badge><Badge variant="light" color="orange">草稿 V{state.planRevision}</Badge>{latest && <Badge variant="light" color="teal" leftSection={<IconLock size={11} />}>最近锁定 V{latest.revision}</Badge>}{!latest && <Badge color="orange" variant="light">尚未锁定</Badge>}</Group><ActionIcon variant="subtle" color="gray"><IconAnchor size={18} /></ActionIcon></Group></AppShellHeader>
    <AppShellNavbar p="xs" className="app-nav"><div className="voyage-card"><Text size="xs" c="dimmed">当前航次</Text><Text fw={800}>上海 → 温哥华</Text><Text size="xs" c="dimmed">经停釜山 · 10-02 离港</Text><Progress value={stability.stability} color={stability.stability > 70 ? 'teal' : 'orange'} size="sm" mt="sm" /><Text size="xs" mt={4}>稳性裕度 {stability.stability.toFixed(1)}%</Text></div>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}<div className="nav-foot"><IconRoute size={16} /><Text size="xs">{latest ? `最近锁定：V${latest.revision}（只读）` : '尚无锁定版本 · 可从初始基线对比'}<br />草稿：V{state.planRevision} · {state.draftSavedAt} 自动保存</Text></div></AppShellNavbar>
    <AppShellMain>{children}</AppShellMain>
  </AppShell>;
}

export default function App() {
  return <BrowserRouter><Shell><Routes><Route path="/" element={<Overview />} /><Route path="/stowage" element={<Stowage />} /><Route path="/compare" element={<Compare />} /><Route path="/print" element={<PrintPlan />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell></BrowserRouter>;
}
