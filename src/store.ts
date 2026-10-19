// store.ts — 共享响应式状态 + 全部 UI 动作（弹窗 / 设置页共用）
// 说明：popup.html 与 options.html 各自独立挂载 App，模块级单例在各自页面
// 内共享；不跨页面通信（页面间依赖 chrome.storage / Supabase 作为权威）。
import { reactive, computed, type ComputedRef } from 'vue';
import { api, type ExtensionMessage } from './lib/ext.js';
import { describeError } from './lib/errors.js';
import { supabase } from './lib/supabase.js';
import { readUiCache, writeUiCache, clearUiCache, type UiCache } from './lib/uiCache.js';
import { reportError } from './lib/telemetry.js';
import type { AuthError, Session } from '@supabase/supabase-js';
import {
  getProfile,
  countServerBookmarks,
  getBoundSpace,
  hasLocalBinding,
  createSpace,
  deleteSpace,
  renameSpace,
  listDevices,
  removeDevice,
  renameDevice,
  getDeviceId,
  resetCoordinator,
  FREE_ITEM_LIMIT,
  type SpaceInfo,
  type DeviceInfo,
  type ProfileInfo,
  type SyncRunResult,
} from './sync.js';
import { decryptMoveOp, bindGateNeeded, isPaidPlan, type ChromeTreeNode } from './sync/index.js';
import {
  exportKey,
  importKey,
  hasKey,
  setKeyFromPassphrase,
  isFirstDevice,
  clearLocalKey,
  ensureLocalKey,
} from './crypto.js';
import { t } from './lib/i18n.js';

// ---- 类型 ----
/** toast 级别（样式类在 App.vue 按 level 映射）。 */
type ToastLevel = 'info' | 'success' | 'danger' | 'warning';

interface Toast {
  id: string;
  level: ToastLevel;
  title: string;
  sub: string;
}

/** 最近一次解密失败详情（sync.ts runSync 落盘 `lastDecryptErrors`）。 */
interface DecryptErrors {
  errors: unknown[];
  at: number;
}

/** 同步方向摘要（syncNow 持久化，展示时经 t() 本地化）。 */
interface SyncSummary {
  seeded: boolean;
  restored: boolean;
  push: boolean;
  pull: boolean;
  dec: number;
  /**
   * 本机无处落地的书签条数（runSync 的 unplaced；0 = 无）。
   * **仅供诊断，不进 UI**（2026-10-09）：这是 Chrome 环境造成的人为限制，不是
   * 故障，展示出来会被用户当成插件坏了。排查看 background 控制台。
   */
  unplaced: number;
}

/** 首绑门禁在同步中收到 bind_needed 时传入的空间列表项。 */
interface BindSpaceOption {
  id: string;
  name: string;
  is_default?: boolean;
}

// ---- 状态 ----

/**
 * 本地开发用的默认登录凭据（**仅本地构建注入，见下方 declare**）。
 *
 * 真实值由 `vite.config.js` 从 `.dev-creds.json`（gitignored）读入，经
 * `define` 编译进产物。**CI 构建与正式发版拿不到这个值** —— 文件不在仓库里，
 * `define` 拿不到就退化成空串，所以商店包不受影响。
 *
 * ⚠ 别把凭据写进 `src/`：src 会进 git、被 CI 打包、最终进商店。
 */
declare const __DEV_CREDS__: { email: string; password: string; passphrase: string };
const devCreds = typeof __DEV_CREDS__ !== 'undefined' ? __DEV_CREDS__ : null;

export const state = reactive({
  // auth
  session: null as Session | null,
  email: devCreds?.email ?? '',
  password: devCreds?.password ?? '',
  mode: 'login' as 'login' | 'register',
  busy: false,
  authError: '',
  authSuccess: '',

  // sync 状态（由 storage 权威回填）
  syncBusy: false,
  status: '',
  lastSyncAt: null as number | null,
  // lastSyncStatus 为机器可读："ok" | "error"（旧版本为中文文案，展示层兼容）；
  // lastSyncStatusDetail 存原因码 + 错误信息，lastSyncSummary 存方向摘要 JSON，
  // 两者都在展示时才经 t() 本地化（避免持久化文案与浏览器语言不一致）。
  lastSyncStatus: '',
  lastSyncStatusDetail: '',
  lastSyncSummary: '',
  lastDecryptErrors: null as DecryptErrors | null,

  // 密钥
  keyValue: '',
  passphraseStored: '',
  keyImportInput: '',
  keyMsg: '',
  keyPhraseInput: '',
  hasKeyNow: false,
  keyStateLoaded: false,

  // 口令门禁（登录后必须先过这关才能进主界面）
  phraseGateVisible: false,
  phraseGateMode: '', // 'setup' = 第一台设备设新口令；'verify' = 其它设备验证旧口令
  phraseGateInput: '',
  phraseGateMsg: '',
  phraseGateBusy: false,
  // 口令门禁是否已判定（key 状态 + setup/verify 模式）。判定完成前主界面不渲染，
  // 避免「先闪现主界面、再弹门禁页」的错误顺序。
  gateChecked: false,

  // 付费档案
  profile: null as ProfileInfo | null, // { plan, quota_bytes, used_bytes, used_count?, purchased_at }
  serverCount: null as number | null, // 基线回退：最近一次同步后的服务端书签条数
  // 云端补水（hydrateRemote）是否失败。首屏不再等云端取数，失败就必须有个说法
  // ——否则额度卡会永远停在「加载中」（见 quotaPlaceholder）。
  remoteFailed: false,
  showUpgradeModal: false,
  checkoutBusy: false,

  // 空间 / 设备
  spaces: [] as SpaceInfo[],
  // 本机**绑定**的空间（一台设备一个空间；本机书签树 ≡ 该空间）。
  activeSpace: null as SpaceInfo | null,
  // 绑定过、但该空间已被删（与「从未绑定」区分：前者走显式换绑，后者才是首绑门禁）。
  boundStale: false,
  // 换绑确认：待换绑到的空间 id（''= 无）。换绑会清空本机书签，必须显式确认。
  rebindTarget: '',
  devices: [] as DeviceInfo[],
  myDeviceId: '',
  newSpaceName: '',
  spaceBusy: false,
  creatingSpace: false, // 「新建空间」行展开态
  renamingId: '',
  renameInput: '',
  renamingDeviceId: '',
  deviceRenameInput: '',

  // 危险操作两步确认（armed 目标 key + 3 秒递减倒计时）
  armed: '',
  armedLeft: 3,

  // 首绑门禁（本机从未绑定过 + 有真选择 → 登录取数后就挡住主界面，让用户决定
  // 这台电脑加入哪个空间）。绑定是一次显式动作，错过这次就只能去空间列表里换绑。
  // 是**门禁**不是弹窗：选择是必须的，能关掉的弹窗等于让人卡在没有同步的半残状态。
  // 「有真选择」= 云端 ≥2 个空间，或账号还能新建空间（见 sync/binding.ts）。
  bindGateVisible: false,
  canCreateSpace: false, // 账号还能不能新建空间（付费档）——门禁页据此决定要不要给「新建」入口
  bindSpaces: [] as BindSpaceOption[], // [{ id, name, is_default }]
  bindTarget: '', // 选中的空间 id（'' = 还没选）
  bindMode: 'merge' as 'merge' | 'overwrite', // 'merge' 本机书签并入该空间 | 'overwrite' 用该空间覆盖本机
  bindNewName: '', // 「新建一个空间并加入」的输入
  bindCreating: false, // 新建空间输入行展开态
  bindBusy: false,
  bindLocalCount: 0, // 本机现有书签条数（门禁说明用）

  // 弹窗二级面板（抽屉）
  drawer: '', // '' | 'account' | 'spaces' | 'key' | 'help' | 'feedback' | 'system'

  // 设置页导航
  navPane: 'account', // 'account' | 'sync' | 'spaces' | 'crypto' | 'help' | 'feedback' | 'system'

  // toast 队列
  toasts: [] as Toast[],
});

// ---- 首屏缓存 / 云端补水 ----
//
// 分工（见 lib/uiCache.ts 的完整背景）：
//   bootstrapLocal()  —— 本地状态放行首屏，**不等云端**；
//   hydrateRemote()   —— 云端取数，结果到了再覆盖；失败只降级，不抛穿、不卡首屏。
// 两者都不该把「渲染」压在网络往返上，这是 popup「打开要转好几秒」的病根。

/** 把当前 state 的云端投影落盘，供下次打开先渲染（stale-while-revalidate）。 */
function persistUiCache(): Promise<void> {
  return writeUiCache(state.session?.user?.id ?? '', {
    profile: state.profile,
    serverCount: state.serverCount,
    spaces: state.spaces,
    activeSpace: state.activeSpace,
    boundStale: state.boundStale,
    devices: state.devices,
  });
}

/**
 * 用上一帧的缓存先填一遍 state（随后被 hydrateRemote 的权威结果覆盖）。
 *
 * 只填展示数据，**不碰门禁**：首绑门禁必须等云端确认了空间列表才谈得上判定，
 * 拿缓存去判会凭过期数据挡出整页门禁。
 */
function applyUiCache(c: UiCache | null): void {
  if (!c) return;
  state.profile = c.profile;
  state.serverCount = c.serverCount;
  state.spaces = c.spaces;
  state.activeSpace = c.activeSpace;
  state.boundStale = c.boundStale;
  state.devices = c.devices;
}

/**
 * 云端补水：付费档案 / 空间 / 设备。
 *
 * `remoteFailed` 只在这里写（两个请求都成功才清），免得 refreshProfile 与
 * refreshSpacesDevices 并发跑时互相覆盖；两者都不抛异常，所以这里也永远不会
 * 把失败甩给调用方——UI 路径上「取数失败」只该表现为额度卡的占位文案。
 */
async function hydrateRemote(): Promise<void> {
  const [profileOk, spacesOk] = await Promise.all([refreshProfile(), refreshSpacesDevices()]);
  state.remoteFailed = !(profileOk && spacesOk);
}

// ---- 计时器句柄（页面级单例） ----
let armedTimer: ReturnType<typeof setInterval> | null = null;

// ---- Toast ----
export function showToast(level: ToastLevel, title: string, sub = ''): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.toasts.push({ id, level, title, sub });
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id);
    if (i >= 0) state.toasts.splice(i, 1);
  }, 3200);
}

// ---- 危险操作两步确认：首次点击进入 armed 倒计时（3→1），再次点击执行 ----
function armStart(key: string): void {
  state.armed = key;
  state.armedLeft = 3;
  clearInterval(armedTimer ?? undefined);
  armedTimer = setInterval(() => {
    state.armedLeft -= 1;
    if (state.armedLeft <= 0) {
      state.armed = '';
      clearInterval(armedTimer ?? undefined);
      armedTimer = null;
    }
  }, 1000);
}
export function disarmAction(): void {
  clearInterval(armedTimer ?? undefined);
  armedTimer = null;
  state.armed = '';
  state.armedLeft = 3;
}
export function armAction(key: string, onConfirm: () => void): void {
  if (state.armed !== key) {
    armStart(key);
    return;
  }
  disarmAction();
  onConfirm();
}

// ---- 同步密钥 ----
export async function refreshKeyState(): Promise<void> {
  try {
    state.hasKeyNow = await hasKey();
  } catch {
    state.hasKeyNow = false;
  }
  state.keyStateLoaded = true;
}

export async function loadKeyPanel(): Promise<void> {
  // 注意：exportKey() 内部会调 ensureKey() 自动生成密钥，因此无密钥时不能调它，
  // 否则用户只是看一眼密钥面板就被动生成了一把密钥，与提示文字矛盾。
  const has = await hasKey();
  state.keyMsg = has ? '' : t('key_noneYet');
  state.keyValue = has ? await exportKey() : '';
  state.passphraseStored = has
    ? ((await api.storage.local.get('crdt.passphrase'))['crdt.passphrase'] as string | undefined) ||
      ''
    : '';
  state.hasKeyNow = has;
  state.keyStateLoaded = true;
}

export async function copyKey(): Promise<void> {
  if (!state.keyValue) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(state.keyValue);
  } catch {
    /* 剪贴板受限时静默 */
  }
  state.keyMsg = t('key_copiedMsg');
  showToast('info', t('key_copiedTitle'), t('key_copiedSub'));
}

export async function copyPhrase(): Promise<void> {
  if (!state.passphraseStored) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(state.passphraseStored);
  } catch {
    /* 剪贴板受限时静默 */
  }
  showToast('info', t('phrase_copiedTitle'), t('phrase_copiedSub'));
}

export async function doImportKey(): Promise<void> {
  const ok = await importKey(state.keyImportInput);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: 'bsync-reset-coordinator' });
    state.keyMsg = t('key_importedMsg');
    state.keyImportInput = '';
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast('success', t('key_importedTitle'), t('key_importedSub'));
  } else {
    state.keyMsg = t('key_badFormat');
    showToast('danger', t('key_badFormatTitle'), t('key_badFormatSub'));
  }
}

export async function doSetKeyByPhrase(): Promise<void> {
  const phrase = state.keyPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.keyMsg = t('phrase_tooShort');
    showToast('danger', t('phrase_tooShortTitle'), t('phrase_tooShortSub'));
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: 'bsync-reset-coordinator' });
    state.keyMsg = t('phrase_setByKeyMsg');
    state.keyPhraseInput = '';
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast('success', t('phrase_setByKeyTitle'), t('phrase_setByKeySub'));
  } else {
    state.keyMsg = t('phrase_setFail');
    showToast('danger', t('phrase_lenTitle'), t('phrase_notSet'));
  }
}

// ---- 口令门禁：登录后必须先过这关才能进主界面 ----
// 第一台设备（云端无盐）：设置新口令；其它设备（云端有盐）：输入旧口令，用它解开
// 云端一条真实 op 才算过（见 verifyPassphrase）。口令一旦设过就不可再改。
/**
 * 用刚派生的密钥验一次口令：能解开云端最新的一条 op 就算对。
 *
 * 取哪条 op：**账号下所有空间里最新的一条**，而不是「本机绑定空间」那条。第二台
 * 设备过门禁时**还没有绑定**，按绑定空间找会拿到 `active == null` 直接放行 —— 等于
 * 没验，口令错要拖到同步时才炸，那时用户已经站在主界面里了。
 *
 * （历史坑：6e091c8 把 `getActiveSpace` 改名成 `getBoundSpace`，唯独漏了这处调用。
 * `ReferenceError` 被下面的 catch 吞成「口令不正确」，于是**任何**第二台设备都永远
 * 过不了门禁。见 eslint 配置里 no-undef 未生效的注释。）
 *
 * @returns 'ok' 通过（含「没有可验的数据」）/ 'wrong' 解密失败 = 口令错 /
 *          'unchecked' 没验成（网络 / 权限 / RPC 失败）——**不能**当成口令错。
 */
async function verifyPassphrase(): Promise<'ok' | 'wrong' | 'unchecked'> {
  let ids: string[] = [];
  try {
    const { spaces: sp } = await getBoundSpace();
    ids = sp.map((s) => s.id);
  } catch {
    return 'unchecked'; // 连空间都取不到 = 网络/权限问题，与口令无关
  }
  if (!ids.length) return 'ok'; // 账号下还没有空间：没有可验的加密数据
  try {
    const { data, error } = await supabase
      .from('bsync_op_log')
      .select('op, space_id')
      .in('space_id', ids)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return 'unchecked';
    if (!data?.op) return 'ok'; // 云端还没有 op（刚设过口令还没播种）：无数据可验
    const key = await ensureLocalKey();
    if (!key) return 'unchecked';
    // AAD 用这把 op 自己那行的 space_id（不是我们挑空间时的 id）：口令对但空间
    // 对不上也会解不开，别把「拿错空间」误报成「口令错」。
    await decryptMoveOp(data.op, key, data.space_id);
    return 'ok';
  } catch {
    // 查询失败走上面的 error 分支，能到这里基本只有解密本身失败 = 口令不对
    return 'wrong';
  }
}

export async function initPhraseGate(): Promise<void> {
  const has = await hasKey();
  if (has) {
    state.phraseGateVisible = false;
    return;
  }
  // 判据是 isFirstDevice 的三态（见 crypto.ts）：只有**确认**云端没有盐才进 setup，
  // 问不到（null）必须落在保守的 verify —— 云端有数据时错口令解不开会被
  // verifyPassphrase 拦下并回滚本机密钥，云端没数据时才算新设备设口令。把 null 当
  // 首设备会让网络抖动中的第二台设备被引导设新口令，派生出一把解不开既有数据的密钥。
  // 写全 `=== true` 而不是真值判断：对 boolean|null 两者恰好等价（null 也 falsy），
  // 写全是为了把「null ≠ 首设备」摆在调用点，免得日后 isFirstDevice 改成别的三态值
  // （比如字符串状态码）时这里被悄悄带偏。
  state.phraseGateMode = (await isFirstDevice()) === true ? 'setup' : 'verify';
  // 本地开发便利：注入的口令自动填好（仅本地构建有值，见 devCreds 注释）。
  // 正式发版拿不到 __DEV_CREDS__ → 这里就是空串，行为与从前完全一致。
  state.phraseGateInput = devCreds?.passphrase ?? '';
  state.phraseGateMsg = '';
  state.phraseGateBusy = false;
  state.phraseGateVisible = true;
}

export async function submitPhraseGate(): Promise<void> {
  const phrase = state.phraseGateInput;
  if (!phrase || phrase.length < 8) {
    state.phraseGateMsg = t('gate_errShort');
    return;
  }
  state.phraseGateBusy = true;
  state.phraseGateMsg = '';
  try {
    const ok = await setKeyFromPassphrase(phrase);
    if (!ok) {
      state.phraseGateMsg = t('gate_errSetFail');
      return;
    }
    // verify 模式：云端已有数据，必须能解密一条真实 op 才算口令正确。
    if (state.phraseGateMode === 'verify') {
      const check = await verifyPassphrase();
      if (check !== 'ok') {
        // 两种失败都要清掉刚派生的密钥：门禁不能把「未经验证的密钥」留在本机——
        // hasKey() 为真会让下次 initPhraseGate 直接放行，用户带着错口令进主界面。
        await clearLocalKey();
        state.phraseGateMsg = t(check === 'wrong' ? 'gate_errWrong' : 'gate_errCheck');
        return;
      }
    }
    // 通过：在本机存一份口令明文（不上云），供加密面板查看/备份
    await api.storage.local.set({ 'crdt.passphrase': phrase });
    // 通过：关门禁，重置 coordinator 让 SW 用新密钥
    state.phraseGateVisible = false;
    state.phraseGateInput = '';
    resetCoordinator();
    api.runtime.sendMessage({ type: 'bsync-reset-coordinator' });
    await Promise.all([refreshStatus(), refreshKeyState(), hydrateRemote()]);
    showToast(
      'success',
      state.phraseGateMode === 'setup' ? t('gate_okSetupTitle') : t('gate_okVerifyTitle'),
      state.phraseGateMode === 'setup' ? t('gate_okSetupSub') : t('gate_okVerifySub'),
    );
    // 立即同步：清掉设口令前遗留的 no_key 失败状态，也省一次手动点击。
    // 若双方都有书签，syncNow 会按流程弹出首同步决策弹窗。
    syncNow();
  } finally {
    state.phraseGateBusy = false;
  }
}

// ---- 空间 / 设备 ----
/** @returns 是否取到云端空间/设备（false = 网络或权限失败）。不抛异常：调用方多为 UI 路径。 */
export async function refreshSpacesDevices(): Promise<boolean> {
  try {
    const { spaces: sp, bound, stale } = await getBoundSpace();
    state.spaces = sp;
    state.activeSpace = bound;
    state.boundStale = !!stale;
    // 把已经拿到的绑定 id 直接传下去。不传的话 listDevices 会自己再查一遍
    // bsync_spaces——首屏关键路径上白白多一次往返（见 lib/uiCache.ts 的说明）。
    state.devices = await listDevices(bound?.id ?? null);
    state.myDeviceId = await getDeviceId();
    syncBindGate();
    void persistUiCache();
    return true;
  } catch (e) {
    console.warn(
      '[store] refreshSpacesDevices failed:',
      (e as { message?: unknown })?.message ?? e,
    );
    return false;
  }
}

/** 该空间是否就是本机绑定的空间（UI 徽标 / 换绑入口共用）。 */
export function isBoundSpace(spaceId: string): boolean {
  return state.activeSpace?.id === spaceId;
}

/**
 * 换绑本机空间（危险操作，需显式确认，见 SpacesList 的确认条）。
 *
 * 语义：本机书签树 ≡ 绑定空间，所以换绑 = **清空本机书签 + 从目标空间重建**。
 * 由 SW 执行——只有 SW 持有与事件桥同 realm 的 coordinator，「先把原空间的
 * 未推送 op 推完」才等得到真实队列；成功后 SW 立即同步一次把书签重建出来。
 */
export async function doRebindSpace(sp: SpaceInfo): Promise<void> {
  if (isBoundSpace(sp.id) || state.spaceBusy) return;
  state.spaceBusy = true;
  state.rebindTarget = '';
  try {
    const r = (await api.runtime.sendMessage({ type: 'bsync-space-rebind', spaceId: sp.id })) as
      | { ok?: boolean; reason?: string; error?: string }
      | undefined;
    if (!r?.ok) {
      showToast(
        'danger',
        t('spaces_switchFailTitle'),
        r?.reason === 'push_failed'
          ? t('spaces_switchPushFailed')
          : t('common_failPrefix', r?.error ?? r?.reason ?? ''),
      );
      return;
    }
    await refreshSpacesDevices();
    showToast('info', t('spaces_switchedTitle', sp.name), t('spaces_switchedSub'));
  } finally {
    state.spaceBusy = false;
  }
}

/** 展开/收起换绑确认条（点击非绑定空间时调用）。 */
export function armRebind(sp: SpaceInfo): void {
  if (isBoundSpace(sp.id)) return;
  state.rebindTarget = state.rebindTarget === sp.id ? '' : sp.id;
}

export async function doCreateSpace(): Promise<void> {
  if (!state.newSpaceName.trim() || state.spaceBusy) return;
  state.spaceBusy = true;
  try {
    const r = await createSpace(state.newSpaceName);
    if (!r.ok && r.reason === 'plan_locked') {
      state.showUpgradeModal = true;
      showToast('warning', t('spaces_limitTitle'), t('spaces_limitSub'));
      return;
    }
    if (!r.ok && r.reason === 'duplicate') {
      showToast('danger', t('spaces_dupTitle'), '');
      return;
    }
    if (!r.ok) {
      showToast('danger', t('common_failPrefix', r.error ?? r.reason), '');
      return;
    }
    state.newSpaceName = '';
    state.creatingSpace = false;
    await refreshSpacesDevices();
    showToast('success', t('spaces_createdTitle'), t('spaces_createdSub'));
  } finally {
    state.spaceBusy = false;
  }
}

export function startRename(sp: SpaceInfo): void {
  state.renamingId = sp.id;
  state.renameInput = sp.name;
}

export async function submitRename(sp: SpaceInfo): Promise<void> {
  const name = state.renameInput.trim();
  if (!name || name === sp.name) {
    state.renamingId = '';
    return;
  }
  const r = await renameSpace(sp.id, name);
  state.renamingId = '';
  if (!r.ok && r.reason === 'duplicate') {
    showToast('danger', t('spaces_dupTitle'), '');
    return;
  }
  if (!r.ok) {
    showToast('danger', t('spaces_renameFail', r.error ?? r.reason), '');
    return;
  }
  await refreshSpacesDevices();
  showToast('success', t('spaces_renamed'), '');
}

export async function doDeleteSpace(sp: SpaceInfo): Promise<void> {
  armAction(`space:${sp.id}`, async () => {
    const r = await deleteSpace(sp.id);
    if (!r.ok && r.reason === 'cannot_delete_default') {
      showToast('danger', t('spaces_cantDeleteDefault'), '');
      return;
    }
    if (!r.ok) {
      showToast('danger', t('spaces_deleteFail', r.error ?? r.reason), '');
      return;
    }
    await refreshSpacesDevices();
    showToast('success', t('spaces_deletedTitle', sp.name), '');
  });
}

export async function doRemoveDevice(d: DeviceInfo): Promise<void> {
  armAction(`device:${d.device_id}`, async () => {
    try {
      await removeDevice(d.device_id);
      await refreshSpacesDevices();
      showToast('success', t('devices_removedTitle'), t('devices_removedSub'));
    } catch (e) {
      showToast(
        'danger',
        t('common_failPrefix', (e as { message?: string })?.message ?? String(e)),
        '',
      );
    }
  });
}

// ---- 设备改名 ----
export function startDeviceRename(d: DeviceInfo): void {
  state.renamingDeviceId = d.device_id;
  state.deviceRenameInput = baseDeviceName(d); // 预填当前存储名；未命名过则为空
}

export async function submitDeviceRename(d: DeviceInfo): Promise<void> {
  const name = state.deviceRenameInput.trim();
  if (!name || name === baseDeviceName(d)) {
    state.renamingDeviceId = '';
    return;
  }
  const r = await renameDevice(d.device_id, name);
  state.renamingDeviceId = '';
  if (!r.ok && r.reason === 'invalid_name') {
    showToast('danger', t('devices_invalidName'), t('devices_invalidNameSub'));
    return;
  }
  if (!r.ok) {
    showToast('danger', t('devices_renameFail', r.error ?? r.reason), '');
    return;
  }
  await refreshSpacesDevices();
  showToast('success', t('devices_renamed'), t('devices_renamedSub'));
}

// ---- 设备名展示 ----
function baseDeviceName(d: DeviceInfo): string {
  const raw = d.name || '';
  if (
    !raw ||
    raw === d.device_id ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    return '';
  }
  return raw;
}

function shortTag(id: string): string {
  let h = 0;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, '0').slice(-4).toUpperCase();
}

const dupDeviceNames: ComputedRef<Map<string, number>> = computed(() => {
  const m = new Map<string, number>();
  for (const d of state.devices) {
    const n = baseDeviceName(d) || t('device_unknown', shortTag(d.device_id));
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
});

export function deviceLabel(d: DeviceInfo): string {
  const known = baseDeviceName(d);
  const name = known || t('device_unknown', shortTag(d.device_id));
  return (dupDeviceNames.value.get(name) ?? 0) > 1 ? `${name} · ${shortTag(d.device_id)}` : name;
}

// 设备最近同步的空间名（用户心智是「哪台浏览器在对哪棵树干活」）
export function deviceSpaceName(d: DeviceInfo): string {
  if (!d.last_space_id) return '';
  const sp = state.spaces.find((s) => s.id === d.last_space_id);
  return sp ? sp.name : '';
}

export function deviceCountForSpace(spaceId: string): number {
  return state.devices.filter((d) => d.last_space_id === spaceId).length;
}

// ---- 付费 / 配额 ----
/**
 * 取云端付费档案（+ 配额口径兜底的服务端条数）。
 *
 * @returns 是否取到（false = 网络 / 权限失败）。**不抛异常**：这条链上的调用方
 *          多是 UI 路径（登录后、设完口令、同步完成后），抛出去会把后面的
 *          「关门禁 / 提示 / 触发同步」全跳过——用户在界面上只会看到卡住。
 */
export async function refreshProfile(): Promise<boolean> {
  try {
    state.profile = await getProfile();
    if (!(state.profile && typeof state.profile.used_count === 'number')) {
      state.serverCount = await countServerBookmarks();
    }
    // 门禁判据含档位（付费才谈得上「新建一个空间」），所以要在这里也重判一次：
    // 登录时 refreshProfile 与 refreshSpacesDevices 是并发跑的，谁先到不确定，
    // 只在 refreshSpacesDevices 末尾判会读到 profile=null（=当免费处理）而漏挡。
    // syncBindGate 幂等，两边都调是安全的。
    syncBindGate();
    void persistUiCache();
    return true;
  } catch (e) {
    console.warn('[store] refreshProfile failed:', (e as { message?: unknown })?.message ?? e);
    return false;
  }
}

export async function startCheckout(plan: string): Promise<void> {
  if (state.checkoutBusy) return;
  state.checkoutBusy = true;
  try {
    const { data, error } = await supabase.functions.invoke('bsync-creem-checkout', {
      body: { plan },
    });
    const url = data?.checkout_url;
    if (error || !url) {
      showToast(
        'danger',
        t('pay_checkoutFail'),
        data?.message ?? error?.message ?? t('pay_tryLater'),
      );
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
    state.showUpgradeModal = false;
    showToast('info', t('pay_checkoutOpened'), t('pay_checkoutOpenedSub'));
  } catch (e) {
    showToast('danger', t('pay_checkoutFail'), (e as { message?: string })?.message ?? String(e));
  } finally {
    state.checkoutBusy = false;
  }
}

export async function manageSubscription(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('bsync-creem-portal', {
      body: {},
    });
    const url = data?.portal_url;
    if (error || !url) {
      showToast(
        'danger',
        t('pay_portalFail'),
        data?.message ?? error?.message ?? t('pay_tryLater'),
      );
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  } catch (e) {
    showToast('danger', t('pay_portalFail'), (e as { message?: string })?.message ?? String(e));
  }
}

export function openUpgrade(): void {
  state.showUpgradeModal = true;
}

// ---- 首绑门禁 ----
/** 本机书签条数（不含浏览器的固定根容器）。 */
async function countLocalBookmarks(): Promise<number> {
  const FIXED = new Set([
    '1',
    '2',
    '3',
    'root________',
    'toolbar_____',
    'unfiled_____',
    'mobile______',
    'menu________',
  ]);
  try {
    const tree = await api.bookmarks.getTree();
    let n = 0;
    const walk = (nodes: ChromeTreeNode[] | undefined): void => {
      for (const node of nodes ?? []) {
        if (!FIXED.has(node.id)) n += 1;
        walk(node.children);
      }
    };
    for (const root of tree ?? []) walk(root.children);
    return n;
  } catch {
    return 0;
  }
}

/**
 * 打开首绑门禁（`syncNow` 收到 `bind_needed` 时调用）。
 *
 * 这是**唯一**一次「这台电脑加入哪个空间」的选择时机：绑定一旦写下就不再是
 * 「从未绑定」，之后只能走换绑（清空 + 重建）。所以这里宁可多问一次。
 *
 * 不做冷却：门禁不可关，用户没选完就一直挡着，不存在「每半小时骚扰一次」的问题
 * ——冷却那套是给「能点稍后」的弹窗准备的。
 */
async function openBindGate(spaces: BindSpaceOption[]): Promise<void> {
  if (!spaces?.length) return;
  armBindGate(spaces);
  state.bindLocalCount = await countLocalBookmarks();
  state.bindGateVisible = true;
}

/**
 * 同步地把门禁的可选项装好（不发请求、不翻可见性）。
 *
 * 单独抽出来是因为**门禁不能在没装数据时就可见**：判据（`syncBindGate`）只决定
 * 「该不该挡」，不含可选项，让两者分开跑会渲染出一个没有空间可选、CTA 永远禁用的
 * 空门禁页——那比弹窗更糟，用户连关闭都做不到。
 */
function armBindGate(spaces: BindSpaceOption[]): void {
  state.bindSpaces = spaces;
  state.bindTarget = spaces.find((s) => s.is_default)?.id ?? spaces[0]?.id ?? '';
  // 本机没有书签时「并入 / 覆盖」没有区别，直接按并入走（门禁隐藏该选择）。
  state.bindMode = 'merge';
  state.bindNewName = '';
  state.bindCreating = false;
}

/**
 * 按当前状态重判门禁是否该挡着。
 *
 * 判据与 `firstBindAction` 的 `ask_user` 分支一致：**本机从未绑定 + 有真选择**
 * （云端 ≥2 个空间，或账号还能新建空间）。挂在 `refreshSpacesDevices()` /
 * `refreshProfile()` 末尾，登录 / 同步完成 / 空间增删都会重判，门禁因此能自己
 * 开合（绑成功后 `activeSpace` 有值 → 自动让开）。
 *
 * `boundStale`（绑定的空间被删）**不算**「从未绑定」：那条路径本机书签树是旧空间
 * 的投影，重选要走 `space_unbound` 的显式换绑（有清空/覆盖的明确提示），不该被
 * 悄悄引流进门禁、当成新设备处理。
 */
function syncBindGate(): void {
  const canCreate = isPaidPlan(state.profile?.plan);
  state.canCreateSpace = canCreate;
  // 新建入口没了就不能停在「正在新建」态：那个输入框会被 v-if 收走，CTA 却还
  // 认着 bindCreating 显示「新建并加入」，点下去必然撞 plan_locked。
  if (!canCreate) state.bindCreating = false;
  if (!bindGateNeeded(state.spaces.length, !!state.activeSpace, state.boundStale, canCreate)) {
    state.bindGateVisible = false;
    return;
  }
  // 首次挡出（或选项还没装载）时把可选项装上；已经装过就不重装，免得把用户
  // 正在做的选择（选了哪个空间 / 新建输入框里已经敲的名字）冲掉。
  if (!state.bindGateVisible || !state.bindSpaces.length) {
    armBindGate(state.spaces);
    countLocalBookmarks().then((n) => {
      state.bindLocalCount = n;
    });
  }
  state.bindGateVisible = true;
}

/**
 * 绑定本机到选中空间（或先新建一个空间再绑）。
 *
 * 由 SW 执行 `bsync-space-bind`：SW 绑定后会立刻同步一次——`merge` 让本机书签
 * 并入该空间，`overwrite` 先清空本机再从该空间重建。
 */
export async function doBindSpace(): Promise<void> {
  if (state.bindBusy) return;
  const creating = state.bindCreating && !!state.bindNewName.trim();
  if (!creating && !state.bindTarget) return;
  state.bindBusy = true;
  try {
    let spaceId = state.bindTarget;
    if (creating) {
      const r = await createSpace(state.bindNewName.trim());
      if (!r.ok) {
        if (r.reason === 'plan_locked') {
          state.showUpgradeModal = true;
          showToast('warning', t('spaces_limitTitle'), t('spaces_limitSub'));
        } else {
          showToast('danger', t('common_failPrefix', r.error ?? r.reason ?? ''), '');
        }
        return;
      }
      spaceId = r.space?.id ?? '';
      if (!spaceId) {
        await refreshSpacesDevices();
        return;
      }
    }
    const r = (await api.runtime.sendMessage({
      type: 'bsync-space-bind',
      spaceId,
      mode: state.bindMode,
    })) as { ok?: boolean; reason?: string; error?: string } | undefined;
    if (!r?.ok) {
      showToast(
        'danger',
        t('spaces_switchFailTitle'),
        t('common_failPrefix', r?.error ?? r?.reason ?? ''),
      );
      return;
    }
    await refreshSpacesDevices(); // 顺带让门禁自判（绑定已写下 → activeSpace 有值 → 让开）
    await refreshStatus();
    const name = state.spaces.find((s) => s.id === spaceId)?.name ?? '';
    showToast('info', t('bind_doneTitle', name), t('bind_doneSub'));
  } finally {
    state.bindBusy = false;
  }
}

// ---- 同步 ----
export async function refreshStatus(extra?: string): Promise<void> {
  const s = await api.storage.local.get([
    'lastSyncAt',
    'lastSyncStatus',
    'lastSyncStatusDetail',
    'lastSyncSummary',
    'lastDecryptErrors',
  ]);
  state.lastSyncAt = (s.lastSyncAt as number | undefined) ?? null;
  state.lastSyncStatus = (s.lastSyncStatus as string | undefined) ?? '';
  state.lastSyncStatusDetail = (s.lastSyncStatusDetail as string | undefined) ?? '';
  state.lastSyncSummary = (s.lastSyncSummary as string | undefined) ?? '';
  state.lastDecryptErrors = (s.lastDecryptErrors as DecryptErrors | undefined) ?? null;
  if (extra) showToast('info', extra);
}

// 把 runSync 返回的 {pushed, pulled, seeded, restored, decryptFailed} 压成可持久化的摘要。
// 注意：pushed/pulled 是 CRDT 操作行数（一个书签的建/移/改会产 2~3 条 op，
// 冷启动重放还会把历史 op 全计一遍），和「书签数」不是一回事，直接展示会让用户
// 误以为传了 N 个书签。持久层只存方向码，展示层（summaryText）再本地化。
function summarize(r: Extract<SyncRunResult, { ok: true }>): SyncSummary {
  return {
    seeded: !!r.seeded,
    restored: !!r.restored,
    push: (r.pushed || 0) > 0,
    pull: (r.pulled || 0) > 0,
    dec: r.decryptFailed || 0,
    unplaced: r.unplaced || 0,
  };
}

function summaryText(sum: SyncSummary | null): string {
  if (!sum) return '';
  let body;
  if (sum.seeded) body = t('status_seeded');
  else if (sum.restored) body = t('status_restored');
  else if (sum.push && sum.pull) body = t('status_bidirectional');
  else if (sum.push) body = t('status_pushed');
  else if (sum.pull) body = t('status_pulled');
  else body = t('status_uptodate');
  if (sum.dec > 0) body += ` · ${t('status_decryptWarn', sum.dec)}`;
  // ★ 不展示 unplaced（「N 条本地书签本机看不到」）。它是**环境造成的人为限制**
  // （Chrome 已登录 + 本地子树为空 → 不创建本地根），不是插件故障，也不是用户
  // 能靠「重试 / 重新登录」解决的问题。挂在状态行上会让用户以为插件坏了
  // （2026-10-09 反馈）。需要排查时看 background 控制台的 `[bsync] N 个落地根…`。
  // 字段仍写进持久化摘要，供诊断/日志回放，不进 UI。
  return body;
}

function parseSummary(raw: string | null): SyncSummary | null {
  try {
    return raw ? (JSON.parse(raw) as SyncSummary) : null;
  } catch {
    return null;
  }
}

// 原因码 → 用户可读文案（未知原因原样展示）
export function reasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'not_authenticated':
      return t('err_notAuthenticated');
    case 'no_space':
      return t('err_noSpace');
    case 'space_unbound':
      return t('err_spaceUnbound');
    case 'bind_needed':
      return t('err_bindNeeded');
    case 'no_key':
      return t('err_noKey');
    case 'timeout':
    case 'no_response':
      return t('err_timeout');
    case 'rate_limited':
      return t('err_rateLimited');
    case 'quota_exceeded':
      return t('err_quota');
    case 'device_limit_reached':
      return t('err_deviceLimit');
    case 'decrypt_error':
      return t('err_decrypt');
    case 'replica_incomplete':
      return t('err_replicaIncomplete');
    default:
      return reason ?? '';
  }
}

// 原因 + 错误详情合并展示；error 与原因文案相同（引擎会对已知原因附带同一句
// 本地化文案）时不重复括号，避免「请先设置同步口令 (请先设置同步口令)」。
export function reasonDisplay(
  reason: string | null | undefined,
  error: string | undefined,
): string {
  const base = reasonText(reason);
  return error && error !== base ? `${base} (${error})` : base;
}

export async function syncNow(opts: boolean | { force?: boolean } = {}): Promise<void> {
  // 注意：模板 @click 直传时 opts 可能是事件对象，统一归一化为 force 布尔
  const force = opts === true || (typeof opts === 'object' && opts !== null && !!opts.force);
  state.syncBusy = true;
  try {
    // 同步在 SW 内执行（SW 是同步权威，事件桥与 coordinator 同 realm）。
    // 60s 兜底超时，避免 SW 未启动时无限「同步中…」。
    const msgResult = new Promise<SyncRunResult>((resolve) => {
      try {
        api.runtime.sendMessage({ type: 'bsync-sync', force }, (resp) => {
          resolve((resp ?? { ok: false, reason: 'no_response' }) as SyncRunResult);
        });
      } catch (e) {
        void reportError('store', 'error', e, { op: 'sync-message' });
        resolve({ ok: false, reason: 'error', error: describeError(e) });
      }
    });
    const timeout = new Promise<SyncRunResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, reason: 'timeout', error: t('err_timeout') }), 60000),
    );
    const r = await Promise.race([msgResult, timeout]);
    if (!r.ok && r.reason === 'bind_needed') {
      // 口令门禁优先：还没设置/验证口令时不打开首绑门禁——runSync 里绑定判定排在
      // 口令检查之前，不拦的话门禁页会盖在口令页上（用户连云端数据都读不到，
      // 就先被问「加入哪个空间」）。设完口令后那次同步自然会走到这里。
      if (state.phraseGateVisible) return;
      // 兜底路径：常态下门禁由 refreshSpacesDevices() 里的 syncBindGate() 判定，
      // 这里覆盖「同步过程中云端空间数从 1 变成 ≥2」之类没走取数的窗口。
      await openBindGate(r.spaces ?? []);
      return;
    }
    if (!r.ok && r.reason === 'no_key') {
      // 本机还没有同步口令：打开口令门禁页（唯一入口，不设置无法使用插件）。
      // 门禁页本身就是提示，不再叠加 toast。
      await initPhraseGate();
      return;
    }
    if (!r.ok && r.reason === 'quota_exceeded') {
      // 字节配额撞顶（0032 服务端执行）。已付费/试用 Pro：给出清理指引而非升级弹窗；
      // Free/Plus：升级引导。
      if (planLabel.value === 'Pro') {
        showToast('warning', t('toast_proByteLimitTitle'), t('toast_proByteLimitSub'));
      } else {
        state.showUpgradeModal = true;
        showToast('warning', t('toast_quotaTitle'), t('toast_quotaSub'));
      }
      return;
    }
    if (!r.ok && r.reason === 'device_limit_reached') {
      // 设备数超计划上限（0033）：升级引导 + 提示可移除旧设备腾位
      state.showUpgradeModal = true;
      showToast('warning', t('toast_deviceLimitTitle'), t('toast_deviceLimitSub'));
      return;
    }
    if (!r.ok && r.reason === 'rate_limited') {
      // 限流（0032）：正常客户端几乎不会触发，静默提示即可，下轮自动重试
      showToast('info', t('toast_rateTitle'), t('toast_rateSub'));
      return;
    }
    if (!r.ok && r.reason === 'decrypt_error') {
      // 端到端加密：密钥不匹配 / 数据损坏，引导用户导入密钥
      showToast('danger', t('toast_decryptTitle'), r.error ?? t('toast_checkKey'));
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok ? 'ok' : 'error',
      lastSyncStatusDetail: r.ok ? '' : `${r.reason ?? ''}${r.error ? ` (${r.error})` : ''}`,
      lastSyncSummary: r.ok ? JSON.stringify(summarize(r)) : '',
    });
    await refreshStatus();
    if (r.ok) {
      // 条数超额时同步本身是成功的（拉取/删除都正常），但新书签推不上去。
      // 只弹一条 warning 覆盖掉「同步完成」，否则用户会以为新加的书签已经上传。
      if (r.itemLimitBlocked) {
        showToast('warning', t('toast_itemLimitTitle'), t('toast_itemLimitSub'));
      } else {
        showToast('success', t('toast_syncDone'), summaryText(parseSummary(state.lastSyncSummary)));
      }
    } else {
      showToast('danger', reasonDisplay(r.reason, r.error), '');
    }
    // 同步后刷新配额与空间/设备状态（push 会登记本设备）。
    // 兜底超时：popup 的 supabase 查询偶尔挂起（网络/会话竞争），
    // 不能让「同步中…」永久卡住——同步本身已完成（storage 已更新）。
    // hydrateRemote 不抛异常，所以取数失败只会落在额度卡的占位文案上，
    // 不会被下面的 catch 误报成「同步失败」。
    if (r.ok) {
      await Promise.race([hydrateRemote(), new Promise((resolve) => setTimeout(resolve, 15000))]);
    }
  } catch (e) {
    showToast(
      'danger',
      t('common_failPrefix', (e as { message?: string })?.message ?? String(e)),
      '',
    );
  } finally {
    state.syncBusy = false;
  }
}

// ---- 登录 / 注册 / 登出 ----
export async function submit(): Promise<void> {
  state.busy = true;
  state.authError = '';
  state.authSuccess = '';
  try {
    const em = state.email.trim();
    const pw = state.password;
    if (!em || !pw) {
      state.authError = t('auth_errRequired');
      return;
    }
    let res: { error: AuthError | null; data: { session: Session | null } };
    if (state.mode === 'register') {
      res = await supabase.auth.signUp({ email: em, password: pw });
      if (res.error) {
        state.authError = t('auth_errRegister', res.error.message);
        return;
      }
      if (!res.data.session) {
        state.session = null;
        state.authSuccess = t('auth_successRegister');
        return;
      }
    } else {
      res = await supabase.auth.signInWithPassword({ email: em, password: pw });
      if (res.error) {
        state.authError = t('auth_errLogin', res.error.message);
        return;
      }
    }
    state.session = res.data.session;
    // 刚登录：主界面等口令门禁判定完成后再渲染（防止先闪现主界面）
    state.gateChecked = false;
    // 记住邮箱，方便下次登录（密码不落盘）
    await api.storage.local.set({ rememberEmail: em });
    // 与冷启动同一条路径：本地状态 + 门禁判定放行首屏，云端取数在后台补水。
    // 别在这里 await refreshProfile()——它走网络，慢的时候登录按钮会一直转。
    await bootSession();
    // 登录成功后自动触发一次同步：消除登录前的失败状态残留（如 onStartup
    // 未登录时记录的 not_authenticated），同时让 SW 中的 supabase 客户端
    // 通过 ensureSession 兜底恢复 session。
    syncNow();
  } finally {
    state.busy = false;
  }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
  // **不要**清 `boundSpaceId`：绑定是「账号 × 设备」的事实，同账号重登必须还是
  // 原来的绑定（清掉的话每次重登都会被当成新设备、重新问一遍「加入哪个空间」）。
  // 换账号由记录里的归属账号兜住——`parseBinding` 判到不符即按从未绑定处理。
  state.session = null;
  state.profile = null;
  state.serverCount = null;
  state.remoteFailed = false;
  state.spaces = [];
  state.devices = [];
  state.activeSpace = null;
  state.boundStale = false;
  state.rebindTarget = '';
  state.bindGateVisible = false;
  state.canCreateSpace = false;
  state.bindSpaces = [];
  state.drawer = '';
  state.armed = '';
  state.status = t('toast_loggedOut');
  // 首屏缓存跟着会话走：不清的话，换账号登录会把上个账号的空间名/设备名先画出来。
  await clearUiCache();
  showToast('info', t('toast_loggedOut'), '');
}

// ---- 弹窗抽屉 / 设置页导航 ----
// 抽屉二级导航：从「账户」进入「空间与设备 / 同步密钥」时记住来路，返回键回到
// 账户而不是直接回主屏（否则嵌套进去就回不来了）。
let drawerBack = '';
export function openDrawer(name: string): void {
  if (name !== state.drawer) drawerBack = state.drawer || '';
  state.drawer = name;
  if (name === 'spaces') refreshSpacesDevices();
  if (name === 'key') loadKeyPanel();
}
export function closeDrawer(): void {
  if (drawerBack) {
    const back = drawerBack;
    drawerBack = '';
    state.drawer = back;
    return;
  }
  state.drawer = '';
}

export function openHelp(): void {
  // 帮助已整合进插件弹窗抽屉；登录页（未登录态）打开官网文档
  const url = 'https://www.bookmark-sync.top/docs';
  if (api.tabs?.create) {
    api.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

// ---- 初始化（App onMounted 调用） ----

/**
 * 首屏阶段：**只读 chrome.storage + 本机密钥**。唯一的例外是「本机还没有同步
 * 口令」时判 setup / verify 要问一次云端盐（见 initPhraseGate）——那是一条一次性
 * 路径，设过口令之后每次打开都是纯本地。
 *
 * 决定「首屏该渲染哪一关」的信息全在本地：登录态、本机有没有同步口令、上次同步
 * 结果、各个开关。把它们与云端取数（档案 / 空间 / 设备）拆开，popup 才能立刻出
 * 界面——旧实现把两者塞进同一个 Promise.all 再 await，于是「打开要转好几秒」：
 * 本机走代理时一次往返 ~0.9s，而 refreshSpacesDevices 是三次串行。
 *
 * 顺序保证不变：有口令 → 不放行门禁；没口令 → 门禁页立刻顶上，都不会先闪主界面。
 */
async function bootstrapLocal(userId: string): Promise<void> {
  try {
    applyUiCache(await readUiCache(userId));
    await Promise.all([refreshStatus(), refreshKeyState()]);
  } catch (e) {
    // 这一段只读 storage，理论上不会失败；真失败了也必须放行首屏——否则
    // gateChecked 永远为 false，popup 会永远停在启动占位上（旧版的病根）。
    console.warn('[store] bootstrapLocal failed:', (e as { message?: unknown })?.message ?? e);
  }
  // 口令门禁单独兜底，且**失败要 fail closed**：它是硬门槛，一次 storage /
  // 网络抖动就把没设口令的机器放进主界面是不能接受的。mode 取 verify 是最保守的
  // 一侧——云端有数据时错口令解不开会被拦下，云端没数据时才算新设备设口令。
  try {
    await initPhraseGate();
  } catch (e) {
    console.warn('[store] initPhraseGate failed:', (e as { message?: unknown })?.message ?? e);
    state.phraseGateMode = 'verify';
    state.phraseGateInput = '';
    state.phraseGateMsg = '';
    state.phraseGateBusy = false;
    state.phraseGateVisible = true;
  }
}

/**
 * 首屏（本地）→ 云端补水（后台）。冷启动与登录共用这一条路径。
 *
 * 「能不能直接放行主界面」取决于首绑门禁会不会挡出来，而门禁只可能在**本机从未
 * 绑定**时出现（见 sync/binding.ts 的 bindGateNeeded）——这个事实在本地：
 *   - 已绑定（含绑定空间已被删的 boundStale）→ 门禁不可能出现，直接放行主界面，
 *     云端取数在后台补（这就是日常「打开即出界面」的那条路径）；
 *   - 从未绑定 → 门禁判据要云端空间列表，只能等这一次取数，否则会先渲染主界面
 *     再被整页门禁盖上，破坏「登录 → 门禁 → 主界面」的顺序。
 */
async function bootSession(): Promise<void> {
  await bootstrapLocal(state.session?.user?.id ?? '');
  if (await hasLocalBinding()) {
    state.gateChecked = true;
    void hydrateRemote();
    return;
  }
  await hydrateRemote();
  state.gateChecked = true;
}

/**
 * 冷启动 / 登录后的入口：本地放行首屏，云端在后台补水。
 */
export async function init(popup: boolean): Promise<void> {
  if (popup) document.body.classList.add('popup');
  // 记住上次登录的邮箱（只存邮箱，不存密码），退出登录后自动填充
  const { rememberEmail } = await api.storage.local.get('rememberEmail');
  if (rememberEmail) state.email = rememberEmail as string;
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) await bootSession();
  supabase.auth.onAuthStateChange(async (_e, s) => {
    const prev = state.session;
    state.session = s;
    if (s) {
      // 刚登录（prev 为空）：主界面等门禁判定完成后再渲染；
      // TOKEN_REFRESHED 等事件（prev 非空）不重置，避免已渲染界面闪烁。
      if (!prev) state.gateChecked = false;
      await bootSession();
    } else {
      state.profile = null;
      state.serverCount = null;
      state.remoteFailed = false;
      state.spaces = [];
      state.devices = [];
      state.activeSpace = null;
      state.boundStale = false;
      state.bindGateVisible = false;
      state.canCreateSpace = false;
      state.rebindTarget = '';
      state.drawer = '';
      // 会话没了（登出 / 令牌失效）：首屏缓存一并清掉，别把上个账号的
      // 空间名、设备名留在盘上。
      void clearUiCache();
    }
  });

  // SW 自动同步（事件桥 flushSoon / 定时拉取）跑完后会发 bsync-sync-done，
  // 开着的 popup/options 收到后刷新书签数、最后同步状态——否则自动同步在后台
  // 跑完了，UI 里还停留在打开时的旧值。
  api.runtime.onMessage.addListener((msg: ExtensionMessage) => {
    if (msg?.type === 'bsync-sync-done') {
      refreshStatus();
      refreshProfile();
      refreshSpacesDevices();
    }
  });
}

// ---- 计算属性（模板直接引用） ----
export const userEmail = computed(() => state.session?.user?.email ?? '');
export const displayName = computed(() => {
  const em = userEmail.value;
  if (!em) return '';
  return em.split('@')[0] || em;
});

export const planLabel = computed(() => {
  const p = state.profile?.plan;
  if (p === 'pro' || p === 'lifetime') return 'Pro';
  if (p === 'plus' || p === 'premium') return 'Plus';
  return 'Free';
});

// 额度按「条」展示（与定价一致：Free 1,000 / Plus 10,000 / Pro·Lifetime 不限）。
// 已用条数优先取服务端 used_count（0016 迁移），未部署时回退本地基线统计。
export const usedCount = computed(() => {
  if (state.profile && typeof state.profile.used_count === 'number') {
    return state.profile.used_count;
  }
  return state.serverCount;
});

export const quotaCount = computed(() => {
  const p = state.profile?.plan;
  if (p === 'pro' || p === 'lifetime') return null; // 不限数量（字节口径兜底）
  return p === 'plus' || p === 'premium' ? 10000 : FREE_ITEM_LIMIT;
});

// Pro/Lifetime 按字节口径预警：E2EE 下服务端以字节执行（0032），
// 对外仍是「数量不限」，撞顶前按 used_bytes/quota_bytes 提醒。
// used_bytes 由服务端在推送/GC 后回写（0032），老账号下次推送前可能还是 0。
export const byteUsagePct = computed(() => {
  const p = state.profile;
  if (!p) return 0;
  if (!(p.plan === 'pro' || p.plan === 'lifetime')) return 0;
  if (!p.quota_bytes || p.used_bytes == null) return 0;
  return Math.min(100, Math.round((p.used_bytes / p.quota_bytes) * 100));
});

export const proByteLabel = computed(() => {
  const p = state.profile;
  if (!p?.quota_bytes || p.used_bytes == null) return '';
  if (!(p.plan === 'pro' || p.plan === 'lifetime')) return '';
  const mb = (b: number): string => (b / 1024 / 1024).toFixed(1).replace(/\.0$/, '');
  return t('quota_proBytes', mb(p.used_bytes), mb(p.quota_bytes));
});

export const usagePct = computed(() => {
  if (byteUsagePct.value > 0) return byteUsagePct.value;
  if (!quotaCount.value || usedCount.value == null) return 0;
  return Math.min(100, Math.round((usedCount.value / quotaCount.value) * 100));
});

export const quotaState = computed(() => {
  // Pro 字节口径：≥80% 提醒、≥100% 阻断（约 25 万条封顶）
  if (byteUsagePct.value >= 100) return 'over';
  if (byteUsagePct.value >= 80) return 'warn';
  if (usedCount.value == null || !quotaCount.value) return 'ok';
  const pct = (usedCount.value / quotaCount.value) * 100;
  if (pct >= 100) return 'over';
  if (pct >= 90) return 'warn';
  return 'ok';
});

export const quotaBadge = computed(() => {
  if (quotaState.value === 'over') return { text: t('quota_over'), cls: 'badge-danger' };
  if (quotaState.value === 'warn') return { text: t('quota_warn'), cls: 'badge-warning' };
  return { text: planLabel.value.toUpperCase(), cls: 'badge-neutral' };
});

/**
 * 额度卡在拿不到服务端档案时的占位文案。
 *
 * 首屏不再等云端（见 bootstrapLocal），所以这个位置既可能是「还在取」也可能是
 * 「取不到」——后者必须说出来，否则会永远停在「加载中」骗人。
 */
export const quotaPlaceholder = computed(() =>
  state.remoteFailed ? t('quota_loadFailed') : t('quota_loading'),
);

export const quotaFoot = computed(() => {
  const spaceName = state.activeSpace?.name ?? '';
  let remain: string;
  if (quotaState.value === 'over') {
    if (byteUsagePct.value >= 100) return t('quota_footOverBytes');
    return t('quota_footOver', ((usedCount.value ?? 0) - (quotaCount.value ?? 0)).toLocaleString());
  }
  if (quotaState.value === 'warn') {
    if (byteUsagePct.value >= 80 && proByteLabel.value)
      return t('quota_footWarnBytes', proByteLabel.value);
    return t('quota_footWarn', ((quotaCount.value ?? 0) - (usedCount.value ?? 0)).toLocaleString());
  }
  remain = quotaCount.value
    ? t('quota_remain', (quotaCount.value - (usedCount.value ?? 0)).toLocaleString())
    : proByteLabel.value
      ? t('quota_unlimitedBytes', proByteLabel.value)
      : t('quota_unlimitedFoot');
  return spaceName ? t('quota_footSpace', spaceName, remain) : remain;
});

export const quotaBtn = computed(() => {
  const p = state.profile?.plan;
  if (!p || p === 'free') return 'upgrade';
  return 'manage';
});

// 同步状态卡：syncing / ok / error / never
export const syncState = computed(() => {
  if (state.syncBusy) return 'syncing';
  if (!state.lastSyncAt) return 'never';
  const st = state.lastSyncStatus ?? '';
  // 新格式 "error"；兼容旧版本持久化的中文前缀文案
  if (st === 'error' || st.startsWith('未同步') || st.startsWith('失败')) return 'error';
  return 'ok';
});

export const syncTitle = computed(() => {
  switch (syncState.value) {
    case 'syncing':
      return t('status_syncing');
    case 'never':
      return t('status_never');
    case 'error':
      return t('status_error');
    default:
      return t('status_ok');
  }
});

export const syncSub = computed(() => {
  const st = state.lastSyncStatus ?? '';
  if (syncState.value === 'syncing') return t('status_syncingSub');
  if (syncState.value === 'never') return t('status_neverSub');
  if (syncState.value === 'error') {
    // 新格式：lastSyncStatusDetail = "原因码 (错误信息)"；旧格式：中文「未同步:/失败:」前缀
    const raw = (state.lastSyncStatusDetail || st.replace(/^error:/, '')).replace(
      /^(未同步|失败):\s*/,
      '',
    );
    const m = raw.match(/^([a-z_]+)\s*(?:\((.*)\))?\s*$/);
    if (m && m[1]) {
      const shown = reasonDisplay(m[1], m[2]);
      if (shown) return shown;
    }
    return raw || t('err_network');
  }
  const decrypt = state.lastDecryptErrors?.errors?.length;
  if (decrypt) return t('status_decryptLine', decrypt);
  const sum = parseSummary(state.lastSyncSummary);
  // 「本机无处落地」既不单列一行、也不挂状态行尾巴（2026-10-09：属环境限制而非
  // 故障，展示出来会被当成「插件坏了」）。只在 background 控制台留warn。
  if (sum) return summaryText(sum);
  // 兼容旧版本持久化的中文摘要文案
  if (st && st !== 'ok') return st;
  return t('status_okSub', usedCount.value ?? 0);
});

// 注：原有 syncHint（「本机看不到的本地书签」tooltip）已随UI 展示一起下线
// （2026-10-09）——那是 Chrome 环境造成的人为限制（已登录 + 本地子树为空 →
// Chrome 不创建本地根），不是插件故障，展示出来会被当成「插件坏了」。
// 排查只看 background 控制台的 `[bsync] N 个落地根在本机无处落地…`。

export const syncTail = computed(() => {
  if (syncState.value === 'never') return t('status_unregistered');
  return fmtRelative(state.lastSyncAt);
});

export function fmtRelative(ts: number | null): string {
  if (!ts) return t('time_never');
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('time_now');
  if (m < 60) return t('time_min', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('time_hour', h);
  const d = Math.floor(h / 24);
  if (d < 30) return t('time_day', d);
  return fmt(ts);
}

export function fmt(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : t('time_never');
}

// 空间数量档位：Free 1 · Plus 3 · Pro/Lifetime 10
export const spaceLimit = computed(() => {
  const p = state.profile?.plan;
  if (p === 'pro' || p === 'lifetime') return 10;
  if (p === 'plus' || p === 'premium') return 3;
  return 1;
});
