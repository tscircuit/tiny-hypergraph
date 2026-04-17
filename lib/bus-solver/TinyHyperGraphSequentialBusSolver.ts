import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver, type PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../core"
import type { RegionIntersectionCache } from "../types"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver } from "./TinyHyperGraphBusSolver"
import type { TinyHyperGraphBusSolverOptions } from "./busSolverTypes"

export interface SequentialBusStage {
  stageName: string
  busId: string
  connectionIds: string[]
}

export interface TinyHyperGraphSequentialBusSolverInput {
  serializedHyperGraph: SerializedHyperGraph
  busStages: SequentialBusStage[]
  busSolverOptions?: TinyHyperGraphBusSolverOptions
}

interface RoutedObstacleStateSnapshot {
  portAssignment: Int32Array
  regionIntersectionCaches: RegionIntersectionCache[]
}

interface SeededTinyHyperGraphBusSolverParams {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  busId: string
  obstacleState?: RoutedObstacleStateSnapshot
  options?: TinyHyperGraphBusSolverOptions
}

const getRouteConnectionId = (
  problem: TinyHyperGraphProblem,
  routeId: number,
): string => {
  const connectionId = (
    problem.routeMetadata?.[routeId] as { connectionId?: unknown } | undefined
  )?.connectionId

  return typeof connectionId === "string" ? connectionId : `route-${routeId}`
}

const cloneRegionIntersectionCache = (
  regionIntersectionCache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: new Int32Array(regionIntersectionCache.netIds),
  lesserAngles: new Int32Array(regionIntersectionCache.lesserAngles),
  greaterAngles: new Int32Array(regionIntersectionCache.greaterAngles),
  layerMasks: new Int32Array(regionIntersectionCache.layerMasks),
  existingCrossingLayerIntersections:
    regionIntersectionCache.existingCrossingLayerIntersections,
  existingSameLayerIntersections:
    regionIntersectionCache.existingSameLayerIntersections,
  existingEntryExitLayerChanges:
    regionIntersectionCache.existingEntryExitLayerChanges,
  existingRegionCost: regionIntersectionCache.existingRegionCost,
  existingSegmentCount: regionIntersectionCache.existingSegmentCount,
})

const cloneRoutedObstacleState = (
  obstacleState: RoutedObstacleStateSnapshot,
): RoutedObstacleStateSnapshot => ({
  portAssignment: new Int32Array(obstacleState.portAssignment),
  regionIntersectionCaches: obstacleState.regionIntersectionCaches.map(
    cloneRegionIntersectionCache,
  ),
})

const captureRoutedObstacleState = (
  solver: TinyHyperGraphBusSolver,
): RoutedObstacleStateSnapshot => ({
  portAssignment: new Int32Array(solver.state.portAssignment),
  regionIntersectionCaches: solver.state.regionIntersectionCaches.map(
    cloneRegionIntersectionCache,
  ),
})

const countAssignedPorts = (portAssignment: Int32Array) => {
  let assignedPortCount = 0

  for (let portId = 0; portId < portAssignment.length; portId++) {
    if (portAssignment[portId] !== -1) {
      assignedPortCount += 1
    }
  }

  return assignedPortCount
}

const countIntersectionSegments = (
  regionIntersectionCaches: RegionIntersectionCache[],
) => {
  let segmentCount = 0

  for (const regionIntersectionCache of regionIntersectionCaches) {
    segmentCount += regionIntersectionCache.existingSegmentCount
  }

  return segmentCount
}

const applyRoutedObstacleState = (
  solver: TinyHyperGraphBusSolver,
  obstacleState?: RoutedObstacleStateSnapshot,
) => {
  solver.state.portAssignment = obstacleState
    ? new Int32Array(obstacleState.portAssignment)
    : new Int32Array(solver.topology.portCount).fill(-1)
  solver.state.regionSegments = Array.from(
    { length: solver.topology.regionCount },
    () => [],
  )
  solver.state.regionIntersectionCaches = obstacleState
    ? obstacleState.regionIntersectionCaches.map(cloneRegionIntersectionCache)
    : Array.from({ length: solver.topology.regionCount }, () =>
        createEmptyRegionIntersectionCache(),
      )
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = []
  solver.state.candidateQueue.clear()
  solver.resetCandidateBestCosts()
  solver.state.goalPortId = -1
  solver.state.ripCount = 0
  solver.state.regionCongestionCost.fill(0)

  return {
    seededAssignedPortCount: countAssignedPorts(solver.state.portAssignment),
    seededIntersectionSegmentCount: countIntersectionSegments(
      solver.state.regionIntersectionCaches,
    ),
  }
}

class SeededTinyHyperGraphBusSolver extends TinyHyperGraphBusSolver {
  private readonly busId: string
  private readonly obstacleState?: RoutedObstacleStateSnapshot

  constructor(params: SeededTinyHyperGraphBusSolverParams) {
    super(params.topology, params.problem, params.options)
    this.busId = params.busId
    this.obstacleState = params.obstacleState
      ? cloneRoutedObstacleState(params.obstacleState)
      : undefined
  }

  override _setup() {
    const { seededAssignedPortCount, seededIntersectionSegmentCount } =
      applyRoutedObstacleState(this, this.obstacleState)

    super._setup()

    this.stats = {
      ...this.stats,
      busId: this.busId,
      stageRouteCount: this.problem.routeCount,
      seededAssignedPortCount,
      seededIntersectionSegmentCount,
    }
  }
}

const filterSerializedHyperGraphByConnectionIds = (
  serializedHyperGraph: SerializedHyperGraph,
  connectionIds: string[],
): SerializedHyperGraph => {
  const selectedConnectionIds = new Set(connectionIds)
  const filteredConnections = (serializedHyperGraph.connections ?? []).filter(
    ({ connectionId }) => selectedConnectionIds.has(connectionId),
  )

  if (filteredConnections.length !== selectedConnectionIds.size) {
    const foundConnectionIds = new Set(
      filteredConnections.map(({ connectionId }) => connectionId),
    )
    const missingConnectionIds = [...selectedConnectionIds]
      .filter((connectionId) => !foundConnectionIds.has(connectionId))
      .sort((left, right) => left.localeCompare(right))

    throw new Error(
      `Missing selected connection ids in serialized hypergraph: ${missingConnectionIds.join(", ")}`,
    )
  }

  return {
    regions: serializedHyperGraph.regions,
    ports: serializedHyperGraph.ports,
    connections: filteredConnections,
  }
}

const createGlobalNetIdByConnectionId = (
  problem: TinyHyperGraphProblem,
): Map<string, number> => {
  const globalNetIdByConnectionId = new Map<string, number>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    globalNetIdByConnectionId.set(
      getRouteConnectionId(problem, routeId),
      problem.routeNet[routeId]!,
    )
  }

  return globalNetIdByConnectionId
}

const remapProblemToGlobalNetIds = (
  problem: TinyHyperGraphProblem,
  globalNetIdByConnectionId: ReadonlyMap<string, number>,
) => {
  const localToGlobalNetId = new Map<number, number>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const connectionId = getRouteConnectionId(problem, routeId)
    const globalNetId = globalNetIdByConnectionId.get(connectionId)
    const localNetId = problem.routeNet[routeId]!

    if (globalNetId === undefined) {
      throw new Error(`No global net id found for connection "${connectionId}"`)
    }

    localToGlobalNetId.set(localNetId, globalNetId)
    problem.routeNet[routeId] = globalNetId
  }

  for (let regionId = 0; regionId < problem.regionNetId.length; regionId++) {
    const localReservedNetId = problem.regionNetId[regionId]

    if (localReservedNetId === -1) {
      continue
    }

    problem.regionNetId[regionId] =
      localToGlobalNetId.get(localReservedNetId) ?? -1
  }
}

const getSolvedRouteCount = (serializedHyperGraph?: SerializedHyperGraph) =>
  serializedHyperGraph?.solvedRoutes?.length ?? 0

export class TinyHyperGraphSequentialBusSolver extends BasePipelineSolver<TinyHyperGraphSequentialBusSolverInput> {
  override pipelineDef: PipelineStep<SeededTinyHyperGraphBusSolver>[] = []

  private readonly globalNetIdByConnectionId: Map<string, number>
  private initialVisualizationSolver?: TinyHyperGraphSolver

  constructor(inputProblem: TinyHyperGraphSequentialBusSolverInput) {
    super(inputProblem)

    if (inputProblem.busStages.length === 0) {
      throw new Error(
        "TinyHyperGraphSequentialBusSolver requires at least one bus stage",
      )
    }

    const duplicateStageName = inputProblem.busStages.find(
      (stage, stageIndex) =>
        inputProblem.busStages.findIndex(
          (candidate) => candidate.stageName === stage.stageName,
        ) !== stageIndex,
    )

    if (duplicateStageName) {
      throw new Error(
        `Duplicate sequential bus stage name "${duplicateStageName.stageName}"`,
      )
    }

    const duplicateConnectionId = inputProblem.busStages
      .flatMap((stage) => stage.connectionIds)
      .find(
        (connectionId, connectionIndex, allConnectionIds) =>
          allConnectionIds.indexOf(connectionId) !== connectionIndex,
      )

    if (duplicateConnectionId) {
      throw new Error(
        `Sequential bus stages cannot reuse connection id "${duplicateConnectionId}"`,
      )
    }

    const { problem } = loadSerializedHyperGraph(
      inputProblem.serializedHyperGraph,
    )
    this.globalNetIdByConnectionId = createGlobalNetIdByConnectionId(problem)

    this.pipelineDef = inputProblem.busStages.map((stage) => ({
      solverName: stage.stageName,
      solverClass: SeededTinyHyperGraphBusSolver,
      getConstructorParams: (
        instance: TinyHyperGraphSequentialBusSolver,
      ): [SeededTinyHyperGraphBusSolverParams] =>
        instance.getStageConstructorParams(stage.stageName),
      onSolved: (instance: TinyHyperGraphSequentialBusSolver) => {
        instance.stats = {
          ...instance.stats,
          [`${stage.stageName}SolvedRouteCount`]: getSolvedRouteCount(
            instance.getStageOutput<SerializedHyperGraph>(stage.stageName),
          ),
        }
      },
    }))
  }

  private getStage(stageName: string): SequentialBusStage {
    const stage = this.inputProblem.busStages.find(
      (candidate) => candidate.stageName === stageName,
    )

    if (!stage) {
      throw new Error(`Unknown sequential bus stage "${stageName}"`)
    }

    return stage
  }

  private getStageObstacleState(
    stageName: string,
  ): RoutedObstacleStateSnapshot | undefined {
    const stageIndex = this.inputProblem.busStages.findIndex(
      (stage) => stage.stageName === stageName,
    )

    if (stageIndex <= 0) {
      return undefined
    }

    const previousStageName =
      this.inputProblem.busStages[stageIndex - 1]!.stageName
    const previousStageSolver =
      this.getSolver<SeededTinyHyperGraphBusSolver>(previousStageName)

    if (!previousStageSolver || !previousStageSolver.solved) {
      throw new Error(`Previous stage "${previousStageName}" is not solved yet`)
    }

    return captureRoutedObstacleState(previousStageSolver)
  }

  getStageConstructorParams(
    stageName: string,
  ): [SeededTinyHyperGraphBusSolverParams] {
    const stage = this.getStage(stageName)
    const stageSerializedHyperGraph = filterSerializedHyperGraphByConnectionIds(
      this.inputProblem.serializedHyperGraph,
      stage.connectionIds,
    )
    const { topology, problem } = loadSerializedHyperGraph(
      stageSerializedHyperGraph,
    )

    remapProblemToGlobalNetIds(problem, this.globalNetIdByConnectionId)

    return [
      {
        topology,
        problem,
        busId: stage.busId,
        obstacleState: this.getStageObstacleState(stageName),
        options: this.inputProblem.busSolverOptions,
      },
    ]
  }

  private getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { topology, problem } = loadSerializedHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver = new TinyHyperGraphSolver(
        topology,
        problem,
      )
    }

    return this.initialVisualizationSolver
  }

  override initialVisualize(): GraphicsObject | null {
    return this.getInitialVisualizationSolver().visualize()
  }

  override visualize(): GraphicsObject {
    if (this.iterations === 0) {
      return this.initialVisualize() ?? super.visualize()
    }

    return super.visualize()
  }

  override getOutput(): SerializedHyperGraph | null {
    const solvedRouteByConnectionId = new Map<
      string,
      NonNullable<SerializedHyperGraph["solvedRoutes"]>[number]
    >()

    for (const stage of this.inputProblem.busStages) {
      const stageOutput = this.getStageOutput<SerializedHyperGraph>(
        stage.stageName,
      )

      for (const solvedRoute of stageOutput?.solvedRoutes ?? []) {
        solvedRouteByConnectionId.set(
          solvedRoute.connection.connectionId,
          solvedRoute,
        )
      }
    }

    if (solvedRouteByConnectionId.size === 0) {
      return null
    }

    return {
      regions: this.inputProblem.serializedHyperGraph.regions,
      ports: this.inputProblem.serializedHyperGraph.ports,
      connections: this.inputProblem.serializedHyperGraph.connections,
      solvedRoutes: (this.inputProblem.serializedHyperGraph.connections ?? [])
        .map(({ connectionId }) => solvedRouteByConnectionId.get(connectionId))
        .filter(
          (
            solvedRoute,
          ): solvedRoute is NonNullable<
            SerializedHyperGraph["solvedRoutes"]
          >[number] => solvedRoute !== undefined,
        ),
    }
  }
}
