/**
 * Studio Drawing App — Tools
 * Brush rendering, stroke smoothing, tool implementations
 */

// ─── Brush Stamp Cache ────────────────────────────────────────────────────────

const stampCache = new Map();

function getStamp(size, hardness, r, g, b) {
  const key = `${size}:${hardness}:${r}:${g}:${b}`;
  if (stampCache.has(key)) return stampCache.get(key);

  const d = Math.ceil(size * 2 + 2);
  const c = document.createElement('canvas');
  c.width = d; c.height = d;
  const ctx = c.getContext('2d');
  const cx = d / 2, cy = d / 2, r0 = size * hardness, r1 = size;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r1);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  if (hardness < 1) {
    grad.addColorStop(Math.max(0, hardness - 0.01), `rgba(${r},${g},${b},1)`);
  }
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, 0, Math.PI * 2);
  ctx.fill();

  if (stampCache.size > 500) {
    const firstKey = stampCache.keys().next().value;
    stampCache.delete(firstKey);
  }
  stampCache.set(key, c);
  return c;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ─── Stroke Smoothing ─────────────────────────────────────────────────────────

class StrokeBuffer {
  constructor() {
    this.pts = [];
    this.smoothed = [];
  }

  push(x, y, pressure, tiltX, tiltY) {
    this.pts.push({ x, y, p: pressure ?? 0.5, tx: tiltX ?? 0, ty: tiltY ?? 0 });
  }

  getSmoothed() {
    const pts = this.pts;
    if (pts.length < 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      out.push({
        x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4,
        y: (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4,
        p: pts[i].p,
        tx: pts[i].tx,
        ty: pts[i].ty,
      });
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  clear() { this.pts = []; this.smoothed = []; }
  get length() { return this.pts.length; }
  get last() { return this.pts[this.pts.length - 1]; }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = {

  pencil: {
    name: 'Pencil',
    cursor: 'crosshair',
    defaultSize: 6,
    defaultHardness: 0.92,
    defaultOpacity: 1,
    spacing: 0.12,

    onStrokeStart(state, ctx, x, y, p) {
      engine.saveUndo();
      state.buf = new StrokeBuffer();
      state.buf.push(x, y, p);
      state.lastX = x; state.lastY = y;
    },

    onStrokeMove(state, ctx, pts) {
      const { color, size, opacity, pressureSize, pressureOpacity, hardness } = state;
      const { r, g, b } = hexToRgb(color);

      for (const pt of pts) {
        state.buf.push(pt.x, pt.y, pt.p);
      }

      ctx.save();
      const sp = state.buf.getSmoothed();
      for (let i = Math.max(1, sp.length - pts.length - 1); i < sp.length; i++) {
        const prev = sp[i - 1], cur = sp[i];
        const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const ps = pressureSize ? cur.p : 0.7 + cur.p * 0.3;
        const po = pressureOpacity ? cur.p : 1;
        const r0 = Math.max(0.5, size * ps);
        const hard = Math.min(1, hardness + 0.05);
        const spacing = Math.max(1, r0 * this.spacing);
        const steps = Math.max(1, Math.ceil(dist / spacing));

        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = prev.x + (cur.x - prev.x) * t;
          const py = prev.y + (cur.y - prev.y) * t;
          const stamp = getStamp(r0, hard, r, g, b);
          ctx.globalAlpha = opacity * po * 0.85;
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(stamp, px - r0, py - r0, r0 * 2, r0 * 2);
        }
      }
      ctx.restore();
    },

    onStrokeEnd(state, layerCtx) {
      layerCtx.drawImage(engine.overlayCanvas, 0, 0);
      engine.overlayCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
      engine.composite();
    },
  },

  pen: {
    name: 'Ink Pen',
    cursor: 'crosshair',
    defaultSize: 4,
    defaultHardness: 1,
    defaultOpacity: 1,
    spacing: 0.08,

    onStrokeStart(state, ctx, x, y, p) {
      engine.saveUndo();
      state.buf = new StrokeBuffer();
      state.buf.push(x, y, p);
    },

    onStrokeMove(state, ctx, pts) {
      const { color, size, opacity, pressureSize } = state;
      const { r, g, b } = hexToRgb(color);

      for (const pt of pts) state.buf.push(pt.x, pt.y, pt.p);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const sp = state.buf.getSmoothed();
      const start = Math.max(1, sp.length - pts.length - 2);

      for (let i = start; i < sp.length; i++) {
        const a = sp[Math.max(0, i - 2)];
        const b0 = sp[i - 1];
        const c = sp[i];
        const d = sp[Math.min(sp.length - 1, i + 1)];

        const lw = pressureSize
          ? Math.max(0.5, size * (0.3 + b0.p * 0.7) * 2)
          : size * 2;

        const cp1x = b0.x + (c.x - a.x) / 6;
        const cp1y = b0.y + (c.y - a.y) / 6;
        const cp2x = c.x - (d.x - b0.x) / 6;
        const cp2y = c.y - (d.y - b0.y) / 6;

        ctx.globalAlpha = opacity;
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(b0.x, b0.y);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, c.x, c.y);
        ctx.stroke();
      }
      ctx.restore();
    },

    onStrokeEnd(state, layerCtx) {
      layerCtx.drawImage(engine.overlayCanvas, 0, 0);
      engine.overlayCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
      engine.composite();
    },
  },

  brush: {
    name: 'Brush',
    cursor: 'crosshair',
    defaultSize: 20,
    defaultHardness: 0.3,
    defaultOpacity: 0.7,
    spacing: 0.2,

    onStrokeStart(state, ctx, x, y, p) {
      engine.saveUndo();
      state.buf = new StrokeBuffer();
      state.buf.push(x, y, p);
    },

    onStrokeMove(state, ctx, pts) {
      const { color, size, opacity, pressureSize, pressureOpacity, hardness } = state;
      const { r, g, b } = hexToRgb(color);

      for (const pt of pts) state.buf.push(pt.x, pt.y, pt.p);

      ctx.save();
      const sp = state.buf.getSmoothed();
      const start = Math.max(1, sp.length - pts.length - 2);

      for (let i = start; i < sp.length; i++) {
        const prev = sp[i - 1], cur = sp[i];
        const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const ps = pressureSize ? 0.4 + cur.p * 0.6 : 1;
        const po = pressureOpacity ? 0.3 + cur.p * 0.7 : 1;
        const r0 = Math.max(1, size * ps);
        const spacing = Math.max(1, r0 * this.spacing);
        const steps = Math.max(1, Math.ceil(dist / spacing));

        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = prev.x + (cur.x - prev.x) * t;
          const py = prev.y + (cur.y - prev.y) * t;
          const stamp = getStamp(r0, hardness, r, g, b);
          ctx.globalAlpha = opacity * po * 0.4;
          ctx.drawImage(stamp, px - r0, py - r0, r0 * 2, r0 * 2);
        }
      }
      ctx.restore();
    },

    onStrokeEnd(state, layerCtx) {
      layerCtx.drawImage(engine.overlayCanvas, 0, 0);
      engine.overlayCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
      engine.composite();
    },
  },

  marker: {
    name: 'Marker',
    cursor: 'crosshair',
    defaultSize: 18,
    defaultHardness: 0.98,
    defaultOpacity: 0.6,
    spacing: 0.05,

    onStrokeStart(state, layerCtx, x, y, p) {
      engine.saveUndo();
      state.buf = new StrokeBuffer();
      state.buf.push(x, y, p);
      // Markers draw directly to layer with constant opacity per stroke
      // We need a temp canvas per stroke to avoid overlap darkening mid-stroke
      state.strokeCanvas = document.createElement('canvas');
      state.strokeCanvas.width = engine.docWidth;
      state.strokeCanvas.height = engine.docHeight;
      state.strokeCtx = state.strokeCanvas.getContext('2d');
    },

    onStrokeMove(state, ctx, pts) {
      const { color, size, hardness } = state;
      const { r, g, b } = hexToRgb(color);
      for (const pt of pts) state.buf.push(pt.x, pt.y, pt.p);

      state.strokeCtx.save();
      const sp = state.buf.getSmoothed();
      const start = Math.max(1, sp.length - pts.length - 2);

      for (let i = start; i < sp.length; i++) {
        const prev = sp[i - 1], cur = sp[i];
        const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const r0 = size;
        const spacing = Math.max(1, r0 * this.spacing);
        const steps = Math.max(1, Math.ceil(dist / spacing));

        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = prev.x + (cur.x - prev.x) * t;
          const py = prev.y + (cur.y - prev.y) * t;
          const stamp = getStamp(r0, hardness, r, g, b);
          state.strokeCtx.globalAlpha = 1;
          state.strokeCtx.drawImage(stamp, px - r0, py - r0, r0 * 2, r0 * 2);
        }
      }
      state.strokeCtx.restore();

      // Preview: composite strokeCanvas onto overlay
      engine.overlayCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
      engine.overlayCtx.save();
      engine.overlayCtx.globalAlpha = state.opacity;
      engine.overlayCtx.drawImage(state.strokeCanvas, 0, 0);
      engine.overlayCtx.restore();
    },

    onStrokeEnd(state, layerCtx) {
      layerCtx.globalAlpha = state.opacity;
      layerCtx.drawImage(state.strokeCanvas, 0, 0);
      layerCtx.globalAlpha = 1;
      engine.overlayCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
      engine.composite();
    },
  },

  eraser: {
    name: 'Eraser',
    cursor: 'crosshair',
    defaultSize: 24,
    defaultHardness: 0.6,
    defaultOpacity: 1,
    spacing: 0.12,

    onStrokeStart(state, layerCtx, x, y, p) {
      engine.saveUndo();
      state.buf = new StrokeBuffer();
      state.buf.push(x, y, p);
    },

    onStrokeMove(state, ctx, pts, layerCtx) {
      const { size, opacity, pressureSize, hardness } = state;
      for (const pt of pts) state.buf.push(pt.x, pt.y, pt.p);

      // Eraser draws directly on layer canvas
      const sp = state.buf.getSmoothed();
      const start = Math.max(1, sp.length - pts.length - 2);

      layerCtx.save();
      for (let i = start; i < sp.length; i++) {
        const prev = sp[i - 1], cur = sp[i];
        const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const ps = pressureSize ? 0.4 + cur.p * 0.6 : 1;
        const r0 = Math.max(1, size * ps);
        const spacing = Math.max(1, r0 * this.spacing);
        const steps = Math.max(1, Math.ceil(dist / spacing));

        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = prev.x + (cur.x - prev.x) * t;
          const py = prev.y + (cur.y - prev.y) * t;
          const stamp = getStamp(r0, hardness, 0, 0, 0);
          layerCtx.globalAlpha = opacity * 0.9;
          layerCtx.globalCompositeOperation = 'destination-out';
          layerCtx.drawImage(stamp, px - r0, py - r0, r0 * 2, r0 * 2);
        }
      }
      layerCtx.restore();
      engine.composite();
    },

    onStrokeEnd(state, layerCtx) {
      layerCtx.globalAlpha = 1;
      layerCtx.globalCompositeOperation = 'source-over';
      engine.composite();
    },
  },

  fill: {
    name: 'Fill',
    cursor: 'crosshair',

    onStrokeStart(state, _ctx, x, y) {
      engine.saveUndo();
      const layerCtx = engine.activeLayer?.ctx;
      if (!layerCtx) return;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= engine.docWidth || iy >= engine.docHeight) return;

      const imgData = layerCtx.getImageData(0, 0, engine.docWidth, engine.docHeight);
      const { r, g, b } = hexToRgb(state.color);
      const fa = Math.round(state.opacity * 255);

      const idx = (iy * engine.docWidth + ix) * 4;
      const tr = imgData.data[idx];
      const tg = imgData.data[idx + 1];
      const tb = imgData.data[idx + 2];
      const ta = imgData.data[idx + 3];

      if (tr === r && tg === g && tb === b && ta === fa) return;

      const tolerance = 32;
      const w = engine.docWidth, h = engine.docHeight;
      const data = imgData.data;
      const visited = new Uint8Array(w * h);
      const stack = [ix + iy * w];
      visited[ix + iy * w] = 1;

      function match(i) {
        const base = i * 4;
        return (
          Math.abs(data[base] - tr) <= tolerance &&
          Math.abs(data[base + 1] - tg) <= tolerance &&
          Math.abs(data[base + 2] - tb) <= tolerance &&
          Math.abs(data[base + 3] - ta) <= tolerance
        );
      }

      while (stack.length > 0) {
        const pos = stack.pop();
        const px = pos % w, py = Math.floor(pos / w);
        const base = pos * 4;
        data[base] = r; data[base + 1] = g; data[base + 2] = b; data[base + 3] = fa;

        const neighbors = [pos - 1, pos + 1, pos - w, pos + w];
        for (const nb of neighbors) {
          if (nb < 0 || nb >= w * h) continue;
          const nx = nb % w, ny = Math.floor(nb / w);
          if (Math.abs(nx - px) > 1) continue;
          if (visited[nb]) continue;
          if (match(nb)) {
            visited[nb] = 1;
            stack.push(nb);
          }
        }
      }

      layerCtx.putImageData(imgData, 0, 0);
      engine.composite();
    },

    onStrokeMove() { /* fill is one-shot */ },
    onStrokeEnd() { /* no-op */ },
  },

  eyedropper: {
    name: 'Eyedropper',
    cursor: 'crosshair',

    onStrokeStart(state, layerCtx, x, y) {
      const ix = Math.clamp ? Math.clamp(Math.floor(x), 0, engine.docWidth - 1)
        : Math.max(0, Math.min(engine.docWidth - 1, Math.floor(x)));
      const iy = Math.max(0, Math.min(engine.docHeight - 1, Math.floor(y)));
      const pixel = engine.displayCtx.getImageData(ix, iy, 1, 1).data;
      const hex = '#' + [pixel[0], pixel[1], pixel[2]]
        .map(v => v.toString(16).padStart(2, '0')).join('');
      if (state.onPickColor) state.onPickColor(hex);
    },

    onStrokeMove(state, ctx, pts) {
      if (pts.length && state.onPickColor) {
        const pt = pts[pts.length - 1];
        const ix = Math.max(0, Math.min(engine.docWidth - 1, Math.floor(pt.x)));
        const iy = Math.max(0, Math.min(engine.docHeight - 1, Math.floor(pt.y)));
        const pixel = engine.displayCtx.getImageData(ix, iy, 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]]
          .map(v => v.toString(16).padStart(2, '0')).join('');
        state.onPickColor(hex);
      }
    },

    onStrokeEnd() {},
  },

  move: {
    name: 'Move',
    cursor: 'grab',
    _startPan: null,

    onStrokeStart(state, ctx, x, y) {
      this._startPan = { x, y, px: engine.panX, py: engine.panY };
    },

    onStrokeMove(state, ctx, pts) {
      if (!this._startPan || !pts.length) return;
      // For move tool we need screen coords
    },

    onStrokeEnd() { this._startPan = null; },
  },
};

// ─── Cursor Brush Preview ─────────────────────────────────────────────────────

class CursorPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = false;
    this.x = 0; this.y = 0;
    this.size = 12;
  }

  show(x, y, size, color, tool) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (tool === 'move' || tool === 'eyedropper' || tool === 'fill') return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5 / engine.zoom;
    ctx.setLineDash([4 / engine.zoom, 4 / engine.zoom]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, size), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.5 / engine.zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, size), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
