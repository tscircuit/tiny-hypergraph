import { MinHeap } from "../MinHeap"
import type { TinyHyperGraphTopology } from "../core"
import type { RegionId } from "../types"
import { BUS_CANDIDATE_EPSILON } from "./busSolverTypes"

interface RegionSearchCandidate {
  regionId: RegionId
  cost: number
}

const compareRegionCandidates = (
  left: RegionSearchCandidate,
  right: RegionSearchCandidate,
) => left.cost - right.cost

export const computeCenterGoalHopDistance = (
  regionCount: number,
  centerGoalTransitRegionId: RegionId,
  centerlineNeighborRegionIdsByRegion: readonly RegionId[][],
) => {
  const hopDistanceByRegion = new Int32Array(regionCount).fill(-1)

  if (centerGoalTransitRegionId < 0) {
    return hopDistanceByRegion
  }

  const queuedRegionIds = [centerGoalTransitRegionId]
  hopDistanceByRegion[centerGoalTransitRegionId] = 0

  for (let queueIndex = 0; queueIndex < queuedRegionIds.length; queueIndex++) {
    const currentRegionId = queuedRegionIds[queueIndex]!
    const nextHopDistance = hopDistanceByRegion[currentRegionId]! + 1

    for (const neighborRegionId of centerlineNeighborRegionIdsByRegion[
      currentRegionId
    ] ?? []) {
      if (hopDistanceByRegion[neighborRegionId] !== -1) {
        continue
      }

      hopDistanceByRegion[neighborRegionId] = nextHopDistance
      queuedRegionIds.push(neighborRegionId)
    }
  }

  return hopDistanceByRegion
}

export const computeRegionDistanceToGoal = (
  topology: TinyHyperGraphTopology,
  centerGoalTransitRegionId: RegionId,
  centerlineNeighborRegionIdsByRegion: readonly RegionId[][],
) => {
  const regionDistanceToGoalByRegion = new Float64Array(
    topology.regionCount,
  ).fill(Number.POSITIVE_INFINITY)
  const candidateQueue = new MinHeap<RegionSearchCandidate>(
    [],
    compareRegionCandidates,
  )

  regionDistanceToGoalByRegion[centerGoalTransitRegionId] = 0
  candidateQueue.queue({
    regionId: centerGoalTransitRegionId,
    cost: 0,
  })

  while (candidateQueue.length > 0) {
    const currentCandidate = candidateQueue.dequeue()
    if (!currentCandidate) {
      break
    }

    if (
      currentCandidate.cost >
      regionDistanceToGoalByRegion[currentCandidate.regionId]! +
        BUS_CANDIDATE_EPSILON
    ) {
      continue
    }

    for (const nextRegionId of centerlineNeighborRegionIdsByRegion[
      currentCandidate.regionId
    ] ?? []) {
      const edgeCost = Math.hypot(
        topology.regionCenterX[currentCandidate.regionId] -
          topology.regionCenterX[nextRegionId],
        topology.regionCenterY[currentCandidate.regionId] -
          topology.regionCenterY[nextRegionId],
      )
      const nextCost = currentCandidate.cost + edgeCost

      if (nextCost >= regionDistanceToGoalByRegion[nextRegionId]!) {
        continue
      }

      regionDistanceToGoalByRegion[nextRegionId] = nextCost
      candidateQueue.queue({
        regionId: nextRegionId,
        cost: nextCost,
      })
    }
  }

  return regionDistanceToGoalByRegion
}
