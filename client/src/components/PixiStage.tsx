// src/components/PixiStage.tsx
import React, { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";

export type PixiStageProps = {
  rootRef?: React.RefObject<HTMLDivElement | null>;
  countRef?: React.RefObject<number>;
  xRef?: React.RefObject<Float32Array | null>;
  yRef?: React.RefObject<Float32Array | null>;
  rRef?: React.RefObject<Float32Array | null>;
  healthRef?: React.RefObject<Float32Array | null>;
  imgIndexRef?: React.RefObject<Int32Array | null>;
  imgSrcsRef?: React.RefObject<string[]>;
  decoderWorker?: Worker | null; // optional - we use internal pool by default
  maxPool?: number;
  onAppReady?: (app: PIXI.Application) => void;
  className?: string;
};

/**
 * PixiStage
 *
 * - Renders up to `maxPool` sprites driven by typed arrays from parent (xRef, yRef, rRef, etc).
 * - Loads textures on demand using a concurrency-limited decoder pool to avoid OOM.
 * - Keeps a small texture cache with eviction to free GPU memory.
 *
 * Notes:
 * - Keep maxTextures and maxTextureSide conservative on low-memory devices.
 * - If you use your own external image decode worker, you can ignore internal pool by passing decoderWorker,
 *   but this component includes its own safe decoder pool for convenience and robustness.
 */
const PixiStage: React.FC<PixiStageProps> = ({
  rootRef,
  countRef,
  xRef,
  yRef,
  rRef,
  healthRef,
  imgIndexRef,
  imgSrcsRef,
  decoderWorker,
  maxPool = 1024,
  onAppReady,
  className,
}) => {
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const textureMapRef = useRef<Map<string, PIXI.Texture>>(new Map());
  const textureOrderRef = useRef<string[]>([]); // LRU-ish order (most recent at end)
  const roRef = useRef<ResizeObserver | null>(null);

  // conservative GPU settings - tune if you know your environment
  const maxTextures = Math.min(160, Math.max(40, Math.floor((maxPool || 1024) / 8))); // cap #distinct textures kept
  const maxTextureSide = 512; // max side length of texture we keep (downscale bigger images)

  // small concurrency-limited decoder pool (uses fetch + createImageBitmap with fallback)
  function createDecoderPool(concurrency = 2, maxRetries = 2) {
    type Task = { src: string; resolve: (b: ImageBitmap | null) => void; reject: (e: any) => void; tries: number };
    const queue: Task[] = [];
    let running = 0;

    const runNext = () => {
      if (running >= concurrency) return;
      const t = queue.shift();
      if (!t) return;
      running++;
      (async () => {
        try {
          const bmp = await decodeOnce(t.src);
          t.resolve(bmp);
        } catch (err) {
          t.tries++;
          if (t.tries <= maxRetries) {
            // simple backoff
            setTimeout(() => {
              queue.push(t);
              runNext();
            }, 150 * t.tries);
          } else {
            t.reject(err);
          }
        } finally {
          running--;
          runNext();
        }
      })();
    };

    async function decodeOnce(src: string): Promise<ImageBitmap | null> {
      // Try fetch + createImageBitmap (fast, efficient), fallback to Image element
      try {
        const resp = await fetch(src, { mode: "cors" });
        if (!resp.ok) throw new Error("fetch failed");
        const blob = await resp.blob();
        // createImageBitmap may fail for huge/corrupt images -> catch in caller
        const bmp = await createImageBitmap(blob);
        return bmp;
      } catch (err) {
        // fallback: load via Image element then createImageBitmap
        return new Promise<ImageBitmap | null>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          let done = false;
          img.onload = async () => {
            try {
              // if createImageBitmap not supported or fails, resolve with null so caller can fallback
              try {
                const bmp = await createImageBitmap(img);
                if (!done) {
                  done = true;
                  resolve(bmp);
                }
              } catch (e) {
                if (!done) {
                  done = true;
                  reject(e);
                }
              }
            } catch (e) {
              if (!done) {
                done = true;
                reject(e);
              }
            } finally {
              // allow GC on image object
              img.onload = null;
              img.onerror = null;
            }
          };
          img.onerror = (e) => {
            if (!done) {
              done = true;
              reject(new Error("Image element failed to load"));
            }
            img.onload = null;
            img.onerror = null;
          };
          img.src = src;
        });
      }
    }

    return {
      enqueue(src: string) {
        return new Promise<ImageBitmap | null>((resolve, reject) => {
          queue.push({ src, resolve, reject, tries: 0 });
          runNext();
        });
      },
    };
  }

  // instantiate decoder pool (we'll use it even if decoderWorker passed; it's simpler)
  const decoderPoolRef = useRef(createDecoderPool(2));

  // downscale ImageBitmap to maxTextureSide if necessary (returns an HTMLCanvasElement)
  const downscaleToCanvas = async (bmp: ImageBitmap, maxSide: number) => {
    try {
      const w = bmp.width;
      const h = bmp.height;
      if (w <= maxSide && h <= maxSide) {
        // no downscale - draw onto canvas to create transferable texture if needed
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bmp, 0, 0);
        return c;
      }
      const ratio = Math.min(maxSide / w, maxSide / h);
      const nw = Math.max(1, Math.floor(w * ratio));
      const nh = Math.max(1, Math.floor(h * ratio));
      const c = document.createElement("canvas");
      c.width = nw;
      c.height = nh;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, nw, nh);
      return c;
    } finally {
      // can't close/transfer ImageBitmap here in all browsers, but GC will free if not referenced
    }
  };

  // ensure texture exists for src (returns PIXI.Texture or undefined)
  const ensureTextureForSrc = async (src: string, app?: PIXI.Application): Promise<PIXI.Texture | undefined> => {
    if (!src) return undefined;
    const map = textureMapRef.current;
    if (map.has(src)) {
      // update LRU order
      const order = textureOrderRef.current;
      const idx = order.indexOf(src);
      if (idx >= 0) {
        order.splice(idx, 1);
        order.push(src);
      } else {
        order.push(src);
      }
      return map.get(src);
    }

    // If too many textures cached, evict oldest
    const order = textureOrderRef.current;
    while (order.length >= maxTextures) {
      const oldest = order.shift();
      if (!oldest) break;
      const t = map.get(oldest);
      if (t) {
        try {
          // destroy texture and base texture
          t.destroy(true);
        } catch {}
      }
      map.delete(oldest);
    }

    try {
      // Use decoder pool to fetch & decode
      const bmp = await decoderPoolRef.current.enqueue(src);
      if (!bmp) return undefined;

      // downscale into canvas if needed
      let sourceForPixi: HTMLCanvasElement | ImageBitmap | HTMLImageElement = bmp;
      if (Math.max(bmp.width, bmp.height) > maxTextureSide) {
        const cnv = await downscaleToCanvas(bmp, maxTextureSide);
        if (cnv) sourceForPixi = cnv;
      }

      // Create PIXI texture from canvas or bitmap
      let texture: PIXI.Texture;
      try {
        // PIXI.Texture.from accepts HTMLCanvasElement, ImageBitmap, or string.
        texture = PIXI.Texture.from(sourceForPixi as any);
      } catch (e) {
        // fallback: create base texture then texture
        try {
          // @ts-ignore - internal BaseTexture constructor typed differently across versions
          const bt = new (PIXI as any).BaseTexture(sourceForPixi);
          texture = new PIXI.Texture(bt as any);
        } catch (err) {
          // last resort: use white texture
          texture = PIXI.Texture.WHITE;
        }
      }

      // store and update order
      map.set(src, texture);
      order.push(src);
      return texture;
    } catch (err) {
      // decode or create texture failed
      console.warn("ensureTextureForSrc failed for", src, err);
      return undefined;
    }
  };

  useEffect(() => {
    const container = (rootRef && rootRef.current) || localContainerRef.current;
    if (!container) return;
    // guard double-init
    if (appRef.current) return;

    // create and attach a canvas to the container for PIXI to use. This is safer than letting PIXI create its own.
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const app = new PIXI.Application();
    appRef.current = app;

    // Prefer Application.init (PIXI v8+) — safe-check and fallback
    try {
      if (typeof (app as any).init === "function") {
        (app as any).init({
          canvas: canvas as unknown as HTMLCanvasElement,
          width: Math.max(200, container.clientWidth),
          height: Math.max(200, container.clientHeight),
          backgroundAlpha: 0,
          antialias: true,
        });
      } else {
        // older versions: resize and ensure renderer uses our canvas if possible
        try {
          app.renderer.resize(Math.max(200, container.clientWidth), Math.max(200, container.clientHeight));
          // try to replace view with our canvas - best-effort (some pixi builds don't allow swapping)
          try {
            // some pixi builds expose renderer.view
            const view = (app.renderer as any).view as HTMLCanvasElement | undefined;
            if (view && view !== canvas) {
              // remove old view if owned by container
              if (view.parentNode === container) view.parentNode.removeChild(view);
              container.appendChild(canvas);
            }
          } catch {}
        } catch {}
      }
    } catch (err) {
      // if init fails, still try to resize renderer to container
      try {
        app.renderer.resize(Math.max(200, container.clientWidth), Math.max(200, container.clientHeight));
      } catch {}
    }

    // call back
    onAppReady?.(app);

    // stage & ticker
    const stage = app.stage;
    const ticker = app.ticker ?? PIXI.Ticker.shared;

    // sprite pool
    const poolSize = Math.max(64, Math.min( Math.max(64, maxPool), 4096 ));
    const spritesPool: PIXI.Sprite[] = [];
    const fallbackTexture = PIXI.Texture.WHITE;

    for (let i = 0; i < poolSize; i++) {
      const s = new PIXI.Sprite(fallbackTexture);
      s.anchor.set(0.5);
      s.visible = false;
      spritesPool.push(s);
      try {
        stage.addChild(s);
      } catch (e) {
        // if stage invalid, ignore
      }
    }

    // resize observer: keep renderer size in sync
    const ro = new ResizeObserver(() => {
      try {
        const w = Math.max(200, container.clientWidth);
        const h = Math.max(200, container.clientHeight);
        // app.renderer.view might be a ViewSystem — cast carefully
        try {
          app.renderer.resize(w, h);
        } catch {}
      } catch {}
    });
    ro.observe(container);
    roRef.current = ro;

    // onTick update loop (defensive)
    const onTick = async () => {
      try {
        if (!appRef.current) return;
        const a = appRef.current;
        // defensive: if renderer destroyed, bail
        if (!a.renderer || (a.renderer as any)._gl === null) return;

        const n = countRef?.current ?? 0;
        const xArr = xRef?.current;
        const yArr = yRef?.current;
        const rArr = rRef?.current;
        const hArr = healthRef?.current;
        const idxArr = imgIndexRef?.current;
        const srcList = imgSrcsRef?.current;

        const visibleCount = Math.min(n, spritesPool.length);
        for (let i = 0; i < visibleCount; i++) {
          const s = spritesPool[i];
          if (!s) continue;
          // defensive: skip if destroyed
          if ((s as any).__destroyed || !s.parent) {
            s.visible = false;
            continue;
          }

          const x = xArr ? xArr[i] : 0;
          const y = yArr ? yArr[i] : 0;
          const r = rArr ? Math.max(1, rArr[i]) : 8;
          const hp = hArr ? hArr[i] : 100;

          s.x = x;
          s.y = y;
          s.visible = true;
          s.width = r * 2;
          s.height = r * 2;

          // color tint based on health
          if (hp > 60) s.tint = 0x2ecc71;
          else if (hp > 30) s.tint = 0xf1c40f;
          else s.tint = 0xff4d4d;

          // texture selection: ensure texture for src is loaded lazily
          if (idxArr && srcList) {
            const imgIdx = idxArr[i];
            if (imgIdx >= 0 && imgIdx < srcList.length) {
              const src = srcList[imgIdx];
              const tex = textureMapRef.current.get(src);
              if (tex) {
                if (s.texture !== tex) s.texture = tex;
              } else {
                // kick off async load (don't await to avoid blocking ticker)
                ensureTextureForSrc(src, a).then((t) => {
                  // once loaded, if our sprite still maps to that src, apply texture
                  try {
                    const currentIdx = imgIndexRef?.current ? imgIndexRef.current[i] : -1;
                    if (currentIdx >= 0 && srcList && currentIdx < srcList.length && srcList[currentIdx] === src) {
                      const maybeTex = textureMapRef.current.get(src);
                      if (maybeTex && spritesPool[i] && spritesPool[i].texture !== maybeTex) {
                        spritesPool[i].texture = maybeTex;
                      }
                    }
                  } catch (e) {
                    // ignore
                  }
                }).catch(() => {});
              }
            }
          } // end if idxArr
        }

        // hide rest
        for (let i = visibleCount; i < spritesPool.length; i++) {
          const s = spritesPool[i];
          if (s) s.visible = false;
        }
      } catch (err) {
        // swallow to prevent ticker crash; log minimally
        // eslint-disable-next-line no-console
        console.warn("PixiStage tick error (ignored):", err);
      }
    };

    // add tick
    if (ticker && typeof ticker.add === "function") {
      ticker.add(onTick);
    } else {
      let rafId = 0;
      const loop = () => {
        onTick();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
      // store so cleanup can cancel if required
      (app as any).__pixi_rafl = rafId;
    }

    // cleanup
    return () => {
      try {
        // remove ticker listener
        try {
          if (ticker && typeof ticker.remove === "function") ticker.remove(onTick);
        } catch {}

        // disconnect ro
        try {
          ro.disconnect();
        } catch {}

        // remove sprites
        try {
          spritesPool.forEach((s) => {
            try {
              if (s.parent) s.parent.removeChild(s);
            } catch {}
            try {
              (s as any).__destroyed = true;
              s.destroy({ children: false, texture: false, baseTexture: false } as any);
            } catch {}
          });
        } catch {}

        // destroy cached textures
        try {
          const map = textureMapRef.current;
          textureOrderRef.current.forEach((k) => {
            try {
              const t = map.get(k);
              if (t) t.destroy(true);
            } catch {}
          });
          map.clear();
          textureOrderRef.current = [];
        } catch {}

        // destroy app
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true } as any);
        } catch {
          try {
            app.destroy(true);
          } catch {}
        }

        // remove canvas we created (best-effort)
        try {
          const canvasEl = container.querySelector("canvas");
          if (canvasEl && canvasEl.parentNode === container) canvasEl.parentNode.removeChild(canvasEl);
        } catch {}
      } catch (ex) {
        // eslint-disable-next-line no-console
        console.warn("PixiStage cleanup ignored error:", ex);
      } finally {
        appRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef?.current, maxPool]);

  // if rootRef provided, don't render local container (we appended canvas into provided container)
  if (rootRef) return null;

  return <div ref={localContainerRef} className={className} style={{ width: "100%", height: "100%", position: "relative" }} />;
};

export default PixiStage;
