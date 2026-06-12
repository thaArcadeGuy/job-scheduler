export const DEFAULT_WHEEL_SIZE = 60
export const DEFAULT_TICK_MS    = 1000

export class TimingWheel {
  constructor(opts = {}) {
    this.wheelSize = opts.wheelSize ?? DEFAULT_WHEEL_SIZE
    this.tickMs    = opts.tickMs    ?? DEFAULT_TICK_MS

    this._slots = Array.from({ length: this.wheelSize }, () => [])
    this._overflow = []
    this._currentSlot = 0
    this._startTime = Date.now()
    this._tickCount = 0
    this.stats = { inserted: 0, fired: 0, overflowPromotions: 0 };
  }

  insert(node) {
    const delayMs = this._delayMs(node);

    if (delayMs <= 0) {
      this._slots[this._currentSlot].push(node);
    } else {
      const ticks = Math.ceil(delayMs / this.tickMs);

      if (ticks >= this.wheelSize) {
        this._overflow.push(node);
      } else {
        const targetSlot = (this._currentSlot + ticks) % this.wheelSize;
        this._slots[targetSlot].push(node);
      }
    }

    this.stats.inserted++;
  }

  tick() {
    this._tickCount++;

    this._currentSlot = (this._currentSlot + 1) % this.wheelSize;

    const due = this._slots[this._currentSlot];
    this._slots[this._currentSlot] = [];

    const stillOverflow = [];
    for (const node of this._overflow) {
      const delayMs = this._delayMs(node);
      if (delayMs <= 0) {
        due.push(node);
        this.stats.overflowPromotions++;
      } else {
        const ticks = Math.ceil(delayMs / this.tickMs);
        if (ticks < this.wheelSize) {
          const targetSlot = (this._currentSlot + ticks) % this.wheelSize;
          this._slots[targetSlot].push(node);
          this.stats.overflowPromotions++;
        } else {
          stillOverflow.push(node);
        }
      }
    }
    this._overflow = stillOverflow;

    this.stats.fired += due.length;
    return due;
  }

  remove(id) {
    for (let i = 0; i < this.wheelSize; i++) {
      const idx = this._slots[i].findIndex((n) => n.id === id);
      if (idx !== -1) {
        this._slots[i].splice(idx, 1);
        return true;
      }
    }
    const idx = this._overflow.findIndex((n) => n.id === id);
    if (idx !== -1) {
      this._overflow.splice(idx, 1);
      return true;
    }
    return false;
  }

  peekSlot(slotIndex) {
    return [...(this._slots[slotIndex] ?? [])];
  }

  get size() {
    const slotCount = this._slots.reduce((sum, s) => sum + s.length, 0);
    return slotCount + this._overflow.length;
  }

  snapshot() {
    return {
      currentSlot: this._currentSlot,
      tickCount: this._tickCount,
      totalQueued: this.size,
      overflowCount: this._overflow.length,
      stats: { ...this.stats },
    };
  }

  _delayMs(node) {
    const dueAt = node.scheduledAt
      ? new Date(node.scheduledAt).getTime()
      : new Date(node.createdAt).getTime();
    return dueAt - Date.now();
  }
}