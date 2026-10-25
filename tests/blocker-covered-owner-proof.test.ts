import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import { inspectRelaxedBlockerReachability } from "lib/selective-rerip/inspectRelaxedBlockerReachability"
import type {
  RelaxedSearchHop,
  RelaxedSearchState,
} from "lib/selective-rerip/relaxedBlockerSearchTypes"
import type { PortId, RegionId } from "lib/types"

type ReachabilityModel = {
  incidentRegions: RegionId[][]
  singleLayerRegions: ReadonlySet<RegionId>
  ownerMask: number
  forbiddenOwner: number
}

function getModelHops(
  input: { state: RelaxedSearchState; includeIncoming: boolean },
  model: ReachabilityModel,
): RelaxedSearchHop[] {
  const { portId: from, nextRegionId: region } = input.state
  const hops: RelaxedSearchHop[] = []
  for (let portId: PortId = 0; portId < 4; portId++) {
    if (
      (!input.includeIncoming && portId === from) ||
      !model.incidentRegions[portId]!.includes(region)
    )
      continue
    const owner = model.singleLayerRegions.has(region)
      ? (from + portId) % 2
      : portId % 2
    const owners = model.ownerMask & (1 << portId) ? [owner] : []
    if (owners.includes(model.forbiddenOwner)) continue
    const nextRegionId =
      portId === 3
        ? region
        : model.incidentRegions[portId]!.find(
            (next): boolean => next !== region,
          )!
    hops.push({
      state: { portId, nextRegionId },
      distance: Math.abs(portId - from),
      owners,
      data: { resources: [] },
    })
  }
  return hops
}

test("two-arrival rerip scans match full directed traversal at every expansion budget", (): void => {
  const regionPairs: RegionId[][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ]
  for (let topologyCode = 0; topologyCode < 81; topologyCode++) {
    let remainingCode = topologyCode
    const incidentRegions: RegionId[][] = []
    for (let portId = 0; portId < 4; portId++) {
      incidentRegions.push(regionPairs[remainingCode % 3]!)
      remainingCode = Math.floor(remainingCode / 3)
    }
    const singleLayerRegion = topologyCode % 3
    const model: ReachabilityModel = {
      incidentRegions,
      singleLayerRegions: new Set([singleLayerRegion]),
      ownerMask: 0,
      forbiddenOwner: -1,
    }
    const layerMasks = new Int32Array(3)
    const topology: TinyHyperGraphTopology = {
      portCount: 4,
      regionCount: 3,
      regionIncidentPorts: Array.from({ length: 3 }, (_, regionId): PortId[] =>
        [0, 1, 2, 3].filter((portId): boolean =>
          incidentRegions[portId]!.includes(regionId),
        ),
      ),
      incidentPortRegion: incidentRegions,
      regionWidth: new Float64Array(3).fill(1),
      regionHeight: new Float64Array(3).fill(1),
      regionCenterX: new Float64Array(3),
      regionCenterY: new Float64Array(3),
      portAngleForRegion1: new Int32Array(4),
      portAngleForRegion2: new Int32Array(4),
      portX: new Float64Array([0, 1, 2, 3]),
      portY: new Float64Array(4),
      portZ: new Int32Array(4),
      regionAvailableZMask: layerMasks,
    }
    const problem: TinyHyperGraphProblem = {
      routeCount: 2,
      routeStartPort: new Int32Array([0, 1]),
      routeEndPort: new Int32Array([3, 2]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array(3).fill(-1),
      portSectionMask: new Int8Array(4).fill(1),
    }
    const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem)
    solver.state.currentRouteId = 0
    solver.state.currentRouteNetId = 0
    const context = {
      solver,
      goalPortId: 3,
      getHops: (state: RelaxedSearchState): RelaxedSearchHop[] =>
        getModelHops({ state, includeIncoming: false }, model),
      getHopTemplates: (state: RelaxedSearchState): RelaxedSearchHop[] =>
        getModelHops({ state, includeIncoming: true }, model),
    }
    for (let ownerMask = 0; ownerMask < 16; ownerMask++) {
      model.ownerMask = ownerMask
      for (const forbiddenOwner of [-1, 0, 1]) {
        model.forbiddenOwner = forbiddenOwner
        for (let startRegion = 0; startRegion < 3; startRegion++) {
          for (
            let maxExpandedStates = 0;
            maxExpandedStates <= 10;
            maxExpandedStates++
          ) {
            const input = {
              start: { portId: 0, nextRegionId: startRegion },
              maxExpandedStates,
            }
            // All-single-layer masks force the full directed scan. Edge owners
            // remain fixed by the model, isolating the two-arrival optimization.
            layerMasks.fill(1)
            const original = inspectRelaxedBlockerReachability(input, context)
            layerMasks.fill(0)
            layerMasks[singleLayerRegion] = 1
            expect(inspectRelaxedBlockerReachability(input, context)).toEqual(
              original,
            )
          }
        }
      }
    }
  }
})
