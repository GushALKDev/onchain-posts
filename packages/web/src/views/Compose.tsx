import { LIMITS, normalizeCaption, normalizeUsername } from '@phi/core';
import { useState } from 'react';
import { submitPost } from '../api.ts';
import { buildSubmission } from '../compose.ts';
import { CHAINS } from '../config.ts';
import { prepareImage, type PreparedImage } from '../image.ts';
import type { PostSigner } from '../signer.ts';
import { savePost } from '../store.ts';

export function Compose({ signer }: { signer: PostSigner }) {
  const [username, setUsername] = useState('');
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<(PreparedImage & { preview: string }) | null>(null);
  const [chainIds, setChainIds] = useState<number[]>(CHAINS.map((c) => c.chainId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codePoints = [...normalizeCaption(caption)].length;

  async function onImage(file: File | undefined) {
    setError(null);
    setImage(null);
    if (!file) return;
    try {
      const prepared = await prepareImage(file);
      setImage({ ...prepared, preview: URL.createObjectURL(new Blob([prepared.bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' })) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const built = await buildSubmission({ username, caption, image: image?.bytes ?? null, chainIds }, signer, Math.floor(Date.now() / 1000));
      const { postHash, receipt } = await submitPost(built.body);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>New post</h2>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ana" required />
        {username && normalizeUsername(username.trim()) !== username && <span className="hint">will be signed as "{normalizeUsername(username.trim())}"</span>}
      </label>
      <label>
        Caption <span className="hint">{codePoints} / {LIMITS.captionMaxCodePoints}</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
      </label>
      <label>
        Image (optional; resized to {LIMITS.imageMaxSide} px, WebP up to {LIMITS.imageMaxBytes / 1024} KiB, metadata removed before signing)
        <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} />
      </label>
      {image && (
        <figure>
          <img src={image.preview} alt="preview of the final bytes that will be signed" />
          <figcaption>{image.width}x{image.height}, {(image.bytes.length / 1024).toFixed(1)} KiB, WebP quality {image.quality}</figcaption>
        </figure>
      )}
      <fieldset>
        <legend>Publish on</legend>
        {CHAINS.map((c) => (
          <label key={c.chainId} className="inline">
            <input
              type="checkbox"
              checked={chainIds.includes(c.chainId)}
              onChange={(e) => setChainIds(e.target.checked ? [...chainIds, c.chainId] : chainIds.filter((id) => id !== c.chainId))}
            />
            {c.name}
          </label>
        ))}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || chainIds.length === 0}>{busy ? 'Signing and sending...' : 'Sign and publish'}</button>
      <p className="hint">You sign the post in the browser; the platform publishes it and pays all fees. Your address never appears on-chain, on Arweave, or to other users.</p>
    </form>
  );
}
