import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import type { NetId, PortId, RegionId } from "../types"

export interface RegionGraphEdge {
  edgeId: number
  regionIdA: RegionId
  regionIdB: RegionId
  portIds: PortId[]
  representativePortId: PortId
  centerDistance: number
}

export interface RegionGraph {
  regionCount: number
  edgeCount: number
  regionCenterX: Float64Array
  regionCenterY: Float64Array
  regionWidth: Float64Array
  regionHeight: Float64Array
  regionCapacity: Float64Array
  regionMetadata?: any[]
  edges: RegionGraphEdge[]
  incidentEdges: RegionGraphEdge[][]
}

export interface RegionPathProblem {
  routeCount: number
  routeStartRegion: Int32Array
  routeEndRegion: Int32Array
  routeNet: Int32Array
  routeMetadata?: any[]
  regionNetId: Int32Array
}

const getSerializedRegionIdFromMetadata = (
  metadata: unknown,
): string | undefined => {
  if (!metadata || typeof metadata !== "object") {
    return undefined
  }

  const regionMetadata = metadata as {
    serializedRegionId?: unknown
    regionId?: unknown
    capacityMeshNodeId?: unknown
  }

  if (typeof regionMetadata.serializedRegionId === "string") {
    return regionMetadata.serializedRegionId
  }

  if (typeof regionMetadata.regionId === "string") {
    return regionMetadata.regionId
  }

  if (typeof regionMetadata.capacityMeshNodeId === "string") {
    return regionMetadata.capacityMeshNodeId
  }

  return undefined
}

const getRegionIndexBySerializedId = (topology: TinyHyperGraphTopology) => {
  const regionIndexBySerializedId = new Map<string, RegionId>()

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const serializedRegionId = getSerializedRegionIdFromMetadata(
      topology.regionMetadata?.[regionId],
    )

    if (serializedRegionId) {
      regionIndexBySerializedId.set(serializedRegionId, regionId)
    }
  }

  return regionIndexBySerializedId
}

const getEndpointRegionFallback = (
  topology: TinyHyperGraphTopology,
  regionNetId: ArrayLike<NetId>,
  routeNetId: NetId,
  portId: PortId,
): RegionId => {
  const incidentRegions = topology.incidentPortRegion[portId] ?? []

  const reservedForRoute = incidentRegions.find(
    (regionId) => regionNetId[regionId] === routeNetId,
  )
  if (reservedForRoute !== undefined) {
    return reservedForRoute
  }

  const unrestrictedRegion = incidentRegions.find(
    (regionId) => regionNetId[regionId] === -1,
  )
  if (unrestrictedRegion !== undefined) {
    return unrestrictedRegion
  }

  const firstIncidentRegion = incidentRegions[0]
  if (firstIncidentRegion !== undefined) {
    return firstIncidentRegion
  }

  throw new Error(`Port ${portId} has no incident regions`)
}

export const createRegionGraph = (
  topology: TinyHyperGraphTopology,
): RegionGraph => {
  const edgeByPairKey = new Map<string, RegionGraphEdge>()

  for (let portId = 0; portId < topology.portCount; portId++) {
    const [regionIdA, regionIdB] = topology.incidentPortRegion[portId] ?? []

    if (regionIdA === undefined || regionIdB === undefined) {
      continue
    }

    const key =
      regionIdA < regionIdB
        ? `${regionIdA}:${regionIdB}`
        : `${regionIdB}:${regionIdA}`

    const existingEdge = edgeByPairKey.get(key)
    if (existingEdge) {
      existingEdge.portIds.push(portId)
      continue
    }

    const dx =
      topology.regionCenterX[regionIdA] - topology.regionCenterX[regionIdB]
    const dy =
      topology.regionCenterY[regionIdA] - topology.regionCenterY[regionIdB]

    edgeByPairKey.set(key, {
      edgeId: edgeByPairKey.size,
      regionIdA,
      regionIdB,
      portIds: [portId],
      representativePortId: portId,
      centerDistance: Math.hypot(dx, dy),
    })
  }

  const edges = [...edgeByPairKey.values()]
  const incidentEdges = Array.from(
    { length: topology.regionCount },
    () => [] as RegionGraphEdge[],
  )

  for (const edge of edges) {
    incidentEdges[edge.regionIdA]!.push(edge)
    incidentEdges[edge.regionIdB]!.push(edge)
  }

  return {
    regionCount: topology.regionCount,
    edgeCount: edges.length,
    regionCenterX: topology.regionCenterX,
    regionCenterY: topology.regionCenterY,
    regionWidth: topology.regionWidth,
    regionHeight: topology.regionHeight,
    regionCapacity: Float64Array.from(
      { length: topology.regionCount },
      (_, regionId) =>
        Math.max(
          1e-6,
          topology.regionWidth[regionId] * topology.regionHeight[regionId],
        ),
    ),
    regionMetadata: topology.regionMetadata,
    edges,
    incidentEdges,
  }
}

export const createRegionPathProblem = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): RegionPathProblem => {
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)
  const routeStartRegion = new Int32Array(problem.routeCount)
  const routeEndRegion = new Int32Array(problem.routeCount)

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeMetadata = problem.routeMetadata?.[routeId] as
      | {
          startRegionId?: unknown
          endRegionId?: unknown
        }
      | undefined
    const serializedStartRegionId =
      typeof routeMetadata?.startRegionId === "string"
        ? routeMetadata.startRegionId
        : undefined
    const serializedEndRegionId =
      typeof routeMetadata?.endRegionId === "string"
        ? routeMetadata.endRegionId
        : undefined

    routeStartRegion[routeId] =
      (serializedStartRegionId !== undefined
        ? regionIndexBySerializedId.get(serializedStartRegionId)
        : undefined) ??
      getEndpointRegionFallback(
        topology,
        problem.regionNetId,
        problem.routeNet[routeId],
        problem.routeStartPort[routeId],
      )

    routeEndRegion[routeId] =
      (serializedEndRegionId !== undefined
        ? regionIndexBySerializedId.get(serializedEndRegionId)
        : undefined) ??
      getEndpointRegionFallback(
        topology,
        problem.regionNetId,
        problem.routeNet[routeId],
        problem.routeEndPort[routeId],
      )
  }

  return {
    routeCount: problem.routeCount,
    routeStartRegion,
    routeEndRegion,
    routeNet: new Int32Array(problem.routeNet),
    routeMetadata: problem.routeMetadata,
    regionNetId: new Int32Array(problem.regionNetId),
  }
}

export const getSerializedRegionId = (
  regionGraph: Pick<RegionGraph, "regionMetadata">,
  regionId: RegionId,
) =>
  getSerializedRegionIdFromMetadata(regionGraph.regionMetadata?.[regionId]) ??
  `region-${regionId}`
