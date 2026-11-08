import { useEffect, useState } from 'react';
import { DEMO_MODE } from './config.ts';
import { OPENFORT_CONFIGURED, openfortClient } from './openfort.ts';
import { developmentSigner, type PostSigner } from './signer.ts';
import { Access } from './views/Access.tsx';
import { Compose } from './views/Compose.tsx';
import { Efficiency } from './views/Efficiency.tsx';
import { PostList, PostView } from './views/Posts.tsx';
import { Verify } from './views/Verify.tsx';

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
}

export function App() {
  // Openfort when configured (ADR-011); otherwise a development key in this browser.
  const [signer, setSigner] = useState<PostSigner | null>(() => (OPENFORT_CONFIGURED ? null : developmentSigner()));
  const [view = 'compose', param] = useRoute();

  return (
    <div className="app">
      <header>
        <h1>Phi posts <small>PoC</small></h1>
        <nav>
          <a href="#compose" className={view === 'compose' ? 'active' : ''}>Compose</a>
          <a href="#posts" className={view === 'posts' || view === 'post' ? 'active' : ''}>My posts</a>
          <a href="#verify" className={view === 'verify' ? 'active' : ''}>Verify</a>
          <a href="#efficiency" className={view === 'efficiency' ? 'active' : ''}>Efficiency</a>
        </nav>
        <p className="signer">
          {signer ? `Signing with: ${signer.label}` : 'Not signed in'}
          {signer?.kind === 'openfort' && (
            <button className="link" onClick={async () => { await openfortClient().auth.logout(); setSigner(null); }}>Sign out</button>
          )}
          {DEMO_MODE && <span className="demo-badge">DEMO MODE: short batching window, not the efficiency configuration</span>}
        </p>
      </header>
      <main>
        {!signer && (view === 'compose' || view === 'posts' || view === 'post') && <Access onReady={setSigner} />}
        {signer && view === 'compose' && <Compose signer={signer} />}
        {signer && view === 'posts' && <PostList signer={signer} />}
        {signer && view === 'post' && param && <PostView signer={signer} postHash={param} />}
        {view === 'verify' && <Verify initialPostHash={param ?? ''} />}
        {view === 'efficiency' && <Efficiency />}
      </main>
    </div>
  );
}
