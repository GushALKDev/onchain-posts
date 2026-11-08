import { useEffect, useState } from 'react';
import { demoFlush, getProof, getStatus } from '../api.ts';
import { downloadJson, privateBundle } from '../bundle.ts';
import { CHAINS, DEMO_MODE, chainName } from '../config.ts';
import type { PostSigner } from '../signer.ts';
import { getPost, listPosts, type LocalPost } from '../store.ts';
import type { ChainStatus, PostStatus } from '../types.ts';

const STAGE_LABEL: Record<ChainStatus['stage'], string> = { accepted: 'Accepted', published: 'Published', settled: 'Settled', failed: 'Failed' };
const STAGE_HELP = 'Accepted: signed receipt issued. Published: anchoring transaction included (soft confirmation). Settled: covered by the safe head (on the L2s, the batch is on L1 and L1 considers it safe).';

export function PostList({ signer }: { signer: PostSigner }) {
  const [posts, setPosts] = useState<LocalPost[] | null>(null);
  useEffect(() => {
    listPosts(signer.address).then(setPosts);
  }, [signer]);

  if (!posts) return <p>Loading...</p>;
  if (posts.length === 0) return <p className="card">No posts from this browser yet. <a href="#compose">Compose one</a>.</p>;
  return (
    <ul className="card list">
      {posts.map((p) => (
        <li key={p.postHash}>
          <a href={`#post/${p.postHash}`}>@{p.username}: {p.caption.slice(0, 80) || '(no caption)'}</a>
          <span className="hint"> {new Date(p.createdAt * 1000).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

export function PostView({ signer, postHash }: { signer: PostSigner; postHash: string }) {
  const [status, setStatus] = useState<PostStatus | null>(null);
  const [local, setLocal] = useState<LocalPost | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('phi-demo-flush-token') ?? '');

  useEffect(() => {
    getPost(postHash, signer.address).then(setLocal);
    let active = true;
    const refresh = () =>
      getStatus(postHash)
        .then((s) => active && setStatus(s))
        .catch((e) => active && setError((e as Error).message));
    refresh();
    const timer = setInterval(() => {
      refresh();
      setNow(Math.floor(Date.now() / 1000));
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [postHash, signer]);

  async function download() {
    setError(null);
    try {
      const bundle = await getProof(postHash);
      if (!bundle) throw new Error('not stored on Arweave yet, try again in a few seconds');
      downloadJson(`phi-proof-${postHash.slice(0, 10)}.json`, local ? privateBundle(bundle, local) : bundle);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function flush() {
    setError(null);
    sessionStorage.setItem('phi-demo-flush-token', token);
    try {
      await demoFlush(token);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Post {postHash.slice(0, 10)}...</h2>
      {local && <p>@{local.username}: {local.caption || '(no caption)'}</p>}
      {status && (
        <>
          <p className="hint">Accepted {new Date(status.acceptedAt * 1000).toLocaleString()}; storage: {status.state === 'STORED' ? `stored, ID ${status.postArweaveId}` : status.state}</p>
          <table>
            <thead>
              <tr><th>Chain</th><th title={STAGE_HELP}>Stage</th><th>Deadline (receipt)</th><th>Transaction</th></tr>
            </thead>
            <tbody>
              {status.chains.map((c) => {
                const explorer = CHAINS.find((x) => x.chainId === c.chainId)?.explorerTx;
                const left = c.anchorBy - now;
                return (
                  <tr key={c.chainId}>
                    <td>{chainName(c.chainId)}</td>
                    <td className={`stage ${c.stage}`}>{STAGE_LABEL[c.stage]}</td>
                    <td>{c.stage === 'accepted' ? (left > 0 ? `${left} s left` : 'passed') : '-'}</td>
                    <td>{c.txHash ? (explorer ? <a href={`${explorer}${c.txHash}`} target="_blank" rel="noreferrer">{c.txHash.slice(0, 12)}...</a> : c.txHash.slice(0, 12)) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="actions">
        <button onClick={download}>Download proof bundle{local ? ' (with your signature)' : ''}</button>
        <a className="button" href={`#verify/${postHash}`}>Verify</a>
      </div>
      {local && <p className="hint">Your signature is stored only in this browser (IndexedDB). Anyone holding the downloaded bundle can tie this post to your key: keep it private.</p>}
      {DEMO_MODE && (
        <div className="demo">
          <strong>Demo only:</strong> flush the batch now instead of waiting for Tmax. Each flush costs one transaction per chain, so it needs the operator token.
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="demo flush token" />
          <button onClick={flush} disabled={!token}>Flush now</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
