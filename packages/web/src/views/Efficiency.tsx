import cost from '../../../bench/results/2026-11-07-cost-snapshot.json';
import gas from '../../../bench/results/2026-11-07-gas-local-prague.json';

const SIZES = ['1', '10', '100', '1000'] as const;
const ROWS = [
  ['B1', 'one transaction per post'],
  ['B2', 'hash list per batch'],
  ['ours', 'Merkle root + one storage slot'],
] as const;

type Variant = { byBatchSize: Record<string, { gasPerPost: number }> };

/** Benchmark summary; the live demo is not the efficiency proof (small batches, demo mode), the benchmark is. */
export function Efficiency() {
  const variants = gas.variants as unknown as Record<string, Variant>;
  return (
    <section className="card">
      <h2>Efficiency</h2>
      <p>Measured on {gas.date} with real transactions under Ethereum mainnet rules; USD from a mainnet price snapshot of {cost.date}. Details and method: docs/efficiency.md in the repository.</p>
      <h3>Gas per post</h3>
      <table>
        <thead>
          <tr><th>Variant</th>{SIZES.map((n) => <th key={n}>N = {n}</th>)}</tr>
        </thead>
        <tbody>
          {ROWS.map(([key, label]) => (
            <tr key={key}>
              <td>{key} <span className="hint">({label})</span></td>
              {SIZES.map((n) => <td key={n}>{variants[key]?.byBatchSize[n]?.gasPerPost.toLocaleString('en-US')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>End-to-end USD per post with a 95 KiB image, all three chains</h3>
      <table>
        <thead>
          <tr>{SIZES.map((n) => <th key={n}>N = {n}</th>)}</tr>
        </thead>
        <tbody>
          <tr>{SIZES.map((n) => <td key={n}>{cost.endToEnd[n].allThreeChains.toFixed(4)}</td>)}</tr>
        </tbody>
      </table>
      <p className="hint">From N = 100 on, the image storage (USD {cost.storage.imageUsd.toFixed(4)} at list price) is 96% or more of the cost. This live demo runs small batches, often in demo mode: it is not the efficiency configuration.</p>
    </section>
  );
}
