import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type { Candidate } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

type NumericCacheStorage = {
  priorityByIndex: Float64Array
  hopIdByIndex: Float64Array
}

test("heap scalar cache avoids repeated priority reads and bounds retained storage", (): void => {
  const heap = new IndexedCandidateHeap(10)
  let prioritiesRead = 0
  for (let index = 0; index < 2_048; index++) {
    const priority = (index * 611) % 97
    const item: Candidate = {
      portId: index,
      nextRegionId: 1,
      g: index,
      h: 0,
      f: priority,
    }
    Object.defineProperty(item, "f", {
      get: (): number => {
        prioritiesRead++
        return priority
      },
    })
    heap.queue(item)
    Object.freeze(item)
  }
  const storage = heap as unknown as NumericCacheStorage
  const priorities = storage.priorityByIndex
  const hopIds = storage.hopIdByIndex
  expect(priorities.length).toBe(hopIds.length)
  expect(priorities.byteLength + hopIds.byteLength).toBeLessThanOrEqual(
    32 * heap.length,
  )

  const sequence: number[] = []
  while (heap.length > 0) sequence.push(heap.dequeue()!.portId)
  // Exact dequeue sequence from the original 474f522 heap, including ties.
  expect(
    createHash("sha256").update(JSON.stringify(sequence)).digest("hex"),
  ).toBe(
    "f3a7065d8135bed9957ddc72f8a7fecd305bfe6b0fce3c98917f95634ae73ea6",
  )
  expect(prioritiesRead).toBe(2_048)
  heap.clear()
  expect(storage.priorityByIndex).toBe(priorities)
  expect(storage.hopIdByIndex).toBe(hopIds)
  const next: Candidate = { portId: 0, nextRegionId: 0, g: 0, h: 0, f: -1 }
  heap.queue(next)
  expect(heap.dequeue()).toBe(next)
  expect(heap.dequeue()).toBeUndefined()
})
