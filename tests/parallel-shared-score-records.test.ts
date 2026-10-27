import { expect, test } from "bun:test"
import {
  publishTransitionScore,
  readTransitionScore,
  type SharedTransitionScores,
} from "../lib/parallel/SharedTransitionScores"

test("shared score publication keeps old records immutable and honors versions and capacity", () => {
  const data: SharedTransitionScores = {
    offsets: new Int32Array(0),
    positions: new Int32Array(0),
    heads: new Int32Array(new SharedArrayBuffer(4)).fill(-1),
    versions: new Int32Array(new SharedArrayBuffer(8)),
    values: new Float64Array(new SharedArrayBuffer(16)),
    owners: new Int8Array(new SharedArrayBuffer(2)),
    next: new Int32Array(new SharedArrayBuffer(4)),
  }
  expect(readTransitionScore(data, 0, 2)).toBeNaN()
  publishTransitionScore(data, 0, 2, 0.125)
  const first = Atomics.load(data.heads, 0)
  publishTransitionScore(data, 0, 4, 0.375)
  expect(readTransitionScore(data, 0, 4)).toBe(0.375)
  expect(data.values[first]).toBe(0.125)
  expect(readTransitionScore(data, 0, 2)).toBeNaN()
  publishTransitionScore(data, 0, 2, 900)
  expect(readTransitionScore(data, 0, 4)).toBe(0.375)
  publishTransitionScore(data, 0, 6, 0.625)
  expect(readTransitionScore(data, 0, 6)).toBeNaN()
  expect(Atomics.load(data.next, 0)).toBe(2)
})
