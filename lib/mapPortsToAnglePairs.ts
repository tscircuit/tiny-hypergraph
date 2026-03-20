import type { LesserAngle, Z1, GreaterAngle, Z2 } from "./types"

export const mapPortsToAnglePairs = (
  center: { x: number; y: number },
  ports: Array<
    [
      { x: number; y: number; z: number },
      {
        x: number
        y: number
        z: number
      },
    ]
  >,
) => {
  const anglePairs: Array<[LesserAngle, Z1, GreaterAngle, Z2]> = []

  for (const [p1, p2] of ports) {
    let [a1, z1] = [Math.atan2(p1.y - center.y, p1.x - center.x), p1.z]
    let [b1, z2] = [Math.atan2(p2.y - center.y, p2.x - center.x), p2.z]

    if (a1 < b1) {
      anglePairs.push([a1, z1, b1, z2])
    } else {
      anglePairs.push([b1, z2, a1, z1])
    }
  }

  return anglePairs
}
