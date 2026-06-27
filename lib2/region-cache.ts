import type { RegionIntersectionCache } from "./types"
import type { NetId } from "./types"
import type { SegmentGeometry } from "./segment-geometry"

/** Counts added by one candidate segment. */
export type RegionSegmentDelta = {
  readonly sameLayerIntersections: number
  readonly crossingLayerIntersections: number
  readonly entryExitLayerChanges: number
}

/** Computes region cost from accumulated intersection counters. */
export type RegionCostFn = (
  sameLayerIntersections: number,
  crossingLayerIntersections: number,
  entryExitLayerChanges: number,
  segmentCount: number,
) => number

const EMPTY_INT32 = new Int32Array(0)

/**
 * Create the public empty region cache shape.
 *
 * @returns An empty region intersection cache.
 */
export function createEmptyCache(): RegionIntersectionCache {
  return {
    netIds: EMPTY_INT32,
    lesserAngles: EMPTY_INT32,
    greaterAngles: EMPTY_INT32,
    layerMasks: EMPTY_INT32,
    existingCrossingLayerIntersections: 0,
    existingSameLayerIntersections: 0,
    existingEntryExitLayerChanges: 0,
    existingRegionCost: 0,
    existingSegmentCount: 0,
  }
}

/**
 * Mutable backing store for one region's segment cache.
 *
 * The public solver state still receives exact-length typed-array views. The
 * backing store keeps capacity between appends, so lib2 avoids copying all
 * previous segment arrays on every committed segment.
 */
export class MutableRegionCache {
  private netIds: Int32Array
  private lesserAngles: Int32Array
  private greaterAngles: Int32Array
  private layerMasks: Int32Array
  private segmentCount: number
  private visibleCache: RegionIntersectionCache

  private constructor(cache: RegionIntersectionCache) {
    this.segmentCount = cache.existingSegmentCount
    const capacity = Math.max(1, this.segmentCount)
    this.netIds = new Int32Array(capacity)
    this.lesserAngles = new Int32Array(capacity)
    this.greaterAngles = new Int32Array(capacity)
    this.layerMasks = new Int32Array(capacity)
    this.netIds.set(cache.netIds)
    this.lesserAngles.set(cache.lesserAngles)
    this.greaterAngles.set(cache.greaterAngles)
    this.layerMasks.set(cache.layerMasks)
    this.visibleCache = cache
  }

  /**
   * Create mutable backing storage from a public cache.
   *
   * @param cache - Public exact-length cache.
   * @returns Mutable cache storage.
   */
  static from(cache: RegionIntersectionCache): MutableRegionCache {
    return new MutableRegionCache(cache)
  }

  /**
   * Check whether this store still owns the public cache in solver state.
   *
   * @param cache - Public cache currently stored on the solver state.
   * @returns True when the store and public state are aligned.
   */
  owns(cache: RegionIntersectionCache): boolean {
    return this.visibleCache === cache
  }

  /** Current same-layer intersection count. */
  get sameLayerIntersections(): number {
    return this.visibleCache.existingSameLayerIntersections
  }

  /** Current crossing-layer intersection count. */
  get crossingLayerIntersections(): number {
    return this.visibleCache.existingCrossingLayerIntersections
  }

  /** Current entry/exit layer-change count. */
  get entryExitLayerChanges(): number {
    return this.visibleCache.existingEntryExitLayerChanges
  }

  /** Current committed segment count. */
  get committedSegmentCount(): number {
    return this.segmentCount
  }

  /** Current computed region cost. */
  get regionCost(): number {
    return this.visibleCache.existingRegionCost
  }

  /**
   * Count the intersections added by a candidate segment.
   *
   * @param netId - Net id for the candidate route.
   * @param geometry - Segment geometry inside this region.
   * @returns Delta counters for the candidate segment.
   */
  countDelta(netId: NetId, geometry: SegmentGeometry): RegionSegmentDelta {
    let sameLayerIntersections = 0
    let crossingLayerIntersections = 0

    for (let index = 0; index < this.segmentCount; index += 1) {
      if (netId === this.netIds[index]) {
        continue
      }

      const lesserAngleIsInsideInterval =
        geometry.lesserAngle < this.lesserAngles[index] &&
        this.lesserAngles[index] < geometry.greaterAngle
      const greaterAngleIsInsideInterval =
        geometry.lesserAngle < this.greaterAngles[index] &&
        this.greaterAngles[index] < geometry.greaterAngle

      if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) {
        continue
      }

      if ((geometry.layerMask & this.layerMasks[index]) !== 0) {
        sameLayerIntersections += 1
      } else {
        crossingLayerIntersections += 1
      }
    }

    return {
      sameLayerIntersections,
      crossingLayerIntersections,
      entryExitLayerChanges: geometry.entryExitLayerChanges,
    }
  }

  /**
   * Compute the incremental region cost for a candidate segment.
   *
   * @param delta - Candidate segment delta counters.
   * @param computeRegionCost - Region cost function for this region.
   * @returns Additional cost compared with the current region cost.
   */
  getAddedCost(
    delta: RegionSegmentDelta,
    computeRegionCost: RegionCostFn,
  ): number {
    const nextSameLayerIntersections =
      this.visibleCache.existingSameLayerIntersections +
      delta.sameLayerIntersections
    const nextCrossingLayerIntersections =
      this.visibleCache.existingCrossingLayerIntersections +
      delta.crossingLayerIntersections
    const nextEntryExitLayerChanges =
      this.visibleCache.existingEntryExitLayerChanges +
      delta.entryExitLayerChanges
    const nextSegmentCount = this.segmentCount + 1

    return (
      computeRegionCost(
        nextSameLayerIntersections,
        nextCrossingLayerIntersections,
        nextEntryExitLayerChanges,
        nextSegmentCount,
      ) - this.visibleCache.existingRegionCost
    )
  }

  /**
   * Append a committed segment and expose an updated public cache view.
   *
   * @param netId - Net id for the committed route.
   * @param geometry - Segment geometry inside this region.
   * @param delta - Intersection counters added by the segment.
   * @param computeRegionCost - Region cost function for this region.
   * @returns Updated exact-length public cache view.
   */
  append(
    netId: NetId,
    geometry: SegmentGeometry,
    delta: RegionSegmentDelta,
    computeRegionCost: RegionCostFn,
  ): RegionIntersectionCache {
    this.ensureCapacity(this.segmentCount + 1)

    const writeIndex = this.segmentCount
    this.netIds[writeIndex] = netId
    this.lesserAngles[writeIndex] = geometry.lesserAngle
    this.greaterAngles[writeIndex] = geometry.greaterAngle
    this.layerMasks[writeIndex] = geometry.layerMask
    this.segmentCount += 1

    const existingSameLayerIntersections =
      this.visibleCache.existingSameLayerIntersections +
      delta.sameLayerIntersections
    const existingCrossingLayerIntersections =
      this.visibleCache.existingCrossingLayerIntersections +
      delta.crossingLayerIntersections
    const existingEntryExitLayerChanges =
      this.visibleCache.existingEntryExitLayerChanges +
      delta.entryExitLayerChanges

    this.visibleCache = {
      netIds: this.netIds.subarray(0, this.segmentCount),
      lesserAngles: this.lesserAngles.subarray(0, this.segmentCount),
      greaterAngles: this.greaterAngles.subarray(0, this.segmentCount),
      layerMasks: this.layerMasks.subarray(0, this.segmentCount),
      existingSameLayerIntersections,
      existingCrossingLayerIntersections,
      existingEntryExitLayerChanges,
      existingSegmentCount: this.segmentCount,
      existingRegionCost: computeRegionCost(
        existingSameLayerIntersections,
        existingCrossingLayerIntersections,
        existingEntryExitLayerChanges,
        this.segmentCount,
      ),
    }

    return this.visibleCache
  }

  private ensureCapacity(requiredCapacity: number) {
    if (requiredCapacity <= this.netIds.length) {
      return
    }

    const nextCapacity = Math.max(requiredCapacity, this.netIds.length * 2)
    const nextNetIds = new Int32Array(nextCapacity)
    const nextLesserAngles = new Int32Array(nextCapacity)
    const nextGreaterAngles = new Int32Array(nextCapacity)
    const nextLayerMasks = new Int32Array(nextCapacity)

    nextNetIds.set(this.netIds.subarray(0, this.segmentCount))
    nextLesserAngles.set(this.lesserAngles.subarray(0, this.segmentCount))
    nextGreaterAngles.set(this.greaterAngles.subarray(0, this.segmentCount))
    nextLayerMasks.set(this.layerMasks.subarray(0, this.segmentCount))

    this.netIds = nextNetIds
    this.lesserAngles = nextLesserAngles
    this.greaterAngles = nextGreaterAngles
    this.layerMasks = nextLayerMasks
  }
}
