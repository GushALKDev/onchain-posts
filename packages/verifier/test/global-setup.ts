import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Builds the contracts once so the harness can deploy the exact PostAnchor init code. */
export default function setup() {
  execFileSync('forge', ['build'], { cwd: fileURLToPath(new URL('../../../contracts', import.meta.url)), stdio: 'ignore' });
}
