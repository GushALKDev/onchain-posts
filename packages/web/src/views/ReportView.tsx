import { formatReport, type ChainResult, type VerificationReport } from '@onchain-posts/verifier';
import { Check, ChainPill, type CheckState } from '../components.tsx';
import { dateTime } from '../format.ts';

const VERDICT: Record<ChainResult['verdict'], { state: CheckState; text: string }> = {
  anchored: { state: 'ok', text: 'anchored by a trusted relayer, proof accepted by PostAnchor' },
  pending: { state: 'pending', text: 'not anchored yet, still inside the receipt deadline' },
  'deadline-passed-not-scanned': { state: 'info', text: 'deadline passed and not found in the hints; run a scan to decide' },
  omitted: { state: 'fail', text: 'OMITTED: a complete scan of the trusted batches in the window did not find the post' },
  'not-found': { state: 'info', text: 'not found in the scanned range' },
};

const BANNER = {
  verified: { cls: 'ok', title: 'Verified', text: 'Every check passed against public sources: Arweave gateways, public RPCs and the trust root.' },
  pending: { cls: 'pending', title: 'Pending', text: 'Nothing failed, but the content is not served by any gateway yet or no chain is anchored yet. Retry in a moment.' },
  failed: { cls: 'fail', title: 'Not verified', text: 'At least one check failed; see below.' },
};

/** A verification report as a checklist: what was checked, against what, and the result. */
export function ReportView({ report }: { report: VerificationReport }) {
  const banner = BANNER[report.status];
  const c = report.content;
  return (
    <div className="report">
      <div className={`banner ${banner.cls}`}>
        <strong>{banner.title}</strong>
        <span>{banner.text}</span>
      </div>
      <h3>Content on Arweave</h3>
      <Check state={c.valid ? 'ok' : c.available ? 'fail' : 'pending'} title={c.valid ? 'Post JSON fetched from a gateway and its fields hash to the postHash' : c.available ? 'Content does not match the postHash' : 'Not served by any gateway yet'}>
        {c.postArweaveId && <div className="mono small">post JSON {c.postArweaveId}{c.imageArweaveId ? `, image ${c.imageArweaveId}` : ''}</div>}
        {c.errors.map((e) => <div key={e} className="error small">{e}</div>)}
        {c.warnings.map((w) => <div key={w} className="muted small">warning: {w}</div>)}
      </Check>
      <h3>Receipt</h3>
      {report.receipt.present ? (
        <Check state={report.receipt.valid ? 'ok' : 'fail'} title={report.receipt.valid ? 'Signed by a trusted receipt key ("Onchain Receipts" EIP-712 domain)' : 'Receipt not valid: its deadlines are ignored'}>
          <div className="mono small">signer {report.receipt.signer}{report.receipt.acceptedAt ? `, accepted ${dateTime(report.receipt.acceptedAt)}` : ''}</div>
          {report.receipt.errors.map((e) => <div key={e} className="error small">{e}</div>)}
        </Check>
      ) : (
        <Check state="info" title="No receipt in the hints: no per-chain deadline to judge against" />
      )}
      <h3>Chains</h3>
      {report.chains.length === 0 && <Check state="info" title="No chain to report" />}
      {report.chains.map((chain) => (
        <Check key={chain.chainId} state={VERDICT[chain.verdict].state} title={<><ChainPill chainId={chain.chainId} /> {VERDICT[chain.verdict].text}{chain.late ? ' (late: after the receipt deadline)' : ''}</>}>
          {chain.anchor && <div className="mono small">root {chain.anchor.root} at {dateTime(chain.anchor.anchoredAt)}, found via {chain.anchor.source}</div>}
          {chain.notes.map((n) => <div key={n} className="muted small">{n}</div>)}
        </Check>
      ))}
      {report.authorship && (
        <>
          <h3>Authorship</h3>
          <Check state={report.authorship.proven ? 'ok' : 'fail'} title={report.authorship.proven ? 'The revealed signature matches the sigCommit in the anchored leaf' : 'Authorship not proven'}>
            {report.authorship.signer && <div className="mono small">signed by {report.authorship.signer} (visible only because you revealed the signature)</div>}
            {report.authorship.errors.map((e) => <div key={e} className="error small">{e}</div>)}
          </Check>
        </>
      )}
      {report.notes.length > 0 && <ul className="notes">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <details>
        <summary>Raw report (same text as the CLI)</summary>
        <pre>{formatReport(report)}</pre>
      </details>
    </div>
  );
}
