import type { NetId, PortId } from "./types"

/** A missing restriction or -1 is free; -2 blocks every net. */
export const isPortAllowedForNet = (
  problem: { portNetId?: Int32Array },
  portId: PortId,
  netId: NetId,
): boolean => {
  const requiredNetId = problem.portNetId?.[portId] ?? -1
  return requiredNetId === -1 || (requiredNetId >= 0 && requiredNetId === netId)
}

export const assertValidPortNetPermissions = (
  portCount: number,
  problem: { portNetId?: Int32Array },
): void => {
  if (problem.portNetId === undefined) return
  if (!(problem.portNetId instanceof Int32Array) || problem.portNetId.length !== portCount) {
    throw new Error("portNetId must be an Int32Array with one entry per port")
  }
  problem.portNetId.forEach((netId, portId) => {
    if (netId < -2) {
      throw new Error(`Port ${portId} net restriction must be -1, -2, or a nonnegative net ID`)
    }
  })
}

export const assertPortAllowsNet = (
  problem: { portNetId?: Int32Array },
  portId: PortId,
  netId: NetId,
): void => {
  if (!isPortAllowedForNet(problem, portId, netId)) {
    throw new Error(`Port ${portId} does not allow net ${netId}`)
  }
}
