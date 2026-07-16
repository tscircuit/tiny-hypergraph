import { expect, test } from "bun:test"
import { SparseCandidateBestCostTable } from "lib/sparse-candidate-best-cost-table"

test("stores bounded generation-scoped costs across colliding hop ids", () => {
  const validatedHopIds: number[] = []
  const table = new SparseCandidateBestCostTable(4, (hopId) => {
    validatedHopIds.push(hopId)
  })

  table.set(0, 8)
  table.set(8, 4)
  table.set(16, 2)

  expect(table.size).toBe(3)
  expect(table.get(0)).toBe(8)
  expect(table.get(8)).toBe(4)
  expect(table.get(16)).toBe(2)

  table.set(8, 3)
  expect(table.get(8)).toBe(3)
  expect(validatedHopIds).toEqual([0, 8, 16])

  table.reset()
  expect(table.get(0)).toBe(Number.POSITIVE_INFINITY)
  expect(table.get(8)).toBe(Number.POSITIVE_INFINITY)

  table.set(8, 1)
  table.set(24, 6)
  expect(table.size).toBe(4)
  expect(table.get(8)).toBe(1)
  expect(table.get(24)).toBe(6)
  expect(validatedHopIds).toEqual([0, 8, 16, 24])

  expect(() => table.set(32, 5)).toThrow(
    "Sparse candidate best-cost table exhausted its 4 legal hop entries",
  )

  const invalidTable = new SparseCandidateBestCostTable(1, (hopId) => {
    throw new Error("invalid incident hop " + hopId)
  })
  expect(() => invalidTable.set(1, 1)).toThrow("invalid incident hop 1")
  expect(() => invalidTable.set(-1, 1)).toThrow("invalid hop id -1")
})
