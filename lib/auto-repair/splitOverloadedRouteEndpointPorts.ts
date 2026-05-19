import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import type { PortId, RouteId } from "../types"

export interface SplitOverloadedRouteEndpointPortsOptions {
  maxRouteEndpointsPerPort?: number
}

export interface SplitOverloadedRouteEndpointPortsResult {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  clonedPortCount: number
  clonedPortIdsByOriginalPortId: Map<PortId, PortId[]>
}

type RouteEndpointUsage = {
  routeId: RouteId
  side: "start" | "end"
}

const cloneMetadataWithVirtualPortInfo = (
  metadata: unknown,
  originalPortId: PortId,
  cloneIndex: number,
) => {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...metadata }
      : metadata === undefined
        ? {}
        : { value: metadata }

  return {
    ...base,
    virtualPort: true,
    originalPortIndex: originalPortId,
    virtualPortCloneIndex: cloneIndex,
  }
}

const appendInt32 = (source: Int32Array | undefined, value: number) => {
  if (!source) return undefined
  const next = new Int32Array(source.length + 1)
  next.set(source)
  next[source.length] = value
  return next
}

const appendFloat64 = (source: Float64Array, value: number) => {
  const next = new Float64Array(source.length + 1)
  next.set(source)
  next[source.length] = value
  return next
}

const getRouteEndpointUsagesByPortId = (problem: TinyHyperGraphProblem) => {
  const usagesByPortId = new Map<PortId, RouteEndpointUsage[]>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    for (const side of ["start", "end"] as const) {
      const portId =
        side === "start"
          ? problem.routeStartPort[routeId]
          : problem.routeEndPort[routeId]
      const usages = usagesByPortId.get(portId) ?? []
      usages.push({ routeId, side })
      usagesByPortId.set(portId, usages)
    }
  }

  return usagesByPortId
}

export const splitOverloadedRouteEndpointPorts = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: SplitOverloadedRouteEndpointPortsOptions = {},
): SplitOverloadedRouteEndpointPortsResult => {
  const maxRouteEndpointsPerPort = Math.max(
    1,
    Math.floor(options.maxRouteEndpointsPerPort ?? 1),
  )
  const routeStartPort = new Int32Array(problem.routeStartPort)
  const routeEndPort = new Int32Array(problem.routeEndPort)
  const regionIncidentPorts = topology.regionIncidentPorts.map((ports) => [
    ...ports,
  ])
  const incidentPortRegion = topology.incidentPortRegion.map((regions) => [
    ...regions,
  ])
  const portAngleForRegion1 = [...topology.portAngleForRegion1]
  const portAngleForRegion2 = topology.portAngleForRegion2
    ? [...topology.portAngleForRegion2]
    : undefined
  const portSectionMask = [...problem.portSectionMask]
  let portX = new Float64Array(topology.portX)
  let portY = new Float64Array(topology.portY)
  let portZ = new Int32Array(topology.portZ)
  const portMetadata = topology.portMetadata
    ? [...topology.portMetadata]
    : undefined
  const clonedPortIdsByOriginalPortId = new Map<PortId, PortId[]>()

  for (const [originalPortId, usages] of getRouteEndpointUsagesByPortId(
    problem,
  )) {
    if (usages.length <= maxRouteEndpointsPerPort) {
      continue
    }

    for (
      let usageIndex = maxRouteEndpointsPerPort;
      usageIndex < usages.length;
      usageIndex++
    ) {
      const usage = usages[usageIndex]!
      const clonedPortId = incidentPortRegion.length
      const originalIncidentRegions =
        topology.incidentPortRegion[originalPortId] ?? []

      incidentPortRegion.push([...originalIncidentRegions])
      for (const regionId of originalIncidentRegions) {
        regionIncidentPorts[regionId]?.push(clonedPortId)
      }

      portAngleForRegion1.push(topology.portAngleForRegion1[originalPortId])
      portAngleForRegion2?.push(
        topology.portAngleForRegion2?.[originalPortId] ??
          topology.portAngleForRegion1[originalPortId],
      )
      portX = appendFloat64(portX, topology.portX[originalPortId])
      portY = appendFloat64(portY, topology.portY[originalPortId])
      portZ = appendInt32(portZ, topology.portZ[originalPortId])!
      portSectionMask.push(problem.portSectionMask[originalPortId] ?? 1)
      portMetadata?.push(
        cloneMetadataWithVirtualPortInfo(
          topology.portMetadata?.[originalPortId],
          originalPortId,
          usageIndex - maxRouteEndpointsPerPort,
        ),
      )

      const clonedPortIds =
        clonedPortIdsByOriginalPortId.get(originalPortId) ?? []
      clonedPortIds.push(clonedPortId)
      clonedPortIdsByOriginalPortId.set(originalPortId, clonedPortIds)

      if (usage.side === "start") {
        routeStartPort[usage.routeId] = clonedPortId
      } else {
        routeEndPort[usage.routeId] = clonedPortId
      }
    }
  }

  const topologyWithSplitPorts: TinyHyperGraphTopology = {
    ...topology,
    portCount: incidentPortRegion.length,
    regionIncidentPorts,
    incidentPortRegion,
    portAngleForRegion1: Int32Array.from(portAngleForRegion1),
    portAngleForRegion2: portAngleForRegion2
      ? Int32Array.from(portAngleForRegion2)
      : undefined,
    portX,
    portY,
    portZ,
    portMetadata,
  }

  return {
    topology: topologyWithSplitPorts,
    problem: {
      ...problem,
      portSectionMask: Int8Array.from(portSectionMask),
      routeStartPort,
      routeEndPort,
      routeNet: new Int32Array(problem.routeNet),
      regionNetId: new Int32Array(problem.regionNetId),
    },
    clonedPortCount: topologyWithSplitPorts.portCount - topology.portCount,
    clonedPortIdsByOriginalPortId,
  }
}
