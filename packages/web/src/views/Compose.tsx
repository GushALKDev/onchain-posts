import { LIMITS, normalizeCaption, normalizeUsername } from '@phi/core';
import { useState } from 'react';
import { submitPost } from '../api.ts';
import { buildSubmission } from '../compose.ts';
import { Avatar, ChainPill } from '../components.tsx';
import { CHAINS } from '../config.ts';
import { kib } from '../format.ts';
import { prepareImage, type PreparedImage } from '../image.ts';
import type { PostSigner } from '../signer.ts';
import { savePost } from '../store.ts';

type Phase = 'idle' | 'sign' | 'send' | 'save';

const PHASES: { key: Exclude<Phase, 'idle'>; text: string }[] = [
  { key: 'sign', text: 'Signing the EIP-712 intent in your browser' },
  { key: 'send', text: 'Platform checks the post and signs a receipt' },
  { key: 'save', text: 'Saving your signature locally (IndexedDB)' },
];

export function Compose({ signer }: { signer: PostSigner }) {
  const [username, setUsername] = useState('');
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<(PreparedImage & { preview: string; original: number }) | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [chainIds, setChainIds] = useState<number[]>(CHAINS.map((c) => c.chainId));
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const codePoints = [...normalizeCaption(caption)].length;
  const signedName = normalizeUsername(username.trim());

  async function onImage(file: File | undefined) {
    setError(null);
    setImage(null);
    if (!file) return;
    setPreparing(true);
    try {
      const prepared = await prepareImage(file);
      setImage({ ...prepared, original: file.size, preview: URL.createObjectURL(new Blob([prepared.bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' })) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setPhase('sign');
      const built = await buildSubmission({ username, caption, image: image?.bytes ?? null, chainIds }, signer, Math.floor(Date.now() / 1000));
      setPhase('send');
      const { postHash, receipt } = await submitPost(built.body);
      setPhase('save');
      await savePost({
        postHash,
        owner: signer.address.toLowerCase(),
        username: built.body.intent.post.username,
        caption: built.body.intent.post.caption,
        createdAt: built.body.intent.post.createdAt,
        signature: built.signature,
        intent: { chainIds: built.body.intent.chainIds, nonce: built.body.intent.nonce, deadline: built.body.intent.deadline },
        receipt,
      });
      location.hash = `#post/${postHash}`;
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';
  return (
    <div className="page">
      <div className="page-head">
        <h1>New post</h1>
      </div>
      <div className="compose">
        <form className="card" onSubmit={onSubmit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ana" required disabled={busy} />
            {username && signedName !== username && <span className="hint">will be signed as "{signedName}"</span>}
          </label>
          <label>
            Caption{' '}
            <span className={`hint ${codePoints > LIMITS.captionMaxCodePoints ? 'error' : ''}`}>
              {codePoints} / {LIMITS.captionMaxCodePoints}
            </span>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} disabled={busy} />
          </label>
          <label className={`dropzone ${image ? 'has-image' : ''}`}>
            <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} disabled={busy} />
            <strong>{preparing ? 'Preparing image...' : image ? 'Change image' : 'Add an image (optional)'}</strong>
            <span className="hint">
              Resized to {LIMITS.imageMaxSide} px, WebP up to {LIMITS.imageMaxBytes / 1024} KiB, EXIF and XMP removed before signing
            </span>
          </label>
          {image && (
            <p className="hint">
              {kib(image.original)} original to {kib(image.bytes.length)} WebP, {image.width}x{image.height}, quality {image.quality}.{' '}
              <button type="button" className="link" onClick={() => setImage(null)}>Remove</button>
            </p>
          )}
          <fieldset disabled={busy}>
            <legend>Publish on</legend>
            {CHAINS.map((c) => (
              <label key={c.chainId} className="inline chain-option">
                <input
                  type="checkbox"
                  checked={chainIds.includes(c.chainId)}
                  onChange={(e) => setChainIds(e.target.checked ? [...chainIds, c.chainId] : chainIds.filter((id) => id !== c.chainId))}
                />
                <ChainPill chainId={c.chainId} />
                <span className="hint">{c.layer === 'L1' ? 'L1, slower and pricier' : 'L2, settles on Ethereum'}</span>
              </label>
            ))}
          </fieldset>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || preparing || chainIds.length === 0}>{busy ? 'Publishing...' : 'Sign and publish'}</button>
          {busy && (
            <ol className="progress">
              {PHASES.map((p, i) => {
                const current = PHASES.findIndex((x) => x.key === phase);
                return (
                  <li key={p.key} className={i < current ? 'done' : i === current ? 'active' : ''}>
                    {p.text}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="hint">You sign in the browser; the platform publishes and pays every fee. Your address never appears on-chain, on Arweave, or to other users.</p>
        </form>
        <aside>
          <span className="muted small">Preview</span>
          <div className="post-card preview">
            {image ? <img className="post-card-image" src={image.preview} alt="the exact bytes that will be signed" /> : !caption && <div className="post-card-text muted">Your post</div>}
            {!image && caption && <div className="post-card-text">{caption}</div>}
            <div className="post-card-body">
              <div className="post-meta">
                <Avatar name={signedName || '?'} />
                <strong>@{signedName || 'username'}</strong>
              </div>
              {image && caption && <p className="post-card-caption">{caption}</p>}
              <div className="pills">
                {chainIds.map((id) => (
                  <ChainPill key={id} chainId={id} />
                ))}
              </div>
            </div>
          </div>
          <div className="card inner small">
            <strong>What happens next</strong>
            <ol className="small">
              <li>The image and post JSON go to Arweave (permanent, public).</li>
              <li>Each chosen chain gets the post in its next batch: one transaction anchors a Merkle root.</li>
              <li>The post page shows each step live, with the proof.</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
