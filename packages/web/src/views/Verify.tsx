import { ProofBundleSchema, TrustedKeysFileSchema, type TrustedKey } from '@phi/core';
import { createPublicSources, formatReport, verifyPublishedPost, type VerificationReport } from '@phi/verifier';
import { useState } from 'react';
import trustedKeysFile from '../../../../config/trusted-keys.json';
import { getProof } from '../api.ts';
import { CHAINS, GATEWAY_URL } from '../config.ts';

const bundledKeys = TrustedKeysFileSchema.parse(trustedKeysFile).keys;

export function Verify({ initialPostHash }: { initialPostHash: string }) {
  const [postHash, setPostHash] = useState(initialPostHash);
  const [bundle, setBundle] = useState<unknown>(undefined);
  const [customKeys, setCustomKeys] = useState<TrustedKey[] | null>(null);
  const [useApi, setUseApi] = useState(true);
  const [scan, setScan] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return setBundle(undefined);
    try {
      const json = JSON.parse(await file.text());
      if (!ProofBundleSchema.safeParse(json).success) throw new Error('not a phi.proof/1 bundle');
      setBundle(json);
      if (!postHash) setPostHash(json.postHash);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onKeysFile(file: File | undefined) {
    setError(null);
    if (!file) return setCustomKeys(null);
    try {
      setCustomKeys(TrustedKeysFileSchema.parse(JSON.parse(await file.text())).keys);
    } catch {
      setError('not a valid phi.trusted-keys/1 file');
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const hints = bundle ?? (useApi ? ((await getProof(postHash)) ?? undefined) : undefined);
      const sources = createPublicSources({ rpcUrls: Object.fromEntries(CHAINS.map((c) => [c.chainId, c.rpcUrl])), gateway: GATEWAY_URL });
      setReport(await verifyPublishedPost(postHash as `0x${string}`, { hints, scan }, { sources, trustedKeys: customKeys ?? bundledKeys }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Verify a post</h2>
      <p className="notice">
        This page runs the same verifier library as the CLI, but the platform serves both this code and its copy of
        trusted-keys.json, so it is a convenience, not independent verification. For that, run <code>pnpm verify &lt;postHash&gt;</code> from
        the public repository at a pinned commit, or with a trusted-keys file you supply.
      </p>
      <label>
        postHash
        <input value={postHash} onChange={(e) => setPostHash(e.target.value.trim())} placeholder="0x..." />
      </label>
      <label>
        Proof bundle (optional, untrusted hints)
        <input type="file" accept="application/json" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <label>
        Trust root (optional): your own trusted-keys.json instead of the copy served with this page
        <input type="file" accept="application/json" onChange={(e) => onKeysFile(e.target.files?.[0])} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={useApi} onChange={(e) => setUseApi(e.target.checked)} disabled={bundle !== undefined} />
        Without a bundle, fetch hints from the platform API (untrusted, re-checked)
      </label>
      <label className="inline">
        <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} />
        Scan anchor events (needed for an "omitted" verdict; slower)
      </label>
      <button onClick={run} disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(postHash)}>{busy ? 'Verifying...' : 'Verify'}</button>
      {error && <p className="error">{error}</p>}
      {report && (
        <>
          <p className={report.ok ? 'verdict ok' : 'verdict bad'}>{report.ok ? 'VERIFIED' : 'NOT VERIFIED'}</p>
          <pre>{formatReport(report)}</pre>
        </>
      )}
    </section>
  );
}
