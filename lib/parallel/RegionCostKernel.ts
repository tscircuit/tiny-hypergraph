import { regionCostKernelBytes } from "./regionCostKernelBytes"
import { COST_SEGMENT_CAPACITY, type RegionCostWorkerInput } from "./regionCostTypes"

type KernelExports = {
  memory: WebAssembly.Memory
  fillRegionCosts: (angles: number, layers: number, enabled: number, segments: number, counts: number, output: number, size: number, count: number, netId: number, area: number, availableLayers: number, viaDiameter: number, density: number) => void
}

export class RegionCostKernel {
  private exports = new WebAssembly.Instance(new WebAssembly.Module(regionCostKernelBytes)).exports as unknown as KernelExports

  compute(data: RegionCostWorkerInput, slot: number, region: number, count: number, netId: number): Float64Array {
    const start = data.portOffsets[region]!
    const size = data.portOffsets[region + 1]! - start
    const angles = 4096
    const layers = angles + size * 4
    const enabled = layers + size * 4
    const segments = Math.ceil((enabled + size) / 4) * 4
    const counts = Math.ceil((segments + count * 16) / 8) * 8
    const output = counts + 40
    const neededPages = Math.ceil((output + size * size * 8) / 65536)
    const memory = this.exports.memory
    if (memory.buffer.byteLength < neededPages * 65536) memory.grow(neededPages - memory.buffer.byteLength / 65536)
    new Int32Array(memory.buffer, angles, size).set(data.angles.subarray(start, start + size))
    new Int32Array(memory.buffer, layers, size).set(data.layers.subarray(start, start + size))
    new Uint8Array(memory.buffer, enabled, size).set(data.portMasks.subarray(slot * data.maxPorts, slot * data.maxPorts + size))
    for (let field = 0; field < 4; field++) {
      const source = (slot * 4 + field) * COST_SEGMENT_CAPACITY
      new Int32Array(memory.buffer, segments + field * count * 4, count).set(data.slotSegments.subarray(source, source + count))
    }
    new Float64Array(memory.buffer, counts, 5).set(data.slotCounts.subarray(slot * 5, slot * 5 + 5))
    this.exports.fillRegionCosts(angles, layers, enabled, segments, counts, output, size, count, netId, data.areas[region]!, data.layerMasks[region]!, data.minViaPadDiameter, data.traceDensityCostFactor)
    return new Float64Array(memory.buffer, output, size * size)
  }
}
