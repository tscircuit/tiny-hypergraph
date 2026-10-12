import { expect, test } from "bun:test"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

const numberValue = (value: number) =>
  Number.isNaN(value) ? "NaN" : Object.is(value, -0) ? "-0" : value

const candidateValue = (candidate?: Candidate): unknown =>
  candidate && [
    candidate.hopId === undefined ? undefined : numberValue(candidate.hopId),
    candidate.prevRegionId,
    candidate.nextRegionId,
    candidate.portId,
    numberValue(candidate.g),
    numberValue(candidate.h),
    numberValue(candidate.f),
    candidateValue(candidate.prevCandidate),
  ]

const heapValue = (heap: IndexedCandidateHeap) => {
  // Inspect private storage without exposing candidates through toArray.
  const state = heap as any
  return {
    items: state.items.map(candidateValue),
    indexes: [...state.indexByHopId],
    closed: [...state.closedHopIds],
    generations: state.hopStateGeneration && [...state.hopStateGeneration],
    indexOrClosed: state.hopIndexOrClosed && [...state.hopIndexOrClosed],
    generation: state.currentHopStateGeneration,
  }
}

test("values upserts preserve legacy heap order and predecessor values", () => {
  for (const compact of [false, true]) {
    const options = compact
      ? {
          hopCapacity: 16,
          hopSlotStride: 2,
          firstRegionByPortId: Int32Array.from({ length: 8 }, () => 0),
          secondRegionByPortId: Int32Array.from({ length: 8 }, () => 1),
          incidentPortRegion: Array.from({ length: 8 }, () => [0, 1]),
        }
      : undefined
    const legacy = new IndexedCandidateHeap(4, options)
    const values = new IndexedCandidateHeap(4, options)
    const retained: { legacy: Candidate; values: Candidate; value: unknown }[] =
      []
    let randomState = 0x71a53539
    const random = () => {
      randomState ^= randomState << 13
      randomState ^= randomState >>> 17
      randomState ^= randomState << 5
      return randomState >>> 0
    }
    const specials = [NaN, -0, 0, -Infinity, Infinity, -3, 1, 7]
    const enqueue = (hopId: number, g: number, h: number, f: number) => {
      const parent =
        retained.length && random() % 4 === 0
          ? retained[random() % retained.length]
          : undefined
      const portId = Math.abs(hopId) % 8
      const prevRegionId = 2
      const nextRegionId = Math.abs(hopId) % 2
      legacy.queue({
        hopId,
        prevRegionId,
        nextRegionId,
        portId,
        g,
        h,
        f,
        prevCandidate: parent?.legacy,
      })
      values.queueValues(
        hopId,
        prevRegionId,
        nextRegionId,
        portId,
        g,
        h,
        f,
        parent?.values,
      )
    }
    const dequeue = () => {
      const old = legacy.dequeue()
      const current = values.dequeue()
      expect(candidateValue(current)).toEqual(candidateValue(old))
      if (old && current)
        retained.push({
          legacy: old,
          values: current,
          value: candidateValue(old),
        })
    }

    // Exercise equal priorities, both sift directions and unordered values.
    enqueue(0, 10, 0, 10)
    enqueue(1, 8, 0, 10)
    enqueue(2, 7, 0, -0)
    enqueue(0, 3, 0, 20)
    enqueue(1, NaN, 0, NaN)
    enqueue(-1, 5, NaN, 0)
    enqueue(-1, -0, 0, -0)
    enqueue(0, -3, 0, 10)
    enqueue(-0, -5, 0, 10)
    expect(heapValue(values)).toEqual(heapValue(legacy))

    for (let operation = 0; operation < 2500; operation++) {
      const kind = random() % 12
      if (kind < 8) {
        const hopId = (random() % 20) - 4
        const numeric = () =>
          random() % 3 === 0
            ? specials[random() % specials.length]
            : (random() % 40) - 20
        enqueue(hopId, numeric(), numeric(), numeric())
      } else if (kind < 11) dequeue()
      else {
        if (operation % 3 === 0) {
          ;(legacy as any).currentHopStateGeneration = 0xffffffff
          ;(values as any).currentHopStateGeneration = 0xffffffff
        }
        legacy.clear()
        values.clear()
      }
      expect(heapValue(values)).toEqual(heapValue(legacy))
    }
    while (legacy.length) dequeue()
    for (const entry of retained) {
      expect(candidateValue(entry.legacy)).toEqual(entry.value)
      expect(candidateValue(entry.values)).toEqual(entry.value)
    }
  }
})
