// A walk cycle for Live2D models that have no legs to animate (the sample models are rigged from the waist
// up, and Mao's legs are under her robe). Pure math, no DOM, so it can be tested in Node.
//
// One cycle is two steps. Each step is a little hop: the body rises and falls, squashes on the footfall,
// waddles from side to side, the robe swings with the stepping leg and the arms swing the other way.

export const STEPS_PER_SECOND = 2.4; // at SPEED 110 px/s that is a ~46 px stride

/**
 * Pose for `t` seconds into a walk. `amount` (0..1) fades the whole pose in when she starts walking and out
 * when she stops, so she never snaps.
 */
export function walkPose(t, amount = 1) {
  const phase = t * STEPS_PER_SECOND * Math.PI; // sin(phase) completes one cycle every two steps
  const side = Math.sin(phase); // -1 left foot forward .. 1 right foot forward
  const hop = Math.abs(Math.sin(phase)); // 0 at each footfall, 1 mid-step
  const contact = Math.max(0, 1 - hop * 4); // a short burst right at the footfall
  return {
    lift: 12 * hop * amount, // px up
    squash: 0.045 * contact * amount, // fraction shorter (and a bit wider) on the footfall
    rotation: 3.5 * side * amount, // degrees of waddle around her feet
    bodyAngleZ: 6 * side * amount,
    bodyAngleX: 4 * side * amount,
    headAngleZ: -3 * side * amount, // the head counters the body so she looks steady
    robeL: 0.9 * side * amount,
    robeR: -0.9 * side * amount,
    armL: -8 * side * amount, // arms swing opposite the legs
    armR: 8 * side * amount,
    shoulderL: 3 * Math.max(0, side) * amount,
    shoulderR: 3 * Math.max(0, -side) * amount,
  };
}

/** Step index at time t; a change means a foot just touched down (for a dust puff). */
export function stepIndex(t) {
  return Math.floor(t * STEPS_PER_SECOND);
}

/** Move `current` toward `target` at `rate` per second (for fading the walk in and out). */
export function approach(current, target, rate, dt) {
  const delta = target - current;
  const stepSize = rate * dt;
  return Math.abs(delta) <= stepSize ? target : current + Math.sign(delta) * stepSize;
}
