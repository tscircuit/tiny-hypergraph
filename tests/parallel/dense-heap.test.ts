import { expect, test } from "bun:test"
import { IndexedCandidateHeap } from "../../lib/indexed-candidate-heap"
import { DenseIndexedCandidateHeap } from "../../lib/parallel/DenseIndexedCandidateHeap"
import type { Candidate } from "../../lib/core"

test("dense heap preserves reference order through ties, replacements, closure and clears", () => {
  const index = {
    hopCapacity: 128,
    hopSlotStride: 2,
    firstRegionByPortId: new Int32Array(64),
    secondRegionByPortId: new Int32Array(64).fill(1),
    incidentPortRegion: Array.from({ length: 64 }, () => [0, 1]),
  }
  const plain = new IndexedCandidateHeap(2, index)
  const dense = new DenseIndexedCandidateHeap(2, index)
  let seed = 9127
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  for (let i = 0; i < 10000; i++) {
    const operation = random(10)
    if (operation === 0) {
      const before = dense.closureEpoch
      plain.clear()
      dense.clear()
      expect(dense.closureEpoch).not.toBe(before)
    } else if (operation < 7) {
      const hop = random(128),
        g = random(8),
        h = random(8)
      const candidate: Candidate = {
        hopId: hop,
        portId: hop >> 1,
        nextRegionId: hop % 2,
        g,
        h,
        f: g + h,
      }
      plain.queue({ ...candidate })
      dense.queue({ ...candidate })
    } else expect(dense.dequeue()).toEqual(plain.dequeue())
    if (i % 25 === 0) {
      expect(dense.toArray()).toEqual(plain.toArray())
      expect(dense.length).toBe(plain.length)
      for (let hop = 0; hop < 128; hop++)
        expect(dense.isClosedHop(hop >> 1, hop % 2)).toBe(
          plain.isClosedHopId(hop),
        )
    }
  }
})
