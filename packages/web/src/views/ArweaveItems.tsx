import { ManifestSchema, PostJsonSchema, manifestRootMatches, postFromJson, postHash as hashPost, type Manifest } from '@onchain-posts/core';
import { useEffect, useState, type ReactNode } from 'react';
import { keccak256 } from 'viem';
import { fetchItem, gatewayUrl, indexedItem, turboStatus, type ItemIndex, type TurboStatus } from '../arweave.ts';
import { Check, Hash, Spinner } from '../components.tsx';
import { GATEWAYS, chainName } from '../config.ts';
import { kib } from '../format.ts';
import type { PostDetail } from '../types.ts';

type Kind = 'post' | 'image' | 'manifest';
type Item = { kind: Kind; id: string; title: string; chainId?: number };

const TURBO_TEXT: Record<string, string> = {
  new: 'accepted by Turbo, waiting to be bundled',
  pending: 'packed in a bundle, settling on Arweave',
  FINALIZED: 'finalized on Arweave',
};

function turboText(status: TurboStatus | null): string {
  if (!status) return 'status not available';
  if (status.status === 'FINALIZED') return TURBO_TEXT.FINALIZED!;
  return TURBO_TEXT[status.info ?? ''] ?? status.status.toLowerCase();
}

/** Everything stored on Arweave for this post: post JSON, image and one manifest per chain, with live checks. */
export function ArweaveItems({ post }: { post: PostDetail }) {
  const items: Item[] = [];
  if (post.postArweaveId) items.push({ kind: 'post', id: post.postArweaveId, title: 'Post JSON' });
  if (post.image?.arweaveId) items.push({ kind: 'image', id: post.image.arweaveId, title: 'Image (WebP)' });
  for (const c of post.chains) {
    if (c.batch?.manifestArweaveId) items.push({ kind: 'manifest', id: c.batch.manifestArweaveId, title: `Batch manifest for ${chainName(c.chainId)}`, chainId: c.chainId });
  }
  if (items.length === 0) return <p className="muted">Uploading to Arweave through Turbo...</p>;
  return (
    <div className="items">
      {items.map((item) => (
        <ArweaveItem key={item.id} item={item} post={post} />
      ))}
    </div>
  );
}

function ArweaveItem({ item, post }: { item: Item; post: PostDetail }) {
  const [status, setStatus] = useState<TurboStatus | null | undefined>(undefined);
  const [index, setIndex] = useState<ItemIndex | null | undefined>(undefined);
  const [content, setContent] = useState<{ bytes: Uint8Array; gateway: string } | null | undefined>(undefined);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    turboStatus(item.id).then(setStatus);
    indexedItem(item.id).then(setIndex);
    fetchItem(item.id)
      .then(setContent)
      .catch((e) => {
        setContent(null);
        setFetchError((e as Error).message);
      });
  }, [item.id]);

  return (
    <div className="item card">
      <div className="item-head">
        <strong>{item.title}</strong>
        <span className={`chip ${status?.status === 'FINALIZED' ? 'ok' : 'neutral'}`}>{status === undefined ? 'checking Turbo...' : turboText(status)}</span>
      </div>
      <div className="kv">
        <span>Arweave ID</span>
        <Hash value={item.id} href={gatewayUrl(item.id)} full />
        <span>Gateways</span>
        <span className="links">
          {GATEWAYS.map((g) => (
            <a key={g} href={gatewayUrl(item.id, g)} target="_blank" rel="noreferrer">
              {new URL(g).host}
            </a>
          ))}
        </span>
        {status && (
          <>
            <span>Turbo</span>
            <span>
              {status.bundleId && (
                <>
                  bundle <Hash value={status.bundleId} />
                </>
              )}
              {status.winc !== undefined && <span className="muted">, cost {status.winc === '0' ? '0 winc (free tier)' : `${status.winc} winc`}</span>}
              {status.rawContentLength && status.payloadContentLength && (
                <span className="muted">
                  , {status.rawContentLength.toLocaleString('en-US')} bytes signed for a {status.payloadContentLength.toLocaleString('en-US')}-byte payload (ANS-104 headers and tags)
                </span>
              )}
            </span>
          </>
        )}
        <span>Owner (signer)</span>
        <span>
          {index === undefined ? (
            <Spinner />
          ) : index ? (
            <>
              <code className="small">{index.owner}</code> <span className="chip ok">platform Arweave key, not the author</span>
            </>
          ) : (
            <span className="muted">not indexed by the gateway yet</span>
          )}
        </span>
        {index && (
          <>
            <span>Tags</span>
            <span className="tags">
              {index.tags.map((t) => (
                <span key={t.name} className="tag">
                  {t.name}: {t.value.length > 24 ? `${t.value.slice(0, 22)}...` : t.value}
                </span>
              ))}
              {!index.tags.some((t) => t.name.toLowerCase() === 'username') && <span className="chip ok">no username tag</span>}
            </span>
          </>
        )}
        {content && (
          <>
            <span>Served by</span>
            <span>
              {new URL(content.gateway).host}, {kib(content.bytes.length)}
            </span>
          </>
        )}
      </div>
      {content === undefined && <Spinner label="Fetching from gateways" />}
      {content === null && <Check state="pending" title="Not served by any gateway yet">{fetchError}</Check>}
      {content && <ItemContent item={item} post={post} bytes={content.bytes} />}
    </div>
  );
}

function ItemContent({ item, post, bytes }: { item: Item; post: PostDetail; bytes: Uint8Array }) {
  if (item.kind === 'image') {
    const ok = keccak256(bytes) === post.image?.hash.toLowerCase();
    return <Check state={ok ? 'ok' : 'fail'} title={ok ? 'keccak256 of the bytes equals the signed imageHash' : 'Bytes do not match the signed imageHash'}><span className="mono small">imageHash {post.image?.hash}</span></Check>;
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return <Check state="fail" title="Not valid JSON" />;
  }
  if (item.kind === 'post') {
    const parsed = PostJsonSchema.safeParse(json);
    const recomputed = parsed.success ? hashPost(postFromJson(parsed.data)) : null;
    return (
      <>
        <Check state={recomputed === post.postHash ? 'ok' : 'fail'} title={recomputed === post.postHash ? 'Its fields hash (EIP-712 hashStruct) to the postHash' : 'Fields do not hash to the postHash'} />
        <JsonView value={json} />
      </>
    );
  }
  const manifest = ManifestSchema.safeParse(json);
  const m = manifest.success ? (manifest.data as Manifest) : null;
  const contains = m?.leaves.some((leaf) => leaf[0].toLowerCase() === post.postHash.toLowerCase());
  return (
    <>
      <Check state={m && manifestRootMatches(m) ? 'ok' : 'fail'} title={m ? `onchain-posts.manifest/1 with ${m.leaves.length} leaves; rebuilds to root ${m.root.slice(0, 10)}...` : 'Not a onchain-posts.manifest/1'}>
        {m && <span className="small">{contains ? 'contains this post' : 'does NOT contain this post'}</span>}
      </Check>
      <JsonView value={json} collapsed />
    </>
  );
}

function JsonView({ value, collapsed = false }: { value: unknown; collapsed?: boolean }): ReactNode {
  const text = JSON.stringify(value, null, 2);
  return collapsed ? (
    <details>
      <summary>Show JSON</summary>
      <pre className="json">{text}</pre>
    </details>
  ) : (
    <pre className="json">{text}</pre>
  );
}
