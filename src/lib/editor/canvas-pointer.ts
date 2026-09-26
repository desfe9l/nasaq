/** One owner per workspace interaction. No TouchEvent path: pen never joins a
 * finger gesture, and an acquired handle/drag cannot be stolen by navigation. */
export const POINTER_SLOP = 6; // screen px, independent of document zoom
export const LONG_PRESS_MS = 550;
export type CanvasPointer = Pick<
  PointerEvent,
  "pointerId" | "pointerType" | "clientX" | "clientY"
>;
export type FingerPair = { x: number; y: number; distance: number };
type Contact = { -readonly [K in keyof CanvasPointer]: CanvasPointer[K] } & {
  x0: number;
  y0: number;
};
type Owner = {
  id: number;
  yieldable: boolean;
  move: (event: PointerEvent) => void;
  end: (event: PointerEvent) => void;
  cancel: () => void;
};

export class CanvasPointerSession {
  private contacts = new Map<number, Contact>();
  private owner: Owner | null = null;
  private gesture: {
    started: number;
    count: number;
    tap: boolean;
    ending: boolean;
    update: (pair: FingerPair) => void;
  } | null = null;
  private firstAt = 0;
  private blocked = false;

  private callbacks: {
    navigate: (start: FingerPair) => (next: FingerPair) => void;
    undo: () => void;
    redo: () => void;
  };

  constructor(callbacks: CanvasPointerSession["callbacks"]) {
    this.callbacks = callbacks;
  }

  get busy() {
    return !!this.owner || !!this.gesture;
  }

  private pair(): FingerPair {
    const [a, b] = [...this.contacts.values()];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      distance: Math.max(
        1,
        Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      ),
    };
  }

  /** Called in stage capture BEFORE element handlers. True consumes this down. */
  down(event: CanvasPointer, now = performance.now()): boolean {
    if (event.pointerType !== "touch") return this.busy;
    if (!this.contacts.size) {
      this.firstAt = now;
      this.blocked = false;
    }
    this.contacts.set(event.pointerId, {
      ...event,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      x0: event.clientX,
      y0: event.clientY,
    });
    if (this.gesture) {
      this.gesture.count = Math.max(this.gesture.count, this.contacts.size);
      this.gesture.tap &&=
        !this.gesture.ending &&
        now - this.firstAt <= 180 &&
        this.contacts.size <= 3;
      return true;
    }
    if (this.contacts.size < 2) return !!this.owner;
    if (this.blocked || (this.owner && !this.owner.yieldable)) {
      this.blocked = true;
      return true;
    }
    this.cancelOwner();
    const pair = this.pair();
    this.gesture = {
      started: this.firstAt,
      count: 2,
      tap:
        now - this.firstAt <= 180 &&
        [...this.contacts.values()].every(
          (c) => Math.hypot(c.clientX - c.x0, c.clientY - c.y0) <= POINTER_SLOP,
        ),
      ending: false,
      update: this.callbacks.navigate(pair),
    };
    return true;
  }

  claim(event: CanvasPointer, handlers: Omit<Owner, "id">): boolean {
    if (this.busy) return false;
    this.owner = { ...handlers, id: event.pointerId };
    return true;
  }

  lock(id: number) {
    if (this.owner?.id === id) this.owner.yieldable = false;
  }

  move(event: PointerEvent) {
    const contact = this.contacts.get(event.pointerId);
    if (contact) {
      contact.clientX = event.clientX;
      contact.clientY = event.clientY;
      if (
        this.gesture &&
        Math.hypot(event.clientX - contact.x0, event.clientY - contact.y0) >
          POINTER_SLOP
      )
        this.gesture.tap = false;
    }
    if (this.gesture) {
      if (!this.gesture.ending && this.contacts.size === 2 && !this.gesture.tap)
        this.gesture.update(this.pair());
      return;
    }
    if (this.owner?.id === event.pointerId) this.owner.move(event);
  }

  end(event: PointerEvent, cancelled = false, now = performance.now()) {
    // lostpointercapture normally follows pointerup. It must not cancel the
    // OTHER finger still completing an otherwise valid two-finger tap.
    if (
      !this.contacts.has(event.pointerId) &&
      this.owner?.id !== event.pointerId
    )
      return;
    // Include final displacement; some devices coalesce the final move into up.
    const contact = this.contacts.get(event.pointerId);
    if (
      contact &&
      this.gesture &&
      Math.hypot(event.clientX - contact.x0, event.clientY - contact.y0) >
        POINTER_SLOP
    )
      this.gesture.tap = false;
    this.contacts.delete(event.pointerId);
    if (this.gesture) {
      this.gesture.ending = true;
      if (cancelled) this.gesture.tap = false;
      if (!this.contacts.size) {
        const gesture = this.gesture;
        this.gesture = null;
        if (gesture.tap && now - gesture.started <= 350) {
          if (gesture.count === 2) this.callbacks.undo();
          if (gesture.count === 3) this.callbacks.redo();
        }
      }
    }
    if (this.owner?.id === event.pointerId) {
      const owner = this.owner;
      this.owner = null;
      if (cancelled) owner.cancel();
      else owner.end(event);
    }
  }

  private cancelOwner() {
    const owner = this.owner;
    this.owner = null;
    owner?.cancel();
  }

  reset() {
    this.cancelOwner();
    this.contacts.clear();
    this.gesture = null;
    this.blocked = false;
  }
}
