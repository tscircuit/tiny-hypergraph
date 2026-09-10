import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/index"
import { applyInitialAssignments } from "lib/initialAssignments"

// Restore the preloaded assignments after a global rerip.
class RV1106Solver extends SelectiveReripTinyHyperGraphSolver {
  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return
    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}

export function createRV1106Solver() {
  const compressed = readFileSync(
    new URL("./rv1106-full-board.json.gz", import.meta.url),
  )
  const fixture: {
    topology: TinyHyperGraphTopology
    problem: TinyHyperGraphProblem
    options: TinyHyperGraphSolverOptions
  } = JSON.parse(gunzipSync(compressed).toString(), (_key, field) => {
    if (field?.nonFiniteNumber) return Number(field.nonFiniteNumber)
    switch (field?.typedArray) {
      case "Float64Array":
        return new Float64Array(field.elements)
      case "Int32Array":
        return new Int32Array(field.elements)
      case "Int8Array":
        return new Int8Array(field.elements)
      default:
        return field
    }
  })
  return new RV1106Solver(fixture.topology, fixture.problem, fixture.options)
}
