import type { LocalPost } from './store.ts';
import type { ProofBundle } from './types.ts';

/** Private copy: the public hints plus the signature and intent fields that only this browser holds (ADR-014). */
export function privateBundle(publicBundle: ProofBundle, local: LocalPost): ProofBundle {
  return { ...publicBundle, signature: local.signature, intent: local.intent };
}

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
