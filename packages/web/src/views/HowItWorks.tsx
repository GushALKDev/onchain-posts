import { POST_ANCHOR_ADDRESS } from '@onchain-posts/core';
import architecture from '../../../../docs/diagrams/png/01-architecture.png';
import publishFlow from '../../../../docs/diagrams/png/02-publish-flow.png';
import verification from '../../../../docs/diagrams/png/06-verification.png';
import { ChainPill, Section } from '../components.tsx';
import { CHAINS } from '../config.ts';

const STEPS = [
  { n: 1, title: 'Sign', where: 'Browser', text: 'The image is compressed to WebP without metadata. The author signs an EIP-712 PublishIntent over the final bytes and the chosen chains. No transaction, no gas, no wallet pop-up for fees.' },
  { n: 2, title: 'Accept', where: 'Backend', text: 'The platform recomputes every hash, checks the signature and returns a signed receipt with one anchoring deadline per chain.' },
  { n: 3, title: 'Store', where: 'Arweave via Turbo', text: 'The image and the post JSON are uploaded with the platform Arweave key, so the author key never appears as owner. Storage is permanent.' },
  { n: 4, title: 'Batch', where: 'Per chain', text: 'Posts wait in a queue per chain. When the batch is full (Nmax) or the window closes (Tmax), the platform builds a Merkle tree and uploads its manifest.' },
  { n: 5, title: 'Anchor', where: 'PostAnchor', text: 'One transaction per batch and chain stores the 32-byte root. The cost is the same for 1 post or 500.' },
  { n: 6, title: 'Settle', where: 'Safe head', text: 'Published once the transaction is in a block; Settled once the chain safe head covers it (for the L2s, once the batch is on Ethereum and safe there).' },
  { n: 7, title: 'Verify', where: 'Anyone', text: 'The verifier re-checks content hashes on Arweave, the Merkle proof on-chain and the platform keys, using public sources only.' },
];

export function HowItWorks() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>How it works</h1>
      </div>
      <Section title="From a signature to three chains" subtitle="Every post page shows these steps live, with the evidence for each one.">
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n} className="card step">
              <span className="step-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong> <span className="muted small">{s.where}</span>
                <p className="small">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="What each party can and cannot do">
        <div className="privacy">
          <div className="card inner">
            <h3>Guaranteed</h3>
            <ul>
              <li>Content cannot be changed after anchoring: the leaf commits to the postHash and the Arweave ID.</li>
              <li>The author's address never appears on-chain, on Arweave or in the API: only sigCommit, the hash of the signature.</li>
              <li>An omission is provable: the signed receipt names a deadline per chain, and the verifier can scan every trusted batch in that window.</li>
              <li>The author can prove authorship later by revealing the signature from the private proof bundle.</li>
            </ul>
          </div>
          <div className="card inner">
            <h3>Not guaranteed</h3>
            <ul>
              <li>Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work).</li>
              <li>Turbo must settle uploads to Arweave after serving them from its cache.</li>
              <li>Usernames are not identities in this PoC: they are first come, first served per account.</li>
            </ul>
          </div>
        </div>
      </Section>
      <Section title="Deployment" subtitle="Same contract address on every chain (CREATE2), no owner, no proxy.">
        <div className="card">
          <div className="pills">
            {CHAINS.map((c) => (
              <a key={c.chainId} href={`${c.explorer}/address/${POST_ANCHOR_ADDRESS}`} target="_blank" rel="noreferrer">
                <ChainPill chainId={c.chainId} />
              </a>
            ))}
          </div>
          <p className="mono small break">PostAnchor {POST_ANCHOR_ADDRESS}</p>
        </div>
      </Section>
      <Section title="Diagrams" subtitle="Made with Archify; interactive versions in docs/diagrams/html in the repository.">
        <div className="diagrams">
          {[
            { src: architecture, title: 'Architecture' },
            { src: publishFlow, title: 'Publish flow' },
            { src: verification, title: 'Verification' },
          ].map((d) => (
            <figure key={d.title} className="card">
              <a href={d.src} target="_blank" rel="noreferrer">
                <img src={d.src} alt={`${d.title} diagram`} loading="lazy" />
              </a>
              <figcaption>{d.title}</figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </div>
  );
}
