import type { Hex, SignedReceipt } from './types.ts';

/** What the browser keeps per post so the author can build the private proof bundle later (ADR-014). */
export type LocalPost = {
  postHash: Hex;
  /** Lower-case signer address; the store only returns posts of the current signer. */
  owner: string;
  username: string;
  caption: string;
  createdAt: number;
  signature: Hex;
  intent: { chainIds: number[]; nonce: Hex; deadline: number };
  receipt: SignedReceipt;
};

const DB = 'phi-web';
const STORE = 'posts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'postHash' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const savePost = (post: LocalPost) => run('readwrite', (s) => s.put(post));

export async function listPosts(owner: string): Promise<LocalPost[]> {
  const all = (await run<LocalPost[]>('readonly', (s) => s.getAll())) ?? [];
  return all.filter((p) => p.owner === owner.toLowerCase()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPost(postHash: string, owner: string): Promise<LocalPost | null> {
  const post = await run<LocalPost | undefined>('readonly', (s) => s.get(postHash.toLowerCase()));
  return post && post.owner === owner.toLowerCase() ? post : null;
}
