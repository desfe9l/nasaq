/** One owner per workspace interaction. No TouchEvent path: pen never joins a
 * finger gesture, and an acquired handle/drag cannot be stolen by navigation. */
export const POINTER_SLOP = 6; // screen px, independent of document zoom
export const LONG_PRESS_MS = 550;
/**
 * ── The held-finger modifier ───────────────────────────────────────────────
 *
 * iPad has no Shift key, so the second contact of a two-finger interaction is
 * the modifier: it stays put and contributes its STATE (Shift-equivalent:
 * angle snapping, aspect-ratio resize, element snapping) while the OTHER
 * contact — the one that owns the gesture — keeps driving it. The held finger
 * never moves the selection itself.
 *
 * Two contacts are ambiguous for a few pixels: the same start looks like a
 * two-finger pan/zoom, a two-finger undo tap, or a modifier hold. The tie is
 * broken by MOVEMENT and by TIME, never by which finger landed first and never
 * by a left/right hand setting, so the gesture reads the same for a left- or
 * right-handed author:
 *
 *  · the joining finger travels beyond {@link POINTER_SLOP} → canvas
 *    navigation (pan/zoom), exactly as before;
 *  · both fingers stay inside the slop and lift quickly → the undo/redo tap;
 *  · the joining finger holds still while the owner travels →
 *    modifier mode, confirmed either once the owner has travelled
 *    {@link MODIFIER_DRIVE_PX} (a fast deliberate drag) or once the joining
 *    finger has been held for {@link MODIFIER_HOLD_MS} (a slow, deliberate
 *    press-and-hold, which is how the modifier is normally used).
 */
export const MODIFIER_DRIVE_PX = 24;
export const MODIFIER_HOLD_MS = 200;

export type CanvasPointer = Pick<
  PointerEvent,
  "pointerId" | "pointerType" | "clientX" | "clientY"
>;
export type FingerPair = { x: number; y: number; distance: number };
type Contact = { -readonly [K in keyof CanvasPointer]: CanvasPointer[K] } & {
  x0: number;
  y0: number;
  /** Landing time, so a "held" finger is measured from its own touchdown. */
  t0: number;
};
type Owner = {
  id: number;
  /**
   * Where the owning pointer went down. A Pencil owner has no tracked contact
   * (only touch is tracked), so the modifier's "the author is travelling"
   * test is measured from the owner's own origin.
   */
  x0: number;
  y0: number;
  yieldable: boolean;
  /**
   * Element move/resize/rotate gestures accept a held second contact as a
   * Shift-equivalent modifier. Marquee, region, raster and space-pan owners
   * do not: for them a second finger still means navigation, as before.
   */
  supportsModifier: boolean;
  /**
   * A pending press is parked (not cancelled) while the session decides
   * between navigation and the modifier hold, so a modifier drag resumes the
   * very gesture the finger started instead of restarting it.
   */
  suspended: boolean;
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
    /** False while navigation-vs-modifier is still being decided. */
    decided: boolean;
    update: (pair: FingerPair) => void;
  } | null = null;
  /** Contact that may become the modifier, pending confirmation. */
  private modifierCandidate: number | null = null;
  /** Contact confirmed as the held modifier (Shift-equivalent). */
  private modifierId: number | null = null;
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

  /**
   * True while a held finger is acting as the Shift-equivalent modifier.
   * Gesture code reads this per frame — the same place it reads `shiftKey` —
   * so touch and keyboard share one modifier rule.
   */
  get shiftModifier() {
    return this.modifierId !== null;
  }

  /** The contact currently held as the modifier, if any. */
  get modifierPointerId() {
    return this.modifierId;
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

  private movedBeyond(contact: Contact, x: number, y: number, slop = POINTER_SLOP) {
    return Math.hypot(x - contact.x0, y - contact.y0) > slop;
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
      t0: now,
    });
    /*
     * A lone finger joining a live Pencil (or element) gesture is a modifier
     * candidate straight away: there is no second touch to disambiguate
     * against, the pen stays the author, and palm rejection has already run.
     */
    if (this.contacts.size === 1) {
      if (
        this.owner?.supportsModifier &&
        !this.owner.suspended &&
        this.owner.id !== event.pointerId
      )
        this.modifierCandidate = event.pointerId;
      return !!this.owner;
    }
    // A confirmed modifier gesture swallows every extra finger: it must never
    // turn into navigation, a second modifier, or a tap.
    if (this.modifierId !== null) {
      this.blocked = true;
      return true;
    }
    if (this.gesture) {
      this.gesture.count = Math.max(this.gesture.count, this.contacts.size);
      this.gesture.tap &&=
        !this.gesture.ending &&
        now - this.firstAt <= 180 &&
        this.contacts.size <= 3;
      return true;
    }
    if (
      this.blocked ||
      this.modifierCandidate !== null ||
      (this.owner && !this.owner.yieldable && !this.owner.supportsModifier)
    ) {
      this.blocked = true;
      return true;
    }
    if (this.owner && !this.owner.yieldable) {
      /*
       * An acquired resize/rotate grip, a pen stroke or a long press cannot be
       * stolen — that rule is unchanged. What changes is that the newcomer is
       * no longer inert: it may become the held modifier for that gesture.
       */
      this.modifierCandidate = event.pointerId;
      return true;
    }
    /*
     * A pending press is parked, not cancelled — but only when the gesture can
     * have a modifier at all. For marquee, region and raster owners a second
     * finger means navigation immediately, exactly as before: the press is
     * promoted and discarded on the spot.
     */
    const canModify = Boolean(this.owner?.supportsModifier);
    if (this.owner) {
      if (canModify) {
        this.owner.suspended = true;
        this.modifierCandidate = event.pointerId;
      } else {
        this.cancelOwner();
      }
    }
    const pair = this.pair();
    this.gesture = {
      started: this.firstAt,
      count: 2,
      tap:
        now - this.firstAt <= 180 &&
        [...this.contacts.values()].every(
          (c) => !this.movedBeyond(c, c.clientX, c.clientY),
        ),
      ending: false,
      decided: !canModify,
      update: this.callbacks.navigate(pair),
    };
    return true;
  }

  claim(
    event: CanvasPointer,
    handlers: Omit<Owner, "id" | "suspended" | "supportsModifier" | "x0" | "y0"> & {
      supportsModifier?: boolean;
    },
  ): boolean {
    if (this.busy) return false;
    this.owner = {
      supportsModifier: false,
      ...handlers,
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      suspended: false,
    };
    return true;
  }

  lock(id: number) {
    if (this.owner?.id === id) this.owner.yieldable = false;
  }

  move(event: PointerEvent, now = performance.now()) {
    const contact = this.contacts.get(event.pointerId);
    if (contact) {
      contact.clientX = event.clientX;
      contact.clientY = event.clientY;
      if (this.gesture && this.movedBeyond(contact, event.clientX, event.clientY))
        this.gesture.tap = false;
    }
    if (this.modifierCandidate !== null) this.updateModifier(event, now);
    // The held finger drives nothing — that is the whole point of a modifier.
    if (event.pointerId === this.modifierId) return;
    if (this.owner && !this.owner.suspended && this.owner.id === event.pointerId) {
      this.owner.move(event);
      return;
    }
    if (this.gesture) {
      if (
        this.gesture.decided &&
        !this.gesture.ending &&
        this.contacts.size === 2 &&
        !this.gesture.tap
      )
        this.gesture.update(this.pair());
      return;
    }
  }

  /**
   * Resolve the joining contact: held modifier, or the start of navigation.
   * Called for every move while a candidate exists; it is idempotent.
   */
  private updateModifier(event: PointerEvent, now: number) {
    const candidate = this.contacts.get(this.modifierCandidate!);
    const owner = this.owner;
    // Never let a gesture modify itself.
    if (
      !candidate ||
      !owner ||
      !owner.supportsModifier ||
      owner.id === this.modifierCandidate
    ) {
      this.modifierCandidate = null;
      return;
    }
    if (this.movedBeyond(candidate, candidate.clientX, candidate.clientY)) {
      // Both fingers travel: this is canvas navigation. A parked press is
      // promoted and discarded exactly as it was before the modifier existed.
      this.modifierCandidate = null;
      if (this.gesture && !this.gesture.decided) {
        this.gesture.decided = true;
        this.cancelOwner();
      }
      return;
    }
    if (event.pointerId === this.modifierCandidate || owner.id !== event.pointerId)
      return;
    const travel = Math.hypot(
      event.clientX - owner.x0,
      event.clientY - owner.y0,
    );
    if (travel <= POINTER_SLOP) return;
    const held = now - candidate.t0 >= MODIFIER_HOLD_MS;
    const driven = travel >= MODIFIER_DRIVE_PX;
    if (!held && !driven) return;
    // Modifier mode: the gesture belongs to the owner contact alone, and the
    // parked press resumes with the modifier already applied.
    this.modifierId = this.modifierCandidate;
    this.modifierCandidate = null;
    this.gesture = null;
    owner.suspended = false;
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
      this.movedBeyond(contact, event.clientX, event.clientY)
    )
      this.gesture.tap = false;
    this.contacts.delete(event.pointerId);
    if (this.modifierCandidate === event.pointerId) this.modifierCandidate = null;
    // Releasing the held finger mid-drag drops the modifier for the rest of
    // the gesture — the same as letting go of Shift on a keyboard.
    if (this.modifierId === event.pointerId) this.modifierId = null;
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
      // A press that never resolved (promotion to navigation, or a two-finger
      // tap) is discarded, never committed.
      if (cancelled || owner.suspended) owner.cancel();
      else owner.end(event);
    }
    if (!this.contacts.size && !this.owner) {
      this.modifierId = null;
      this.modifierCandidate = null;
    }
  }

  private cancelOwner() {
    const owner = this.owner;
    this.owner = null;
    this.modifierCandidate = null;
    owner?.cancel();
  }

  reset() {
    this.cancelOwner();
    this.contacts.clear();
    this.gesture = null;
    this.modifierId = null;
    this.modifierCandidate = null;
    this.blocked = false;
  }
}
