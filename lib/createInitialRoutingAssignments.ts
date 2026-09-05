import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { DuplicatedPortSummary } from "./DuplicateCongestedPortSolver"
import type { NetId } from "./types"

type SerializedPortId = string
type SerializedRegionId = string
type SerializedConnectionId = string

export interface IndependentRouteAssignment {
  connectionId: SerializedConnectionId
  netId: NetId
  regionId: SerializedRegionId
  fromPortId: SerializedPortId
  toPortId: SerializedPortId
}

/** Allocate separate crossing points to independent nets before seeding routes. */
export const createInitialRoutingAssignments = (params: {
  serializedHyperGraph: SerializedHyperGraph
  duplicatedPorts: DuplicatedPortSummary[]
  independentRouteAssignments: IndependentRouteAssignment[]
}): SerializedHyperGraph => {
  const availablePortIds = new Map<SerializedPortId, SerializedPortId[]>(
    params.duplicatedPorts.map(({ sourcePortId, duplicatePortIds }) => [
      sourcePortId,
      [sourcePortId, ...duplicatePortIds],
    ]),
  )
  const assignedPortIds = new Map<
    SerializedPortId,
    Map<NetId, SerializedPortId>
  >()
  const netByConnectionId = new Map<SerializedConnectionId, NetId>(
    params.independentRouteAssignments.map(({ connectionId, netId }) => [
      connectionId,
      netId,
    ]),
  )
  for (const region of params.serializedHyperGraph.regions) {
    for (const assignment of region.assignments ?? []) {
      const netId = netByConnectionId.get(assignment.connectionId)
      if (netId === undefined) {
        throw new Error(
          `Initial routing is missing connection ${assignment.connectionId}`,
        )
      }
      for (const sourcePortId of [
        assignment.regionPort1Id,
        assignment.regionPort2Id,
      ]) {
        const netPortIds = assignedPortIds.get(sourcePortId)
        if (netPortIds && !netPortIds.has(netId)) {
          throw new Error(
            `Existing assignments share port ${sourcePortId} across different nets`,
          )
        }
        assignedPortIds.set(sourcePortId, new Map([[netId, sourcePortId]]))
      }
    }
  }
  const regions = params.serializedHyperGraph.regions.map((region) => ({
    ...region,
    assignments: [] as NonNullable<typeof region.assignments>,
  }))
  const regionById = new Map<SerializedRegionId, (typeof regions)[number]>(
    regions.map((region) => [region.regionId, region]),
  )

  for (const assignment of params.independentRouteAssignments) {
    const region = regionById.get(assignment.regionId)
    if (!region) {
      throw new Error(
        `Initial routing references missing region ${assignment.regionId}`,
      )
    }
    const allocatedPortIds: SerializedPortId[] = []
    for (const sourcePortId of [assignment.fromPortId, assignment.toPortId]) {
      let netPortIds = assignedPortIds.get(sourcePortId)
      if (!netPortIds) {
        netPortIds = new Map<NetId, SerializedPortId>()
        assignedPortIds.set(sourcePortId, netPortIds)
      }
      let allocatedPortId = netPortIds.get(assignment.netId)
      if (allocatedPortId === undefined) {
        allocatedPortId = (availablePortIds.get(sourcePortId) ?? [
          sourcePortId,
        ])[netPortIds.size]
        if (allocatedPortId === undefined) {
          throw new Error(
            `Initial routing has insufficient crossing points at ${sourcePortId}`,
          )
        }
        netPortIds.set(assignment.netId, allocatedPortId)
      }
      allocatedPortIds.push(allocatedPortId)
    }
    region.assignments.push({
      connectionId: assignment.connectionId,
      regionPort1Id: allocatedPortIds[0],
      regionPort2Id: allocatedPortIds[1],
    })
  }

  return { ...params.serializedHyperGraph, regions }
}
