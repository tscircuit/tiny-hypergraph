import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"

test("a via reserves intermediate layers but not layers outside its span", (): void => {
  for (const foreignZ of [1, 3]) {
    const points = [{x:0,y:0,z:0}, {x:0,y:0,z:2}, {x:0,y:0.2,z:foreignZ}, {x:-1,y:0.2,z:foreignZ}, {x:1,y:0.2,z:foreignZ}]
    const graph: SerializedHyperGraph = {
      regions: [
        {regionId:"via",pointIds:["p0","p1"],d:{center:{x:0,y:0},width:0.3,height:0.3,availableZ:[0,1,2,3]}},
        {regionId:"left",pointIds:["p2","p3"],d:{center:{x:-0.5,y:0.2},width:1,height:1,availableZ:[foreignZ]}},
        {regionId:"right",pointIds:["p2","p4"],d:{center:{x:0.5,y:0.2},width:1,height:1,availableZ:[foreignZ]}},
        ...points.flatMap((point,i)=>i===2?[]:[{regionId:`t${i}`,pointIds:[`p${i}`],d:{center:point,width:0.001,height:0.001,availableZ:[point.z]}}]),
      ],
      ports:points.map((point,i)=>({portId:`p${i}`,region1Id:i<2?"via":i===4?"right":"left",region2Id:i===2?"right":`t${i}`,d:point})),
      connections:[{connectionId:"via-net",mutuallyConnectedNetworkId:"via-net",startRegionId:"t0",endRegionId:"t1"},{connectionId:"wire-net",mutuallyConnectedNetworkId:"wire-net",startRegionId:"t3",endRegionId:"t4"}],
    }
    for (const reverseOrder of [false, true]) {
    if (reverseOrder) graph.connections!.reverse()
    const {topology,problem}=loadSerializedHyperGraph(graph)
    const region=topology.regionAvailableZMask!.findIndex(mask=>mask===15)
    expect(region).toBeGreaterThanOrEqual(0)
    const portsByRegion:number[][]=Array.from({length:topology.regionCount},()=>[])
    portsByRegion[region]=[2]
    problem.viaRegionPortConflicts={portsByRegion,regionsByPort:[[],[],[region],[],[]]}
    const solver=new TinyHyperGraphSolver(topology,problem,{MAX_ITERATIONS:100,ACCEPT_BEST_SOLUTION_ON_TIMEOUT:true})
    solver.solve()
    expect(solver.solved).toBe(foreignZ===3)
    expect(solver.failed).toBe(foreignZ===1)
    }
  }
})
