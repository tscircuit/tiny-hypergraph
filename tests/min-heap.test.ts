import { expect, test } from "bun:test"
import { MinHeap } from "lib/MinHeap"

test("pop returns items in ascending order", () => {
  const heapItems: number[] = []
  const heap = new MinHeap(heapItems, (left, right) => left - right)

  heap.queue(4)
  heap.queue(1)
  heap.queue(3)
  heap.queue(2)

  expect(heap.dequeue()).toBe(1)
  expect(heap.dequeue()).toBe(2)
  expect(heap.dequeue()).toBe(3)
  expect(heap.dequeue()).toBe(4)
  expect(heap.dequeue()).toBeUndefined()
})

test("clear empties the backing array", () => {
  const heapItems: number[] = []
  const heap = new MinHeap(heapItems, (left, right) => left - right)

  heap.queue(3)
  heap.queue(1)

  heap.clear()

  expect(heap.length).toBe(0)
  expect(heapItems).toEqual([])
})
