import { ProofBundleSchema, TrustedKeysFileSchema, type TrustedKey } from '@onchain-posts/core';
import { createPublicSources, verifyPublishedPost, type VerificationReport } from '@onchain-posts/verifier';
import { useState } from 'react';
import { getProof } from '../api.ts';
import { Spinner } from '../components.tsx';
import { CHAINS, GATEWAYS } from '../config.ts';
import { bundledKeys } from '../trust.ts';
import { ReportView } from './ReportView.tsx';

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
      if (!ProofBundleSchema.safeParse(json).success) throw new Error('not a onchain-posts.proof/1 bundle');
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
      setError('not a valid onchain-posts.trusted-keys/1 file');
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const hints = bundle ?? (useApi ? ((await getProof(postHash).catch(() => null)) ?? undefined) : undefined);
      const sources = createPublicSources({ rpcUrls: Object.fromEntries(CHAINS.map((c) => [c.chainId, c.rpcUrl])), gateway: GATEWAYS });
      setReport(await verifyPublishedPost(postHash as `0x${string}`, { hints, scan }, { sources, trustedKeys: customKeys ?? bundledKeys }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const valid = /^0x[0-9a-fA-F]{64}$/.test(postHash);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Verify a post</h1>
        {valid && <a className="button secondary" href={`#post/${postHash}`}>Open post page</a>}
      </div>
      <div className="card">
        <p className="notice">
          This page runs the same verifier library as the CLI, but the platform serves both this code and its copy of trusted-keys.json, so it is a
          convenience, not independent verification. For that, run <code>pnpm verify &lt;postHash&gt;</code> from the public repository at a pinned
          commit, or with a trusted-keys file you supply.
        </p>
        <label>
          postHash
          <input value={postHash} onChange={(e) => setPostHash(e.target.value.trim())} placeholder="0x..." />
        </label>
        <div className="grid-2">
          <label>
            Proof bundle (optional, untrusted hints)
            <input type="file" accept="application/json" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label>
            Trust root (optional): your own trusted-keys.json
            <input type="file" accept="application/json" onChange={(e) => onKeysFile(e.target.files?.[0])} />
          </label>
        </div>
        <label className="inline">
          <input type="checkbox" checked={useApi} onChange={(e) => setUseApi(e.target.checked)} disabled={bundle !== undefined} />
          Without a bundle, fetch hints from the platform API (untrusted, re-checked)
        </label>
        <label className="inline">
          <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} />
          Scan anchor events (needed for an "omitted" verdict and to find a post without hints; slower)
        </label>
        <p className="muted small">Arweave gateways tried in order: {GATEWAYS.map((g) => new URL(g).host).join(', ')}.</p>
        <button onClick={run} disabled={busy || !valid}>{busy ? 'Verifying...' : 'Verify'}</button>
        {error && <p className="error">{error}</p>}
      </div>
      {busy && <Spinner label="Fetching from Arweave gateways and public RPCs" />}
      {report && (
        <div className="card">
          <ReportView report={report} />
        </div>
      )}
    </div>
  );
}
