import { expect, test } from "bun:test"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { ReferenceSelectiveBlockerSolver } from "./fixtures/referenceSelectiveBlockerSolver"

class ExposedBlockerSolver extends SelectiveReripTinyHyperGraphSolver {
  search(forbidden: ReadonlySet<number>): unknown {
    return this.findRelaxedBlockerPath(forbidden)
  }
}

test("regional blocker origins preserve live-reference paths and expansion counts", () => {
  for (const singleLayer of [false, true]) {
    for (let variant = 0; variant < 12; variant++) {
      const regionCount = 8
      const boundaryWidth = 6
      const portCount = (regionCount - 1) * boundaryWidth + 2
      const goal = portCount - 1
      const regionIncidentPorts = Array.from(
        { length: regionCount },
        () => [] as number[],
      )
      const incidentPortRegion: number[][] = [[0]]
      regionIncidentPorts[0].push(0)
      for (let port = 1; port < goal; port++) {
        const left = Math.floor((port - 1) / boundaryWidth)
        incidentPortRegion[port] = [left, left + 1]
        regionIncidentPorts[left].push(port)
        regionIncidentPorts[left + 1].push(port)
      }
      incidentPortRegion[goal] = [regionCount - 1]
      regionIncidentPorts[regionCount - 1].push(goal)
      const topology: TinyHyperGraphTopology = {
        portCount,
        regionCount,
        regionIncidentPorts,
        incidentPortRegion,
        regionWidth: new Float64Array(regionCount).fill(10),
        regionHeight: new Float64Array(regionCount).fill(10),
        regionCenterX: new Float64Array(regionCount),
        regionCenterY: new Float64Array(regionCount),
        regionAvailableZMask: new Int32Array(regionCount).fill(
          singleLayer ? 1 : 3,
        ),
        portAngleForRegion1: Int32Array.from(
          { length: portCount },
          (_, i) => (i * 317) % 36000,
        ),
        portAngleForRegion2: Int32Array.from(
          { length: portCount },
          (_, i) => (i * 317 + 18000) % 36000,
        ),
        portX: Float64Array.from({ length: portCount }, (_, i) =>
          i === 0
            ? 0
            : i === goal
              ? 80
              : (Math.floor((i - 1) / boundaryWidth) + 1) * 10,
        ),
        portY: Float64Array.from(
          { length: portCount },
          (_, i) => ((i * 7 + variant) % boundaryWidth) * 0.73,
        ),
        portZ: new Int32Array(portCount),
      }
      const problem: TinyHyperGraphProblem = {
        routeCount: 4,
        portSectionMask: new Int8Array(portCount).fill(1),
        routeStartPort: Int32Array.from([0, 7, 19, 31]),
        routeEndPort: Int32Array.from([goal, 8, 20, 32]),
        routeNet: Int32Array.from([1, 2, 3, 4]),
        regionNetId: new Int32Array(regionCount).fill(-1),
      }
      const prepare = <T extends SelectiveReripTinyHyperGraphSolver>(
        solver: T,
      ): T => {
        solver._setup()
        solver.state.currentRouteId = 0
        solver.state.currentRouteNetId = 1
        solver.state.goalPortId = goal
        for (let port = 1; port < goal; port++) {
          const boundary = Math.floor((port - 1) / boundaryWidth)
          if (boundary % 2 === 0) continue
          const owner = 1 + Math.floor(boundary / 2)
          solver.state.portAssignment[port] = problem.routeNet[owner]
          solver.state.regionSegments[boundary].push([owner, port, port])
        }
        return solver
      }
      const original = prepare(
        new ReferenceSelectiveBlockerSolver(topology, problem),
      )
      const optimized = prepare(new ExposedBlockerSolver(topology, problem))
      for (const forbidden of [
        new Set<number>(),
        new Set([1]),
        new Set([2, 3]),
      ]) {
        expect(optimized.search(forbidden)).toEqual(
          original.findRelaxedBlockerPath(forbidden),
        )
      }
    }
  }
})
