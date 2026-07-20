import { expect, test } from "bun:test"
import {
  computeTracePitch,
  DEFAULT_MIN_TRACE_CLEARANCE,
  DEFAULT_MIN_TRACE_WIDTH,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const topology: TinyHyperGraphTopology = {
  portCount: 0,
  regionCount: 0,
  regionIncidentPorts: [],
  incidentPortRegion: [],
  regionWidth: new Float64Array(0),
  regionHeight: new Float64Array(0),
  regionCenterX: new Float64Array(0),
  regionCenterY: new Float64Array(0),
  portAngleForRegion1: new Int32Array(0),
  portX: new Float64Array(0),
  portY: new Float64Array(0),
  portZ: new Int32Array(0),
}

const problem: TinyHyperGraphProblem = {
  routeCount: 0,
  portSectionMask: new Int8Array(0),
  routeStartPort: new Int32Array(0),
  routeEndPort: new Int32Array(0),
  routeNet: new Int32Array(0),
  regionNetId: new Int32Array(0),
}

test("trace pitch defaults to 0.1mm width plus 0.1mm clearance", () => {
  expect(DEFAULT_MIN_TRACE_WIDTH).toBe(0.1)
  expect(DEFAULT_MIN_TRACE_CLEARANCE).toBe(0.1)
  expect(computeTracePitch()).toBeCloseTo(0.2)
  expect(
    new TinyHyperGraphSolver(topology, problem).getTracePitch(),
  ).toBeCloseTo(0.2)
})

test("trace pitch is derived from configured width and clearance", () => {
  expect(computeTracePitch(0.15, 0.22)).toBeCloseTo(0.37)
  expect(
    new TinyHyperGraphSolver(topology, problem, {
      minTraceWidth: 0.15,
      minTraceClearance: 0.22,
    }).getTracePitch(),
  ).toBeCloseTo(0.37)
})
