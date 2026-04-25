export const getZLayerLabel = (
  layers: readonly unknown[],
): string | undefined => {
  const normalizedLayers = [
    ...new Set(
      layers.filter(
        (layer): layer is number =>
          typeof layer === "number" && Number.isInteger(layer) && layer >= 0,
      ),
    ),
  ].sort((left, right) => left - right)

  if (normalizedLayers.length === 0) {
    return undefined
  }

  return `z${normalizedLayers.join(",")}`
}

export const getAvailableZFromMask = (mask: number): number[] => {
  const availableZ: number[] = []

  for (let z = 0; z < 31; z++) {
    if ((mask & (1 << z)) !== 0) {
      availableZ.push(z)
    }
  }

  return availableZ
}
