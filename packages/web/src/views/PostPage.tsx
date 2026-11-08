import { POSTS_DOMAIN, imageHash, isTrustedKey, receiptFromJson, recoverReceiptSigner } from '@onchain-posts/core';
import { createPublicSources, verifyPublishedPost, type VerificationReport } from '@onchain-posts/verifier';
import { useEffect, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { demoFlush, getPost, getProof } from '../api.ts';
import { downloadJson, privateBundle } from '../bundle.ts';
import { Avatar, ChainPill, Check, GatewayImage, Hash, Section, Spinner, useNow } from '../components.tsx';
import { CHAINS, DEMO_MODE, GATEWAYS, chainName } from '../config.ts';
import { dateTime, duration, kib, relativeTime } from '../format.ts';
import type { PostSigner } from '../signer.ts';
import { getPost as getLocalPost, type LocalPost } from '../store.ts';
import { bundledKeys } from '../trust.ts';
import type { PostDetail } from '../types.ts';
import { ArweaveItems } from './ArweaveItems.tsx';
import { ChainAnchor } from './ChainAnchor.tsx';
import { ReportView } from './ReportView.tsx';

const finished = (p: PostDetail) => p.state === 'STORED' && p.chains.every((c) => c.stage === 'settled' || c.stage === 'failed');

/** Everything public about one post, each piece with the check that makes it trustworthy. */
export function PostPage({ postHash, signer }: { postHash: string; signer: PostSigner | null }) {
  const [post, setPost] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalPost | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const p = await getPost(postHash);
        if (!active) return;
        setPost(p);
        setError(null);
        if (!finished(p)) timer = setTimeout(load, 4000);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [postHash]);

  useEffect(() => {
    if (signer) getLocalPost(postHash, signer.address).then(setLocal);
  }, [postHash, signer]);

  if (error && !post) {
    return (
      <div className="page">
        <a href="#" className="back">Back to the feed</a>
        <div className="card">
          <h1>Post not found on this platform</h1>
          <p className="muted">{error}</p>
          <p>
            The platform API is only a convenience. If you have the postHash from somewhere else, you can still <a href={`#verify/${postHash}`}>verify it from public sources</a>.
          </p>
        </div>
      </div>
    );
  }
  if (!post) return <div className="page"><Spinner label="Loading post" /></div>;

  return (
    <div className="page">
      <a href="#" className="back">Back to the feed</a>
      <Hero post={post} now={now} />
      <Section title="Journey" subtitle="From the author's signature to finality on every chain. Times come from the platform database and, for anchors, from the block timestamp.">
        <Journey post={post} now={now} />
      </Section>
      <Section title="Signed content" subtitle="What the author signed and how the post identity is derived. The same postHash on every chain.">
        <SignedContent post={post} />
      </Section>
      <Section title="Stored on Arweave" subtitle="Uploaded through Turbo, signed with the platform Arweave key. Each item is fetched live from public gateways and checked against the signed hashes.">
        <ArweaveItems post={post} />
      </Section>
      <Section title="Anchored on-chain" subtitle="One transaction per batch and chain stores a Merkle root in PostAnchor. Each chain is independent.">
        <div className="chains">
          {post.chains.map((c) => (
            <ChainAnchor key={c.chainId} post={post} chain={c} now={now} />
          ))}
        </div>
      </Section>
      <Section title="Receipt" subtitle="Signed by the platform when it accepted the post: a promise to anchor on each chain before a deadline. It makes an omission provable.">
        <ReceiptCheck post={post} />
      </Section>
      <Section id="verify" title="Independent verification" subtitle="The verifier library re-checks everything from public sources: Arweave gateways, public RPCs and the trust root. API data is used only as untrusted hints.">
        <InlineVerify post={post} local={local} />
      </Section>
      <Section title="Privacy" subtitle="What anyone can see about this post, and what never leaves the author's browser.">
        <Privacy post={post} />
      </Section>
      <Section title="Proof bundle" subtitle="A self-contained file that lets anyone verify this post later, even if this platform disappears.">
        <BundleTools post={post} local={local} />
      </Section>
    </div>
  );
}

function Hero({ post, now }: { post: PostDetail; now: number }) {
  const settled = post.chains.filter((c) => c.stage === 'settled').length;
  return (
    <div className="card hero">
      {post.image?.arweaveId ? (
        <GatewayImage className="hero-image" id={post.image.arweaveId} gateways={GATEWAYS} alt={`image posted by ${post.username}`} />
      ) : post.image ? (
        <div className="hero-image image-missing">Image uploading to Arweave...</div>
      ) : null}
      <div className="hero-body">
        <div className="post-meta">
          <Avatar name={post.username} />
          <div>
            <strong>@{post.username}</strong>
            <div className="muted small" title={dateTime(post.createdAt)}>
              signed {relativeTime(post.createdAt, now)}
            </div>
          </div>
        </div>
        <p className="hero-caption">{post.caption || <span className="muted">(no caption)</span>}</p>
        {post.image && (
          <p className="muted small">
            WebP {post.image.width}x{post.image.height}, {kib(post.image.bytes)}
          </p>
        )}
        <div className="pills">
          {post.chains.map((c) => (
            <ChainPill key={c.chainId} chainId={c.chainId} stage={c.stage} />
          ))}
        </div>
        <p className="muted small">
          {post.state !== 'STORED' ? 'Uploading to Arweave. ' : 'Stored permanently on Arweave. '}
          {settled === post.chains.length ? `Settled on all ${settled} chains.` : `Settled on ${settled} of ${post.chains.length} chains.`}
        </p>
        <Hash value={post.postHash} label="postHash" />
        <div className="actions">
          <a className="button" href="#verify" onClick={(e) => { e.preventDefault(); document.getElementById('verify')?.scrollIntoView({ behavior: 'smooth' }); }}>
            Verification
          </a>
          <a className="button secondary" href={`#verify/${post.postHash}`}>Open in the verifier</a>
        </div>
      </div>
    </div>
  );
}

type Step = { title: string; at: number | null; note: string };

function Journey({ post, now }: { post: PostDetail; now: number }) {
  const steps: (Step & { done: boolean; delta: boolean })[] = [
    { title: 'Signed by the author', at: post.createdAt, done: true, delta: false, note: 'EIP-712 signature in the browser; createdAt is declared by the author and covered by the signature' },
    { title: 'Accepted by the platform', at: post.acceptedAt, done: true, delta: false, note: 'signature checked, receipt signed with one deadline per chain' },
    { title: 'Stored on Arweave', at: post.storedAt, done: post.state === 'STORED', delta: true, note: 'image and post JSON uploaded through Turbo; readable on ar.io gateways at once' },
  ];
  const since = (at: number | null) => (at === null ? null : `+${duration(Math.max(0, at - post.acceptedAt))}`);
  return (
    <div className="journey">
      <ol className="timeline">
        {steps.map((s) => (
          <li key={s.title} className={s.done ? 'done' : 'todo'}>
            <span className="tl-dot" />
            <div>
              <strong>{s.title}</strong> {s.at !== null && <span className="muted small">{dateTime(s.at)}{s.delta && ` (${since(s.at)})`}</span>}
              <div className="muted small">{s.note}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="lanes">
        <div className="lane lane-head">
          <span />
          <span>Batched</span>
          <span>Published</span>
          <span>Settled</span>
        </div>
        {post.chains.map((c) => {
          const b = c.batch;
          const cells: (number | null)[] = [b?.batchedAt ?? null, b?.anchoredAt ?? null, b?.settledAt ?? null];
          // Posts accepted before the timeline columns existed have no timestamps; the stage still says what is done.
          const reached = [b !== null, c.stage === 'published' || c.stage === 'settled', c.stage === 'settled'];
          return (
            <div key={c.chainId} className="lane">
              <ChainPill chainId={c.chainId} />
              {cells.map((at, i) => (
                <span key={i} className={`lane-cell ${at !== null || reached[i] ? 'done' : c.stage === 'failed' ? 'failed' : 'todo'}`} title={at !== null ? dateTime(at) : undefined}>
                  {at !== null ? since(at) : reached[i] ? 'done' : i === 0 && !b && c.anchorBy > now ? `deadline in ${duration(c.anchorBy - now)}` : '...'}
                </span>
              ))}
            </div>
          );
        })}
        <p className="muted small">Times are relative to acceptance. Published = included in a block; Settled = covered by the chain's safe head (for the L2s, posted to Ethereum and safe there).</p>
      </div>
    </div>
  );
}

function SignedContent({ post }: { post: PostDetail }) {
  const fields: [string, string, string][] = [
    ['username', JSON.stringify(post.username), 'NFC, lower case, [a-z0-9_]'],
    ['contentType', '"post"', 'fixed'],
    ['caption', JSON.stringify(post.caption.length > 80 ? `${post.caption.slice(0, 78)}...` : post.caption), 'normalized (NFC)'],
    ['imageHash', post.image?.hash ?? imageHash(null), post.image ? 'keccak256 of the final WebP bytes' : 'zero hash: no image'],
    ['createdAt', String(post.createdAt), dateTime(post.createdAt)],
  ];
  return (
    <div className="signed">
      <div className="typed">
        <div className="typed-block">
          <span className="muted small">EIP-712 domain</span>
          <code>
            {`{ name: "${POSTS_DOMAIN.name}", version: "${POSTS_DOMAIN.version}", verifyingContract: ${POSTS_DOMAIN.verifyingContract} }`}
          </code>
          <span className="muted small">No chainId: one signature identifies the post on every chain.</span>
        </div>
        <div className="typed-block">
          <span className="muted small">Post struct</span>
          <table className="fields">
            <tbody>
              {fields.map(([name, value, note]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td><code className="break small">{value}</code></td>
                  <td className="muted small">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="kv">
        <span>postHash</span>
        <span><Hash value={post.postHash} full /> <span className="muted small">= hashStruct(Post), recomputed below from the Arweave copy</span></span>
        <span>sigCommit</span>
        <span><Hash value={post.sigCommit} full /> <span className="muted small">= keccak256(signature); the signature itself is not public</span></span>
      </div>
    </div>
  );
}

function ReceiptCheck({ post }: { post: PostDetail }) {
  const [signer, setSigner] = useState<Address | null | undefined>(undefined);
  useEffect(() => {
    recoverReceiptSigner(receiptFromJson(post.receipt), post.receipt.signature as Hex).then(setSigner, () => setSigner(null));
  }, [post.receipt]);
  const trusted = signer ? isTrustedKey(bundledKeys, { role: 'receipt', address: signer, at: post.receipt.acceptedAt }) : false;
  const matches = post.receipt.postHash.toLowerCase() === post.postHash.toLowerCase() && post.receipt.sigCommit.toLowerCase() === post.sigCommit.toLowerCase();
  return (
    <div>
      {signer === undefined ? (
        <Spinner label="Recovering the receipt signer" />
      ) : (
        <Check state={signer && trusted && matches ? 'ok' : 'fail'} title={signer && trusted ? 'Signed by a trusted receipt key ("Onchain Receipts" EIP-712 domain)' : 'Receipt signer is not a trusted receipt key'}>
          <div className="mono small break">signer {signer ?? 'unrecoverable'}</div>
          {!matches && <div className="error small">the receipt does not commit to this postHash and sigCommit</div>}
        </Check>
      )}
      <table className="deadlines">
        <thead>
          <tr>
            <th>Chain</th>
            <th>Anchor by</th>
            <th>Window</th>
          </tr>
        </thead>
        <tbody>
          {post.receipt.deadlines.map((d) => (
            <tr key={d.chainId}>
              <td>{chainName(d.chainId)}</td>
              <td>{dateTime(d.anchorBy)}</td>
              <td className="muted">{duration(d.anchorBy - post.receipt.acceptedAt)} after acceptance</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Show the signed receipt</summary>
        <pre className="json">{JSON.stringify(post.receipt, null, 2)}</pre>
      </details>
    </div>
  );
}

function InlineVerify({ post, local }: { post: PostDetail; local: LocalPost | null }) {
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const autoRan = useRef(false);

  async function run(withScan: boolean) {
    setBusy(true);
    setError(null);
    try {
      const proof = await getProof(post.postHash).catch(() => null);
      const hints = proof && local ? privateBundle(proof, local) : (proof ?? undefined);
      const sources = createPublicSources({ rpcUrls: Object.fromEntries(CHAINS.map((c) => [c.chainId, c.rpcUrl])), gateway: GATEWAYS });
      setReport(await verifyPublishedPost(post.postHash as Hex, { hints, scan: withScan }, { sources, trustedKeys: bundledKeys }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const anyAnchored = post.chains.some((c) => c.stage === 'published' || c.stage === 'settled');
  useEffect(() => {
    if (anyAnchored && post.state === 'STORED' && !autoRan.current) {
      autoRan.current = true;
      run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyAnchored, post.state]);

  return (
    <div>
      <p className="notice">
        This runs the same verifier as the CLI, in your browser. The platform still serves this page and its copy of trusted-keys.json, so for fully
        independent verification run <code>pnpm verify {post.postHash.slice(0, 10)}...</code> from the public repository.
        {local && ' Your private copy (with your signature) is used, so authorship is checked too.'}
      </p>
      <div className="actions">
        <button onClick={() => run(scan)} disabled={busy}>
          {busy ? 'Verifying...' : report ? 'Verify again' : 'Verify now'}
        </button>
        <label className="inline">
          <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} />
          Also scan anchor events (needed to prove an omission; slower)
        </label>
      </div>
      {!anyAnchored && !report && <p className="muted small">Verification runs automatically once the post is anchored on at least one chain.</p>}
      {error && <p className="error">{error}</p>}
      {busy && <Spinner label="Fetching from Arweave gateways and public RPCs" />}
      {report && <ReportView report={report} />}
    </div>
  );
}

function Privacy({ post }: { post: PostDetail }) {
  return (
    <div className="privacy">
      <div className="card inner">
        <h3>Public</h3>
        <ul>
          <li>Username @{post.username}, caption{post.image ? ', image' : ''} and createdAt</li>
          <li>postHash and sigCommit, in the Merkle leaf on each chain</li>
          <li>The platform's keys: Arweave owner of every upload, relayer that sent each transaction, receipt signer</li>
          <li>Timing: when the post was accepted and anchored</li>
        </ul>
      </div>
      <div className="card inner">
        <h3>Never public</h3>
        <ul>
          <li>The author's address or public key: not on-chain, not in Arweave tags or owner, not in API responses</li>
          <li>The author's signature: only its hash (sigCommit) is published</li>
          <li>The intent nonce and deadline of the signed publish request</li>
        </ul>
        <p className="muted small">The author can later prove authorship by revealing the signature from the private proof bundle (selective disclosure).</p>
      </div>
    </div>
  );
}

function BundleTools({ post, local }: { post: PostDetail; local: LocalPost | null }) {
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('onchain-posts-demo-flush-token') ?? '');
  const [flushed, setFlushed] = useState<string | null>(null);

  async function download(withSignature: boolean) {
    setError(null);
    try {
      const bundle = await getProof(post.postHash);
      if (!bundle) throw new Error('not stored on Arweave yet, try again in a few seconds');
      const file = withSignature && local ? privateBundle(bundle, local) : bundle;
      downloadJson(`onchain-posts-proof-${post.postHash.slice(0, 10)}${withSignature ? '-private' : ''}.json`, file);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function flush() {
    setError(null);
    sessionStorage.setItem('onchain-posts-demo-flush-token', token);
    try {
      const { flushing } = await demoFlush(token);
      setFlushed(flushing.length ? `flushing on ${flushing.map(chainName).join(', ')}` : 'nothing to flush');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const waiting = post.chains.some((c) => c.stage === 'accepted');
  return (
    <div>
      <div className="actions">
        <button onClick={() => download(false)} disabled={post.state !== 'STORED'}>Download public bundle</button>
        {local && (
          <button className="secondary" onClick={() => download(true)} disabled={post.state !== 'STORED'}>
            Download private bundle (with your signature)
          </button>
        )}
      </div>
      <p className="muted small">
        The public bundle holds the Arweave IDs, the receipt and one Merkle proof per chain. {local ? 'The private one adds your signature, kept only in this browser (IndexedDB): anyone holding it can tie this post to your key, so keep it private.' : 'If you are the author, sign in on the browser you posted from to download the private copy.'}
      </p>
      {DEMO_MODE && waiting && (
        <div className="demo">
          <strong>Demo only:</strong> close the open batches now instead of waiting for Tmax. Each flush costs one transaction per chain, so it needs the operator token.
          <div className="actions">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="demo flush token" />
            <button onClick={flush} disabled={!token}>Flush now</button>
          </div>
          {flushed && <span className="muted small">{flushed}</span>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
