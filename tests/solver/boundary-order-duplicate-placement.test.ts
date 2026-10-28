import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../../lib/DuplicateCongestedPortSolver"

class InspectableDuplicateSolver extends DuplicateCongestedPortSolver {
  duplicate(count = 3) { return this.duplicateCongestedPorts(new Map([["source", count]])) }
}

const fixture = (flag?: boolean): SerializedHyperGraph => ({
  regions: [
    { regionId: "left", pointIds: ["source"], d: { center: { x: -0.1125, y: 0.0795 }, width: 0.225, height: 0.324, ...(flag === undefined ? {} : { boundaryPortOrderPreserved: flag }) } },
    { regionId: "right", pointIds: ["source"], d: { center: { x: 0.0825, y: 0 }, width: 0.165, height: 0.165 } },
  ],
  ports: [{ portId: "source", region1Id: "left", region2Id: "right", d: { x: 0, y: 0, z: 0, allowedNetId: "inactive-owner" } }],
  connections: [],
})

test("certified duplicate ports follow the actual T-junction edge and remain strictly inside its bounded interval", () => {
  const input = fixture(true)
  const before = JSON.stringify(input)
  const solver = new InspectableDuplicateSolver(input, { duplicatePortProximity: 10 })
  const output = solver.duplicate(5)
  expect(output.ports.map((port) => port.portId)).toEqual(["source", "source::dup1", "source::dup2", "source::dup3", "source::dup4"])
  for (const port of output.ports.slice(1)) {
    expect(port.d!.x).toBe(0)
    expect(port.d!.y).toBeGreaterThan(-0.0825)
    expect(port.d!.y).toBeLessThan(0.0825)
    expect(port.d!.allowedNetId).toBe("inactive-owner")
  }
  expect(JSON.stringify(input)).toBe(before)
  expect(output.regions[0].d!.boundaryPortOrderPreserved).toBe(true)
  // A source at the common-edge endpoint has a legal one-sided inward interval.
  for (const y of [-0.0825, -0.0825 + 1e-12, 0.0825 - 1e-12, 0.0825]) {
    const nearCorner = fixture(true)
    nearCorner.ports[0].d!.y = y
    const duplicates = new InspectableDuplicateSolver(nearCorner, { duplicatePortProximity: 10 }).duplicate().ports.slice(1)
    for (const port of duplicates) {
      expect(port.d!.x).toBe(0)
      expect(port.d!.y).toBeGreaterThan(-0.0825)
      expect(port.d!.y).toBeLessThan(0.0825)
    }
  }
  const absent = new InspectableDuplicateSolver(fixture()).duplicate()
  const disabled = new InspectableDuplicateSolver(fixture(false)).duplicate()
  expect(absent.ports).toEqual(disabled.ports)
  expect(absent.ports[1].d!.x).not.toBe(0) // Legacy center-normal fallback is unchanged.
  const bad = fixture(true)
  bad.ports[0].d!.x = 0.01
  expect(() => new InspectableDuplicateSolver(bad).duplicate()).toThrow("proven common rectangle edge")
  for (const [x, width] of [[-0.1125, 0.225], [-0.0625, 0.125]]) {
    const overlap = fixture(true)
    overlap.regions[1].d!.center = { x, y: 0.0795 }
    overlap.regions[1].d!.width = width
    overlap.regions[1].d!.height = 0.324
    overlap.ports[0].d!.x = -0.225 // Matching same-side faces do not prove adjacency.
    expect(() => new InspectableDuplicateSolver(overlap).duplicate()).toThrow("proven common rectangle edge")
  }
  const conflicting = fixture(true)
  conflicting.regions[0].d!.bounds = { minX: -1, maxX: 0, minY: -1, maxY: 1 }
  expect(() => new InspectableDuplicateSolver(conflicting).duplicate()).toThrow("proven common rectangle edge")
  const missing = fixture(true)
  delete missing.regions[1].d!.width
  expect(() => new InspectableDuplicateSolver(missing).duplicate()).toThrow("proven common rectangle edge")
})
