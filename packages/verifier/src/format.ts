import type { VerificationReport } from './verify.ts';

const VERDICT_TEXT: Record<string, string> = {
  anchored: 'anchored',
  pending: 'pending, inside deadline',
  'deadline-passed-not-scanned': 'deadline passed, not found in hints (not scanned)',
  omitted: 'OMITTED (bounded scan completed, post absent)',
  'not-found': 'not found',
};

const iso = (t?: number) => (t === undefined ? '-' : new Date(t * 1000).toISOString());

/** Human-readable report for the CLI. */
export function formatReport(r: VerificationReport): string {
  const lines = [`Post ${r.postHash}`, `Result: ${r.ok ? 'VERIFIED' : 'NOT VERIFIED'} (checked ${iso(r.checkedAt)})`, ''];
  lines.push(`Content: ${r.content.valid ? 'valid' : 'INVALID'}${r.content.username ? ` (@${r.content.username}, created ${iso(r.content.createdAt)})` : ''}`);
  if (r.content.postArweaveId) lines.push(`  post JSON ${r.content.postArweaveId}${r.content.imageArweaveId ? `, image ${r.content.imageArweaveId}` : ''}`);
  for (const e of r.content.errors) lines.push(`  error: ${e}`);
  for (const w of r.content.warnings) lines.push(`  warning: ${w}`);

  lines.push(`Receipt: ${!r.receipt.present ? 'none' : r.receipt.valid ? `valid, signed by ${r.receipt.signer}, accepted ${iso(r.receipt.acceptedAt)}` : 'INVALID'}`);
  for (const e of r.receipt.errors) lines.push(`  error: ${e}`);

  lines.push('Chains:');
  for (const c of r.chains) {
    const late = c.late ? ' (LATE: after anchorBy)' : '';
    lines.push(`  ${c.chainId}: ${VERDICT_TEXT[c.verdict]}${late}${c.anchorBy ? `, anchorBy ${iso(c.anchorBy)}` : ''}`);
    if (c.anchor) lines.push(`    root ${c.anchor.root} by ${c.anchor.sender} at ${iso(c.anchor.anchoredAt)} (found via ${c.anchor.source})`);
    for (const n of c.notes) lines.push(`    ${n}`);
  }
  if (r.chains.length === 0) lines.push('  none');

  if (r.authorship) {
    lines.push(`Authorship: ${r.authorship.proven ? `proven, signed by ${r.authorship.signer}` : 'NOT PROVEN'}`);
    for (const e of r.authorship.errors) lines.push(`  error: ${e}`);
  }
  for (const n of r.notes) lines.push(`Note: ${n}`);
  return lines.join('\n');
}
