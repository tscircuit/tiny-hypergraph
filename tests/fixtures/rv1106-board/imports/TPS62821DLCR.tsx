import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["EN"],
  pin2: ["FB"],
  pin3: ["AGND"],
  pin4: ["NC"],
  pin5: ["PGND"],
  pin6: ["SW"],
  pin7: ["VIN"],
  pin8: ["PG"]
} as const

const pinAttributes = {
  pin3: {requiresGround: true},
  pin4: {doNotConnect: true},
  pin5: {requiresGround: true},
  pin7: {requiresPower: true}
} as const

export const TPS62821DLCR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C469860"
  ]
}}
      manufacturerPartNumber="TPS62821DLCR"
      footprint="dfn8_p0.5001mm_w1.9003mm_pw0.25mm_pl0.55mm_pin1location(leftside,bottom)"
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C469860.obj?uuid=2a9c0ec790e848cea22868c54671a1cb",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C469860.step?uuid=2a9c0ec790e848cea22868c54671a1cb",
        pcbRotationOffset: 270,
        modelOriginPosition: { x: 0, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}