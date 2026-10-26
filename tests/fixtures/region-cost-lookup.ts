import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/core"

export const createRegionCostProbeGraph = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => ({
  topology: {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([3]),
    regionHeight: new Float64Array([7]),
    regionCenterX: new Float64Array(1),
    regionCenterY: new Float64Array(1),
    regionAvailableZMask: new Int32Array([3]),
    portAngleForRegion1: new Int32Array([0, 18000]),
    portX: new Float64Array([-1, 1]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  },
  problem: {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([1]),
    regionNetId: new Int32Array([-1]),
    portSectionMask: new Int8Array([1, 1]),
  },
})

export class RegionCostProbe extends TinyHyperGraphSolver {
  score(same: number, cross: number, entry: number): number {
    return this["getCandidateRegionCost"](
      0,
      this.state.regionIntersectionCaches[0],
      same,
      cross,
      entry,
    )
  }

  restoreRecordedState(): void {
    const costs = this.state.regionIntersectionCaches.map(
      (occupancy) => occupancy.existingRegionCost,
    )
    const summary = {
      maxRegionCost: this.getMaxRegionCost(),
      totalRegionCost: costs.reduce((sum, value) => sum + value, 0),
    }
    this.captureBestSolvedState(summary)
    this.restoreBestSolvedState()
  }
}
