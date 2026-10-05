# iPad touch & Pencil gesture contract (modifier finger)

Date: 2026-10-05. Extends `docs/ipad-pointer-verification.md`; no second gesture
system was added — everything below lives in the existing
`CanvasPointerSession` (`src/lib/editor/canvas-pointer.ts`) and the one canvas
gesture owner (`startOp` in `src/components/editor/CanvasStage.tsx`).

## The problem this solves

iPad hardware has no Shift/Alt. Every precise transform in the editor — angle
snapping, aspect-ratio resize, on-demand element snapping — was reachable only
from a keyboard, so on a tablet those controls did not exist. The fix is a
**held-contact modifier**: one contact stays put and contributes modifier
STATE, while the contact that owns the gesture keeps driving it.

## Rules

- The modifier is the Shift-equivalent. It is read per frame in `paintFrame`
  next to `ev.shiftKey` (`session.shiftModifier`), so touch and keyboard share
  one rule and one code path:
  - move → element snapping is forced on (alignment guides appear even when
    `snapElements` is off);
  - resize → the proportion is locked, and the snap stays available through the
    uniform, proportion-preserving branch of `applyResizeSnap`
    (`{ ratioLock: true }`) so a locked resize still reports its alignment;
  - rotate → 15°/45°/90° snapping, with the rotation readout naming the finger
    gesture instead of the Shift key.
- The held contact never moves the selection. `CanvasPointerSession.move`
  returns before the owner for the modifier pointer id.
- Handedness is irrelevant: nothing keys off "first" vs "second" finger or a
  left/right setting. The contact that stays inside `POINTER_SLOP` is the
  modifier; the contact that owns the gesture drives. Either hand can hold
  either role.
- Element move/resize/rotate gestures are claimed with
  `supportsModifier: true`. Marquee, region, raster and Space-pan owners are
  not, so for them a second finger still means canvas navigation exactly as
  before.

## How two contacts are disambiguated

Two fingers on an element press are ambiguous for the first few pixels: pan/zoom,
two-finger undo tap, or modifier hold. The tie is broken by movement and time,
never by finger order:

| Observation | Resolution |
| --- | --- |
| the joining finger travels beyond `POINTER_SLOP` | canvas navigation (pan/zoom); a pending press is promoted and discarded, as before |
| both fingers stay inside the slop and lift within 350 ms | the existing two-finger undo tap (three fingers: redo) |
| the joining finger holds still while the owner travels `MODIFIER_DRIVE_PX` (24 px) | modifier mode |
| the joining finger has been held `MODIFIER_HOLD_MS` (200 ms) and the owner passes the slop | modifier mode |

While undecided, a pending element press is **parked, not cancelled**
(`owner.suspended`), so a modifier drag resumes the gesture the finger already
started. A press that never resolves (promotion or tap) is still discarded,
never committed. When the modifier is confirmed after the finger has already
travelled, `startOp` rebases the drag origin to the current point so the
artwork does not jump the distance covered while undecided.

A confirmed modifier swallows extra fingers: a third contact cannot turn it
into navigation, a second modifier, or a tap.

## Pencil + finger

`pen-input.ts` palm rejection now combines TIME (a pen is down, or was active
within `PEN_GRACE_MS`) with the contact SIZE the platform reports
(`PALM_MIN_CONTACT_PX = 32`). A large contact near an active Pencil is a resting
hand and is swallowed; a fingertip-sized contact is the author's other hand and
reaches the gesture layer, where it becomes the modifier for the live Pencil
gesture (a lone touch joining a modifier-capable owner is a candidate
immediately — there is no second touch to disambiguate against). When a
platform reports no contact geometry, the conservative time-only rule applies.
The Pencil keeps ownership of its gesture throughout: a finger cannot steal a
pen stroke, a grip, or a long press.

## Long press

A long press (550 ms, element bodies, select tool) now enters **multi-select**:
the pressed element is added to the current selection through `selectMany`, the
object does not move (`heldLong` blocks every frame and the commit), no history
entry is created, and the existing context menu still opens — now acting on the
whole selection.

## Browser/system gestures

`touch-action: none` on the stage and every artboard, preventDefault on the
non-portable `gesture*` events, `-webkit-touch-callout: none`, and
`overscroll-behavior: contain` were already in place. Added: while a gesture is
confirmed (`body.is-gesturing`), the document also drops overscroll bounce,
text selection and long-press callouts, so a finger that slides off the
artboard mid-drag cannot hand the gesture to the system.

Touch targets are unchanged: 40 px resize / 44 px rotation hit areas on tablet
surfaces with visually small dots, and 44 px outward corner targets verified
disjoint on 4 mm artwork at 20/100/200 % zoom.

## Verification

```sh
npm run typecheck
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/editor/canvas-pointer.test.ts src/lib/editor/pen-input.test.ts \
         src/lib/editor/transform.test.ts
npm run test:src && npm run test:editor:tools
node scripts/verify-canvas-input.mjs   # needs the dev server + a Chromium
```

The unit suites cover the shipped session and snap maths: modifier engagement
and release, the modifier finger never driving the owner, a travelling second
finger still navigating, a lone finger joining a Pencil gesture, extra fingers
inert, undo/redo taps preserved, non-modifier owners unchanged, size-aware palm
rejection, and the proportion-preserving resize snap.
`scripts/verify-canvas-input.mjs` gained interactive scenarios for the same
contract (guides appear only with the held finger, the held finger never moves
the element, 15° rotation snap, ratio-locked resize, long-press multi-select,
Pencil + finger).
