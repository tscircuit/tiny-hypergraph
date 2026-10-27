// AssemblyScript: compile without --fastMath to preserve JavaScript operation order.
export function fillRegionCosts(
  anglesPtr: usize, layersPtr: usize, enabledPtr: usize,
  segmentsPtr: usize, countsPtr: usize, outputPtr: usize,
  size: i32, segmentCount: i32, netId: i32,
  area: f64, availableLayers: i32, viaDiameter: f64, densityFactor: f64,
): void {
  const existingSame = load<f64>(countsPtr)
  const existingCross = load<f64>(countsPtr + 8)
  const existingVias = load<f64>(countsPtr + 16)
  const existingCost = load<f64>(countsPtr + 24)
  const traceCount = load<f64>(countsPtr + 32) + 1.0
  const viaSize = viaDiameter + 0.15
  const viaSizeSq = viaSize * viaSize
  const traceMult = 1.0 + traceCount / 5.0
  const singleLayer = availableLayers > 0 && (availableLayers & (availableLayers - 1)) == 0
  let layerCount: i32 = 0
  if (availableLayers == 0) layerCount = 2
  else {
    let bits = <u32>availableLayers
    while (bits != 0) { layerCount += <i32>(bits & 1); bits >>= 1 }
  }
  const densityRatio = traceCount / <f64>layerCount
  const traceDensity = (densityFactor * (densityRatio * densityRatio) * (0.1 * 0.1)) / area
  const segmentBytes = <usize>segmentCount * 4
  for (let from: i32 = 0; from < size; from++) {
    const angle1 = load<i32>(anglesPtr + <usize>from * 4)
    const z1 = load<i32>(layersPtr + <usize>from * 4)
    for (let to: i32 = from; to < size; to++) {
      const output = outputPtr + (<usize>from * size + to) * 8
      const transpose = outputPtr + (<usize>to * size + from) * 8
      if (load<u8>(enabledPtr + from) == 0 || load<u8>(enabledPtr + to) == 0) {
        store<f64>(output, NaN); store<f64>(transpose, NaN); continue
      }
      const angle2 = load<i32>(anglesPtr + <usize>to * 4)
      const z2 = load<i32>(layersPtr + <usize>to * 4)
      const lesser = angle1 < angle2 ? angle1 : angle2
      const greater = angle1 < angle2 ? angle2 : angle1
      const layers = (1 << z1) | (1 << z2)
      let same: i32 = 0, cross: i32 = 0
      for (let segment: i32 = 0; segment < segmentCount; segment++) {
        const offset = <usize>segment * 4
        if (load<i32>(segmentsPtr + offset) == netId) continue
        const low = load<i32>(segmentsPtr + segmentBytes + offset)
        const high = load<i32>(segmentsPtr + segmentBytes * 2 + offset)
        const lowInside = lesser < low && low < greater
        const highInside = lesser < high && high < greater
        if (lowInside == highInside) continue
        if ((layers & load<i32>(segmentsPtr + segmentBytes * 3 + offset)) != 0) same++
        else cross++
      }
      if (singleLayer && same > 0) { store<f64>(output, Infinity); store<f64>(transpose, Infinity); continue }
      const newSame = existingSame + <f64>same
      const newCross = existingCross + <f64>cross
      const newVias = existingVias + (z1 != z2 ? 1.0 : 0.0)
      const vias = newSame * 2.0 + newCross * 1.0 + newVias * 1.0
      const impossible = singleLayer ? newSame * 10.0 : 0.0
      const cost = ((vias * viaSizeSq * traceMult) / area + impossible + traceDensity) - existingCost
      store<f64>(output, cost)
      store<f64>(transpose, cost)
    }
  }
}
