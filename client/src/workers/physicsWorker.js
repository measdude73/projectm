// Prototype physics worker
// Layout per bubble (Float32): x, y, vx, vy, radius, health, aliveFlag, id, imgIndex
const PER_BUBBLE = 9;
let count = 0;
let width = 0;
let height = 0;
let positionsBuffer = null; // ArrayBuffer being written this tick
let positions = null; // Float32Array view
let running = false;
let tickMs = 16; // ~60Hz physics

function init(payload) {
  count = payload.count || 200;
  width = payload.width || 800;
  height = payload.height || 600;
  tickMs = payload.tickMs || 16;

  const byteLen = Float32Array.BYTES_PER_ELEMENT * count * PER_BUBBLE;
  positionsBuffer = new ArrayBuffer(byteLen);
  positions = new Float32Array(positionsBuffer);

  // Initialize bubbles with random state if none provided
  for (let i = 0; i < count; i++) {
    const b = i * PER_BUBBLE;
    positions[b + 0] = Math.random() * width; // x
    positions[b + 1] = Math.random() * height; // y
    positions[b + 2] = (Math.random() - 0.5) * 120; // vx
    positions[b + 3] = (Math.random() - 0.5) * 120; // vy
    positions[b + 4] = (payload.minRadius || 6) + Math.random() * ((payload.maxRadius || 14) - (payload.minRadius || 6)); // radius
    positions[b + 5] = payload.startHealth || 100; // health
    positions[b + 6] = 1; // alive
    positions[b + 7] = i + 1; // id (float)
    positions[b + 8] = -1; // imgIndex (no image)
  }

  // Send initial buffer to main thread (transferable)
  postMessage({ type: 'buffer', count, buffer: positionsBuffer }, [positionsBuffer]);

  // After transfer the buffer is neutered in this worker, create a new one for subsequent ticks
  positionsBuffer = new ArrayBuffer(byteLen);
  positions = new Float32Array(positionsBuffer);

  running = true;
  runLoop();
}

function runLoop() {
  let last = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  function step() {
    if (!running) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

      // Simple physics: move, bounds, health drain
    for (let i = 0; i < count; i++) {
      const b = i * PER_BUBBLE;
      // If this bubble was not initialized into this buffer (because of double-buffering), skip
      // We'll copy initial values in the first tick from previously sent buffer on main thread.
      // For prototype, treat zero radius as uninitialized.
      if (positions[b + 4] === 0) {
        // assign defaults if needed
        positions[b + 4] = 8;
        positions[b + 5] = 100;
        positions[b + 6] = 1;
      }

      if (positions[b + 6] === 0) continue; // dead

      // integrate
      positions[b + 0] += positions[b + 2] * dt;
      positions[b + 1] += positions[b + 3] * dt;

      // simple bounds bounce
      if (positions[b + 0] - positions[b + 4] < 0) {
        positions[b + 0] = positions[b + 4];
        positions[b + 2] *= -1;
      } else if (positions[b + 0] + positions[b + 4] > width) {
        positions[b + 0] = width - positions[b + 4];
        positions[b + 2] *= -1;
      }
      if (positions[b + 1] - positions[b + 4] < 0) {
        positions[b + 1] = positions[b + 4];
        positions[b + 3] *= -1;
      } else if (positions[b + 1] + positions[b + 4] > height) {
        positions[b + 1] = height - positions[b + 4];
        positions[b + 3] *= -1;
      }

      // health drain (prototype): small drain, and occasional random damage to simulate fights
      positions[b + 5] -= dt * (payloadHealthDrainRate || 0.5);
      if (Math.random() < 0.0008) positions[b + 5] -= Math.random() * 20; // random hit
      if (positions[b + 5] <= 0) positions[b + 6] = 0; // dead
    }

    // Transfer buffer to main thread for rendering
    try {
      postMessage({ type: 'buffer', count, buffer: positionsBuffer }, [positionsBuffer]);
    } catch (err) {
      // If transfer fails for any reason, send without transfer
      postMessage({ type: 'buffer', count, buffer: positionsBuffer });
    }

    // recreate buffer for next tick (can't reuse a transferred ArrayBuffer)
    const byteLen = Float32Array.BYTES_PER_ELEMENT * count * PER_BUBBLE;
    positionsBuffer = new ArrayBuffer(byteLen);
    positions = new Float32Array(positionsBuffer);

    setTimeout(step, tickMs);
  }

  step();
}

let payloadHealthDrainRate = 0.5;

onmessage = (e) => {
  const { type, payload } = e.data;
  if (type === 'init') {
    Object.assign(payload || {}, {});
    if (payload && typeof payload.healthDrainRate === 'number') payloadHealthDrainRate = payload.healthDrainRate;
    init(payload || {});
  } else if (type === 'stop') {
    running = false;
  } else if (type === 'config') {
    if (payload.width) width = payload.width;
    if (payload.height) height = payload.height;
    if (typeof payload.tickMs === 'number') tickMs = payload.tickMs;
    if (typeof payload.healthDrainRate === 'number') payloadHealthDrainRate = payload.healthDrainRate;
  } else if (type === 'initBuffer') {
    // payload: { count, width, height, tickMs }, and e.data.buffer contains an ArrayBuffer with initial Float32 data
    const buf = e.data.buffer;
    if (buf && payload && payload.count) {
      try {
        const incoming = new Float32Array(buf);
        count = payload.count;
        width = payload.width || width;
        height = payload.height || height;
        tickMs = payload.tickMs || tickMs;

        const byteLen = Float32Array.BYTES_PER_ELEMENT * count * PER_BUBBLE;
        // Create internal buffer and copy initial state into it
        positionsBuffer = new ArrayBuffer(byteLen);
        positions = new Float32Array(positionsBuffer);
        // copy min(lengths)
        positions.set(incoming.subarray(0, Math.min(incoming.length, positions.length)));

        // start loop
        running = true;
        runLoop();
        // send initial frame back
        postMessage({ type: 'buffer', count, buffer: positionsBuffer }, [positionsBuffer]);
        // recreate internal buffer for next ticks
        positionsBuffer = new ArrayBuffer(byteLen);
        positions = new Float32Array(positionsBuffer);
      } catch (err) {
        // fallback: won't crash
        console.error('initBuffer error', err);
      }
    }
  }
};
