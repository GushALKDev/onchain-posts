#!/usr/bin/env node
// onchain-posts-verify: verifies a post from public sources only. Run it from the public repository at a pinned commit, or
// with a trusted-keys file you supply, for verification that does not depend on the platform (README section 9).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CHAIN_IDS, TrustedKeysFileSchema } from '@onchain-posts/core';
import { DEFAULT_GATEWAYS, createPublicSources } from './sources.ts';
import { formatReport } from './format.ts';
import { verifyPublishedPost } from './verify.ts';

const DEFAULT_RPCS: Record<number, string> = {
  [CHAIN_IDS.ethereumSepolia]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [CHAIN_IDS.baseSepolia]: 'https://sepolia.base.org',
  [CHAIN_IDS.arbitrumSepolia]: 'https://sepolia-rollup.arbitrum.io/rpc',
};
const DEFAULT_TRUSTED_KEYS = new URL('../../../config/trusted-keys.json', import.meta.url);

const USAGE = `Usage: onchain-posts-verify <postHash> [options]

  --hints <file>          proof bundle (public or private copy); untrusted, re-checked
  --hints-url <url>       fetch hints from GET /proof/:postHash; untrusted, re-checked
  --trusted-keys <file>   trust root (default: config/trusted-keys.json of this repository)
  --rpc <chainId>=<url>   RPC per chain, repeatable (default: public testnet RPCs)
  --gateway <url>         Arweave gateway, repeatable, tried in order (default: ${DEFAULT_GATEWAYS.join(', ')})
  --scan                  scan BatchAnchored events: discovery and the bounded scan behind "omitted"
  --since <time>          start of the discovery window without a receipt (unix seconds or ISO 8601)
  --json                  print the report as JSON

Exit codes: 0 verified, 1 not verified, 2 usage error, 3 pending (content or anchors not available yet).`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      hints: { type: 'string' },
      'hints-url': { type: 'string' },
      'trusted-keys': { type: 'string' },
      rpc: { type: 'string', multiple: true },
      gateway: { type: 'string', multiple: true },
      scan: { type: 'boolean' },
      since: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const postHash = positionals[0];
  if (values.help || !postHash || !/^0x[0-9a-fA-F]{64}$/.test(postHash)) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }

  const trustedKeys = TrustedKeysFileSchema.parse(JSON.parse(readFileSync(values['trusted-keys'] ?? DEFAULT_TRUSTED_KEYS, 'utf8'))).keys;
  const rpcUrls = { ...DEFAULT_RPCS };
  for (const entry of values.rpc ?? []) {
    const [chainId, url] = entry.split(/=(.*)/s);
    if (!chainId || !url) throw new Error(`--rpc expects <chainId>=<url>, got ${entry}`);
    rpcUrls[Number(chainId)] = url;
  }
  let hints: unknown;
  if (values.hints) hints = JSON.parse(readFileSync(values.hints, 'utf8'));
  else if (values['hints-url']) hints = await (await fetch(values['hints-url'])).json();
  const since = values.since === undefined ? undefined : /^\d+$/.test(values.since) ? Number(values.since) : Math.floor(Date.parse(values.since) / 1000);

  const report = await verifyPublishedPost(
    postHash as `0x${string}`,
    { hints, scan: values.scan ?? false, since },
    { sources: createPublicSources({ rpcUrls, gateway: values.gateway?.length ? values.gateway : DEFAULT_GATEWAYS }), trustedKeys },
  );
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  // 0 verified, 1 not verified, 3 pending (retry later).
  process.exitCode = report.status === 'verified' ? 0 : report.status === 'pending' ? 3 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
