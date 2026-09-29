import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo, type CargoType } from './api';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

export type ConflictIssue = {
  id: string;
  cargoId: string;
  level: 'high' | 'medium';
  title: string;
  detail: string;
};

/** 锁定时形成的只读审阅结论：货位、冲突、条件接受和意见全部定格 */
export type PlanVersion = {
  id: string;
  revision: number;
  lockedAt: string;
  lockedBy: string;
  cargo: Cargo[];
  comments: StowageComment[];
  acceptedLimits: string[];
  conflicts: ConflictIssue[];
};

/** 对比页 / 打印页统一使用的版本视图：系统基线、锁定版本或当前草稿 */
export type VersionView = {
  id: string;
  revision: number;
  kind: 'baseline' | 'locked' | 'draft';
  lockedAt: string | null;
  lockedBy: string | null;
  cargo: Cargo[];
  comments: StowageComment[];
  acceptedLimits: string[];
  conflicts: ConflictIssue[];
};

type State = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  versions: PlanVersion[];
};

export const seedCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

export const seedComments: StowageComment[] = [
  { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
  { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
  { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
];

const STORAGE_KEY = 'yy62-stowage-plan';
const CORRUPT_BACKUP_KEY = 'yy62-stowage-plan-corrupt';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 清洗货物数组：坏条目剔除，字段缺失给默认值，保证锁定版本不被脏数据拖垮 */
function sanitizeCargoArray(value: unknown): Cargo[] {
  if (!Array.isArray(value)) return [];
  const cargoTypes: CargoType[] = ['集装箱', '散货', '重大件'];
  const lashings: Cargo['lashing'][] = ['已绑扎', '待绑扎', '需复核'];
  return value.filter(isRecord).map((raw): Cargo => ({
    id: String(raw.id ?? ''),
    bill: String(raw.bill ?? ''),
    type: cargoTypes.includes(raw.type as CargoType) ? raw.type as CargoType : '集装箱',
    bay: Number(raw.bay) || 0,
    row: Number(raw.row) || 0,
    tier: Number(raw.tier) || 0,
    deck: raw.deck === '货舱' ? '货舱' : '主甲板',
    weight: Number(raw.weight) || 0,
    dimension: String(raw.dimension ?? ''),
    port: String(raw.port ?? ''),
    hazmat: String(raw.hazmat ?? '无'),
    lashing: lashings.includes(raw.lashing as Cargo['lashing']) ? raw.lashing as Cargo['lashing'] : '待绑扎',
    color: String(raw.color ?? '#88908c')
  })).filter((item) => item.id && item.bill);
}

function sanitizeComments(value: unknown): StowageComment[] {
  if (!Array.isArray(value)) return [];
  const roles: StowageComment['role'][] = ['船长', '码头', '货主'];
  const statuses: StowageComment['status'][] = ['待确认', '已接受', '已退回'];
  return value.filter(isRecord).map((raw) => ({
    id: String(raw.id ?? `CM-${Math.random().toString(36).slice(2, 8)}`),
    cargoId: String(raw.cargoId ?? ''),
    author: String(raw.author ?? '未知'),
    role: roles.includes(raw.role as StowageComment['role']) ? raw.role as StowageComment['role'] : '船长',
    content: String(raw.content ?? ''),
    status: statuses.includes(raw.status as StowageComment['status']) ? raw.status as StowageComment['status'] : '待确认'
  })).filter((item) => item.content);
}

function sanitizeConflicts(value: unknown): ConflictIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((raw, index): ConflictIssue => ({
    id: String(raw.id ?? `conflict-${index}`),
    cargoId: String(raw.cargoId ?? ''),
    level: raw.level === 'medium' ? 'medium' : 'high',
    title: String(raw.title ?? '配载冲突'),
    detail: String(raw.detail ?? '')
  })).filter((item) => item.cargoId);
}

/** 校验并清洗一条锁定版本；坏记录返回 null（由调用方丢弃，但不能波及其他锁定版本） */
function sanitizeVersion(value: unknown): PlanVersion | null {
  if (!isRecord(value)) return null;
  const revision = Number(value.revision);
  if (!Number.isFinite(revision)) return null;
  const cargo = sanitizeCargoArray(value.cargo);
  if (!cargo.length) return null;
  const storedConflicts = sanitizeConflicts(value.conflicts);
  const conflicts = storedConflicts.length ? storedConflicts : detectConflicts(cargo);
  return {
    id: String(value.id ?? `V-${revision}`),
    revision,
    lockedAt: String(value.lockedAt ?? '未知时间'),
    lockedBy: String(value.lockedBy ?? '配载负责人'),
    cargo,
    comments: sanitizeComments(value.comments),
    acceptedLimits: Array.isArray(value.acceptedLimits) ? value.acceptedLimits.map(String) : [],
    conflicts
  };
}

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 系统初始基线：旧草稿没有版本历史时，仍可与最初船岸状态对比 */
export const initialBaseline: PlanVersion = {
  id: 'VB-baseline',
  revision: 0,
  lockedAt: '系统初始基线',
  lockedBy: '系统',
  cargo: clone(seedCargo),
  comments: clone(seedComments),
  acceptedLimits: [],
  conflicts: []
};
initialBaseline.conflicts = detectConflicts(initialBaseline.cargo);

function buildInitialState(): State {
  return {
    cargo: clone(seedCargo),
    activeCargoId: 'BL-88247',
    planRevision: 5,
    comments: clone(seedComments),
    acceptedLimits: [],
    viewMode: '3d',
    draftSavedAt: '09:52',
    versions: []
  };
}

/**
 * 载入本地状态：
 * - 旧草稿（无 versions 字段）平滑升级；
 * - 旧的 locked 草稿补登一条只读锁定版本，历史不丢；
 * - 整体坏记录不会清掉已锁定版本——无法解析时保留安全状态并备份原记录，
 *   个别坏版本条目只丢弃该条，其余锁定版本照常可用。
 */
function loadState(): State {
  if (typeof localStorage === 'undefined') return buildInitialState();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return buildInitialState();
  }
  if (!raw) return buildInitialState();
  return hydrateFromRaw(raw);
}

/** 从原始记录恢复状态：供初始化与（测试）重入使用 */
export function hydrateStateFromStorage(raw: string | null): State {
  return raw === null ? buildInitialState() : hydrateFromRaw(raw);
}

function hydrateFromRaw(raw: string): State {
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    // 整条记录损坏：备份坏记录，回到安全默认，绝不覆盖式“修复”导致锁定版本丢失
    try {
      localStorage.setItem(`${CORRUPT_BACKUP_KEY}-${Date.now()}`, raw);
    } catch {
      /* 存储不可用时忽略 */
    }
    return buildInitialState();
  }
  if (!isRecord(saved)) return buildInitialState();

  const legacyLocked = saved.locked === true;
  const versions = (Array.isArray(saved.versions) ? saved.versions : [])
    .map(sanitizeVersion)
    .filter((item): item is PlanVersion => item !== null)
    .sort((a, b) => a.revision - b.revision);

  // 草稿货物损坏时，依次回退到最近锁定版本、系统基线、种子数据
  const sanitizedCargo = sanitizeCargoArray(saved.cargo);
  const fallbackCargo = versions.length ? versions[versions.length - 1].cargo : seedCargo;
  const cargo = sanitizedCargo.length ? sanitizedCargo : clone(fallbackCargo);

  const state: State = {
    cargo,
    activeCargoId: String(saved.activeCargoId ?? cargo[0]?.id ?? seedCargo[0].id),
    planRevision: Number(saved.planRevision) || (versions.length ? versions[versions.length - 1].revision + 1 : 5),
    comments: sanitizeComments(saved.comments),
    acceptedLimits: Array.isArray(saved.acceptedLimits) ? saved.acceptedLimits.map(String) : [],
    viewMode: saved.viewMode === 'section' ? 'section' : '3d',
    draftSavedAt: typeof saved.draftSavedAt === 'string' ? saved.draftSavedAt : nowLabel(),
    versions
  };
  if (!state.cargo.some((item) => item.id === state.activeCargoId)) {
    state.activeCargoId = state.cargo[0]?.id ?? seedCargo[0].id;
  }

  // 旧草稿升级：原先 locked=true 但没有版本历史的，补登为只读锁定版本
  if (legacyLocked && !versions.some((item) => item.revision === state.planRevision)) {
    const legacyVersion = sanitizeVersion({
      id: `V${state.planRevision}-legacy`,
      revision: state.planRevision,
      lockedAt: `历史锁定 · 草稿时间 ${state.draftSavedAt}`,
      lockedBy: '旧版方案升级',
      cargo: state.cargo,
      comments: state.comments,
      acceptedLimits: state.acceptedLimits,
      conflicts: detectConflicts(state.cargo)
    });
    if (legacyVersion) {
      state.versions.push(legacyVersion);
      state.versions.sort((a, b) => a.revision - b.revision);
      state.planRevision += 1; // 锁定之后的编辑进入新草稿
    }
  }

  return state;
}

const initialState = loadState();

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      // 只作用于当前草稿，已锁定版本的货位不会被后来的拖货改写
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) Object.assign(cargo, action.payload);
      state.draftSavedAt = nowLabel();
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
      state.draftSavedAt = nowLabel();
    },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
      state.draftSavedAt = nowLabel();
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
      state.draftSavedAt = nowLabel();
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
      state.draftSavedAt = nowLabel();
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) {
      // 阻断级冲突存在时不允许形成审阅结论
      if (detectConflicts(state.cargo).some((item) => item.level === 'high')) return;
      const revision = state.planRevision;
      const snapshot: PlanVersion = {
        id: `V${revision}-${Date.now()}`,
        revision,
        lockedAt: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        lockedBy: '配载负责人',
        cargo: clone(state.cargo),
        comments: clone(state.comments),
        acceptedLimits: clone(state.acceptedLimits),
        conflicts: detectConflicts(state.cargo)
      };
      state.versions = [...state.versions.filter((item) => item.revision !== revision), snapshot]
        .sort((a, b) => a.revision - b.revision);
      // 锁定后开启新草稿：复制当前内容继续拖货/改绑扎/处理意见，旧版本自此只读
      state.planRevision = revision + 1;
      state.draftSavedAt = nowLabel();
    }
  }
});

export const { selectCargo, moveCargo, updateLashing, addComment, acceptComment, rejectComment, acceptLimit, setViewMode, lockPlan } = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().stowage));
  } catch {
    /* 存储不可用（隐私模式/配额）时不影响页面操作 */
  }
});

export type RootState = ReturnType<typeof store.getState>;

export function getLatestVersion(state: State): VersionView | null {
  const latest = state.versions.length ? state.versions[state.versions.length - 1] : null;
  return latest ? toView(latest, 'locked') : null;
}

function toView(version: PlanVersion, kind: VersionView['kind']): VersionView {
  return { ...version, kind, lockedBy: version.lockedBy ?? null };
}

/** 可在对比页/打印页选择的全部版本：系统基线 + 按时间排列的锁定版本 + 当前草稿 */
export function listVersionViews(state: State): VersionView[] {
  const draft: VersionView = {
    id: 'draft',
    revision: state.planRevision,
    kind: 'draft',
    lockedAt: null,
    lockedBy: null,
    cargo: state.cargo,
    comments: state.comments,
    acceptedLimits: state.acceptedLimits,
    conflicts: detectConflicts(state.cargo)
  };
  return [toView(initialBaseline, 'baseline'), ...state.versions.map((item) => toView(item, 'locked')), draft];
}

export function findVersionView(state: State, id: string): VersionView {
  const views = listVersionViews(state);
  return views.find((item) => item.id === id) ?? views[views.length - 1];
}

export function versionLabel(view: Pick<VersionView, 'kind' | 'revision'>): string {
  if (view.kind === 'baseline') return '初始基线';
  if (view.kind === 'draft') return `草稿 V${view.revision}`;
  return `锁定 V${view.revision}`;
}

export type CargoChange = {
  cargoId: string;
  bill: string;
  kind: 'moved' | 'modified' | 'added' | 'removed';
  field: string;
  before: string;
  after: string;
};

function locationOf(item: Cargo) {
  return `${item.deck} · Bay ${item.bay} / Row ${item.row} / Tier ${item.tier}`;
}

/** 比较两个版本的货物，列出货位、绑扎、重量、危险品、卸货港的差异 */
export function diffCargo(beforeCargo: Cargo[], afterCargo: Cargo[]): CargoChange[] {
  const changes: CargoChange[] = [];
  const beforeMap = new Map(beforeCargo.map((item) => [item.id, item]));
  const afterMap = new Map(afterCargo.map((item) => [item.id, item]));

  beforeCargo.forEach((before) => {
    const after = afterMap.get(before.id);
    if (!after) {
      changes.push({ cargoId: before.id, bill: before.bill, kind: 'removed', field: '货物', before: `${before.bill} 在船`, after: '已移除', });
      return;
    }
    if (locationOf(before) !== locationOf(after)) {
      changes.push({ cargoId: before.id, bill: before.bill, kind: 'moved', field: '货位', before: locationOf(before), after: locationOf(after) });
    }
    const fields: [keyof Cargo, string][] = [
      ['lashing', '绑扎'],
      ['weight', '重量'],
      ['hazmat', '危险品'],
      ['port', '卸货港']
    ];
    fields.forEach(([key, label]) => {
      if (before[key] !== after[key]) {
        changes.push({ cargoId: before.id, bill: before.bill, kind: 'modified', field: label, before: String(before[key]), after: String(after[key]) });
      }
    });
  });
  afterCargo.forEach((after) => {
    if (!beforeMap.has(after.id)) {
      changes.push({ cargoId: after.id, bill: after.bill, kind: 'added', field: '货物', before: '不在船', after: `${after.bill} 新加` });
    }
  });
  return changes;
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

export function detectConflicts(cargo: Cargo[]): ConflictIssue[] {
  const issues: ConflictIssue[] = [];
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
