import { useEffect, useState, type ReactNode } from 'react';
import { getPost, getPosts } from '../api.ts';
import { Avatar, ChainPill, GatewayImage, Spinner, useNow } from '../components.tsx';
import { GATEWAYS } from '../config.ts';
import { relativeTime } from '../format.ts';
import type { PostSigner } from '../signer.ts';
import { listPosts } from '../store.ts';
import type { PostSummary } from '../types.ts';

/** Polls a loader every 10 s while mounted. */
function usePosts(load: () => Promise<PostSummary[]>, deps: unknown[]): { posts: PostSummary[] | null; error: string | null } {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const run = () =>
      load()
        .then((p) => active && (setPosts(p), setError(null)))
        .catch((e) => active && setError((e as Error).message));
    run();
    const t = setInterval(run, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { posts, error };
}

/** Latest posts published through this platform. Every one of them is public on Arweave and anchored on-chain. */
export function Feed() {
  const { posts, error } = usePosts(() => getPosts(48), []);
  return (
    <PostGrid title="Latest posts" posts={posts} error={error}>
      No posts yet. <a href="#compose">Publish the first one</a>.
    </PostGrid>
  );
}

/** Posts signed in this browser by the current account (the list comes from IndexedDB, the details from the API). */
export function MyPosts({ signer }: { signer: PostSigner }) {
  const { posts, error } = usePosts(async () => {
    const local = await listPosts(signer.address);
    const found = await Promise.all(local.map((p) => getPost(p.postHash).catch(() => null)));
    return found.filter((p): p is NonNullable<typeof p> => p !== null);
  }, [signer]);
  return (
    <PostGrid title="My posts" posts={posts} error={error}>
      No posts from this account in this browser yet. <a href="#compose">Compose one</a>.
    </PostGrid>
  );
}

function PostGrid({ title, posts, error, children }: { title: string; posts: PostSummary[] | null; error: string | null; children: ReactNode }) {
  const now = useNow(15000);
  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <a className="button" href="#compose">New post</a>
      </div>
      {error && <p className="error">{error}</p>}
      {!posts && !error && <Spinner label="Loading posts" />}
      {posts && posts.length === 0 && <div className="card empty">{children}</div>}
      <div className="feed">
        {posts?.map((p) => (
          <a key={p.postHash} className="post-card" href={`#post/${p.postHash}`}>
            {p.image?.arweaveId ? (
              <GatewayImage className="post-card-image" id={p.image.arweaveId} gateways={GATEWAYS} alt={`image posted by ${p.username}`} />
            ) : p.image ? (
              <div className="post-card-image image-missing">Uploading image...</div>
            ) : (
              <div className="post-card-text">{p.caption || '(no caption)'}</div>
            )}
            <div className="post-card-body">
              <div className="post-meta">
                <Avatar name={p.username} />
                <strong>@{p.username}</strong>
                <span className="muted small">{relativeTime(p.acceptedAt, now)}</span>
              </div>
              {p.image && p.caption && <p className="post-card-caption">{p.caption}</p>}
              <div className="pills">
                {p.chains.map((c) => (
                  <ChainPill key={c.chainId} chainId={c.chainId} stage={c.stage} />
                ))}
              </div>
              {p.state !== 'STORED' && <span className="muted small">storing on Arweave...</span>}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
