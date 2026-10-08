// A walk cycle for Live2D models with no leg parameters (Live2D's sample models can move their head, body,
// arms and coat, but not their legs). Pure math, no DOM, so it can be tested in Node.
//
// So she walks the way chibi desktop pets do: one cycle is two steps, and each step is a springy hop. She
// leans into the direction she walks, waddles side to side, stretches in the air, squashes and nods on each
// footfall, and her coat and arms swing in opposite directions.

export const STEPS_PER_SECOND = 2.4; // at SPEED 110 px/s that is a ~46 px stride

/**
 * Pose for `t` seconds into a walk. `amount` (0..1) fades the whole pose in when she starts walking and out
 * when she stops, so she never snaps.
 */
export function walkPose(t, amount = 1, facing = 1) {
  const phase = t * STEPS_PER_SECOND * Math.PI; // sin(phase) completes one cycle every two steps
  const side = Math.sin(phase); // -1 left foot forward .. 1 right foot forward
  const hop = Math.abs(Math.sin(phase)); // 0 at each footfall, 1 mid-step
  const contact = Math.max(0, 1 - hop * 4); // a short burst right at the footfall
  const air = Math.max(0, hop * 1.6 - 0.6); // near the top of the hop
  return {
    lift: 18 * Math.pow(hop, 0.8) * amount, // px up: a springy, chibi hop
    squash: (0.07 * contact - 0.025 * air) * amount, // shorter and wider on the footfall, stretched in the air
    rotation: (3 * side + 4 * Math.sign(facing || 1)) * amount, // waddle, leaning into the direction she walks
    headAngleY: -4 * contact * amount, // a little nod as each foot lands
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
