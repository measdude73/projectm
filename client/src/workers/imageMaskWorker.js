// src/workers/imageMaskWorker.js
// Offscreen worker: receives {type: 'mask', id, src, size} and returns {type:'masked', id, src, bitmap, success}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg && msg.type === 'mask') {
      const { id, src, size } = msg;
      // Fetch image as blob (CORS must be allowed)
      let response;
      try {
        response = await fetch(src, { mode: 'cors' });
      } catch (err) {
        self.postMessage({ type: 'masked', id, src, success: false, error: 'fetch-failed' });
        return;
      }
      if (!response.ok) {
        self.postMessage({ type: 'masked', id, src, success: false, error: 'bad-status' });
        return;
      }
      const blob = await response.blob();

      // createImageBitmap from blob (fast, off-main thread)
      let imgBitmap;
      try {
        imgBitmap = await createImageBitmap(blob);
      } catch (err) {
        // fallback: post failure
        self.postMessage({ type: 'masked', id, src, success: false, error: 'createImageBitmap-failed' });
        return;
      }

      // compute canvas size (size x size pixels)
      const outSize = Math.max(1, Math.floor(size));

      // OffscreenCanvas draw
      try {
        const canvas = new OffscreenCanvas(outSize, outSize);
        const ctx = canvas.getContext('2d');

        // Draw circular mask
        ctx.clearRect(0, 0, outSize, outSize);
        ctx.save();
        ctx.beginPath();
        ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // Draw image scaled to fit (cover behavior)
        // compute scale preserving aspect and cover the circle
        const iw = imgBitmap.width;
        const ih = imgBitmap.height;
        const scale = Math.max(outSize / iw, outSize / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (outSize - dw) / 2;
        const dy = (outSize - dh) / 2;

        ctx.drawImage(imgBitmap, dx, dy, dw, dh);
        ctx.restore();

        // produce ImageBitmap to transfer
        const maskedBitmap = await createImageBitmap(canvas);

        // Transfer bitmap back to main thread
        self.postMessage({ type: 'masked', id, src, success: true, bitmap: maskedBitmap }, [maskedBitmap]);
        // close original bitmap
        imgBitmap.close && imgBitmap.close();
      } catch (err) {
        // any error
        imgBitmap && imgBitmap.close && imgBitmap.close();
        self.postMessage({ type: 'masked', id, src, success: false, error: 'draw-failed' });
      }
    }
  } catch (err) {
    try {
      self.postMessage({ type: 'masked', id: msg && msg.id, src: msg && msg.src, success: false, error: 'unexpected' });
    } catch (e) {}
  }
};
