import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../../lib/DuplicateCongestedPortSolver"

class BoundaryDuplicationSolver extends DuplicateCongestedPortSolver {
  duplicateBoundary(): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map([["shared", 2]]))
  }
}

test("an isolated boundary duplicates on the same side regardless of region order", (): void => {
  for (const horizontal of [false, true]) {
    const graph: SerializedHyperGraph = {
      regions: [-1, 1].map((offset, index) => ({
        regionId: String(index),
        pointIds: ["shared"],
        d: {
          center: horizontal ? { x: 0, y: offset } : { x: offset, y: 0 },
          width: 2,
          height: 2,
        },
      })),
      ports: [{
        portId: "shared",
        region1Id: "0",
        region2Id: "1",
        d: { x: 0, y: 0, z: 0 },
      }],
      connections: [],
    }
    const original = structuredClone(graph)
    const forward = new BoundaryDuplicationSolver(graph).duplicateBoundary()
    const reversed = structuredClone(graph)
    reversed.ports[0]!.region1Id = "1"
    reversed.ports[0]!.region2Id = "0"
    const backward = new BoundaryDuplicationSolver(reversed).duplicateBoundary()
    const forwardCopy = forward.ports.find((port) => port.d?.duplicatedFromPortId)
    const backwardCopy = backward.ports.find((port) => port.d?.duplicatedFromPortId)
    expect(backwardCopy?.d?.x).toBe(forwardCopy?.d?.x)
    expect(backwardCopy?.d?.y).toBe(forwardCopy?.d?.y)
    expect(forwardCopy?.d?.[horizontal ? "x" : "y"]).toBeGreaterThan(0)
    expect(forwardCopy?.d?.[horizontal ? "y" : "x"]).toBe(0)
    expect(graph).toEqual(original)
  }
})
