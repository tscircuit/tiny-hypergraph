import { expect, test } from "bun:test"
import { PortDistanceQueue } from "../lib/PortDistanceQueue"

test("port distances decrease in place and can be queued again after removal", () => {
  const queue = new PortDistanceQueue(128)
  const pending = new Map<number, number>()
  let randomState = 42
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 0x100000000
  }

  expect(queue.dequeue()).toBeUndefined()
  for (let round = 0; round < 8; round++) {
    for (let index = 0; index < 512; index++) {
      const portId = Math.floor(random() * 128)
      const cost = Math.floor(random() * 256) / 16
      queue.queue(portId, cost)
      pending.set(portId, Math.min(cost, pending.get(portId) ?? Infinity))
      expect(queue.length).toBe(pending.size)
      if (index % 3 !== 0) continue
      const expectedCost = Math.min(...pending.values())
      const next = queue.dequeue()!
      expect(pending.get(next)).toBe(expectedCost)
      pending.delete(next)
    }
    while (pending.size > 0) {
      const expectedCost = Math.min(...pending.values())
      const next = queue.dequeue()!
      expect(pending.get(next)).toBe(expectedCost)
      pending.delete(next)
      expect(queue.length).toBe(pending.size)
    }
    expect(queue.dequeue()).toBeUndefined()
  }

  queue.queue(0, Infinity)
  queue.queue(1, Infinity)
  queue.queue(1, 0)
  expect(queue.dequeue()).toBe(1)
  expect(queue.dequeue()).toBe(0)
  expect(queue.length).toBe(0)
})
