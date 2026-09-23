import "bun-match-svg"
import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("visualizes repeated owner-set exploration before a disconnected goal", async () => {
  const branchCount = 8
  const visits = Array<number>(branchCount + 1).fill(0)
  const options = {
    start: 0,
    getStateKey: (state: number) => state,
    isGoal: (state: number) => state === branchCount + 1,
    getHops: (state: number) => {
      visits[state]!++
      if (state === branchCount) return []
      return [
        { state: state + 1, distance: 1, owners: [`left-${state}`] },
        { state: state + 1, distance: 1, owners: [`right-${state}`] },
      ]
    },
    // Older versions ignore this option, providing the visual baseline.
    checkReachability: true,
  }
  const result = findDistinctOwnerBlockerPath(options)

  expect(result.found).toBe(false)
  if (result.found) throw new Error("The isolated goal must be unreachable")
  expect(result.reason).toBe("no_path")
  expect(result.expandedLabelCount).toBe(511)
  expect(visits.reduce((sum, count) => sum + count, 0)).toBe(
    result.expandedLabelCount,
  )
  expect(visits.every((count) => count > 0)).toBe(true)

  const color = (count: number) => (count > 1 ? "#dc2626" : "#2563eb")
  const x = (state: number) => 60 + state * 94
  const graph = visits
    .map((count, state) => {
      const edges =
        state === branchCount
          ? ""
          : [-1, 1]
              .map(
                (side) => `
    <path d="M ${x(state) + 18} 170 Q ${x(state) + 47} ${170 + side * 66} ${x(state + 1) - 18} 170" fill="none" stroke="#94a3b8" stroke-width="2"/>
    <text x="${x(state) + 47}" y="${170 + side * 42}" font-size="11" text-anchor="middle">${side < 0 ? "left" : "right"}-${state}</text>`,
              )
              .join("")
      return `${edges}
    <circle cx="${x(state)}" cy="170" r="18" fill="white" stroke="${color(count)}" stroke-width="3"/>
    <text x="${x(state)}" y="175" text-anchor="middle" font-size="13">${state}</text>
    <text x="${x(state)}" y="224" text-anchor="middle" fill="${color(count)}" font-size="14">${count} visits</text>`
    })
    .join("")
  const bars = visits
    .map(
      (count, state) => `
    <text x="40" y="${324 + state * 27}" font-size="13">State ${state}</text>
    <rect x="112" y="${312 + state * 27}" width="${count * 2}" height="17" fill="${color(count)}"/>
    <text x="${122 + count * 2}" y="${325 + state * 27}" font-size="13">${count}</text>`,
    )
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="600" viewBox="0 0 1020 600">
  <rect width="1020" height="600" fill="white"/>
  <g font-family="sans-serif" fill="#0f172a">
    <text x="30" y="36" font-size="23" font-weight="bold">Disconnected blocker search</text>
    <text x="30" y="66" font-size="15">8 owner-choice stages; each left/right edge adds a distinct blocker owner.</text>
    <text x="30" y="94" font-size="17" fill="${color(Math.max(...visits))}">Result: ${result.reason} | Expanded states/labels: ${result.expandedLabelCount} | Reachable states: ${visits.length}</text>
    ${graph}
    <circle cx="940" cy="170" r="23" fill="#f1f5f9" stroke="#64748b" stroke-width="2" stroke-dasharray="4 3"/>
    <text x="940" y="175" text-anchor="middle" font-size="13">goal</text>
    <text x="940" y="224" text-anchor="middle" font-size="14">unreachable</text>
    <text x="30" y="281" font-size="17" font-weight="bold">Search expansions per state (fixed scale: 2 pixels per visit)</text>
    ${bars}
    <text x="30" y="582" font-size="13">Blue: visited once. Red: revisited for different owner sets. Counts recorded by the search's getHops callback.</text>
  </g>
</svg>`

  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
