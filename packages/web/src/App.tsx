import { useEffect, useState } from 'react';
import { DEMO_MODE } from './config.ts';
import { developmentSigner } from './signer.ts';
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
  const [signer] = useState(() => developmentSigner());
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
          Signing with: {signer.label}
          {DEMO_MODE && <span className="demo-badge">DEMO MODE: short batching window, not the efficiency configuration</span>}
        </p>
      </header>
      <main>
        {view === 'compose' && <Compose signer={signer} />}
        {view === 'posts' && <PostList signer={signer} />}
        {view === 'post' && param && <PostView signer={signer} postHash={param} />}
        {view === 'verify' && <Verify initialPostHash={param ?? ''} />}
        {view === 'efficiency' && <Efficiency />}
      </main>
    </div>
  );
}
