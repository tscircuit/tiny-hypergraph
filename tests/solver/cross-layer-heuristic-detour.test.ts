import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const DISTRACTOR_COUNT = 8
const START_TERMINAL_REGION = 0
const TOP_HUB_REGION = 1
const FIRST_DISTRACTOR_REGION = 2
const FIRST_CORRIDOR_REGION = FIRST_DISTRACTOR_REGION + DISTRACTOR_COUNT
const SECOND_CORRIDOR_REGION = FIRST_CORRIDOR_REGION + 1
const VIA_REGION = SECOND_CORRIDOR_REGION + 1
const FOURTH_CORRIDOR_REGION = VIA_REGION + 1
const FIFTH_CORRIDOR_REGION = FOURTH_CORRIDOR_REGION + 1
const BOTTOM_HUB_REGION = FIFTH_CORRIDOR_REGION + 1
const GOAL_TERMINAL_REGION = BOTTOM_HUB_REGION + 1

const START_PORT = 0
const GOAL_PORT = 1
const FIRST_DISTRACTOR_PORT = 2
const FIRST_CORRIDOR_PORT = FIRST_DISTRACTOR_PORT + DISTRACTOR_COUNT
const SECOND_CORRIDOR_PORT = FIRST_CORRIDOR_PORT + 1
const VIA_ENTRY_PORT = SECOND_CORRIDOR_PORT + 1
const VIA_EXIT_PORT = VIA_ENTRY_PORT + 1
const FOURTH_CORRIDOR_PORT = VIA_EXIT_PORT + 1
const FIFTH_CORRIDOR_PORT = FOURTH_CORRIDOR_PORT + 1

interface CrossLayerDetourTopologyDraft {
  incidentPortRegion: number[][]
  regionIncidentPorts: number[][]
  portX: Float64Array
  portY: Float64Array
  portZ: Int32Array
}

interface CrossLayerDetourPortConnection {
  portId: number
  region1Id: number
  region2Id: number
  x: number
  y: number
  z: number
}

const connectCrossLayerDetourPort = (
  connection: CrossLayerDetourPortConnection,
  topologyDraft: CrossLayerDetourTopologyDraft,
) => {
  topologyDraft.incidentPortRegion[connection.portId] = [
    connection.region1Id,
    connection.region2Id,
  ]
  topologyDraft.regionIncidentPorts[connection.region1Id]!.push(
    connection.portId,
  )
  topologyDraft.regionIncidentPorts[connection.region2Id]!.push(
    connection.portId,
  )
  topologyDraft.portX[connection.portId] = connection.x
  topologyDraft.portY[connection.portId] = connection.y
  topologyDraft.portZ[connection.portId] = connection.z
}

const createCrossLayerDetourTopology = (): TinyHyperGraphTopology => {
  const portCount = FIFTH_CORRIDOR_PORT + 1
  const regionCount = GOAL_TERMINAL_REGION + 1
  const regionIncidentPorts = Array.from(
    { length: regionCount },
    () => [] as number[],
  )
  const incidentPortRegion = Array.from(
    { length: portCount },
    () => [] as number[],
  )
  const portX = new Float64Array(portCount)
  const portY = new Float64Array(portCount)
  const portZ = new Int32Array(portCount)
  const topologyDraft = {
    incidentPortRegion,
    regionIncidentPorts,
    portX,
    portY,
    portZ,
  }

  connectCrossLayerDetourPort(
    {
      portId: START_PORT,
      region1Id: TOP_HUB_REGION,
      region2Id: START_TERMINAL_REGION,
      x: -0.5,
      y: 0,
      z: 0,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: GOAL_PORT,
      region1Id: BOTTOM_HUB_REGION,
      region2Id: GOAL_TERMINAL_REGION,
      x: -0.5,
      y: 0,
      z: 1,
    },
    topologyDraft,
  )

  for (let index = 0; index < DISTRACTOR_COUNT; index++) {
    connectCrossLayerDetourPort(
      {
        portId: FIRST_DISTRACTOR_PORT + index,
        region1Id: TOP_HUB_REGION,
        region2Id: FIRST_DISTRACTOR_REGION + index,
        x: 0,
        y: -0.56 + index * 0.16,
        z: 0,
      },
      topologyDraft,
    )
  }

  connectCrossLayerDetourPort(
    {
      portId: FIRST_CORRIDOR_PORT,
      region1Id: TOP_HUB_REGION,
      region2Id: FIRST_CORRIDOR_REGION,
      x: 0.8,
      y: 0,
      z: 0,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: SECOND_CORRIDOR_PORT,
      region1Id: FIRST_CORRIDOR_REGION,
      region2Id: SECOND_CORRIDOR_REGION,
      x: 1.6,
      y: 0,
      z: 0,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: VIA_ENTRY_PORT,
      region1Id: SECOND_CORRIDOR_REGION,
      region2Id: VIA_REGION,
      x: 2.5,
      y: 0,
      z: 0,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: VIA_EXIT_PORT,
      region1Id: VIA_REGION,
      region2Id: FOURTH_CORRIDOR_REGION,
      x: 2.5,
      y: 0,
      z: 1,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: FOURTH_CORRIDOR_PORT,
      region1Id: FOURTH_CORRIDOR_REGION,
      region2Id: FIFTH_CORRIDOR_REGION,
      x: 1.6,
      y: 0,
      z: 1,
    },
    topologyDraft,
  )
  connectCrossLayerDetourPort(
    {
      portId: FIFTH_CORRIDOR_PORT,
      region1Id: FIFTH_CORRIDOR_REGION,
      region2Id: BOTTOM_HUB_REGION,
      x: 0.8,
      y: 0,
      z: 1,
    },
    topologyDraft,
  )

  const regionCenterX = new Float64Array(regionCount)
  const regionCenterY = new Float64Array(regionCount)
  const regionWidth = new Float64Array(regionCount).fill(0.8)
  const regionHeight = new Float64Array(regionCount).fill(0.8)
  const regionAvailableZMask = new Int32Array(regionCount).fill(1)

  regionCenterX[START_TERMINAL_REGION] = -1
  regionCenterX[TOP_HUB_REGION] = 0.25
  regionWidth[TOP_HUB_REGION] = 1.5
  regionHeight[TOP_HUB_REGION] = 1.6

  for (let index = 0; index < DISTRACTOR_COUNT; index++) {
    const regionId = FIRST_DISTRACTOR_REGION + index
    regionCenterX[regionId] = 0
    regionCenterY[regionId] = -0.56 + index * 0.16
    regionWidth[regionId] = 0.2
    regionHeight[regionId] = 0.1
  }

  regionCenterX[FIRST_CORRIDOR_REGION] = 1.2
  regionCenterX[SECOND_CORRIDOR_REGION] = 2.05
  regionCenterX[VIA_REGION] = 2.5
  regionWidth[VIA_REGION] = 1
  regionHeight[VIA_REGION] = 1
  regionAvailableZMask[VIA_REGION] = 3
  regionCenterX[FOURTH_CORRIDOR_REGION] = 2.05
  regionCenterX[FIFTH_CORRIDOR_REGION] = 1.2
  regionCenterX[BOTTOM_HUB_REGION] = 0.25
  regionCenterX[GOAL_TERMINAL_REGION] = -1
  regionAvailableZMask[FOURTH_CORRIDOR_REGION] = 2
  regionAvailableZMask[FIFTH_CORRIDOR_REGION] = 2
  regionAvailableZMask[BOTTOM_HUB_REGION] = 2
  regionAvailableZMask[GOAL_TERMINAL_REGION] = 2

  return {
    portCount,
    regionCount,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth,
    regionHeight,
    regionCenterX,
    regionCenterY,
    regionAvailableZMask,
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
    portX,
    portY,
    portZ,
    regionMetadata: Array.from({ length: regionCount }, (_, regionId) => ({
      name:
        regionId === VIA_REGION
          ? "legal layer-change region"
          : `region ${regionId}`,
      availableZ:
        regionId === VIA_REGION
          ? [0, 1]
          : regionAvailableZMask[regionId] === 2
            ? [1]
            : [0],
    })),
    portMetadata: Array.from({ length: portCount }, (_, portId) => ({
      name:
        portId === START_PORT
          ? "start z0"
          : portId === GOAL_PORT
            ? "goal z1"
            : `port ${portId}`,
    })),
  }
}

const createCrossLayerDetourProblem = (): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(FIFTH_CORRIDOR_PORT + 1).fill(1),
  routeStartPort: new Int32Array([START_PORT]),
  routeEndPort: new Int32Array([GOAL_PORT]),
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array(GOAL_TERMINAL_REGION + 1).fill(-1),
  routeMetadata: [{ connectionId: "cross-layer-detour" }],
})

test("cross-layer search finds the legal layer-change detour", () => {
  const solver = new TinyHyperGraphSolver(
    createCrossLayerDetourTopology(),
    createCrossLayerDetourProblem(),
    {
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      MAX_ITERATIONS: 10,
      RIP_THRESHOLD_START: 1,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )
  const inputGraphics = solver.visualize()

  solver.solve()

  expect(
    getSvgFromGraphicsObject(
      stackGraphicsVertically([inputGraphics, solver.visualize()], {
        titles: ["input topology", "solver result"],
      }),
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
