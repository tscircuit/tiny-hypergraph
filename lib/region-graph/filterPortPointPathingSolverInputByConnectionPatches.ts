import {
  getSinglePortPointPathingSolverParams,
  type SerializedHyperGraphPortPointPathingSolverInput,
  type SerializedHyperGraphPortPointPathingSolverParams,
} from "../compat/convertPortPointPathingSolverInputToSerializedHyperGraph"

export interface ConnectionPatchSelection {
  connectionPatches: Array<{
    connectionId: string
  }>
}

export const filterPortPointPathingSolverInputByConnectionPatches = (
  input: SerializedHyperGraphPortPointPathingSolverInput,
  selection: ConnectionPatchSelection,
): SerializedHyperGraphPortPointPathingSolverInput => {
  const params = getSinglePortPointPathingSolverParams(input)

  const selectedConnectionIds = new Set(
    selection.connectionPatches.map(({ connectionId }) => connectionId),
  )

  if (selectedConnectionIds.size === 0) {
    throw new Error("Connection patch selection must contain at least one id")
  }

  const filteredConnections = params.connections.filter(({ connectionId }) =>
    selectedConnectionIds.has(connectionId),
  )

  if (filteredConnections.length !== selectedConnectionIds.size) {
    const foundConnectionIds = new Set(
      filteredConnections.map(({ connectionId }) => connectionId),
    )
    const missingConnectionIds = [...selectedConnectionIds]
      .filter((connectionId) => !foundConnectionIds.has(connectionId))
      .sort((left, right) => left.localeCompare(right))

    throw new Error(
      `Missing selected connection ids in port point pathing input: ${missingConnectionIds.join(", ")}`,
    )
  }

  const filteredParams: SerializedHyperGraphPortPointPathingSolverParams = {
    ...params,
    connections: filteredConnections,
  }

  return Array.isArray(input) ? [filteredParams] : filteredParams
}
