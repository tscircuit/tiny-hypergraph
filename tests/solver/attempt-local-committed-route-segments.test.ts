import { expect, test } from "bun:test"
import type {
  TinyHyperGraphInitialAssignment,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"
import type { PortId, RegionId, RouteId } from "lib/types"

type IndexedSegment = {
  segmentIndex: number
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

type PartialRipAccess = {
  preparePartialRip(hotRegions: RegionId[], costs: Float64Array): boolean
  getCommittedRouteSegments(
    routeId: RouteId,
    indexed: readonly IndexedSegment[],
  ): Array<Omit<IndexedSegment, "segmentIndex">> | undefined
  partialRipRoutePlans: Map<RouteId, unknown>
  partialRipWindowDistance?: number
}

const createSeededProblem = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => {
  const routeRegions = [2, 0, 2, 3]
  const incidentPortRegion = Array.from(
    { length: 15 },
    (_, portId): number[] => {
      const index = portId % 5
      return [
        index === 0 ? 4 : routeRegions[index - 1]!,
        index === 4 ? 5 : routeRegions[index]!,
      ]
    },
  )
  const initialAssignments: TinyHyperGraphInitialAssignment[] = [
    [1, 2, 7, 8],
    [0, 0, 2, 1],
    [2, 2, 10, 11],
    [0, 3, 3, 4],
    [1, 0, 6, 7],
    [0, 2, 2, 3],
    [2, 3, 13, 14],
    [1, 3, 8, 9],
    [0, 2, 0, 1],
    [1, 2, 5, 6],
    [2, 0, 11, 12],
    [2, 2, 12, 13],
  ].map(
    ([
      routeId,
      regionId,
      fromPortId,
      toPortId,
    ]): TinyHyperGraphInitialAssignment => ({
      routeId,
      regionId,
      fromPortId,
      toPortId,
    }),
  )
  const topology: TinyHyperGraphTopology = {
    portCount: 15,
    regionCount: 6,
    incidentPortRegion,
    regionIncidentPorts: Array.from({ length: 6 }, (_, regionId): number[] =>
      incidentPortRegion.flatMap((regions, portId): number[] =>
        regions.includes(regionId) ? [portId] : [],
      ),
    ),
    regionWidth: new Float64Array(6).fill(100),
    regionHeight: new Float64Array(6).fill(100),
    regionCenterX: Float64Array.of(7.5, 0, 10, 17.5, 0, 20),
    regionCenterY: new Float64Array(6),
    regionAvailableZMask: new Int32Array(6).fill(3),
    regionConnectedZMask: Int32Array.of(0, 0, 3, 0, 0, 0),
    portAngleForRegion1: new Int32Array(15).fill(18000),
    portAngleForRegion2: new Int32Array(15),
    portX: Float64Array.from(
      { length: 15 },
      (_, portId): number => (portId % 5) * 5,
    ),
    portY: Float64Array.from(
      { length: 15 },
      (_, portId): number => Math.floor(portId / 5) * 2,
    ),
    portZ: Int32Array.from({ length: 15 }, (_, portId): number =>
      portId >= 5 && portId < 10 ? 1 : 0,
    ),
    portReservedNetId: new Int32Array(15).fill(-1),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    routeStartPort: Int32Array.of(0, 5, 10),
    routeEndPort: Int32Array.of(4, 9, 14),
    routeNet: Int32Array.of(0, 0, 1),
    portSectionMask: new Int8Array(15).fill(1),
    regionNetId: new Int32Array(6).fill(-1),
    portPenalty: new Float64Array(15),
    initialAssignments,
  }
  return { topology, problem }
}

// This is the unchanged d35 collection loop, independent of the new buckets.
const collectLegacySegments = (
  solver: OutsideInPartialRipTinyHyperGraphSolver,
  routeId: RouteId,
): IndexedSegment[] => {
  const segments: IndexedSegment[] = []
  for (
    let regionId = 0;
    regionId < solver.state.regionSegments.length;
    regionId++
  ) {
    for (const [owner, fromPortId, toPortId] of solver.state.regionSegments[
      regionId
    ] ?? []) {
      if (owner !== routeId) continue
      segments.push({
        segmentIndex: segments.length,
        regionId,
        fromPortId,
        toPortId,
      })
    }
  }
  return segments
}

test("attempt-local buckets preserve legacy route order and complete partial-rip state", (): void => {
  for (const viaCost of [0, 0.6]) {
    for (const variant of [
      "seeded",
      "reordered",
      "empty",
      "disconnected",
    ] as const) {
      const input = createSeededProblem()
      const originalInput = structuredClone(input)
      const hosts = [false, true].map(
        (
          legacyControl,
        ): {
          solver: OutsideInPartialRipTinyHyperGraphSolver
          access: PartialRipAccess
          collections: Array<{ routeId: RouteId; segments: IndexedSegment[] }>
        } => {
          const solver = new OutsideInPartialRipTinyHyperGraphSolver(
            input.topology,
            input.problem,
            {
              VIA_COST: viaCost,
              CROSS_LAYER_INTERSECTION_COST_FACTOR: 1,
              TRACE_DENSITY_COST_FACTOR: 10,
              PARTIAL_RIP_MAX_DISTANCE: 3,
              STATIC_REACHABILITY_PRECHECK: false,
            },
          )
          expect(solver.stats.initialAssignmentCount).toBe(12)
          expect(solver.stats.initiallyRoutedRouteCount).toBe(3)
          if (variant === "reordered") solver.state.regionSegments[2]!.reverse()
          if (variant === "empty") {
            solver.state.regionSegments = solver.state.regionSegments.map(
              (segments): typeof segments =>
                segments.filter(([owner]): boolean => owner !== 2),
            )
          }
          if (variant === "disconnected") {
            solver.state.regionSegments[2] =
              solver.state.regionSegments[2]!.filter(
                ([owner, from]): boolean => owner !== 2 || from !== 12,
              )
          }
          const access = solver as unknown as PartialRipAccess
          const originalCollector =
            access.getCommittedRouteSegments.bind(solver)
          const collections: Array<{
            routeId: RouteId
            segments: IndexedSegment[]
          }> = []
          access.getCommittedRouteSegments = (
            routeId,
            indexed,
          ): Array<Omit<IndexedSegment, "segmentIndex">> | undefined => {
            const legacy = collectLegacySegments(solver, routeId)
            expect(indexed).toEqual(legacy)
            collections.push({
              routeId,
              segments: structuredClone([...indexed]),
            })
            // Both controls retain the real, unchanged DFS and mutation machinery.
            return originalCollector(routeId, legacyControl ? legacy : indexed)
          }
          return { solver, access, collections }
        },
      )
      const [optimized, legacy] = hosts
      const costs = Float64Array.of(2, 0, 0, 0, 0, 0)
      const initialStates = hosts.map(
        ({ solver }): Omit<TinyHyperGraphWorkingState, "candidateQueue"> => {
          const { candidateQueue: _queue, ...state } = solver.state
          return structuredClone(state)
        },
      )
      const prepared = hosts.map(({ access }): boolean =>
        access.preparePartialRip([0], costs),
      )
      expect(prepared).toEqual([
        variant === "seeded" || variant === "reordered",
        variant === "seeded" || variant === "reordered",
      ])
      expect(optimized!.collections).toEqual(legacy!.collections)
      expect(
        optimized!.collections.map(({ routeId }): RouteId => routeId),
      ).toEqual([0, 1, 2])
      expect(optimized!.solver.state).toEqual(legacy!.solver.state)
      expect(optimized!.access.partialRipRoutePlans).toEqual(
        legacy!.access.partialRipRoutePlans,
      )
      expect(optimized!.access.partialRipWindowDistance).toBe(
        legacy!.access.partialRipWindowDistance,
      )
      expect(optimized!.solver.stats).toEqual(legacy!.solver.stats)
      expect(input).toEqual(originalInput)
      if (!prepared[0]) {
        for (let index = 0; index < hosts.length; index++) {
          const { candidateQueue: _queue, ...state } =
            hosts[index]!.solver.state
          expect(state).toEqual(initialStates[index])
        }
        continue
      }
      expect(optimized!.solver.state.unroutedRoutes).toEqual([0, 1, 2])
      expect(optimized!.solver.stats.partiallyRippedSegmentCount).toBe(3)
      expect(optimized!.solver.stats.retainedPartialRipSegmentCount).toBe(9)
      const retainedStates = hosts.map(
        ({ solver }): Omit<TinyHyperGraphWorkingState, "candidateQueue"> => {
          const { candidateQueue: _queue, ...state } = solver.state
          return structuredClone(state)
        },
      )
      // A second attempt must see the now-incomplete retained paths, not stale
      // full-route buckets from the successful first attempt.
      expect(
        hosts.map(({ access }): boolean =>
          access.preparePartialRip([2], costs),
        ),
      ).toEqual([false, false])
      for (let index = 0; index < hosts.length; index++) {
        const { candidateQueue: _queue, ...state } = hosts[index]!.solver.state
        expect(state).toEqual(retainedStates[index])
        expect(hosts[index]!.collections.at(-1)!.segments).toHaveLength(3)
      }
      expect(optimized!.collections).toEqual(legacy!.collections)
      for (const { solver } of hosts) {
        solver.solve()
        expect(solver.solved).toBeTrue()
        expect(solver.failed).toBeFalse()
        expect(solver.stats.outsideInCompletedRouteCount).toBe(3)
      }
      expect(optimized!.solver.getOutput()).toEqual(legacy!.solver.getOutput())
      expect(optimized!.solver.state).toEqual(legacy!.solver.state)
      expect(optimized!.solver.iterations).toBe(legacy!.solver.iterations)
      expect(optimized!.solver.stats).toEqual(legacy!.solver.stats)
      expect(optimized!.access.partialRipRoutePlans).toEqual(
        legacy!.access.partialRipRoutePlans,
      )
      expect(input).toEqual(originalInput)
    }
  }
})
