export class MinHeap<T> {
  constructor(
    private readonly items: T[],
    private readonly compare: (left: T, right: T) => number,
  ) {}

  get length(): number {
    return this.items.length
  }

  toArray(): T[] {
    return [...this.items]
  }

  clear() {
    this.items.length = 0
  }

  queue(item: T) {
    this.items.push(item)
    this.siftUp(this.items.length - 1)
  }

  dequeue(): T | undefined {
    const bestItem = this.items[0]
    if (bestItem === undefined) {
      return undefined
    }

    const lastItem = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.siftDown(0)
    }

    return bestItem
  }

  private siftUp(startIndex: number) {
    let index = startIndex

    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = this.items[parentIndex]!
      const item = this.items[index]!

      if (this.compare(parent, item) <= 0) {
        return
      }

      this.items[parentIndex] = item
      this.items[index] = parent
      index = parentIndex
    }
  }

  private siftDown(startIndex: number) {
    let index = startIndex
    const length = this.items.length

    while (true) {
      const leftChildIndex = index * 2 + 1
      if (leftChildIndex >= length) {
        return
      }

      const rightChildIndex = leftChildIndex + 1
      let smallestChildIndex = leftChildIndex

      if (
        rightChildIndex < length &&
        this.compare(
          this.items[rightChildIndex]!,
          this.items[leftChildIndex]!,
        ) < 0
      ) {
        smallestChildIndex = rightChildIndex
      }

      const item = this.items[index]!
      const smallestChild = this.items[smallestChildIndex]!

      if (this.compare(item, smallestChild) <= 0) {
        return
      }

      this.items[index] = smallestChild
      this.items[smallestChildIndex] = item
      index = smallestChildIndex
    }
  }
}
