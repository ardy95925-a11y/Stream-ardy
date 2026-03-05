/**
 * Studio Drawing App — Canvas Engine
 * Handles layers, compositing, undo/redo, zoom/pan
 */

class CanvasEngine {
  constructor() {
    this.layers = [];
    this.activeLayerIdx = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 40;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 0.05;
    this.maxZoom = 20;

    this.docWidth = 2732;
    this.docHeight = 2048;
    this.bgColor = '#ffffff';

    this.viewport = null;
    this.container = null;
    this.displayCanvas = null;
    this.displayCtx = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;

    // Gesture tracking
    this.activePenId = null;
    this.isPenDown = false;
    this.touchIds = new Set();
  }

  init(viewportEl, containerEl) {
    this.viewport = viewportEl;
    this.container = containerEl;

    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.id = 'display-canvas';
    this.displayCanvas.width = this.docWidth;
    this.displayCanvas.height = this.docHeight;
    this.displayCtx = this.displayCanvas.getContext('2d', { willReadFrequently: true });
    containerEl.insertBefore(this.displayCanvas, containerEl.firstChild);

    this.overlayCanvas = document.getElementById('overlay-canvas');
    this.overlayCanvas.width = this.docWidth;
    this.overlayCanvas.height = this.docHeight;
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // First layer
    this.addLayer('Background');
    this.fitToViewport();
    this.composite();
  }

  // ─── Layers ───────────────────────────────────────────────────

  addLayer(name) {
    const canvas = document.createElement('canvas');
    canvas.width = this.docWidth;
    canvas.height = this.docHeight;
    const layer = {
      id: Date.now() + Math.random(),
      name: name || `Layer ${this.layers.length + 1}`,
      canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      opacity: 1,
      blendMode: 'source-over',
      visible: true,
    };
    this.layers.push(layer);
    this.activeLayerIdx = this.layers.length - 1;
    this.composite();
    return layer;
  }

  deleteLayer(idx) {
    if (this.layers.length <= 1) return;
    this.layers.splice(idx, 1);
    this.activeLayerIdx = Math.max(0, Math.min(idx, this.layers.length - 1));
    this.composite();
  }

  duplicateLayer(idx) {
    const src = this.layers[idx];
    const canvas = document.createElement('canvas');
    canvas.width = this.docWidth;
    canvas.height = this.docHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src.canvas, 0, 0);
    const layer = {
      id: Date.now() + Math.random(),
      name: src.name + ' Copy',
      canvas,
      ctx,
      opacity: src.opacity,
      blendMode: src.blendMode,
      visible: src.visible,
    };
    this.layers.splice(idx + 1, 0, layer);
    this.activeLayerIdx = idx + 1;
    this.composite();
    return layer;
  }

  mergeDown(idx) {
    if (idx === 0) return;
    const top = this.layers[idx];
    const bot = this.layers[idx - 1];
    bot.ctx.globalAlpha = top.opacity;
    bot.ctx.globalCompositeOperation = top.blendMode;
    bot.ctx.drawImage(top.canvas, 0, 0);
    bot.ctx.globalAlpha = 1;
    bot.ctx.globalCompositeOperation = 'source-over';
    this.layers.splice(idx, 1);
    this.activeLayerIdx = idx - 1;
    this.composite();
  }

  moveLayer(fromIdx, toIdx) {
    const [layer] = this.layers.splice(fromIdx, 1);
    this.layers.splice(toIdx, 0, layer);
    this.activeLayerIdx = toIdx;
    this.composite();
  }

  get activeLayer() {
    return this.layers[this.activeLayerIdx];
  }

  // ─── Compositing ──────────────────────────────────────────────

  composite() {
    const ctx = this.displayCtx;
    ctx.clearRect(0, 0, this.docWidth, this.docHeight);
    ctx.fillStyle = this.bgColor === 'transparent' ? 'rgba(0,0,0,0)' : this.bgColor;
    ctx.fillRect(0, 0, this.docWidth, this.docHeight);

    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(layer.canvas, 0, 0);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ─── Undo / Redo ──────────────────────────────────────────────

  saveUndo() {
    const layer = this.activeLayer;
    if (!layer) return;
    const imageData = layer.ctx.getImageData(0, 0, this.docWidth, this.docHeight);
    this.undoStack.push({ layerId: layer.id, layerIdx: this.activeLayerIdx, imageData });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    const state = this.undoStack.pop();
    const layer = this.layers.find(l => l.id === state.layerId) || this.layers[state.layerIdx];
    if (!layer) return false;
    const cur = layer.ctx.getImageData(0, 0, this.docWidth, this.docHeight);
    this.redoStack.push({ layerId: layer.id, layerIdx: state.layerIdx, imageData: cur });
    layer.ctx.putImageData(state.imageData, 0, 0);
    this.composite();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const state = this.redoStack.pop();
    const layer = this.layers.find(l => l.id === state.layerId) || this.layers[state.layerIdx];
    if (!layer) return false;
    const cur = layer.ctx.getImageData(0, 0, this.docWidth, this.docHeight);
    this.undoStack.push({ layerId: layer.id, layerIdx: state.layerIdx, imageData: cur });
    layer.ctx.putImageData(state.imageData, 0, 0);
    this.composite();
    return true;
  }

  // ─── Coordinate Transforms ────────────────────────────────────

  screenToCanvas(screenX, screenY) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (screenX - rect.left) / this.zoom,
      y: (screenY - rect.top) / this.zoom,
    };
  }

  fitToViewport() {
    if (!this.viewport) return;
    const padding = 60;
    const vw = this.viewport.clientWidth - padding;
    const vh = this.viewport.clientHeight - padding;
    const sx = vw / this.docWidth;
    const sy = vh / this.docHeight;
    this.zoom = Math.min(sx, sy, 1);
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  applyTransform() {
    if (!this.container) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const scaledW = this.docWidth * this.zoom;
    const scaledH = this.docHeight * this.zoom;
    const left = Math.max(0, (vw - scaledW) / 2) + this.panX;
    const top = Math.max(0, (vh - scaledH) / 2) + this.panY;
    this.container.style.transform = `scale(${this.zoom})`;
    this.container.style.transformOrigin = '0 0';
    this.container.style.left = left + 'px';
    this.container.style.top = top + 'px';
  }

  setZoom(newZoom, pivotScreenX, pivotScreenY) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

    if (pivotScreenX !== undefined && pivotScreenY !== undefined) {
      // Zoom toward the pivot point on screen
      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;
      const scaledW_old = this.docWidth * oldZoom;
      const scaledH_old = this.docHeight * oldZoom;
      const left_old = Math.max(0, (vw - scaledW_old) / 2) + this.panX;
      const top_old = Math.max(0, (vh - scaledH_old) / 2) + this.panY;

      // Canvas point under pivot
      const cx = (pivotScreenX - left_old) / oldZoom;
      const cy = (pivotScreenY - top_old) / oldZoom;

      // New position
      const scaledW_new = this.docWidth * this.zoom;
      const scaledH_new = this.docHeight * this.zoom;
      const left_new_base = Math.max(0, (vw - scaledW_new) / 2);
      const top_new_base = Math.max(0, (vh - scaledH_new) / 2);

      this.panX = pivotScreenX - left_new_base - cx * this.zoom;
      this.panY = pivotScreenY - top_new_base - cy * this.zoom;
    }

    this.applyTransform();
  }

  // ─── Resize Canvas ────────────────────────────────────────────

  resize(w, h) {
    this.docWidth = w;
    this.docHeight = h;

    this.displayCanvas.width = w;
    this.displayCanvas.height = h;
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;

    for (const layer of this.layers) {
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.canvas = tmp;
      layer.ctx = tmp.getContext('2d', { willReadFrequently: true });
    }

    this.undoStack = [];
    this.redoStack = [];
    this.composite();
    this.fitToViewport();
  }

  // ─── Export ───────────────────────────────────────────────────

  buildExportCanvas(bgOverride) {
    const ec = document.createElement('canvas');
    ec.width = this.docWidth;
    ec.height = this.docHeight;
    const ctx = ec.getContext('2d');
    const bg = bgOverride !== undefined ? bgOverride : this.bgColor;
    if (bg && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.docWidth, this.docHeight);
    }
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return ec;
  }

  exportPNG() { return this.buildExportCanvas().toDataURL('image/png'); }
  exportJPEG() { return this.buildExportCanvas('#ffffff').toDataURL('image/jpeg', 0.92); }

  async copyToClipboard() {
    const ec = this.buildExportCanvas();
    return new Promise(resolve => {
      ec.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve(true);
        } catch { resolve(false); }
      });
    });
  }
}

const engine = new CanvasEngine();
