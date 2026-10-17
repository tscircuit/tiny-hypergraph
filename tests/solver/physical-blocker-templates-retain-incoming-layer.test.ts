import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("shared physical blocker templates distinguish incoming via layers", (): void => {
  const points=[{x:0,y:0,z:0},{x:0,y:0,z:3},{x:0,y:0,z:2},{x:0,y:0.2,z:1},{x:1,y:0.2,z:1}]
  const graph: SerializedHyperGraph={
    regions:[
      {regionId:"via",pointIds:["p0","p1","p2"],d:{center:{x:0,y:0},width:0.3,height:0.3,availableZ:[0,1,2,3]}},
      {regionId:"wire",pointIds:["p3","p4"],d:{center:{x:0.5,y:0.2},width:1,height:1,availableZ:[1]}},
      ...points.map((point,i)=>({regionId:`t${i}`,pointIds:[`p${i}`],d:{center:point,width:0.001,height:0.001,availableZ:[point.z]}})),
    ],
    ports:points.map((point,i)=>({portId:`p${i}`,region1Id:i<3?"via":"wire",region2Id:`t${i}`,d:point})),
    connections:[{connectionId:"via-net",startRegionId:"t0",endRegionId:"t2"},{connectionId:"wire-net",startRegionId:"t3",endRegionId:"t4"}],
  }
  const {topology,problem}=loadSerializedHyperGraph(graph)
  const via=topology.regionAvailableZMask!.findIndex(mask=>mask===15)
  const portsByRegion:number[][]=Array.from({length:topology.regionCount},()=>[])
  portsByRegion[via]=[3]
  problem.viaRegionPortConflicts={portsByRegion,regionsByPort:[[],[],[],[via],[]]}
  const solver=new SelectiveReripTinyHyperGraphSolver(topology,problem)
  solver.state.currentRouteId=0
  solver.state.currentRouteNetId=problem.routeNet[0]!
  const inspect=solver as unknown as {getRelaxedSearchHops(params:unknown):{state:{portId:number}}[]}
  const templates=new Map()
  const params={goalPortId:2,routeNetId:problem.routeNet[0]!,portOwners:new Map(),portResources:new Map(),forbiddenOwnerRouteIds:new Set(),hopTemplatesByRegion:templates}
  const fromBelow=inspect.getRelaxedSearchHops({...params,state:{portId:0,nextRegionId:via}})
  const fromAbove=inspect.getRelaxedSearchHops({...params,state:{portId:1,nextRegionId:via}})
  expect(fromBelow.some(hop=>hop.state.portId===2)).toBeFalse()
  expect(fromAbove.some(hop=>hop.state.portId===2)).toBeTrue()
  expect(templates.get(via).size).toBe(2)
})
