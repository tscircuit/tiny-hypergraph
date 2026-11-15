import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

type TaggedCandidate = Candidate & { serial: number }
type HopGenerationState = {
  currentHopStateGeneration: number
  hopStateGeneration?: Uint32Array
}

// Observable heap state from the original 474f522 implementation: identities,
// array/dequeue order, resolved hop ids, closure, and generation-scoped clears.
const originalDigest = {
  map: "8b35d469f19bea4360b85701fb4414a5572cf977fb3c41dd696952fb9d272bb3",
  compact: "2e21afbb0008da8a1a2220d0d67d744c004e713a26d6a3cf96466d95ed5a7072",
}

test("queued scalar caches preserve original directed-hop heap results", (): void => {
  const priorities = [-Infinity, -1, -0, 0, 1, 1, 2, Infinity, NaN]
  const compact = {
    hopCapacity: 48,
    hopSlotStride: 3,
    firstRegionByPortId: Int32Array.from(
      { length: 16 },
      (_, index): number => index,
    ),
    secondRegionByPortId: Int32Array.from(
      { length: 16 },
      (_, index): number => index + 20,
    ),
    incidentPortRegion: Array.from({ length: 16 }, (_, index): number[] => [
      index,
      index + 20,
      index + 40,
    ]),
  }
  for (const mode of ["map", "compact"] as const) {
    const heap = new IndexedCandidateHeap(
      100,
      mode === "compact" ? compact : undefined,
    )
    const digest = createHash("sha256")
    const issued = new Map<number, TaggedCandidate>()
    let serial = 0
    const observe = (values: unknown[]): void => {
      digest.update(
        JSON.stringify(values, (_key: string, value: unknown): unknown => {
          if (typeof value !== "number") return value
          if (Object.is(value, -0)) return "-0"
          if (Number.isNaN(value)) return "NaN"
          if (value === Infinity) return "+Infinity"
          if (value === -Infinity) return "-Infinity"
          return value
        }),
      )
      digest.update("\n")
    }
    const snapshot = (): void => {
      const array = heap.toArray()
      observe([
        "heap",
        heap.length,
        array.map((item): number => (item as TaggedCandidate).serial),
      ])
      array.pop()
      expect(heap.length).toBe(heap.toArray().length)
    }
    const queue = (params: Omit<TaggedCandidate, "serial">): void => {
      const item: TaggedCandidate = { ...params, serial: serial++ }
      issued.set(item.serial, item)
      heap.queue(item)
      observe(["queue", item.serial, item.hopId, heap.length])
      // queue() initializes hopId before the queued scalars become immutable.
      Object.freeze(item)
    }
    const dequeue = (): void => {
      const item = heap.dequeue() as TaggedCandidate | undefined
      if (item) expect(item).toBe(issued.get(item.serial)!)
      observe([
        "dequeue",
        item?.serial,
        item?.hopId,
        item?.f,
        heap.length,
        item?.hopId === undefined ? undefined : heap.isClosedHopId(item.hopId),
      ])
    }

    // Equal-priority ties, large negative hop ids, and repeated capacity growth.
    for (let index = 0; index < 10_000; index++) {
      queue({
        hopId: -(Number.MAX_SAFE_INTEGER - index),
        portId: index,
        nextRegionId: 1,
        g: 10,
        h: 0,
        f: 1,
      })
    }
    snapshot()
    for (let index = 0; index < 10_000; index++) dequeue()
    snapshot()
    heap.clear()
    const region = mode === "compact" ? 1 : 2
    queue({ portId: 1, nextRegionId: region, g: 10, h: 0, f: 10 })
    queue({ portId: 2, nextRegionId: region + 1, g: 10, h: 0, f: 11 })
    queue({ portId: 1, nextRegionId: region, g: 5, h: 0, f: 20 })
    snapshot()
    queue({ portId: 1, nextRegionId: region, g: 2, h: 0, f: -1 })
    snapshot()
    queue({ portId: 1, nextRegionId: region, g: 3, h: 0, f: -100 })
    snapshot()
    while (heap.length > 0) dequeue()

    let randomState = mode === "compact" ? 0x83ab921c : 0x745da019
    const random = (): number => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      return randomState
    }
    for (let index = 0; index < 30_000; index++) {
      const operation = random() % 100
      if (operation < 72) {
        const portId = random() % 16
        const regionChoice = random() % 4
        const nextRegionId =
          regionChoice === 3 ? 99 : portId + regionChoice * 20
        const explicit = random() % 20
        const hopId =
          explicit === 0
            ? Number.MAX_SAFE_INTEGER - portId
            : explicit === 1
              ? -(2 ** 40 + portId)
              : undefined
        queue({
          portId,
          nextRegionId,
          ...(hopId === undefined ? {} : { hopId }),
          g: random() % 100,
          h: 0,
          f: priorities[random() % priorities.length]!,
        })
      } else if (operation < 98) {
        dequeue()
      } else {
        heap.clear()
        observe(["clear", heap.length])
      }
      if (index % 31 === 0) snapshot()
    }
    snapshot()
    while (heap.length > 0) dequeue()

    if (mode === "compact") {
      const state = heap as unknown as HopGenerationState
      state.currentHopStateGeneration = 0xffffffff
      state.hopStateGeneration!.fill(0xffffffff)
      heap.clear()
      expect(state.currentHopStateGeneration).toBe(1)
      expect(
        state.hopStateGeneration!.every(
          (generation): boolean => generation === 0,
        ),
      ).toBe(true)
      for (let index = 0; index < 16; index++) {
        queue({
          portId: index,
          nextRegionId: index,
          g: 1,
          h: 0,
          f: index % 3,
        })
      }
      snapshot()
      while (heap.length > 0) dequeue()
    }
    heap.clear()
    queue({ portId: 0, nextRegionId: 0, g: 0, h: 0, f: -0 })
    dequeue()
    dequeue()
    expect(digest.digest("hex")).toBe(originalDigest[mode])
  }
})
