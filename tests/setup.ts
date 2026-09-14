// Vitest setup: expose fake-indexeddb globals so the storage layer can use
// `indexedDB` / `IDBKeyRange` as if it were running in a real browser.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBFactory = IDBFactory;
globalThis.IDBKeyRange = IDBKeyRange;
