import { expect, it } from 'vitest';
import { normalize } from '../server/search.ts';

it('normalizes hub vectors and rejects vectors that cannot support cosine similarity', () => {
  expect(normalize([3, 4])).toEqual([0.6, 0.8]);
  for (const vector of [[], [0, 0], [NaN], [Infinity], Array(32769).fill(1)]) expect(() => normalize(vector)).toThrow();
});
