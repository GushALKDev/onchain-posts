import { API_URL } from './config.ts';
import type { SubmitBody } from './compose.ts';
import type { Hex, PostDetail, PostSummary, ProofBundle, SignedReceipt } from './types.ts';

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `request failed with status ${res.status}`);
  return { status: res.status, body: body as T };
}

export const submitPost = async (body: SubmitBody) => (await call<{ postHash: Hex; receipt: SignedReceipt }>('/posts', { method: 'POST', body: JSON.stringify(body) })).body;

export const getPosts = async (limit = 24) => (await call<PostSummary[]>(`/posts?limit=${limit}`)).body;

export const getPost = async (postHash: string) => (await call<PostDetail>(`/posts/${postHash}`)).body;

/** Untrusted hints; null while the post is not stored yet. */
export async function getProof(postHash: string): Promise<ProofBundle | null> {
  const { status, body } = await call<ProofBundle>(`/proof/${postHash}`);
  return status === 202 ? null : body;
}

export const demoFlush = async (token: string) => (await call<{ flushing: number[] }>('/demo/flush', { method: 'POST', headers: { 'x-demo-flush-token': token } })).body;
