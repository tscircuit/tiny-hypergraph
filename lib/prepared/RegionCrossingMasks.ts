import type { RegionIntersectionCache } from "../types"

type AngleMasks = {
  lowerLess: Uint32Array
  lowerAtMost: Uint32Array
  upperLess: Uint32Array
  upperAtMost: Uint32Array
}

const popcount = (value: number): number => {
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  value = (value + (value >>> 4)) & 0x0f0f0f0f
  return Math.imul(value, 0x01010101) >>> 24
}

/** Cache endpoint comparisons for an immutable region-intersection snapshot. */
export class RegionCrossingMasks {
  hasSameLayerCrossing = false
  private readonly angles = new Map<number, AngleMasks>()
  private readonly compatible = new Map<number, Uint32Array>()
  private readonly nets = new Map<number, Uint32Array>()
  private readonly wordCount: number

  constructor(private readonly cache: RegionIntersectionCache) {
    this.wordCount = Math.ceil(cache.netIds.length / 32)
    for (let i = 0; i < cache.netIds.length; i++) {
      const net = cache.netIds[i]!
      let bits = this.nets.get(net)
      if (!bits) {
        bits = new Uint32Array(this.wordCount)
        this.nets.set(net, bits)
      }
      bits[i >>> 5] = bits[i >>> 5]! | (1 << (i & 31))
    }
  }

  private getAngle(angle: number): AngleMasks {
    const existing = this.angles.get(angle)
    if (existing) return existing
    const masks: AngleMasks = {
      lowerLess: new Uint32Array(this.wordCount),
      lowerAtMost: new Uint32Array(this.wordCount),
      upperLess: new Uint32Array(this.wordCount),
      upperAtMost: new Uint32Array(this.wordCount),
    }
    for (let i = 0; i < this.cache.netIds.length; i++) {
      const word = i >>> 5, bit = 1 << (i & 31)
      const lower = this.cache.lesserAngles[i]!
      const upper = this.cache.greaterAngles[i]!
      if (lower < angle) masks.lowerLess[word] = masks.lowerLess[word]! | bit
      if (lower <= angle) masks.lowerAtMost[word] = masks.lowerAtMost[word]! | bit
      if (upper < angle) masks.upperLess[word] = masks.upperLess[word]! | bit
      if (upper <= angle) masks.upperAtMost[word] = masks.upperAtMost[word]! | bit
    }
    this.angles.set(angle, masks)
    return masks
  }

  count(a: number, b: number, layerMask: number, net: number): number {
    const lo = this.getAngle(Math.min(a, b))
    const hi = this.getAngle(Math.max(a, b))
    let compatible = this.compatible.get(layerMask)
    if (!compatible) {
      compatible = new Uint32Array(this.wordCount)
      for (let i = 0; i < this.cache.netIds.length; i++) {
        if (layerMask & this.cache.layerMasks[i]!)
          compatible[i >>> 5] = compatible[i >>> 5]! | (1 << (i & 31))
      }
      this.compatible.set(layerMask, compatible)
    }
    const own = this.nets.get(net)
    let same = 0, cross = 0
    for (let i = 0; i < this.wordCount; i++) {
      const lowerInside = hi.lowerLess[i]! & ~lo.lowerAtMost[i]!
      const upperInside = hi.upperLess[i]! & ~lo.upperAtMost[i]!
      const crossings = (lowerInside ^ upperInside) & ~(own?.[i] ?? 0)
      same += popcount(crossings & compatible[i]!)
      cross += popcount(crossings & ~compatible[i]!)
    }
    this.hasSameLayerCrossing = same > 0
    return 2 * same + cross
  }
}
