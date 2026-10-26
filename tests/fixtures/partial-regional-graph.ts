import {
  type Candidate,
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/index"

type OracleHopKey = string & { readonly __brand: "OracleHopKey" }
type OracleLabel = { portId: number; regionId: number; g: number }
export type PartialRegionalGraph = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
}

export class RecordedRegionalSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly completedCosts: number[] = []

  override onPathFound(candidate: Candidate): void {
    if (candidate.portId === this.state.goalPortId) {
      this.completedCosts.push(candidate.g)
    }
    super.onPathFound(candidate)
  }
}

export const createPartialRegionalGraph = ({
  seed,
  regionCount = 20,
}: {
  seed: number
  regionCount?: number
}): PartialRegionalGraph => {
  let randomState = seed
  const portRegions: number[][] = [[0, regionCount]]
  const regionPorts: number[][] = Array.from(
    { length: regionCount + 2 },
    () => [],
  )
  for (let first = 0; first < regionCount; first++) {
    for (let second = first + 1; second < regionCount; second++) {
      portRegions.push([first, second])
    }
  }
  const goalPort = portRegions.length
  portRegions.push([regionCount - 1, regionCount + 1])
  const ports = portRegions.length
  const portX = new Float64Array(ports)
  const portY = new Float64Array(ports)
  const penalties = new Float64Array(ports)
  for (let portId = 0; portId < ports; portId++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    portX[portId] = (randomState % 10001) / 1000
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    portY[portId] = (randomState % 10001) / 1000
    penalties[portId] = (randomState % 7) / 10
    for (const regionId of portRegions[portId]) {
      regionPorts[regionId].push(portId)
    }
  }
  return {
    topology: {
      portCount: ports,
      regionCount: regionCount + 2,
      regionIncidentPorts: regionPorts,
      incidentPortRegion: portRegions,
      regionWidth: new Float64Array(regionCount + 2).fill(100),
      regionHeight: new Float64Array(regionCount + 2).fill(100),
      regionCenterX: new Float64Array(regionCount + 2),
      regionCenterY: new Float64Array(regionCount + 2),
      portAngleForRegion1: Int32Array.from({ length: ports }, (_, i) => i),
      portAngleForRegion2: Int32Array.from({ length: ports }, (_, i) => -i),
      portX,
      portY,
      portZ: new Int32Array(ports),
    },
    problem: {
      routeCount: 1,
      portSectionMask: new Int8Array(ports).fill(1),
      routeStartPort: Int32Array.from([0]),
      routeEndPort: Int32Array.from([goalPort]),
      routeNet: Int32Array.from([7]),
      regionNetId: new Int32Array(regionCount + 2).fill(-1),
      portPenalty: penalties,
    },
  }
}

export const createRecordedRegionalSolver = ({
  graph,
  partial,
}: {
  graph: PartialRegionalGraph
  partial: boolean
}): RecordedRegionalSolver =>
  new RecordedRegionalSolver(graph.topology, graph.problem, {
    DISTANCE_TO_COST: 1,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    PARTIAL_REGIONAL_EXPANSION: partial,
    STATIC_REACHABILITY_PRECHECK: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    MAX_ITERATIONS: 100_000,
    RIP_THRESHOLD_START: 1,
    RIP_THRESHOLD_END: 1,
  })

export const getIndependentRegionalCost = ({
  topology,
  problem,
}: PartialRegionalGraph): number => {
  const goal = problem.routeEndPort[0]
  const start = problem.routeStartPort[0]
  const labels = new Map<OracleHopKey, OracleLabel>()
  const closed = new Set<OracleHopKey>()
  const firstKey = `${start}:0` as OracleHopKey
  labels.set(firstKey, { portId: start, regionId: 0, g: 0 })
  while (true) {
    let selected: OracleLabel | undefined
    let selectedKey: OracleHopKey | undefined
    for (const [key, label] of labels) {
      if (!closed.has(key) && (!selected || label.g < selected.g)) {
        selected = label
        selectedKey = key
      }
    }
    if (!selected || selectedKey === undefined) return Infinity
    if (selected.portId === goal) return selected.g
    closed.add(selectedKey)
    for (const portId of topology.regionIncidentPorts[selected.regionId]) {
      if (portId === selected.portId) continue
      const regions = topology.incidentPortRegion[portId]
      const regionId =
        portId === goal
          ? selected.regionId
          : regions[0] === selected.regionId
            ? regions[1]
            : regions[0]
      if (regionId === undefined) continue
      const dx = topology.portX[selected.portId] - topology.portX[portId]
      const dy = topology.portY[selected.portId] - topology.portY[portId]
      const g =
        selected.g +
        (problem.portPenalty?.[portId] ?? 0) +
        Math.sqrt(dx * dx + dy * dy)
      const key = `${portId}:${regionId}` as OracleHopKey
      if (g < (labels.get(key)?.g ?? Infinity)) {
        labels.set(key, { portId, regionId, g })
      }
    }
  }
}
