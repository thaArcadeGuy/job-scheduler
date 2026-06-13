export class MinHeap {
  constructor() {
    this._heap = [];
  }

  get size() {
    return this._heap.length;
  }

  isEmpty() {
    return this._heap.length === 0;
  }

  insert(node) {
    this._heap.push(node);
    this._siftUp(this._heap.length - 1);
  }

  extractMin() {
    if (this.isEmpty()) return null;

    const min = this._heap[0];
    const last = this._heap.pop();

    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }

    return min;
  }

  peek() {
    return this._heap[0] ?? null;
  }

  updatePriority(jobId, newEffectivePriority) {
    const idx = this._heap.findIndex((n) => n.id === jobId);
    if (idx === -1) return false;

    this._heap[idx] = { ...this._heap[idx], effectivePriority: newEffectivePriority };
    this._siftUp(idx);
    return true;
  }

  remove(jobId) {
    const idx = this._heap.findIndex((n) => n.id === jobId);
    if (idx === -1) return false;

    const last = this._heap.pop();
    if (idx < this._heap.length) {
      this._heap[idx] = last;
      this._siftUp(idx);
      this._siftDown(idx);
    }
    return true;
  }

  snapshot() {
    return [...this._heap];
  }

  _compare(a, b) {
    if (a.effectivePriority !== b.effectivePriority) {
      return a.effectivePriority - b.effectivePriority;
    }

    const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
    const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }

  _siftUp(idx) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this._compare(this._heap[idx], this._heap[parent]) < 0) {
        this._swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  _siftDown(idx) {
    const n = this._heap.length;

    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < n && this._compare(this._heap[left], this._heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < n && this._compare(this._heap[right], this._heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== idx) {
        this._swap(idx, smallest);
        idx = smallest;
      } else {
        break;
      }
    }
  }

  _swap(i, j) {
    [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]];
  }
}