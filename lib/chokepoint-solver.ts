import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { analyzePortCapacityMinCut } from "./chokepoint-flow"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import type { PortId, RegionId, RouteId } from "./types"

export interface ChokepointSolverOptions extends TinyHyperGraphSolverOptions {
  MAX_CHOKEPOINT_EXPANSION_PASSES?: number
  MAX_CHOKEPOINT_EXPANSIONS?: number
  MAX_CHOKEPOINT_SEARCH_PORTS?: number
  MAX_CHOKEPOINT_SEARCH_ROUTES?: number
  CHOKEPOINT_PORT_SPACING?: number
}

export interface ChokepointExpansion {
  originalPortId: PortId
  replacementPortIds: [PortId, PortId]
  routeIds: RouteId[]
}

export interface ChokepointSolverOutput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  expansions: ChokepointExpansion[]
  passCount: number
}

export interface ChokepointSolverInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options?: ChokepointSolverOptions
}

const DEFAULT_MAX_CHOKEPOINT_EXPANSION_PASSES = 8
const DEFAULT_MAX_CHOKEPOINT_EXPANSIONS = 8
const DEFAULT_MAX_CHOKEPOINT_SEARCH_PORTS = 256
const DEFAULT_MAX_CHOKEPOINT_SEARCH_ROUTES = 32
const DEFAULT_RELATIVE_CHOKEPOINT_PORT_SPACING = 0.12
const MIN_CHOKEPOINT_PORT_SPACING = 0.05

const createPortSectionMask = (
  sourcePortIds: PortId[],
  problem: TinyHyperGraphProblem,
) =>
  Int8Array.from(
    sourcePortIds.map(
      (sourcePortId) => problem.portSectionMask[sourcePortId] ?? 1,
    ),
  )

const getInteriorPortPredicate = (problem: TinyHyperGraphProblem) => {
  const endpointPortIds = new Set<PortId>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    endpointPortIds.add(problem.routeStartPort[routeId]!)
    endpointPortIds.add(problem.routeEndPort[routeId]!)
  }

  return (portId: PortId) => !endpointPortIds.has(portId)
}

const findChokepointPorts = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: ChokepointSolverOptions = {},
): Array<{ portId: PortId; routeIds: RouteId[] }> => {
  const maxSearchPorts =
    options.MAX_CHOKEPOINT_SEARCH_PORTS ?? DEFAULT_MAX_CHOKEPOINT_SEARCH_PORTS
  const maxSearchRoutes =
    options.MAX_CHOKEPOINT_SEARCH_ROUTES ?? DEFAULT_MAX_CHOKEPOINT_SEARCH_ROUTES
  if (
    topology.portCount > maxSearchPorts ||
    problem.routeCount > maxSearchRoutes
  ) {
    return []
  }

  const analysis = analyzePortCapacityMinCut({ topology, problem })
  if (analysis.maxFlow >= analysis.demand) {
    return []
  }

  const isInteriorPort = getInteriorPortPredicate(problem)
  return analysis.minCutPortIds
    .filter((portId) => isInteriorPort(portId))
    .map((portId) => {
      return {
        portId,
        routeIds: analysis.routeIds,
      }
    })
}

const cloneMetadata = (metadata: any, replacementIndex?: number) => {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return {
      ...metadata,
      chokepointReplacementIndex: replacementIndex,
    }
  }

  return metadata
}

const pushPort = ({
  topology,
  sourcePortId,
  portX,
  portY,
  portZ,
  portAngleForRegion1,
  portAngleForRegion2,
  incidentPortRegion,
  portMetadata,
  sourcePortIds,
  replacementIndex,
}: {
  topology: TinyHyperGraphTopology
  sourcePortId: PortId
  portX: number[]
  portY: number[]
  portZ: number[]
  portAngleForRegion1: number[]
  portAngleForRegion2: number[]
  incidentPortRegion: RegionId[][]
  portMetadata?: any[]
  sourcePortIds: PortId[]
  replacementIndex?: number
}) => {
  const nextPortId = portX.length
  portX.push(topology.portX[sourcePortId]!)
  portY.push(topology.portY[sourcePortId]!)
  portZ.push(topology.portZ[sourcePortId]!)
  portAngleForRegion1.push(topology.portAngleForRegion1[sourcePortId]!)
  portAngleForRegion2.push(
    topology.portAngleForRegion2?.[sourcePortId] ??
      topology.portAngleForRegion1[sourcePortId]!,
  )
  incidentPortRegion.push([...topology.incidentPortRegion[sourcePortId]!])
  portMetadata?.push(
    cloneMetadata(topology.portMetadata?.[sourcePortId], replacementIndex),
  )
  sourcePortIds.push(sourcePortId)

  return nextPortId
}

const getRegionProjectionExtent = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  axisX: number,
  axisY: number,
) =>
  Math.abs(axisX) * topology.regionWidth[regionId]! +
  Math.abs(axisY) * topology.regionHeight[regionId]!

const getReplacementPoints = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  requestedSpacing?: number,
) => {
  const [region1Id, region2Id] = topology.incidentPortRegion[portId]!
  const dx =
    (topology.regionCenterX[region2Id] ?? topology.portX[portId]!) -
    (topology.regionCenterX[region1Id] ?? topology.portX[portId]!)
  const dy =
    (topology.regionCenterY[region2Id] ?? topology.portY[portId]!) -
    (topology.regionCenterY[region1Id] ?? topology.portY[portId]!)
  const length = Math.hypot(dx, dy) || 1
  const tangentX = -dy / length
  const tangentY = dx / length
  const regionLimitedSpacing = Math.max(
    MIN_CHOKEPOINT_PORT_SPACING,
    Math.min(
      getRegionProjectionExtent(topology, region1Id, tangentX, tangentY),
      getRegionProjectionExtent(topology, region2Id, tangentX, tangentY),
    ) * DEFAULT_RELATIVE_CHOKEPOINT_PORT_SPACING,
  )
  const spacing =
    requestedSpacing === undefined
      ? regionLimitedSpacing
      : Math.min(requestedSpacing, regionLimitedSpacing)
  const halfSpacing = spacing / 2

  return [
    {
      x: topology.portX[portId]! - tangentX * halfSpacing,
      y: topology.portY[portId]! - tangentY * halfSpacing,
    },
    {
      x: topology.portX[portId]! + tangentX * halfSpacing,
      y: topology.portY[portId]! + tangentY * halfSpacing,
    },
  ] as const
}

const expandChokepointPortsOnce = ({
  topology,
  problem,
  chokepoints,
  spacing,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  chokepoints: Array<{ portId: PortId; routeIds: RouteId[] }>
  spacing?: number
}): ChokepointSolverOutput => {
  const chokepointByPortId = new Map(
    chokepoints.map((chokepoint) => [chokepoint.portId, chokepoint]),
  )
  const originalToReplacementPortIds = new Map<PortId, PortId[]>()
  const portX: number[] = []
  const portY: number[] = []
  const portZ: number[] = []
  const portAngleForRegion1: number[] = []
  const portAngleForRegion2: number[] = []
  const incidentPortRegion: RegionId[][] = []
  const sourcePortIds: PortId[] = []
  const portMetadata = topology.portMetadata ? [] : undefined

  for (let portId = 0; portId < topology.portCount; portId++) {
    const chokepoint = chokepointByPortId.get(portId)
    if (!chokepoint) {
      originalToReplacementPortIds.set(portId, [
        pushPort({
          topology,
          sourcePortId: portId,
          portX,
          portY,
          portZ,
          portAngleForRegion1,
          portAngleForRegion2,
          incidentPortRegion,
          portMetadata,
          sourcePortIds,
        }),
      ])
      continue
    }

    const replacementPoints = getReplacementPoints(topology, portId, spacing)
    const replacementPortIds = replacementPoints.map((point, index) => {
      const replacementPortId = pushPort({
        topology,
        sourcePortId: portId,
        portX,
        portY,
        portZ,
        portAngleForRegion1,
        portAngleForRegion2,
        incidentPortRegion,
        portMetadata,
        sourcePortIds,
        replacementIndex: index,
      })
      portX[replacementPortId] = point.x
      portY[replacementPortId] = point.y
      return replacementPortId
    })
    originalToReplacementPortIds.set(portId, replacementPortIds)
  }

  const regionIncidentPorts = topology.regionIncidentPorts.map((portIds) =>
    portIds.flatMap((portId) => originalToReplacementPortIds.get(portId) ?? []),
  )
  const mapPort = (portId: PortId) =>
    originalToReplacementPortIds.get(portId)?.[0] ?? portId

  return {
    topology: {
      ...topology,
      portCount: portX.length,
      regionIncidentPorts,
      incidentPortRegion,
      portAngleForRegion1: Int32Array.from(portAngleForRegion1),
      portAngleForRegion2: Int32Array.from(portAngleForRegion2),
      portX: Float64Array.from(portX),
      portY: Float64Array.from(portY),
      portZ: Int32Array.from(portZ),
      portMetadata,
    },
    problem: {
      ...problem,
      portSectionMask: createPortSectionMask(sourcePortIds, problem),
      routeStartPort: Int32Array.from(
        Array.from(problem.routeStartPort, mapPort),
      ),
      routeEndPort: Int32Array.from(Array.from(problem.routeEndPort, mapPort)),
    },
    expansions: chokepoints.map((chokepoint) => ({
      originalPortId: chokepoint.portId,
      replacementPortIds: originalToReplacementPortIds.get(
        chokepoint.portId,
      ) as [PortId, PortId],
      routeIds: chokepoint.routeIds,
    })),
    passCount: 1,
  }
}

export const expandPortChokepoints = ({
  topology,
  problem,
  options = {},
}: ChokepointSolverInput): ChokepointSolverOutput => {
  let expandedTopology = topology
  let expandedProblem = problem
  const expansions: ChokepointExpansion[] = []
  const maxPasses =
    options.MAX_CHOKEPOINT_EXPANSION_PASSES ??
    DEFAULT_MAX_CHOKEPOINT_EXPANSION_PASSES
  let passCount = 0

  for (; passCount < maxPasses; passCount++) {
    const chokepoints = findChokepointPorts(
      expandedTopology,
      expandedProblem,
      options,
    )
    if (chokepoints.length === 0) {
      break
    }
    if (
      expansions.length + chokepoints.length >
      (options.MAX_CHOKEPOINT_EXPANSIONS ?? DEFAULT_MAX_CHOKEPOINT_EXPANSIONS)
    ) {
      break
    }

    const expanded = expandChokepointPortsOnce({
      topology: expandedTopology,
      problem: expandedProblem,
      chokepoints,
      spacing: options.CHOKEPOINT_PORT_SPACING,
    })
    expandedTopology = expanded.topology
    expandedProblem = expanded.problem
    expansions.push(...expanded.expansions)
  }

  return {
    topology: expandedTopology,
    problem: expandedProblem,
    expansions,
    passCount,
  }
}

const createVisualizationSolver = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
) =>
  new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 1,
    STATIC_REACHABILITY_PRECHECK: false,
  })

export class ChokepointSolver extends BaseSolver {
  override MAX_ITERATIONS = 2
  private readonly inputTopology: TinyHyperGraphTopology
  private readonly inputProblem: TinyHyperGraphProblem
  private readonly options: ChokepointSolverOptions
  private chokepoints: Array<{ portId: PortId; routeIds: RouteId[] }> = []
  private output?: ChokepointSolverOutput
  private phase: "initial" | "identified" | "expanded" = "initial"

  constructor({ topology, problem, options = {} }: ChokepointSolverInput) {
    super()
    this.inputTopology = topology
    this.inputProblem = problem
    this.options = options
  }

  override _step() {
    if ((this.options.MAX_CHOKEPOINT_EXPANSION_PASSES ?? 1) <= 0) {
      this.output = {
        topology: this.inputTopology,
        problem: this.inputProblem,
        expansions: [],
        passCount: 0,
      }
      this.phase = "expanded"
      this.solved = true
      this.stats = {
        ...this.stats,
        chokepointCount: 0,
        chokepointExpansionCount: 0,
        chokepointExpansionPassCount: 0,
      }
      return
    }

    if (this.phase === "initial") {
      this.chokepoints = findChokepointPorts(
        this.inputTopology,
        this.inputProblem,
        this.options,
      )
      this.phase = "identified"
      this.stats = {
        ...this.stats,
        chokepointCount: this.chokepoints.length,
      }
      return
    }

    this.output = expandPortChokepoints({
      topology: this.inputTopology,
      problem: this.inputProblem,
      options: this.options,
    })
    this.phase = "expanded"
    this.solved = true
    this.stats = {
      ...this.stats,
      chokepointExpansionCount: this.output.expansions.length,
      chokepointExpansionPassCount: this.output.passCount,
    }
  }

  override visualize(): GraphicsObject {
    const output = this.output
    const topology = output?.topology ?? this.inputTopology
    const problem = output?.problem ?? this.inputProblem
    const solver = createVisualizationSolver(topology, problem)
    const graphics = solver.visualize() as Required<GraphicsObject>

    if (this.phase === "identified") {
      for (const chokepoint of this.chokepoints) {
        graphics.circles.push({
          center: {
            x: this.inputTopology.portX[chokepoint.portId]!,
            y: this.inputTopology.portY[chokepoint.portId]!,
          },
          radius: 0.18,
          fill: "rgba(239, 68, 68, 0.22)",
          stroke: "rgba(220, 38, 38, 0.95)",
          label: `chokepoint port ${chokepoint.portId}\nroutes: ${chokepoint.routeIds.join(", ")}`,
        })
      }
      graphics.title = `ChokepointSolver | chokepoints=${this.chokepoints.length}`
    } else if (this.phase === "expanded" && output) {
      for (const expansion of output.expansions) {
        for (const replacementPortId of expansion.replacementPortIds) {
          graphics.circles.push({
            center: {
              x: output.topology.portX[replacementPortId]!,
              y: output.topology.portY[replacementPortId]!,
            },
            radius: 0.14,
            fill: "rgba(34, 197, 94, 0.22)",
            stroke: "rgba(22, 163, 74, 0.95)",
            label: `replacement for port ${expansion.originalPortId}`,
          })
        }
      }
      graphics.title = `ChokepointSolver | expanded=${output.expansions.length}`
    } else {
      graphics.title = "ChokepointSolver | initial"
    }

    return graphics
  }

  override getOutput(): ChokepointSolverOutput {
    if (!this.output) {
      return expandPortChokepoints({
        topology: this.inputTopology,
        problem: this.inputProblem,
        options: this.options,
      })
    }

    return this.output
  }
}
