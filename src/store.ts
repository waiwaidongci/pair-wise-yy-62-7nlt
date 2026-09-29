import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo } from './api';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

export type PlanConflict = {
  id: string;
  cargoId: string;
  level: 'high' | 'medium';
  title: string;
  detail: string;
};

/** 锁定后不可变的只读审阅版本：保留当时的货位、冲突、条件接受与各方意见 */
export type PlanVersion = {
  id: string;
  revision: number;
  lockedAt: string;
  cargo: Cargo[];
  comments: StowageComment[];
  acceptedLimits: string[];
  conflicts: PlanConflict[];
};

type DraftState = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  viewMode: '3d' | 'section';
  draftSavedAt: string;
};

type State = DraftState & {
  versions: PlanVersion[];
};

const DRAFT_KEY = 'yy62-stowage-plan';
const VERSIONS_KEY = 'yy62-stowage-versions';

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

const initialComments: StowageComment[] = [
  { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
  { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
  { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
];

const initialAcceptedLimits = ['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeCargoArray(value: unknown, fallback: Cargo[]): Cargo[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter(isRecord)
    .map((r): Cargo | null => {
      if (typeof r.id !== 'string') return null;
      const num = (key: string) => (typeof r[key] === 'number' && Number.isFinite(r[key]) ? (r[key] as number) : 0);
      const str = (key: string, d = '') => (typeof r[key] === 'string' ? (r[key] as string) : d);
      const type = str('type');
      const lashing = str('lashing');
      return {
        id: r.id,
        bill: str('bill', r.id),
        type: type === '集装箱' || type === '散货' || type === '重大件' ? type : '集装箱',
        bay: num('bay'),
        row: num('row'),
        tier: num('tier'),
        deck: str('deck') === '货舱' ? '货舱' : '主甲板',
        weight: num('weight'),
        dimension: str('dimension'),
        port: str('port'),
        hazmat: str('hazmat', '无'),
        lashing: lashing === '已绑扎' || lashing === '待绑扎' || lashing === '需复核' ? lashing : '待绑扎',
        color: str('color', '#366d94')
      };
    })
    .filter((item): item is Cargo => item !== null);
  return list.length ? list : fallback;
}

function sanitizeComments(value: unknown): StowageComment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((r) => typeof r.id === 'string')
    .map((r) => {
      const str = (key: string, d = '') => (typeof r[key] === 'string' ? (r[key] as string) : d);
      const role = str('role');
      const status = str('status');
      return {
        id: str('id'),
        cargoId: str('cargoId'),
        author: str('author', '未知'),
        role: role === '船长' || role === '码头' || role === '货主' ? role : '船长',
        content: str('content'),
        status: status === '已接受' || status === '已退回' ? status : '待确认'
      } as StowageComment;
    });
}

function sanitizeConflicts(value: unknown, cargo: Cargo[]): PlanConflict[] {
  if (!Array.isArray(value)) return detectConflicts(cargo);
  return value
    .filter(isRecord)
    .filter((r) => typeof r.id === 'string' && typeof r.title === 'string')
    .map((r) => {
      const str = (key: string, d = '') => (typeof r[key] === 'string' ? (r[key] as string) : d);
      const level = r.level;
      return {
        id: str('id'),
        cargoId: str('cargoId'),
        level: level === 'high' ? 'high' : 'medium',
        title: str('title'),
        detail: str('detail')
      } satisfies PlanConflict;
    });
}

/** 逐条校验锁定版本：坏条目只丢它自己，绝不整体清空 */
function sanitizeVersions(value: unknown): PlanVersion[] {
  if (!Array.isArray(value)) return [];
  const valid: PlanVersion[] = [];
  for (const raw of value) {
    try {
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.revision !== 'number' || !Number.isFinite(raw.revision)) continue;
      const cargo = sanitizeCargoArray(raw.cargo, []);
      if (!cargo.length) continue;
      valid.push({
        id: raw.id,
        revision: raw.revision,
        lockedAt: typeof raw.lockedAt === 'string' ? raw.lockedAt : '未知时间',
        cargo,
        comments: sanitizeComments(raw.comments),
        acceptedLimits: Array.isArray(raw.acceptedLimits) ? raw.acceptedLimits.filter((item): item is string => typeof item === 'string') : [],
        conflicts: sanitizeConflicts(raw.conflicts, cargo)
      });
    } catch {
      // 单条坏记录不能影响其它锁定版本
    }
  }
  const dedup = new Map<string, PlanVersion>();
  valid.forEach((version) => dedup.set(version.id, version));
  return [...dedup.values()].sort((a, b) => a.revision - b.revision);
}

function buildFactoryBaseline(): PlanVersion {
  const cargo = clone(initialCargo);
  const patch = (id: string, change: Partial<Cargo>) => Object.assign(cargo.find((item) => item.id === id)!, change);
  patch('BL-88247', { bay: 14, row: 1, lashing: '已绑扎' });
  patch('BL-88219', { lashing: '待绑扎' });
  patch('BL-88240', { tier: 1 });
  const comments = clone(initialComments).map((comment) => ({ ...comment, status: '已接受' as const }));
  return {
    id: 'VER-4',
    revision: 4,
    lockedAt: '09-28 16:20',
    cargo,
    comments,
    acceptedLimits: clone(initialAcceptedLimits),
    conflicts: detectConflicts(cargo)
  };
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可用（隐私模式 / 配额）不应拖垮应用
  }
}

function loadInitialState(): { state: State; persistDraft: boolean; persistVersions: boolean } {
  const factoryDraft: DraftState = {
    cargo: clone(initialCargo),
    activeCargoId: 'BL-88247',
    planRevision: 5,
    comments: clone(initialComments),
    acceptedLimits: [],
    viewMode: '3d',
    draftSavedAt: '09:52'
  };

  const draftRaw = readKey(DRAFT_KEY);
  const versionsRaw = readKey(VERSIONS_KEY);

  let parsedDraft: Record<string, unknown> | null = null;
  let draftCorrupted = false;
  if (draftRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(draftRaw);
      if (isRecord(parsed)) parsedDraft = parsed;
      else draftCorrupted = true;
    } catch {
      // 整块坏记录：不覆写原数据，留给人工恢复，但锁定版本不受影响
      draftCorrupted = true;
    }
  }

  let versions: PlanVersion[] = [];
  let persistVersions = true;
  if (versionsRaw === null) {
    if (draftRaw === null) {
      // 全新用户：内置一个已锁定的 V4 基线，便于直接演示版本对比
      versions = [buildFactoryBaseline()];
    } else if (parsedDraft && parsedDraft.locked === true) {
      // 旧草稿（无版本历史）此前已“锁定”：把当时内容补录为只读版本
      const revision = typeof parsedDraft.planRevision === 'number' ? parsedDraft.planRevision : 1;
      const cargo = sanitizeCargoArray(parsedDraft.cargo, clone(initialCargo));
      versions = [{
        id: `VER-${revision}`,
        revision,
        lockedAt: '历史锁定版本',
        cargo,
        comments: sanitizeComments(parsedDraft.comments),
        acceptedLimits: Array.isArray(parsedDraft.acceptedLimits) ? (parsedDraft.acceptedLimits as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        conflicts: detectConflicts(cargo)
      }];
    }
  } else {
    try {
      versions = sanitizeVersions(JSON.parse(versionsRaw));
    } catch {
      // 版本库整块损坏：内存中按空处理，但绝不把坏数据覆盖成“空版本库”
      persistVersions = false;
    }
  }

  let draft: DraftState;
  if (parsedDraft) {
    const fallbackCargo = versions.length ? clone(versions[versions.length - 1].cargo) : clone(initialCargo);
    const cargo = sanitizeCargoArray(parsedDraft.cargo, fallbackCargo);
    const legacyLocked = parsedDraft.locked === true && versions.some((v) => v.revision === parsedDraft!.planRevision);
    const comments = sanitizeComments(parsedDraft.comments);
    const baseRevision = typeof parsedDraft.planRevision === 'number' && Number.isFinite(parsedDraft.planRevision) ? parsedDraft.planRevision : factoryDraft.planRevision;
    draft = {
      cargo,
      activeCargoId: cargo.some((item) => item.id === parsedDraft!.activeCargoId) ? String(parsedDraft.activeCargoId) : cargo[0]?.id ?? '',
      // 旧版已锁定的草稿升级后进入下一版新草稿，锁定内容留在只读版本中
      planRevision: legacyLocked ? baseRevision + 1 : baseRevision,
      comments: comments.length ? comments : clone(initialComments),
      acceptedLimits: Array.isArray(parsedDraft.acceptedLimits) ? parsedDraft.acceptedLimits.filter((x): x is string => typeof x === 'string') : [],
      viewMode: parsedDraft.viewMode === 'section' ? 'section' : '3d',
      draftSavedAt: typeof parsedDraft.draftSavedAt === 'string' ? parsedDraft.draftSavedAt : nowStamp()
    };
  } else if (draftRaw !== null && versions.length) {
    // 草稿整块损坏但锁定版本完好：从最近锁定版本恢复一份新草稿，锁定版本保持不动
    const base = versions[versions.length - 1];
    draft = {
      ...factoryDraft,
      cargo: clone(base.cargo),
      comments: clone(base.comments),
      acceptedLimits: clone(base.acceptedLimits),
      activeCargoId: base.cargo[0]?.id ?? '',
      planRevision: base.revision + 1,
      draftSavedAt: '草稿记录损坏，已从最近锁定版本恢复'
    };
  } else {
    draft = factoryDraft;
  }

  return { state: { ...draft, versions }, persistDraft: !draftCorrupted, persistVersions };
}

const loaded = loadInitialState();
const initialState: State = loaded.state;

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) Object.assign(cargo, action.payload);
      state.draftSavedAt = nowStamp();
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
      state.draftSavedAt = nowStamp();
    },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
      state.draftSavedAt = nowStamp();
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) {
      // 存在阻断/预警冲突时不得形成审阅结论
      if (detectConflicts(state.cargo).length > 0) return;
      const stamp = nowStamp();
      const revision = state.planRevision;
      state.versions.push({
        id: `VER-${revision}-${Date.now()}`,
        revision,
        lockedAt: stamp,
        cargo: clone(state.cargo),
        comments: clone(state.comments),
        acceptedLimits: clone(state.acceptedLimits),
        conflicts: detectConflicts(state.cargo)
      });
      // 锁定内容冻结；后续拖货、改绑扎、处理意见进入下一版新草稿
      state.planRevision = revision + 1;
      state.draftSavedAt = stamp;
    }
  }
});

export const { selectCargo, moveCargo, updateLashing, addComment, acceptComment, rejectComment, acceptLimit, setViewMode, lockPlan } = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

// 草稿与锁定版本分开存储：任一侧损坏都不能牵连另一侧
store.subscribe(() => {
  const state = store.getState().stowage;
  if (loaded.persistDraft) {
    const { versions: _versions, ...draft } = state;
    writeKey(DRAFT_KEY, JSON.stringify(draft));
  }
  if (loaded.persistVersions) writeKey(VERSIONS_KEY, JSON.stringify(state.versions));
});

export type RootState = ReturnType<typeof store.getState>;

export function latestVersion(versions: PlanVersion[]): PlanVersion | null {
  return versions.reduce<PlanVersion | null>((top, version) => (!top || version.revision > top.revision ? version : top), null);
}

export function calculateStability(cargo: Cargo[]) {
  const total = cargo.reduce((sum, item) => sum + item.weight, 0);
  const longitudinal = cargo.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(total, 1);
  const vertical = cargo.reduce((sum, item) => sum + item.weight * (item.tier + 1), 0) / Math.max(total, 1);
  const deckLoad = cargo.filter((item) => item.deck === '主甲板').reduce((sum, item) => sum + item.weight, 0);
  const stability = Math.max(0, 92 - Math.abs(longitudinal - 10.8) * 2.2 - Math.max(0, vertical - 1.75) * 8);
  return {
    total,
    longitudinal,
    vertical,
    deckLoad,
    stability,
    trim: (longitudinal - 10.8) < -0.4 ? '艉倾' : (longitudinal - 10.8) > 0.4 ? '艏倾' : '正平'
  };
}

export function detectConflicts(cargo: Cargo[]) {
  const issues: PlanConflict[] = [];
  const slots = new Map<string, Cargo>();
  cargo.forEach((item) => {
    const key = `${item.deck}-${item.bay}-${item.row}-${item.tier}`;
    const existing = slots.get(key);
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同二维货位。` });
    slots.set(key, item);
    if (item.hazmat !== '无' && item.deck === '主甲板' && item.row <= 1) issues.push({ id: `${item.id}-hazmat`, cargoId: item.id, level: 'high', title: '危险品隔离不足', detail: `${item.id} 与船体边界距离小于方案要求。` });
    if (item.weight > 100 && item.lashing !== '已绑扎') issues.push({ id: `${item.id}-lashing`, cargoId: item.id, level: 'medium', title: '重大件绑扎未完成', detail: `${item.id} 重量 ${item.weight}t，绑扎状态为“${item.lashing}”。` });
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}

export type CargoChange = {
  field: string;
  before: string;
  after: string;
};

export type CargoDiff = {
  cargoId: string;
  bill: string;
  kind: 'moved' | 'modified' | 'added' | 'removed';
  changes: CargoChange[];
};

const slotLabel = (cargo: Cargo) => `${cargo.deck} · Bay ${cargo.bay} / Row ${cargo.row} / Tier ${cargo.tier}`;

/** 对比只读旧版本与新草稿：逐票货找出货位、绑扎、重量等实际变化 */
export function diffCargo(before: Cargo[], after: Cargo[]): CargoDiff[] {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterMap = new Map(after.map((item) => [item.id, item]));
  const diffs: CargoDiff[] = [];
  after.forEach((item) => {
    const old = beforeMap.get(item.id);
    if (!old) {
      diffs.push({ cargoId: item.id, bill: item.bill, kind: 'added', changes: [] });
      return;
    }
    const changes: CargoChange[] = [];
    if (slotLabel(old) !== slotLabel(item)) changes.push({ field: '货位', before: slotLabel(old), after: slotLabel(item) });
    if (old.lashing !== item.lashing) changes.push({ field: '绑扎', before: old.lashing, after: item.lashing });
    if (old.weight !== item.weight) changes.push({ field: '重量', before: `${old.weight} t`, after: `${item.weight} t` });
    if (old.hazmat !== item.hazmat) changes.push({ field: '危险品', before: old.hazmat, after: item.hazmat });
    if (old.port !== item.port) changes.push({ field: '卸货港', before: old.port, after: item.port });
    if (changes.length) diffs.push({ cargoId: item.id, bill: item.bill, kind: changes.some((change) => change.field === '货位') ? 'moved' : 'modified', changes });
  });
  before.forEach((old) => {
    if (!afterMap.has(old.id)) diffs.push({ cargoId: old.id, bill: old.bill, kind: 'removed', changes: [] });
  });
  return diffs;
}

export function deckSlotKey(cargo: Cargo) {
  return `${cargo.bay}-${cargo.row}`;
}
