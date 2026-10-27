import { expect, test } from "bun:test"
import { CommittedNetTreeIndex } from "lib/CommittedNetTreeIndex"

test("component membership follows current committed port identities across additions and rips", () => {
  const index = new CommittedNetTreeIndex()
  const routeNet = new Int32Array([7, 7, 8])
  const original: Array<Array<[number, number, number]>> = [
    [
      [0, 0, 1],
      [1, 2, 3],
      [2, 1, 4],
    ],
  ]
  index.synchronize({ regionSegments: original, routeNet })
  expect([...index.getComponent({ netId: 7, rootPortId: 0 }).keys()]).toEqual([
    0, 1,
  ])
  index.add({ netId: 7, regionId: 0, fromPortId: 1, toPortId: 2 })
  expect([...index.getComponent({ netId: 7, rootPortId: 0 }).keys()]).toEqual([
    0, 1, 2, 3,
  ])
  const ripped: Array<Array<[number, number, number]>> = [[[1, 2, 3]]]
  index.synchronize({ regionSegments: ripped, routeNet })
  expect([...index.getComponent({ netId: 7, rootPortId: 0 }).keys()]).toEqual([
    0,
  ])
  expect([...index.getComponent({ netId: 7, rootPortId: 3 }).keys()]).toEqual([
    3, 2,
  ])
  index.synchronize({ regionSegments: [[]], routeNet })
  expect([...index.getComponent({ netId: 7, rootPortId: 3 }).keys()]).toEqual([
    3,
  ])
})
