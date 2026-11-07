// Writes test/fixtures/merkle-fixture.json, consumed by contracts/test/CoreFixture.t.sol.
// Usage: node scripts/generate-fixtures.ts   (Node 22.18+ or 23.6+ runs TypeScript directly)
import { writeFileSync } from 'node:fs';
import { buildMerkleFixture, FIXTURE_PATH, serialize } from '../test/fixture-data.ts';

writeFileSync(FIXTURE_PATH, serialize(await buildMerkleFixture()));
console.log(`wrote ${FIXTURE_PATH.pathname}`);
