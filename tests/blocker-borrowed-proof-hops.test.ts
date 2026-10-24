import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import {
  SelectiveReripTinyHyperGraphSolver,
  type SelectiveReripBlockerResource,
} from "lib/selective-rerip-tiny-hyper-graph-solver"
import type { PortId, RegionId, RouteId } from "lib/types"

type ProofState = { portId: PortId; nextRegionId: RegionId }
type ProofHop = {
  state: ProofState
  distance: number
  owners: RouteId[]
  data: { resources: SelectiveReripBlockerResource[] }
}
type PortResource = Extract<SelectiveReripBlockerResource, { kind: "port" }>

test("borrowed proof hops preserve queued states and independent traversals", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 7,
    regionIncidentPorts: [[0, 1, 2, 3], [0], [1, 4], [2], [3, 5], [4], [5]],
    incidentPortRegion: [[0, 1], [0, 2], [0, 3], [0, 4], [2, 5], [4, 6]],
    regionWidth: new Float64Array(7).fill(1),
    regionHeight: new Float64Array(7).fill(1),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 1, 3]),
    portY: new Float64Array([0, 0, 0, 0, -1, -1]),
    portZ: new Int32Array([0, 0, 1, 1, 0, 1]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([2, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(7).fill(-1),
    portSectionMask: new Int8Array(6).fill(1),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.portAssignment[1] = 1
  solver.state.portAssignment[3] = 1
  solver.state.regionSegments[0] = [[1, 1, 3]]
  const context = {
    state: { portId: 0, nextRegionId: 0 },
    goalPortId: 2,
    routeNetId: 0,
    portOwners: new Map<PortId, ReadonlySet<RouteId>>([
      [1, new Set<RouteId>([1])],
      [3, new Set<RouteId>([1])],
    ]),
    portResources: new Map<PortId, PortResource>(),
    forbiddenOwnerRouteIds: new Set<RouteId>(),
    hopTemplatesByRegion: new Map<RegionId, ProofHop[]>(),
  }
  const weighted = solver["getRelaxedSearchHops"](context)
  const proofSnapshots: ProofHop[] = []
  const borrowedRecords: ProofHop[] = []
  solver["forEachRelaxedReachabilityHop"](context, (hop): boolean => {
    borrowedRecords.push(hop)
    proofSnapshots.push({ ...hop })
    return true
  })
  expect(proofSnapshots).toEqual(weighted)
  expect(proofSnapshots.map((hop): PortId => hop.state.portId)).toEqual([1, 2, 3])
  expect(new Set(borrowedRecords).size).toBe(1)
  expect(new Set(weighted).size).toBe(3)
  expect(weighted).toEqual(proofSnapshots)

  const leftRecords: ProofHop[] = []
  const rightRecords: ProofHop[] = []
  const queuedLeftStates: ProofState[] = []
  const queuedRightStates: ProofState[] = []
  let reentered = false
  solver["forEachRelaxedReachabilityHop"](context, (hop): boolean => {
    leftRecords.push(hop)
    queuedLeftStates.push(hop.state)
    if (!reentered) {
      reentered = true
      const beforeReentry = hop.state
      solver["forEachRelaxedReachabilityHop"](
        { ...context, state: { portId: 3, nextRegionId: 0 } },
        (nestedHop): boolean => {
          rightRecords.push(nestedHop)
          queuedRightStates.push(nestedHop.state)
          return true
        },
      )
      expect(hop.state).toBe(beforeReentry)
      expect(rightRecords[0]).not.toBe(hop)
    }
    return true
  })
  expect(new Set(leftRecords).size).toBe(1)
  expect(new Set(rightRecords).size).toBe(1)
  expect(queuedLeftStates.map((state): PortId => state.portId)).toEqual([1, 2, 3])
  expect(queuedRightStates.map((state): PortId => state.portId)).toEqual([0, 1, 2])
  const stoppedPorts: PortId[] = []
  solver["forEachRelaxedReachabilityHop"](context, (hop): boolean => {
    stoppedPorts.push(hop.state.portId)
    return false
  })
  expect(stoppedPorts).toEqual([1])

  // The goal is followed by another template. Reusing a state object itself
  // would corrupt the queued goal before the reachability search visits it.
  const result = solver["findRelaxedBlockerPath"]()
  expect(result.found).toBe(true)
  if (result.found) {
    expect(result.owners.size).toBe(0)
    expect(result.distance).toBe(2)
    expect(result.states.at(-1)?.portId).toBe(2)
  }

  const forbiddenContext = {
    ...context,
    forbiddenOwnerRouteIds: new Set<RouteId>([1]),
    hopTemplatesByRegion: new Map<RegionId, ProofHop[]>(),
  }
  const allowedPorts: PortId[] = []
  solver["forEachRelaxedReachabilityHop"](forbiddenContext, (hop): boolean => {
    allowedPorts.push(hop.state.portId)
    return true
  })
  expect(allowedPorts).toEqual([2])
  const emptyContext = {
    ...context,
    hopTemplatesByRegion: new Map<RegionId, ProofHop[]>([[0, []]]),
  }
  let emptyVisits = 0
  solver["forEachRelaxedReachabilityHop"](emptyContext, (): boolean => {
    emptyVisits++
    return true
  })
  expect(emptyVisits).toBe(0)

  problem.regionNetId[0] = 9
  solver["forEachRelaxedReachabilityHop"](context, (): boolean => {
    emptyVisits++
    return true
  })
  expect(emptyVisits).toBe(0)
  problem.regionNetId[0] = -1
  const singleLayerSolver = new SelectiveReripTinyHyperGraphSolver(
    {
      ...topology,
      portZ: new Int32Array(6),
      regionAvailableZMask: new Int32Array(7).fill(1),
    },
    problem,
    { STATIC_REACHABILITY_PRECHECK: false },
  )
  singleLayerSolver.state.currentRouteId = 0
  singleLayerSolver.state.currentRouteNetId = 0
  singleLayerSolver.state.portAssignment[1] = 1
  singleLayerSolver.state.portAssignment[3] = 1
  singleLayerSolver.state.regionSegments[0] = [[1, 1, 3]]
  const singleLayerContext = {
    ...context,
    portResources: new Map<PortId, PortResource>(),
    hopTemplatesByRegion: new Map<RegionId, ProofHop[]>(),
  }
  const singleLayerProof: ProofHop[] = []
  singleLayerSolver["forEachRelaxedReachabilityHop"](
    singleLayerContext,
    (hop): boolean => {
      singleLayerProof.push(hop)
      return true
    },
  )
  expect(singleLayerProof).toEqual(
    singleLayerSolver["getRelaxedSearchHops"](singleLayerContext),
  )
  expect(new Set(singleLayerProof).size).toBe(singleLayerProof.length)
})
