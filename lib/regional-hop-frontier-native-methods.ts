const nativeSolvers = new WeakSet<object>()
const nativeMethods = new Map<string, Set<unknown>>()

export const registerRegionalHopFrontierSolver = (solver: object): void => {
  nativeSolvers.add(solver)
}

/** Register producer-owned implementations without reading method accessors. */
export const registerRegionalHopFrontierMethods = (
  prototype: object,
  names: readonly string[],
): void => {
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    if (!descriptor || !("value" in descriptor)) continue
    const methods = nativeMethods.get(name) ?? new Set<unknown>()
    methods.add(descriptor.value)
    nativeMethods.set(name, methods)
  }
}

/** The opt-in contract keeps these descriptors fixed until the queue clears. */
export const hasNativeRegionalHopFrontierMethods = (
  solver: object,
): boolean => {
  if (!nativeSolvers.has(solver)) return false
  for (const [name, methods] of nativeMethods) {
    let receiver: object | null = solver
    let descriptor: PropertyDescriptor | undefined
    while (receiver !== null) {
      descriptor = Object.getOwnPropertyDescriptor(receiver, name)
      if (descriptor) break
      receiver = Object.getPrototypeOf(receiver)
    }
    if (!descriptor || !("value" in descriptor)) return false
    if (!methods.has(descriptor.value)) return false
  }
  return true
}
