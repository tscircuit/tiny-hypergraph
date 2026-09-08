import type { PortId } from "./types"

/** Decrease-key heap: each unsettled port has one reverse-search priority. */
export class PortDistanceQueue {
  private readonly ports: PortId[] = []
  private readonly priorities: number[] = []
  private readonly positions: Int32Array

  constructor(portCount: number) {
    this.positions = new Int32Array(portCount).fill(-1)
  }

  get length(): number {
    return this.ports.length
  }

  queue(portId: PortId, cost: number): void {
    let index = this.positions[portId]!
    if (index < 0) {
      index = this.ports.length
      this.ports.push(portId)
      this.priorities.push(cost)
    } else if (cost >= this.priorities[index]!) {
      return
    }
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parentCost = this.priorities[parentIndex]!
      if (parentCost <= cost) break
      const parentPort = this.ports[parentIndex]!
      this.ports[index] = parentPort
      this.priorities[index] = parentCost
      this.positions[parentPort] = index
      index = parentIndex
    }
    this.ports[index] = portId
    this.priorities[index] = cost
    this.positions[portId] = index
  }

  dequeue(): PortId | undefined {
    if (this.ports.length === 0) return undefined
    const portId = this.ports[0]!
    const lastPortId = this.ports.pop()!
    const lastCost = this.priorities.pop()!
    this.positions[portId] = -1
    const length = this.ports.length
    if (length > 0) {
      let index = 0
      while (true) {
        let child = index * 2 + 1
        if (child >= length) break
        if (
          child + 1 < length &&
          this.priorities[child + 1]! < this.priorities[child]!
        ) {
          child++
        }
        const childCost = this.priorities[child]!
        if (lastCost <= childCost) break
        const childPortId = this.ports[child]!
        this.ports[index] = childPortId
        this.priorities[index] = childCost
        this.positions[childPortId] = index
        index = child
      }
      this.ports[index] = lastPortId
      this.priorities[index] = lastCost
      this.positions[lastPortId] = index
    }
    return portId
  }
}
