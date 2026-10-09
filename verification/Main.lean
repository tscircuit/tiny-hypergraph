import TinyHypergraph

/-- Exhaustive finite fixture stream. Columns: first,second,current,next.
    Only distinct two-ended ports with an incident current region are emitted. -/
def main : IO Unit := do
  IO.println "first,second,current,next"
  for first in [:4] do
    for second in [:4] do
      if first != second then
        for current in [:4] do
          if current == first || current == second then
            IO.println s!"{first},{second},{current},{TinyHypergraph.opposite first second current}"
