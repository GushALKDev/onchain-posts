import { ArweaveSigner, TurboFactory } from '@ardrive/turbo-sdk';
import { bytes32ToArweaveId } from '@phi/core';
import { keccak256 } from 'viem';
import type { ArweaveJwk } from './keys.ts';

export type Tag = { name: string; value: string };

/** Permanent storage of data items signed with the platform key (ADR-002). */
export interface Storage {
  upload(data: Uint8Array, tags: Tag[]): Promise<string>;
}

export const APP_NAME = 'Phi-Posts';

/** Turbo bundler: items are signed with the platform Arweave key, so the ANS-104 owner is never the user (ADR-002). */
export function turboStorage(jwk: ArweaveJwk): Storage {
  const turbo = TurboFactory.authenticated({ signer: new ArweaveSigner(jwk as never) });
  return {
    async upload(data, tags) {
      const result = await turbo.upload({ data: Buffer.from(data), dataItemOpts: { tags } });
      return result.id;
    },
  };
}

/** In-memory storage for tests and local runs; also readable as a gateway by the verifier. */
export class MemoryStorage implements Storage {
  readonly items = new Map<string, { data: Uint8Array; tags: Tag[] }>();

  async upload(data: Uint8Array, tags: Tag[]): Promise<string> {
    const id = bytes32ToArweaveId(keccak256(new Uint8Array([...data, ...new TextEncoder().encode(JSON.stringify(tags))])));
    this.items.set(id, { data, tags });
    return id;
  }

  async get(id: string): Promise<Uint8Array> {
    const item = this.items.get(id);
    if (!item) throw new Error(`not found: ${id}`);
    return item.data;
  }
}
