import type { ChainContext } from '../chains.ts';
import type { Deps } from '../deps.ts';
import { log } from '../log.ts';

/** ANCHORED (soft) becomes SETTLED once the chain's safe head covers the anchor block (ADR-017). */
export async function settleChain(deps: Deps, ctx: ChainContext): Promise<number> {
  const pending = await deps.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM batches WHERE chain_id = ${ctx.config.chainId} AND state = 'ANCHORED' AND block_number IS NOT NULL`;
  if (!pending[0]?.count) return 0;
  const safe = await ctx.publicClient.getBlock({ blockTag: 'safe' });
  const settled = await deps.sql`
    UPDATE batches SET state = 'SETTLED', settled_at = ${deps.now()}, updated_at = now()
    WHERE chain_id = ${ctx.config.chainId} AND state = 'ANCHORED' AND block_number <= ${safe.number.toString()} RETURNING id`;
  if (settled.length > 0) log.info('batches settled', { chainId: ctx.config.chainId, count: settled.length, safeBlock: Number(safe.number) });
  return settled.length;
}
