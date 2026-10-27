import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

test("region reachability retains an exit unlocked by a second incoming port", () => {
  class Observe extends SelectiveReripTinyHyperGraphSolver {
    search() {
      this.state.currentRouteId = 0
      this.state.currentRouteNetId = 7
      return this.findRelaxedBlockerPath()
    }
  }
  const solver = new Observe(
    {
      portCount: 4,
      regionCount: 3,
      regionIncidentPorts: [
        [0, 2, 3],
        [0, 1],
        [2, 3],
      ],
      incidentPortRegion: [[0, 1], [1], [0, 2], [0, 2]],
      regionWidth: new Float64Array(3).fill(10),
      regionHeight: new Float64Array(3).fill(10),
      regionCenterX: new Float64Array(3),
      regionCenterY: new Float64Array(3),
      portX: Float64Array.from([0, -1, 1, 1]),
      portY: Float64Array.from([0, 0, 1, -1]),
      portZ: new Int32Array(4),
      portAngleForRegion1: Int32Array.from([0, 18000, 9000, 27000]),
      portAngleForRegion2: new Int32Array(4),
    },
    {
      routeCount: 1,
      routeStartPort: Int32Array.of(0),
      routeEndPort: Int32Array.of(1),
      routeNet: Int32Array.of(7),
      regionNetId: new Int32Array(3).fill(-1),
      portSectionMask: new Int8Array(4).fill(1),
    },
    { STATIC_REACHABILITY_PRECHECK: false, VERBOSE: false },
  )
  solver.useCompiledOwnerSearch = true
  const result = solver.search()
  expect(result.found).toBe(true)
  if (!result.found)
    throw new Error("Expected a path through the second region entry")
  expect(result.states.map((state) => state.portId)).toEqual([0, 2, 3, 0, 1])
  expect(result.owners.size).toBe(0)
})
