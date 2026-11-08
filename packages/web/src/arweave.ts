import { ARWEAVE_GRAPHQL, GATEWAYS, TURBO_STATUS } from './config.ts';

export const gatewayUrl = (id: string, gateway = GATEWAYS[0]) => `${gateway}/${id}`;

/** First gateway that serves the item; content must still be checked by hash by the caller. */
export async function fetchItem(id: string): Promise<{ bytes: Uint8Array; gateway: string }> {
  const failures: string[] = [];
  for (const gateway of GATEWAYS) {
    try {
      const res = await fetch(gatewayUrl(id, gateway));
      if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), gateway };
      failures.push(`${new URL(gateway).host} ${res.status}`);
    } catch (error) {
      failures.push(`${new URL(gateway).host} ${(error as Error).message}`);
    }
  }
  throw new Error(`not served yet (${failures.join(', ')})`);
}

export type TurboStatus = { status: string; info?: string; bundleId?: string; winc?: string; rawContentLength?: number; payloadContentLength?: number };

/** Turbo's view of an upload: accepted (new), packed in a bundle (pending), or finalized on Arweave. */
export async function turboStatus(id: string): Promise<TurboStatus | null> {
  const res = await fetch(`${TURBO_STATUS}/${id}/status`).catch(() => null);
  return res?.ok ? ((await res.json()) as TurboStatus) : null;
}

export type ItemIndex = { owner: string; tags: { name: string; value: string }[]; size: number | null };

/** Owner and tags from an ar.io gateway's GraphQL index; null until the item is indexed. */
export async function indexedItem(id: string): Promise<ItemIndex | null> {
  const query = `{ transaction(id: "${id}") { owner { address } tags { name value } data { size } } }`;
  const res = await fetch(ARWEAVE_GRAPHQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) }).catch(() => null);
  if (!res?.ok) return null;
  const tx = (await res.json())?.data?.transaction;
  return tx ? { owner: tx.owner.address, tags: tx.tags, size: tx.data?.size ? Number(tx.data.size) : null } : null;
}
