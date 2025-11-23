// src/workers/imageDecoderWorker.js
self.onmessage = async (ev) => {
  const data = ev.data;
  if (!data) return;
  if (data.type === "decode" && data.src) {
    const src = data.src;
    try {
      // fetch as blob (CORS must allow)
      const resp = await fetch(src, { mode: "cors" });
      if (!resp.ok) {
        self.postMessage({ type: "decoded", src, success: false });
        return;
      }
      const blob = await resp.blob();
      // createImageBitmap will decode image off-main-thread in worker
      const bitmap = await createImageBitmap(blob);
      // post it back, transfer the bitmap to main thread
      self.postMessage({ type: "decoded", src, success: true, bitmap }, [bitmap]);
    } catch (err) {
      try {
        self.postMessage({ type: "decoded", src, success: false });
      } catch (e) {}
    }
  }
};
