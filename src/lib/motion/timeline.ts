/**
 * Timeline resolution for the NASAQ Motion Studio.
 *
 * Turns an absolute time into "which scene is playing, and what is its local
 * time" — and, critically, defines what happens *between* scenes so that a
 * frame sampled exactly on a boundary is still well-defined. A timeline that
 * is only correct strictly inside its scenes produces duplicated or dropped
 * frames at every cut, which is the single most common source of a stutter in
 * a rendered video.
 *
 * Everything here is pure and cheap enough to call per frame.
 */

import { easedProgress, MOTION_EASE } from "./easing.ts";
import type { Composition, Scene, Transition } from "./types.ts";
import { compositionDuration } from "./types.ts";

/** A scene resolved at a point in time. */
export interface ResolvedScene {
  scene: Scene;
  /** Index in `composition.scenes`. */
  index: number;
  /** Absolute start of this scene in the composition. */
  startMs: number;
  /** Absolute end (exclusive) of this scene. */
  endMs: number;
  /** Time since this scene started, clamped to [0, durationMs]. */
  localMs: number;
  /** 0–1 across this scene. */
  progress: number;
}

/**
 * Absolute start offsets of every scene.
 *
 * Computed in one pass so scene lookup, the HTML exporter and the timeline UI
 * all agree. Scenes are contiguous by construction — the builder lays them out
 * end to end and never overlaps them.
 */
export const sceneOffsets = (
  composition: Composition,
): Array<{ scene: Scene; index: number; startMs: number; endMs: number }> => {
  const offsets: Array<{
    scene: Scene;
    index: number;
    startMs: number;
    endMs: number;
  }> = [];
  let cursor = 0;
  composition.scenes.forEach((scene, index) => {
    offsets.push({
      scene,
      index,
      startMs: cursor,
      endMs: cursor + scene.durationMs,
    });
    cursor += scene.durationMs;
  });
  return offsets;
};

/**
 * Clamp a time to the composition, wrapping when the composition loops.
 *
 * A looping composition at exactly its duration resolves to 0, not to the
 * final frame, so that the exported loop's last frame is authored to equal the
 * first and the video joins without a duplicated frame.
 */
export const clampTime = (
  composition: Composition,
  timeMs: number,
): number => {
  const duration = compositionDuration(composition);
  if (duration <= 0) return 0;
  const wrapped = timeMs % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
};

/**
 * Resolve the scene active at `timeMs`.
 *
 * The search is the last scene whose start is ≤ the time. On an exact boundary
 * that is the *incoming* scene at local time 0 — the outgoing scene is
 * considered over. Combined with {@link sceneInProgress}, which keeps an
 * outgoing scene alive across its transition, this gives a clean handover: the
 * outgoing scene fades across the boundary while the incoming one is already
 * drawing at its own t=0.
 */
export const sceneAt = (composition: Composition, timeMs: number): ResolvedScene => {
  const offsets = sceneOffsets(composition);
  if (offsets.length === 0) {
    throw new Error("motion: composition has no scenes");
  }
  const t = clampTime(composition, timeMs);
  let match = offsets[0];
  for (const candidate of offsets) {
    if (t >= candidate.startMs) match = candidate;
    else break;
  }
  const localMs = Math.min(
    Math.max(t - match.startMs, 0),
    match.scene.durationMs,
  );
  return {
    scene: match.scene,
    index: match.index,
    startMs: match.startMs,
    endMs: match.endMs,
    localMs,
    progress:
      match.scene.durationMs > 0 ? localMs / match.scene.durationMs : 0,
  };
};

/**
 * Transition progress for a scene: 1 during the scene, easing to 0 across its
 * leading `transition.durationMs`.
 *
 * The transition belongs to the *outgoing* scene, so it is resolved from the
 * scene's end backwards. A zero-duration transition is a hard cut and returns
 * 1 until the very last instant.
 */
export const transitionProgress = (
  scene: Scene,
  localMs: number,
): number => {
  const { transition } = scene;
  if (!transition || transition.durationMs <= 0) return 1;
  const leadIn = Math.min(transition.durationMs, scene.durationMs);
  const into = easedProgress(localMs, 0, leadIn, MOTION_EASE);
  return 1 - into;
};

/**
 * Every scene that contributes a visible layer at `timeMs` — the resolved
 * scene plus any earlier scene still inside its transition.
 *
 * Renderers must draw all of these in `z` then index order. Returning a list
 * rather than a single scene is what makes cross-fades possible without the
 * renderer knowing anything about transitions.
 */
export const scenesInProgress = (
  composition: Composition,
  timeMs: number,
): ResolvedScene[] => {
  const offsets = sceneOffsets(composition);
  if (offsets.length === 0) return [];
  const t = clampTime(composition, timeMs);
  const active = sceneAt(composition, t);
  const result: ResolvedScene[] = [active];

  for (const candidate of offsets) {
    if (candidate.endMs <= active.startMs) {
      const outgoing = candidate.scene.transition;
      if (
        outgoing &&
        outgoing.kind !== "cut" &&
        outgoing.kind !== "none" &&
        outgoing.durationMs > 0 &&
        // The current time must still be inside the outgoing scene's
        // transition window. Testing only `active.startMs - endMs` keeps the
        // scene in the list for the whole of the *incoming* scene, long after
        // its transition finished. It is harmless today because its computed
        // opacity is zero and renderers skip it — but it is a stale entry that
        // every consumer has to know to ignore.
        t < candidate.endMs + outgoing.durationMs
      ) {
        const localMs = Math.min(
          candidate.scene.durationMs,
          Math.max(t - candidate.startMs, 0),
        );
        result.push({
          scene: candidate.scene,
          index: candidate.index,
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          localMs,
          progress:
            candidate.scene.durationMs > 0
              ? localMs / candidate.scene.durationMs
              : 0,
        });
      }
    }
  }
  return result.sort((a, b) => a.index - b.index);
};

/** Resolve a transition's slide offset in composition px, for `slide` cuts. */
export const transitionOffset = (
  transition: Transition,
  height: number,
): { x: number; y: number } => {
  if (transition.kind !== "slide") return { x: 0, y: 0 };
  const angle = ((transition.direction ?? 180) * Math.PI) / 180;
  return {
    x: Math.cos(angle) * height,
    y: Math.sin(angle) * height,
  };
};