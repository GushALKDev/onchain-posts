import { useEffect, useState, type ReactNode } from 'react';
import { chainInfo, chainName } from './config.ts';
import { shortHash } from './format.ts';
import type { Stage } from './types.ts';

export function Hash({ value, href, full = false, label }: { value: string; href?: string; full?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="hash">
      {label && <span className="hash-label">{label}</span>}
      <code title={value}>{full ? value : shortHash(value)}</code>
      <button
        className="icon-button"
        title="Copy"
        onClick={(e) => {
          e.preventDefault();
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
      {href && (
        <a className="icon-button" href={href} target="_blank" rel="noreferrer" title="Open">
          open
        </a>
      )}
    </span>
  );
}

export function ChainPill({ chainId, stage }: { chainId: number; stage?: Stage }) {
  const info = chainInfo(chainId);
  return (
    <span className="chain-pill" style={{ ['--chain' as string]: info?.color ?? '#64748b' }} title={stage ? `${chainName(chainId)}: ${STAGE_LABEL[stage]}` : chainName(chainId)}>
      <span className={`dot ${stage ?? ''}`} />
      {info?.short ?? chainName(chainId)}
      {stage && <span className="pill-stage">{STAGE_LABEL[stage]}</span>}
    </span>
  );
}

export const STAGE_LABEL: Record<Stage, string> = { accepted: 'Accepted', published: 'Published', settled: 'Settled', failed: 'Failed' };

export const STAGE_HELP: Record<Stage, string> = {
  accepted: 'The platform signed a receipt promising to anchor the post on this chain before the deadline.',
  published: 'The anchoring transaction is included in a block (soft confirmation).',
  settled: "The chain's safe head covers the block: on the L2s the batch is on Ethereum and Ethereum considers it safe.",
  failed: 'Anchoring failed; the receipt makes the omission provable.',
};

export function Section({ title, subtitle, children, aside, id }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export type CheckState = 'ok' | 'fail' | 'pending' | 'info';

export function Check({ state, title, children }: { state: CheckState; title: ReactNode; children?: ReactNode }) {
  const icon = { ok: 'OK', fail: 'FAIL', pending: 'WAIT', info: 'INFO' }[state];
  return (
    <div className={`check ${state}`}>
      <span className="check-icon">{icon}</span>
      <div>
        <div className="check-title">{title}</div>
        {children && <div className="check-body">{children}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 55% 52%)` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" />
      {label}
    </span>
  );
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Image from the first gateway that serves it; falls back to the next on error. */
export function GatewayImage({ id, gateways, alt, className }: { id: string; gateways: string[]; alt: string; className?: string }) {
  const [index, setIndex] = useState(0);
  if (index >= gateways.length) return <div className={`image-missing ${className ?? ''}`}>Image not served by any gateway yet</div>;
  return <img className={className} src={`${gateways[index]}/${id}`} alt={alt} loading="lazy" onError={() => setIndex(index + 1)} />;
}
