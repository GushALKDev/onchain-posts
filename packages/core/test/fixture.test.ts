import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMerkleFixture, FIXTURE_PATH, serialize } from './fixture-data.ts';

describe('Solidity fixture', () => {
  it('the committed fixture matches what the code produces (run `pnpm fixtures` after changing the leaf or tree code)', async () => {
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(serialize(await buildMerkleFixture()));
  });
});
