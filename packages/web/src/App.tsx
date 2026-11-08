import { useEffect, useState } from 'react';
import { DEMO_MODE } from './config.ts';
import { OPENFORT_CONFIGURED, openfortClient } from './openfort.ts';
import { developmentSigner, type PostSigner } from './signer.ts';
import { Access } from './views/Access.tsx';
import { Compose } from './views/Compose.tsx';
import { Efficiency } from './views/Efficiency.tsx';
import { Feed, MyPosts } from './views/Feed.tsx';
import { HowItWorks } from './views/HowItWorks.tsx';
import { PostPage } from './views/PostPage.tsx';
import { Verify } from './views/Verify.tsx';

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash);
      scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
}

const NAV = [
  { view: 'feed', label: 'Feed' },
  { view: 'compose', label: 'New post' },
  { view: 'mine', label: 'My posts' },
  { view: 'verify', label: 'Verify' },
  { view: 'how', label: 'How it works' },
  { view: 'efficiency', label: 'Efficiency' },
];

export function App() {
  // Openfort when configured (ADR-011); otherwise a development key in this browser.
  const [signer, setSigner] = useState<PostSigner | null>(() => (OPENFORT_CONFIGURED ? null : developmentSigner()));
  const [route = '', param] = useRoute();
  const view = route || 'feed';
  const active = view === 'post' ? 'feed' : view;
  const needsSigner = view === 'compose' || view === 'mine';

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">Φ</span> Phi posts <small>PoC</small>
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.view} href={`#${n.view}`} className={active === n.view ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="account">
          {signer ? <span title={signer.label}>{signer.kind === 'openfort' ? 'Signed in' : 'Dev key'}</span> : <span className="muted">Not signed in</span>}
          {signer?.kind === 'openfort' && (
            <button
              className="link"
              onClick={async () => {
                await openfortClient().auth.logout();
                setSigner(null);
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      {DEMO_MODE && <div className="demo-strip">Demo mode: short batching window so posts anchor in seconds. This is not the efficiency configuration.</div>}
      <main>
        {needsSigner && !signer && (
          <div className="page narrow">
            <Access onReady={setSigner} />
          </div>
        )}
        {view === 'feed' && <Feed />}
        {view === 'compose' && signer && <Compose signer={signer} />}
        {view === 'mine' && signer && <MyPosts signer={signer} />}
        {view === 'post' && param && <PostPage postHash={param} signer={signer} />}
        {view === 'verify' && <Verify initialPostHash={param ?? ''} />}
        {view === 'how' && <HowItWorks />}
        {view === 'efficiency' && (
          <div className="page">
            <Efficiency />
          </div>
        )}
      </main>
      <footer className="muted small">Testnets only: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia. Content on Arweave is permanent and public.</footer>
    </div>
  );
}
