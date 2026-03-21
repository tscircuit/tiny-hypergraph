export const range = (len: number) => {
  const ar: number[] = new Array(len)
  for (let i = 0; i < len; i++) {
    ar[i] = i
  }
  return ar
}
