import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/core"
import { orderRoutesByCrossingDegree } from "../../lib/orderRoutesByCrossingDegree"
import { shuffle } from "../../lib/shuffle"

test("completed physical-via rerips defer shared crossing centers while preserving layer, net, and tie constraints", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 16,
    regionCount: 2,
    regionIncidentPorts: [
      Array.from({ length: 12 }, (_, index) => index),
      [12, 13, 14, 15],
    ],
    incidentPortRegion: Array.from({ length: 16 }, (): number[] => [0, 1]),
    regionWidth: Float64Array.of(4, 4),
    regionHeight: Float64Array.of(4, 4),
    regionCenterX: Float64Array.of(0, 5),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 3),
    portAngleForRegion1: new Int32Array(16),
    portX: Float64Array.of(
      -2,
      2,
      -1,
      -1,
      0,
      0,
      1,
      1,
      0,
      0,
      0.5,
      0.5,
      3,
      7,
      4,
      4,
    ),
    portY: Float64Array.of(
      0,
      0,
      -1,
      1,
      -1,
      1,
      -1,
      1,
      -1,
      1,
      -1,
      1,
      0,
      0,
      -1,
      1,
    ),
    portZ: Int32Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 6,
    portSectionMask: new Int8Array(16).fill(1),
    routeStartPort: Int32Array.of(0, 2, 4, 6, 8, 10),
    routeEndPort: Int32Array.of(1, 3, 5, 7, 9, 11),
    routeNet: Int32Array.of(0, 1, 2, 3, 4, 0),
    regionNetId: new Int32Array(2).fill(-1),
  }
  const segments: Array<Array<[number, number, number]>> = [
    [
      [0, 0, 1],
      [1, 2, 3],
      [2, 4, 5],
      [3, 6, 7],
      [4, 8, 9],
      [5, 10, 11],
    ],
    [
      [0, 12, 13],
      [1, 14, 15],
    ],
  ]
  const currentOrder = [0, 3, 2, 1, 4, 5]
  // The bottom-layer route and same-net branch are independent. A leaf that
  // crosses the center twice follows the other leaves, then the center is last.
  expect(
    orderRoutesByCrossingDegree(
      topology,
      segments,
      problem.routeNet,
      currentOrder,
    ),
  ).toEqual([4, 5, 3, 2, 1, 0])

  const physical = new TinyHyperGraphSolver(topology, problem, { VIA_COST: 1 })
  physical.state.regionSegments = segments
  physical.state.unroutedRoutes = []
  physical.state.ripCount = 1
  const shuffledRoutes = shuffle([0, 1, 2, 3, 4, 5], 1)
  physical.resetRoutingStateForRerip()
  expect(physical.state.unroutedRoutes).toEqual(
    orderRoutesByCrossingDegree(
      topology,
      segments,
      problem.routeNet,
      shuffledRoutes,
    ),
  )
  expect(physical.state.unroutedRoutes.at(-1)).toBe(0)
  expect(
    physical.state.regionSegments.every((region) => region.length === 0),
  ).toBe(true)

  const legacy = new TinyHyperGraphSolver(topology, problem)
  legacy.state.regionSegments = segments
  legacy.state.unroutedRoutes = []
  legacy.state.ripCount = 1
  legacy.resetRoutingStateForRerip()
  expect(legacy.state.unroutedRoutes).toEqual(shuffledRoutes)

  const incomplete = new TinyHyperGraphSolver(topology, problem, {
    VIA_COST: 1,
  })
  incomplete.state.regionSegments = segments
  incomplete.state.currentRouteId = 4
  incomplete.state.ripCount = 1
  incomplete.resetRoutingStateForRerip()
  expect(incomplete.state.unroutedRoutes).toEqual(shuffledRoutes)

  // A top-to-bottom center must see both pure-layer crossings together when
  // placing its transition; separate optimistic pair decisions can contradict.
  const transitionTopology = {
    ...topology,
    portZ: Int32Array.from(topology.portZ),
  }
  transitionTopology.portZ[1] = 1
  transitionTopology.portZ[6] = 1
  transitionTopology.portZ[7] = 1
  expect(
    orderRoutesByCrossingDegree(
      transitionTopology,
      [
        [
          [0, 0, 1],
          [1, 2, 3],
          [3, 6, 7],
        ],
      ],
      problem.routeNet,
      [0, 1, 3],
    ),
  ).toEqual([1, 3, 0])
})
