import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("workspace reset rejects subclasses before changing their routing state", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], [0, 1]],
    incidentPortRegion: [[0, 1], [0, 1]],
    regionWidth: new Float64Array([10, 10]),
    regionHeight: new Float64Array([10, 10]),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array([0, 180]),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const originalProblem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([4]),
    regionNetId: new Int32Array([-1, -1]),
  }
  const replacementProblem = {
    ...originalProblem,
    routeNet: new Int32Array([7]),
  }
  for (const Solver of [
    OutsideInPartialRipTinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
  ]) {
    const solver = new Solver(topology, originalProblem)
    expect(() => solver.resetForProblem(replacementProblem)).toThrow(
      "TinyHyperGraphSolver.resetForProblem cannot reset subclass routing state",
    )
    expect(solver.problem).toBe(originalProblem)
  }
})
