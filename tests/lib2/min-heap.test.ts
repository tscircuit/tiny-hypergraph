import { expect, test } from "bun:test"
import { MinHeap } from "lib2/min-heap"

test("lib2 heap pops items in ascending order", () => {
  const heap = new MinHeap<number>([], (left, right) => left - right)

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

test("lib2 heap clear empties the backing array", () => {
  const heap = new MinHeap<number>([], (left, right) => left - right)

  heap.queue(2)
  heap.queue(1)
  heap.clear()

  expect(heap.length).toBe(0)
  expect(heap.toArray()).toEqual([])
})
