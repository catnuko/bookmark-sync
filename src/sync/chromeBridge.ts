/**
 * Chrome bookmarks <-> Move-CRDT bridge (Phase C-2).
 *
 * This is the ONLY module that touches chrome.bookmarks. It adapts:
 *   local chrome events            -> coordinator.create/move/delete
 *   remote CRDT state (after pull)  -> reverse-applied to chrome.bookmarks
 *
 * Root topology (identical on every device, fixed UUIDs):
 *   __root__
 *     └─ ROOT_UUID                    (chrome root id "0")
 *          ├─ BOOKMARKS_BAR_UUID      (chrome "1", folderType 'bookmarks-bar')
 *          ├─ OTHER_BOOKMARKS_UUID    (chrome "2", folderType 'other')
 *          └─ MOBILE_UUID             (chrome "3", folderType 'mobile')
 *
 * We never create/delete the special roots; only ordinary nodes are mapped.
 *
 * TODO(real-chrome): verify numeric ids "1"/"2"/"3" map to bar/other/mobile on
 * a real profile; fall back to node.folderType (Chrome 134+) if they differ.
 */

import type { Metadata } from '../crdt/index.js';
import {
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  CHROME_ROOT_ID,
} from '../crdt/index.js';
import type { SyncCoordinator } from './syncEngine.js';

/** Minimal chrome.bookmarks surface we depend on (ease of testing). */
export interface ChromeBookmarksAPI {
  getTree(): Promise<ChromeTreeNode[]>;
  create(parentId: string, createProps: { title?: string; url?: string }): Promise<ChromeTreeNode>;
  move(id: string, moveProps: { parentId: string; index?: number }): Promise<ChromeTreeNode>;
  update(id: string, changes: { title?: string; url?: string }): Promise<ChromeTreeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
  getChildren(parentId: string): Promise<ChromeTreeNode[]>;
  onCreated: BrowserEvent<[string, ChromeTreeNode]>;
  onChanged: BrowserEvent<[string, { title: string; url?: string }]>;
  onMoved: BrowserEvent<[string, { parentId: string; oldParentId: string; index: number; oldIndex: number }]>;
  onRemoved: BrowserEvent<[string, { removedNode: ChromeTreeNode }]>;
}

interface BrowserEvent<T extends unknown[]> {
  addListener(cb: (...args: T) => void): void;
}

export interface ChromeTreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: ChromeTreeNode[];
  folderType?: string;
}

/** chromeId -> fixed root UUID, or null for ordinary nodes. */
function fixedRootUuid(chromeId: string): string | null {
  switch (chromeId) {
    case CHROME_ROOT_ID: return ROOT_UUID;
    case '1': return BOOKMARKS_BAR_UUID;
    case '2': return OTHER_BOOKMARKS_UUID;
    case '3': return MOBILE_UUID;
    default: return null;
  }
}

/**
 * In-memory chromeId <-> uuid map. Persistence (UuidMappingStore) owns the
 * durable layer; this cache is warmed at start and written-through.
 */
export class IdBridge {
  private forward = new Map<string, string>(); // chromeId -> uuid
  private backward = new Map<string, string>(); // uuid -> chromeId

  constructor(private readonly onChange?: () => void) {
    // Seed fixed roots.
    for (const [cid, uuid] of [
      [CHROME_ROOT_ID, ROOT_UUID],
      ['1', BOOKMARKS_BAR_UUID],
      ['2', OTHER_BOOKMARKS_UUID],
      ['3', MOBILE_UUID],
    ] as Array<[string, string]>) {
      this.forward.set(cid, uuid);
      this.backward.set(uuid, cid);
    }
  }

  toUuid(chromeId: string): string | null {
    return this.forward.get(chromeId) ?? null;
  }

  toChromeId(uuid: string): string | null {
    return this.backward.get(uuid) ?? null;
  }

  map(chromeId: string, uuid: string): void {
    this.forward.set(chromeId, uuid);
    this.backward.set(uuid, chromeId);
    this.onChange?.();
  }

  /** Durable snapshot: chromeId -> uuid (fixed roots included). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.forward);
  }

  /** Rehydrate a previously persisted snapshot (fixed roots re-seeded anyway). */
  load(map: Record<string, string>): void {
    for (const [cid, uuid] of Object.entries(map)) {
      this.forward.set(cid, uuid);
      this.backward.set(uuid, cid);
    }
  }
}

/**
 * Wire chrome events into the coordinator. Returns a disposer that detaches
 * the listeners. A `suppressed` flag (toggled around reverse-apply) makes
 * handlers no-op so our own chrome API calls don't echo back as local ops.
 *
 * `coordinator` may be a lazy getter: in the MV3 service worker it is
 * registered at top level (before login/space selection), so handlers resolve
 * the coordinator lazily and no-op when it is not yet available.
 */
export function captureLocalEvents(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator | (() => SyncCoordinator | null),
  bridge: IdBridge,
  onLocalOp?: () => void,
): { suppressed: { value: boolean } } {
  const suppressed = { value: false };
  const getC = (): SyncCoordinator | null =>
    typeof coordinator === 'function' ? coordinator() : coordinator;

  const onCreated = async (id: string, node: ChromeTreeNode) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    if (fixedRootUuid(id)) return; // never track chrome's own roots
    const parentUuid = node.parentId ? bridge.toUuid(node.parentId) : null;
    if (!parentUuid) return; // parent not yet mapped; skip (will arrive later)
    const uuid = globalThis.crypto.randomUUID();
    bridge.map(id, uuid);
    const meta: Metadata = { title: node.title, ...(node.url ? { url: node.url } : {}) };
    c.createNodeWithId(uuid, parentUuid, meta);
    onLocalOp?.();
  };

  const onChanged = async (id: string, change: { title: string; url?: string }) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    const parent = uuid ? c.replica.getParent(uuid) : null;
    if (!uuid || !parent) return;
    const current = c.replica.getNodeMeta(uuid) ?? {};
    c.moveNode(uuid, parent, { ...current, title: change.title, url: change.url });
    onLocalOp?.();
  };

  const onMoved = async (
    id: string,
    move: { parentId: string; oldParentId: string; index: number; oldIndex: number },
  ) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    const newParent = move.parentId ? bridge.toUuid(move.parentId) : null;
    if (!uuid || !newParent) return;
    const current = c.replica.getNodeMeta(uuid) ?? {};
    c.moveNode(uuid, newParent, { ...current });
    onLocalOp?.();
  };

  const onRemoved = async (id: string) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    if (!uuid) return;
    c.deleteNode(uuid);
    onLocalOp?.();
  };

  chrome.onCreated.addListener(onCreated);
  chrome.onChanged.addListener(onChanged);
  chrome.onMoved.addListener(onMoved);
  chrome.onRemoved.addListener(onRemoved);

  return { suppressed };
}

/**
 * Best-effort reverse-apply: after a pull, reconcile the visible CRDT tree
 * onto chrome. This is a convergence helper, not a full diff engine.
 *
 * TODO(real-chrome): implement a proper reachability-based diff (see reference
 * extension/reverseApply.ts). For the initial rollout we rely on per-op
 * reverse application inside pull; this function only refreshes roots.
 */
export async function reverseApply(
  _chrome: ChromeBookmarksAPI,
  _coordinator: SyncCoordinator,
  _bridge: IdBridge,
): Promise<void> {
  // Placeholder: the per-op reverse application is intentionally minimal in
  // this phase. Real-world reconciliation needs the reference's reachability
  // BFS and is marked TODO pending on-device verification.
}
