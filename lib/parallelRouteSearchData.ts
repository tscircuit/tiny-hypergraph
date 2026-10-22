import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
  type TinyHyperGraphWorkingState,
} from "./core"
import type { RegionIntersectionCache } from "./types"

type NumericArray = Int8Array | Int32Array | Float64Array

type PackedTopology = Omit<
  TinyHyperGraphTopology,
  | "regionIncidentPorts"
  | "incidentPortRegion"
  | "regionMetadata"
  | "portMetadata"
> & {
  regionPortIds: Int32Array
  regionPortOffsets: Int32Array
  portRegionIds: Int32Array
  portRegionOffsets: Int32Array
}

export interface SharedRouteSearchGraph {
  id: number
  topology: PackedTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  distanceAware: boolean
}

export interface SharedRouteSearchSnapshot {
  portAssignment: Int32Array
  regionCongestionCost: Float64Array
  regionIds: Int32Array
  segmentOffsets: Int32Array
  geometry: Int32Array
  costs: Float64Array
}

let nextGraphId = 1

function share<T extends NumericArray>(values: T): T {
  const Constructor = values.constructor as {
    new (buffer: SharedArrayBuffer): T
  }
  const shared = new Constructor(new SharedArrayBuffer(values.byteLength))
  shared.set(values)
  return shared
}

function packIncidence(rows: number[][]): {
  ids: Int32Array
  offsets: Int32Array
} {
  const offsets = new Int32Array(rows.length + 1)
  for (let index = 0; index < rows.length; index++) {
    offsets[index + 1] = offsets[index] + rows[index].length
  }
  const ids = new Int32Array(offsets[rows.length])
  for (let index = 0; index < rows.length; index++)
    ids.set(rows[index], offsets[index])
  return { ids: share(ids), offsets: share(offsets) }
}

export function createSharedRouteSearchGraph(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: TinyHyperGraphSolverOptions,
  distanceAware: boolean,
): SharedRouteSearchGraph {
  const regionPorts = packIncidence(topology.regionIncidentPorts)
  const portRegions = packIncidence(topology.incidentPortRegion)
  return {
    id: nextGraphId++,
    distanceAware,
    options,
    topology: {
      portCount: topology.portCount,
      regionCount: topology.regionCount,
      regionPortIds: regionPorts.ids,
      regionPortOffsets: regionPorts.offsets,
      portRegionIds: portRegions.ids,
      portRegionOffsets: portRegions.offsets,
      regionWidth: share(topology.regionWidth),
      regionHeight: share(topology.regionHeight),
      regionCenterX: share(topology.regionCenterX),
      regionCenterY: share(topology.regionCenterY),
      regionAvailableZMask:
        topology.regionAvailableZMask && share(topology.regionAvailableZMask),
      portAngleForRegion1: share(topology.portAngleForRegion1),
      portAngleForRegion2:
        topology.portAngleForRegion2 && share(topology.portAngleForRegion2),
      portX: share(topology.portX),
      portY: share(topology.portY),
      portZ: share(topology.portZ),
    },
    problem: {
      routeCount: problem.routeCount,
      portSectionMask: share(problem.portSectionMask),
      routeStartPort: share(problem.routeStartPort),
      routeEndPort: share(problem.routeEndPort),
      routeNet: share(problem.routeNet),
      regionNetId: share(problem.regionNetId),
      portPenalty: problem.portPenalty && share(problem.portPenalty),
    },
  }
}

export function unpackRouteSearchTopology(
  packed: PackedTopology,
): TinyHyperGraphTopology {
  return {
    ...packed,
    regionIncidentPorts: Array.from(
      { length: packed.regionCount },
      (_, index) =>
        Array.from(
          packed.regionPortIds.subarray(
            packed.regionPortOffsets[index],
            packed.regionPortOffsets[index + 1],
          ),
        ),
    ),
    incidentPortRegion: Array.from({ length: packed.portCount }, (_, index) =>
      Array.from(
        packed.portRegionIds.subarray(
          packed.portRegionOffsets[index],
          packed.portRegionOffsets[index + 1],
        ),
      ),
    ),
  }
}

/** Numeric snapshots are read-only until every search in the batch finishes. */
export function createSharedRouteSearchSnapshot(
  state: TinyHyperGraphWorkingState,
): SharedRouteSearchSnapshot {
  const regionIds: number[] = []
  const offsets = [0]
  for (
    let regionId = 0;
    regionId < state.regionIntersectionCaches.length;
    regionId++
  ) {
    const cache = state.regionIntersectionCaches[regionId]
    if (cache.existingSegmentCount === 0) continue
    regionIds.push(regionId)
    offsets.push(offsets[offsets.length - 1] + cache.netIds.length)
  }
  const segmentCount = offsets[offsets.length - 1]
  const geometry = new Int32Array(
    new SharedArrayBuffer(segmentCount * 4 * Int32Array.BYTES_PER_ELEMENT),
  )
  const costs = new Float64Array(
    new SharedArrayBuffer(
      regionIds.length * 5 * Float64Array.BYTES_PER_ELEMENT,
    ),
  )
  for (let index = 0; index < regionIds.length; index++) {
    const cache = state.regionIntersectionCaches[regionIds[index]]
    const start = offsets[index]
    geometry.set(cache.netIds, start)
    geometry.set(cache.lesserAngles, segmentCount + start)
    geometry.set(cache.greaterAngles, segmentCount * 2 + start)
    geometry.set(cache.layerMasks, segmentCount * 3 + start)
    costs.set(
      [
        cache.existingCrossingLayerIntersections,
        cache.existingSameLayerIntersections,
        cache.existingEntryExitLayerChanges,
        cache.existingRegionCost,
        cache.existingSegmentCount,
      ],
      index * 5,
    )
  }
  return {
    portAssignment: share(state.portAssignment),
    regionCongestionCost: share(state.regionCongestionCost),
    regionIds: share(Int32Array.from(regionIds)),
    segmentOffsets: share(Int32Array.from(offsets)),
    geometry,
    costs,
  }
}

export function unpackRouteSearchCaches(
  snapshot: SharedRouteSearchSnapshot,
  regionCount: number,
): RegionIntersectionCache[] {
  const caches = new Array<RegionIntersectionCache>(regionCount).fill(
    createEmptyRegionIntersectionCache(),
  )
  const total = snapshot.segmentOffsets[snapshot.regionIds.length]
  for (let index = 0; index < snapshot.regionIds.length; index++) {
    const start = snapshot.segmentOffsets[index]
    const end = snapshot.segmentOffsets[index + 1]
    caches[snapshot.regionIds[index]] = {
      netIds: snapshot.geometry.subarray(start, end),
      lesserAngles: snapshot.geometry.subarray(total + start, total + end),
      greaterAngles: snapshot.geometry.subarray(
        total * 2 + start,
        total * 2 + end,
      ),
      layerMasks: snapshot.geometry.subarray(
        total * 3 + start,
        total * 3 + end,
      ),
      existingCrossingLayerIntersections: snapshot.costs[index * 5],
      existingSameLayerIntersections: snapshot.costs[index * 5 + 1],
      existingEntryExitLayerChanges: snapshot.costs[index * 5 + 2],
      existingRegionCost: snapshot.costs[index * 5 + 3],
      existingSegmentCount: snapshot.costs[index * 5 + 4],
    }
  }
  return caches
}
