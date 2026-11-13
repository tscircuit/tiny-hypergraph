import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  DuplicateCongestedPortSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "lib/index"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

test("immutable port reservations survive duplicate estimates and section search", (): void => {
  const duplicateSolver = new DuplicateCongestedPortSolver(
    createImmutablePortCopperGraph(["net-a", "net-b", "net-a"], ["net-a"]),
    { duplicatePortProximity: 0.05 },
  )
  duplicateSolver.solve()
  expect(duplicateSolver.failed).toBeFalse()
  expect(duplicateSolver.solved).toBeTrue()
  expect(duplicateSolver.report.portUseCounts.occupied).toBe(2)
  expect(duplicateSolver.report.portUseCounts.alternate).toBe(1)
  const duplicated = duplicateSolver.getOutput()
  const duplicatePort = duplicated.ports.find(
    (port: SerializedHyperGraph["ports"][number]): boolean =>
      port.d?.duplicatedFromPortId === "occupied",
  )!
  expect(duplicatePort).toBeDefined()
  expect(duplicatePort.d?.immutableCopperNetIds).toEqual(["net-a"])
  duplicated.connections = duplicated.connections!.filter(
    (
      connection: NonNullable<SerializedHyperGraph["connections"]>[number],
    ): boolean => connection.mutuallyConnectedNetworkId === "net-b",
  )
  const reloaded = loadSerializedHyperGraph(duplicated)
  const foreignSolver = new TinyHyperGraphSolver(
    reloaded.topology,
    reloaded.problem,
  )
  foreignSolver.solve()
  expect(foreignSolver.failed).toBeFalse()
  expect(
    foreignSolver
      .getOutput()
      .solvedRoutes?.[0]?.path.map(
        ({ portId }: { portId: string }): string => portId,
      ),
  ).toEqual(["start-1", "alternate", "end-1"])

  const { topology, problem } = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-b"], ["net-a"]),
  )
  const originalSolver = new TinyHyperGraphSolver(topology, problem)
  originalSolver.solve()
  expect(originalSolver.solved).toBeTrue()
  const { solution } = loadSerializedHyperGraph(originalSolver.getOutput())
  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )
  sectionSolver.solve()
  expect(sectionSolver.failed).toBeFalse()
  expect(sectionSolver.solved).toBeTrue()
  expect(sectionSolver.activeRouteIds).toEqual([0])
  expect(sectionSolver.sectionSolver).toBeDefined()
  expect(sectionSolver.sectionSolver!.topology).toBe(topology)
  expect(
    sectionSolver.sectionSolver!.problemSetup.portEndpointNetIds[
      topology.portCount - 2
    ],
  ).toBeUndefined()
  expect(
    sectionSolver.sectionSolver!.problemSetup.portEndpointReservationNetId[
      topology.portCount - 2
    ],
  ).toBe(topology.portReservedNetId![topology.portCount - 2])
  expect(
    sectionSolver
      .getOutput()
      .solvedRoutes?.[0]?.path.map(
        ({ portId }: { portId: string }): string => portId,
      ),
  ).toEqual(["start-0", "alternate", "end-0"])
  const replay = loadSerializedHyperGraph(sectionSolver.getOutput())
  expect(replay.topology.portReservedNetId).toEqual(topology.portReservedNetId)
})
