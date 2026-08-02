import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

const createRegion = (
  regionId: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: { center, width, height },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
): SerializedHyperGraph["ports"][number] => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})

const createSevenNetChokeFixture = (): SerializedHyperGraph => {
  const connections = Array.from({ length: 7 }, (_, index) => ({
    connectionId: `connection-${index}`,
    startRegionId: `start-${index}`,
    endRegionId: `end-${index}`,
    mutuallyConnectedNetworkId: `net-${index}`,
  }))
  const startPorts = connections.map((_, index) =>
    createPort(`start-port-${index}`, `start-${index}`, "left", -0.2, 0),
  )
  const endPorts = connections.map((_, index) =>
    createPort(`end-port-${index}`, "right", `end-${index}`, 0.2, 0),
  )

  return {
    regions: [
      ...connections.map((_, index) =>
        createRegion(`start-${index}`, { x: -0.3, y: 0 }, 0.1, 0.1, [
          `start-port-${index}`,
        ]),
      ),
      createRegion("left", { x: -0.076, y: 0 }, 0.152, 0.396, [
        ...startPorts.map((port) => port.portId),
        "shared-choke",
      ]),
      createRegion("right", { x: 0.103, y: 0 }, 0.156, 0.396, [
        "shared-choke",
        ...endPorts.map((port) => port.portId),
      ]),
      ...connections.map((_, index) =>
        createRegion(`end-${index}`, { x: 0.3, y: 0 }, 0.1, 0.1, [
          `end-port-${index}`,
        ]),
      ),
    ],
    ports: [
      ...startPorts,
      createPort("shared-choke", "left", "right", 0.025, 0),
      ...endPorts,
    ],
    connections,
  }
}

test("limits duplicated ports to the physical capacity of their boundary", () => {
  const solver = new DuplicateCongestedPortSolver(
    createSevenNetChokeFixture(),
    {
      minimumDuplicatePortSpacing: 0.2,
      duplicatePortWidth: 0.1,
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.report.duplicatedPorts).toContainEqual({
    sourcePortId: "shared-choke",
    duplicatePortIds: ["shared-choke::dup1"],
    useCount: 7,
    availableLaneCount: 2,
  })

  const output = solver.getOutput()
  const lanePorts = output.ports.filter(
    (port) =>
      port.portId === "shared-choke" ||
      port.d?.duplicatedFromPortId === "shared-choke",
  )
  expect(lanePorts).toHaveLength(2)
  expect(
    Math.abs(Number(lanePorts[0]!.d?.y) - Number(lanePorts[1]!.d?.y)),
  ).toBeCloseTo(0.2)
})
