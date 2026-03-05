/**
 * Studio Drawing App — App Controller
 * UI state management, event handling, color picker, layers UI
 */

// ─── App State ────────────────────────────────────────────────────────────────

const app = {
  currentTool: 'pencil',
  color: '#1a1a2e',
  recentColors: ['#1a1a2e', '#e94560', '#ffffff', '#f5a623', '#4a90d9', '#7ed321', '#9b59b6', '#2ecc71'],

  brushSettings: {
    size: 8,
    opacity: 1,
    hardness: 0.88,
    pressureSize: true,
    pressureOpacity: false,
  },

  // Stroke state
  isDrawing: false,
  activePenId: null,
  touchStartTime: 0,
  lastPts: [],

  // Gesture
  pinchDist: null,
  pinchMidX: null,
  pinchMidY: null,
  panStart: null,

  // Color picker
  pickerH: 220,
  pickerS: 70,
  pickerL: 40,
  pickerA: 1,

  // Undo hint
  lastUndoTime: 0,
};

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  const viewport = document.getElementById('canvas-area');
  const container = document.getElementById('canvas-container');
  const cursorCanvas = document.getElementById('cursor-canvas');

  engine.init(viewport, container);
  engine.bgColor = '#ffffff';

  // Size cursor canvas
  cursorCanvas.width = engine.docWidth;
  cursorCanvas.height = engine.docHeight;
  const cursorPreview = new CursorPreview(cursorCanvas);

  setupPointerEvents(container, cursorPreview);
  setupGestureEvents(viewport);
  setupKeyboardShortcuts();
  setupToolButtons();
  setupBrushControls();
  setupColorSection();
  setupLayersUI();
  setupTopBar();
  setupExportModal();
  setupColorPickerModal();
  setupCanvasSection();

  updateLayersPanel();
  syncColorUI(app.color);

  // Dismiss splash
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 600);
    }
  }, 1200);

  // Orientation change
  window.addEventListener('resize', () => {
    engine.fitToViewport();
    const w = engine.docWidth, h = engine.docHeight;
    cursorCanvas.width = w; cursorCanvas.height = h;
    document.getElementById('overlay-canvas').width = w;
    document.getElementById('overlay-canvas').height = h;
  });

  // Three-finger tap = undo (Procreate style)
  let fingerCount = 0;
  viewport.addEventListener('touchstart', e => {
    fingerCount = e.touches.length;
    if (fingerCount === 3) { engine.undo(); updateUndoRedoBtns(); flashUndoHint('Undo'); }
    if (fingerCount === 4) { engine.redo(); updateUndoRedoBtns(); flashUndoHint('Redo'); }
  }, { passive: false });
});

// ─── Pointer Events (Drawing) ─────────────────────────────────────────────────

function setupPointerEvents(container, cursorPreview) {
  const overlayCanvas = document.getElementById('overlay-canvas');
  const cursorCanvas = document.getElementById('cursor-canvas');

  // We listen on both canvases and the container
  const target = overlayCanvas;

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  target.addEventListener('pointerleave', e => { cursorPreview.clear(); });

  function getStrokeState() {
    return {
      color: app.color,
      size: app.brushSettings.size,
      opacity: app.brushSettings.opacity,
      hardness: app.brushSettings.hardness,
      pressureSize: app.brushSettings.pressureSize,
      pressureOpacity: app.brushSettings.pressureOpacity,
      onPickColor: (hex) => { app.color = hex; syncColorUI(hex); },
    };
  }

  function getCanvasPt(e) {
    return engine.screenToCanvas(e.clientX, e.clientY);
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') return; // handled by gesture

    e.preventDefault();
    target.setPointerCapture(e.pointerId);

    if (app.currentTool === 'move') {
      app.isPanning = true;
      app.panStart = { x: e.clientX, y: e.clientY, px: engine.panX, py: engine.panY };
      return;
    }

    app.isDrawing = true;
    app.activePenId = e.pointerId;
    app.strokeState = getStrokeState();

    const pt = getCanvasPt(e);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const tool = TOOLS[app.currentTool];
    if (!tool) return;

    tool.onStrokeStart(app.strokeState, engine.overlayCtx, pt.x, pt.y, pressure, e.tiltX, e.tiltY);
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch') return;
    e.preventDefault();

    const pt = getCanvasPt(e);

    // Cursor preview
    const displaySize = (app.brushSettings.size * (app.brushSettings.pressureSize ? 0.7 : 1));
    cursorPreview.show(pt.x, pt.y, displaySize, app.color, app.currentTool);

    if (app.isPanning && app.panStart) {
      const dx = e.clientX - app.panStart.x;
      const dy = e.clientY - app.panStart.y;
      engine.panX = app.panStart.px + dx;
      engine.panY = app.panStart.py + dy;
      engine.applyTransform();
      return;
    }

    if (!app.isDrawing || e.pointerId !== app.activePenId) return;

    const tool = TOOLS[app.currentTool];
    if (!tool) return;

    // Get coalesced events for high-precision Apple Pencil input
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const pts = coalesced.map(ce => {
      const cp = getCanvasPt(ce);
      return { x: cp.x, y: cp.y, p: ce.pressure > 0 ? ce.pressure : 0.5, tx: ce.tiltX || 0, ty: ce.tiltY || 0 };
    });

    tool.onStrokeMove(app.strokeState, engine.overlayCtx, pts, engine.activeLayer?.ctx);

    // Update display (composite happens inside tool or we trigger it)
    // For tools that draw to overlay, composite
    if (app.currentTool !== 'eraser') {
      engine.composite();
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') return;
    e.preventDefault();

    if (app.isPanning) {
      app.isPanning = false;
      app.panStart = null;
      return;
    }

    if (!app.isDrawing || e.pointerId !== app.activePenId) return;
    app.isDrawing = false;
    app.activePenId = null;

    const tool = TOOLS[app.currentTool];
    if (tool && engine.activeLayer) {
      tool.onStrokeEnd(app.strokeState, engine.activeLayer.ctx);
    }

    updateUndoRedoBtns();
    cursorPreview.clear();
  }
}

// ─── Gesture Events (Pinch / Pan with Touch) ──────────────────────────────────

function setupGestureEvents(viewport) {
  let touches = [];

  viewport.addEventListener('touchstart', e => {
    touches = Array.from(e.touches);
    if (touches.length === 2) {
      app.pinchDist = getTouchDist(touches[0], touches[1]);
      app.pinchMidX = (touches[0].clientX + touches[1].clientX) / 2;
      app.pinchMidY = (touches[0].clientY + touches[1].clientY) / 2;
      app.pinchStartZoom = engine.zoom;
      app.panStart2 = { x: app.pinchMidX, y: app.pinchMidY, px: engine.panX, py: engine.panY };
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', e => {
    e.preventDefault();
    touches = Array.from(e.touches);
    if (touches.length === 2) {
      const dist = getTouchDist(touches[0], touches[1]);
      const midX = (touches[0].clientX + touches[1].clientX) / 2;
      const midY = (touches[0].clientY + touches[1].clientY) / 2;

      // Zoom
      const scale = dist / app.pinchDist;
      engine.setZoom(app.pinchStartZoom * scale, midX, midY);

      // Pan
      if (app.panStart2) {
        const dx = midX - app.panStart2.x;
        const dy = midY - app.panStart2.y;
        engine.panX = app.panStart2.px + dx;
        engine.panY = app.panStart2.py + dy;
        engine.applyTransform();
      }

      updateZoomDisplay();
    }
  }, { passive: false });

  viewport.addEventListener('touchend', e => {
    touches = Array.from(e.touches);
    if (touches.length < 2) {
      app.pinchDist = null;
      app.panStart2 = null;
    }
  }, { passive: true });

  function getTouchDist(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) { engine.redo(); flashUndoHint('Redo'); }
      else { engine.undo(); flashUndoHint('Undo'); }
      updateUndoRedoBtns();
      return;
    }

    const shortcuts = {
      'b': 'brush', 'p': 'pencil', 'e': 'eraser',
      'i': 'eyedropper', 'g': 'fill', 'v': 'move',
      'n': 'pen', 'm': 'marker',
    };
    if (shortcuts[e.key]) {
      setTool(shortcuts[e.key]);
    }

    if (e.key === '[') adjustSize(-2);
    if (e.key === ']') adjustSize(2);
    if (e.key === '0') engine.fitToViewport(), updateZoomDisplay();
  });
}

function adjustSize(delta) {
  app.brushSettings.size = Math.max(1, Math.min(500, app.brushSettings.size + delta));
  const sizeSlider = document.getElementById('brush-size');
  const sizeVal = document.getElementById('size-value');
  if (sizeSlider) sizeSlider.value = app.brushSettings.size;
  if (sizeVal) sizeVal.textContent = app.brushSettings.size;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

function setupToolButtons() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      setTool(btn.dataset.tool);
    });
  });
}

function setTool(toolName) {
  if (!TOOLS[toolName]) return;
  app.currentTool = toolName;

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });

  // Apply tool defaults if switching brush type
  const tool = TOOLS[toolName];
  if (tool.defaultSize !== undefined && toolName !== 'eraser') {
    // Don't auto-change, just show cursor
  }

  // Update cursor
  const ca = document.getElementById('canvas-area');
  if (toolName === 'move') ca.style.cursor = 'grab';
  else if (toolName === 'eyedropper') ca.style.cursor = 'crosshair';
  else if (toolName === 'fill') ca.style.cursor = 'crosshair';
  else ca.style.cursor = 'none';
}

// ─── Brush Controls ───────────────────────────────────────────────────────────

function setupBrushControls() {
  const sizeSlider = document.getElementById('brush-size');
  const opacitySlider = document.getElementById('brush-opacity');
  const hardnessSlider = document.getElementById('brush-hardness');
  const sizeVal = document.getElementById('size-value');
  const opacityVal = document.getElementById('opacity-value');
  const hardnessVal = document.getElementById('hardness-value');
  const pressureSize = document.getElementById('pressure-size');
  const pressureOpacity = document.getElementById('pressure-opacity');

  sizeSlider.addEventListener('input', () => {
    app.brushSettings.size = +sizeSlider.value;
    sizeVal.textContent = sizeSlider.value;
  });

  opacitySlider.addEventListener('input', () => {
    app.brushSettings.opacity = +opacitySlider.value / 100;
    opacityVal.textContent = opacitySlider.value + '%';
  });

  hardnessSlider.addEventListener('input', () => {
    app.brushSettings.hardness = +hardnessSlider.value / 100;
    hardnessVal.textContent = hardnessSlider.value + '%';
  });

  pressureSize.addEventListener('click', () => {
    app.brushSettings.pressureSize = !app.brushSettings.pressureSize;
    pressureSize.classList.toggle('active', app.brushSettings.pressureSize);
  });

  pressureOpacity.addEventListener('click', () => {
    app.brushSettings.pressureOpacity = !app.brushSettings.pressureOpacity;
    pressureOpacity.classList.toggle('active', app.brushSettings.pressureOpacity);
  });
}

// ─── Color Section ────────────────────────────────────────────────────────────

function setupColorSection() {
  const swatch = document.getElementById('open-color-picker');
  swatch.addEventListener('click', openColorPicker);

  renderRecentColors();
}

function renderRecentColors() {
  const container = document.getElementById('color-swatches');
  if (!container) return;
  container.innerHTML = '';
  app.recentColors.slice(0, 8).forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-swatch';
    div.style.background = c;
    div.title = c;
    div.addEventListener('click', () => { app.color = c; syncColorUI(c); });
    container.appendChild(div);
  });
}

function syncColorUI(hex) {
  const preview = document.getElementById('color-preview');
  const hexEl = document.getElementById('color-hex');
  if (preview) preview.style.background = hex;
  if (hexEl) hexEl.textContent = hex.toUpperCase();

  // Update picker HSL
  const { h, s, l } = hexToHsl(hex);
  app.pickerH = h; app.pickerS = s; app.pickerL = l;
}

function addRecentColor(hex) {
  app.recentColors = app.recentColors.filter(c => c !== hex);
  app.recentColors.unshift(hex);
  if (app.recentColors.length > 16) app.recentColors.pop();
  renderRecentColors();
}

// ─── Layers UI ────────────────────────────────────────────────────────────────

function setupLayersUI() {
  document.getElementById('btn-add-layer').addEventListener('click', () => {
    engine.addLayer();
    updateLayersPanel();
    updateLayerProps();
  });

  document.getElementById('btn-delete-layer').addEventListener('click', () => {
    engine.deleteLayer(engine.activeLayerIdx);
    updateLayersPanel();
    updateLayerProps();
  });

  document.getElementById('btn-merge-layer').addEventListener('click', () => {
    if (engine.activeLayerIdx > 0) {
      engine.saveUndo();
      engine.mergeDown(engine.activeLayerIdx);
      updateLayersPanel();
    }
  });

  document.getElementById('btn-dup-layer').addEventListener('click', () => {
    engine.duplicateLayer(engine.activeLayerIdx);
    updateLayersPanel();
  });

  // Layer properties
  document.getElementById('layer-opacity').addEventListener('input', e => {
    const layer = engine.activeLayer;
    if (!layer) return;
    layer.opacity = +e.target.value / 100;
    document.getElementById('layer-opacity-value').textContent = e.target.value + '%';
    engine.composite();
  });

  document.getElementById('layer-blend').addEventListener('change', e => {
    const layer = engine.activeLayer;
    if (!layer) return;
    layer.blendMode = e.target.value;
    engine.composite();
  });
}

function updateLayersPanel() {
  const list = document.getElementById('layers-list');
  if (!list) return;
  list.innerHTML = '';

  // Render in reverse (top = highest layer)
  for (let i = engine.layers.length - 1; i >= 0; i--) {
    const layer = engine.layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (i === engine.activeLayerIdx ? ' active' : '');
    item.dataset.idx = i;

    const thumb = document.createElement('canvas');
    thumb.width = 48; thumb.height = 36;
    thumb.className = 'layer-thumb';
    const tc = thumb.getContext('2d');
    if (engine.bgColor !== 'transparent') {
      tc.fillStyle = '#f5f5f5';
      tc.fillRect(0, 0, 48, 36);
    }
    tc.drawImage(layer.canvas, 0, 0, engine.docWidth, engine.docHeight, 0, 0, 48, 36);

    const info = document.createElement('div');
    info.className = 'layer-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;
    nameEl.addEventListener('dblclick', () => {
      const newName = prompt('Layer name:', layer.name);
      if (newName) { layer.name = newName; updateLayersPanel(); }
    });

    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis ' + (layer.visible ? '' : 'hidden');
    visBtn.innerHTML = layer.visible
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    visBtn.addEventListener('click', e => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      engine.composite();
      updateLayersPanel();
    });

    info.appendChild(nameEl);
    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(visBtn);

    item.addEventListener('click', () => {
      engine.activeLayerIdx = i;
      updateLayersPanel();
      updateLayerProps();
    });

    list.appendChild(item);
  }
}

function updateLayerProps() {
  const layer = engine.activeLayer;
  if (!layer) return;
  const opSlider = document.getElementById('layer-opacity');
  const opVal = document.getElementById('layer-opacity-value');
  const blendSel = document.getElementById('layer-blend');
  if (opSlider) { opSlider.value = Math.round(layer.opacity * 100); }
  if (opVal) { opVal.textContent = Math.round(layer.opacity * 100) + '%'; }
  if (blendSel) { blendSel.value = layer.blendMode; }
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function setupTopBar() {
  document.getElementById('btn-undo').addEventListener('click', () => {
    engine.undo(); updateUndoRedoBtns(); flashUndoHint('Undo');
  });

  document.getElementById('btn-redo').addEventListener('click', () => {
    engine.redo(); updateUndoRedoBtns(); flashUndoHint('Redo');
  });

  document.getElementById('btn-zoom-fit').addEventListener('click', () => {
    engine.fitToViewport(); updateZoomDisplay();
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    engine.setZoom(engine.zoom * 1.25); updateZoomDisplay();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    engine.setZoom(engine.zoom / 1.25); updateZoomDisplay();
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    document.getElementById('export-overlay').classList.add('open');
  });

  document.getElementById('btn-grid').addEventListener('click', e => {
    const btn = e.currentTarget;
    btn.classList.toggle('active');
    document.getElementById('canvas-area').classList.toggle('show-grid');
  });

  // Panel toggles
  document.getElementById('toggle-tools').addEventListener('click', () => {
    document.getElementById('panel-left').classList.toggle('collapsed');
  });

  document.getElementById('toggle-layers').addEventListener('click', () => {
    document.getElementById('panel-right').classList.toggle('collapsed');
  });
}

function updateUndoRedoBtns() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) undoBtn.classList.toggle('disabled', engine.undoStack.length === 0);
  if (redoBtn) redoBtn.classList.toggle('disabled', engine.redoStack.length === 0);
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(engine.zoom * 100) + '%';
}

function flashUndoHint(text) {
  let hint = document.getElementById('undo-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'undo-hint';
    hint.className = 'undo-hint';
    document.body.appendChild(hint);
  }
  hint.textContent = text;
  hint.classList.remove('fade-out');
  void hint.offsetWidth;
  hint.classList.add('fade-out');
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function setupExportModal() {
  document.getElementById('close-export').addEventListener('click', () => {
    document.getElementById('export-overlay').classList.remove('open');
  });

  document.getElementById('export-png').addEventListener('click', () => {
    const data = engine.exportPNG();
    downloadData(data, 'studio-drawing.png');
  });

  document.getElementById('export-jpg').addEventListener('click', () => {
    const data = engine.exportJPEG();
    downloadData(data, 'studio-drawing.jpg');
  });

  document.getElementById('export-copy').addEventListener('click', async () => {
    const ok = await engine.copyToClipboard();
    const btn = document.getElementById('export-copy');
    btn.textContent = ok ? '✓ Copied!' : '✗ Failed';
    setTimeout(() => { btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy PNG<span>Copy to clipboard</span>`; }, 2000);
  });

  document.getElementById('export-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('export-overlay'))
      document.getElementById('export-overlay').classList.remove('open');
  });
}

function downloadData(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ─── Canvas Section ───────────────────────────────────────────────────────────

function setupCanvasSection() {
  document.getElementById('btn-resize').addEventListener('click', () => {
    const w = parseInt(document.getElementById('canvas-width').value);
    const h = parseInt(document.getElementById('canvas-height').value);
    if (w >= 100 && w <= 8000 && h >= 100 && h <= 8000) {
      if (confirm(`Resize canvas to ${w}×${h}? This cannot be undone.`)) {
        engine.resize(w, h);
      }
    }
  });

  document.querySelectorAll('.bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bg = btn.dataset.bg;
      engine.bgColor = bg === 'transparent' ? 'transparent' : bg === 'black' ? '#000000' : '#ffffff';
      engine.composite();
    });
  });

  // Preset sizes
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const [w, h] = btn.dataset.size.split('x').map(Number);
      document.getElementById('canvas-width').value = w;
      document.getElementById('canvas-height').value = h;
    });
  });
}

// ─── Color Picker Modal ───────────────────────────────────────────────────────

function setupColorPickerModal() {
  const overlay = document.getElementById('color-picker-overlay');
  const modal = document.getElementById('color-picker-modal');
  const closeBtn = document.getElementById('close-color-picker');

  closeBtn.addEventListener('click', closeColorPicker);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeColorPicker();
  });

  // SL gradient canvas
  const slCanvas = document.getElementById('sl-canvas');
  const hueCanvas = document.getElementById('hue-canvas');
  const alphaCanvas = document.getElementById('alpha-canvas');

  renderHueStrip(hueCanvas);
  renderSLGradient(slCanvas, app.pickerH);

  // Hue slider
  hueCanvas.addEventListener('pointerdown', e => {
    const handleHue = (ev) => {
      const rect = hueCanvas.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      app.pickerH = t * 360;
      renderSLGradient(slCanvas, app.pickerH);
      updatePickerColor();
      updateHueThumb();
    };
    handleHue(e);
    const up = () => { window.removeEventListener('pointermove', handleHue); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', handleHue);
    window.addEventListener('pointerup', up);
  });

  // SL canvas
  slCanvas.addEventListener('pointerdown', e => {
    const handleSL = (ev) => {
      const rect = slCanvas.getBoundingClientRect();
      const tx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const ty = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      app.pickerS = tx * 100;
      app.pickerL = (1 - ty) * 100;
      updatePickerColor();
      updateSLThumb();
    };
    handleSL(e);
    const up = () => { window.removeEventListener('pointermove', handleSL); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', handleSL);
    window.addEventListener('pointerup', up);
  });

  // Hex input
  document.getElementById('hex-input').addEventListener('change', e => {
    let v = e.target.value.replace('#', '');
    if (v.length === 3) v = v.split('').map(c => c + c).join('');
    if (v.length === 6) {
      const { h, s, l } = hexToHsl('#' + v);
      app.pickerH = h; app.pickerS = s; app.pickerL = l;
      renderSLGradient(slCanvas, app.pickerH);
      updatePickerColor();
      updateHueThumb();
      updateSLThumb();
    }
  });

  // Recent colors in picker
  document.getElementById('picker-recent').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (swatch) {
      const hex = swatch.style.background;
      const { h, s, l } = hexToHsl(hex);
      app.pickerH = h; app.pickerS = s; app.pickerL = l;
      renderSLGradient(slCanvas, app.pickerH);
      updatePickerColor();
      updateHueThumb();
      updateSLThumb();
    }
  });
}

function openColorPicker() {
  const overlay = document.getElementById('color-picker-overlay');
  overlay.classList.add('open');
  renderSLGradient(document.getElementById('sl-canvas'), app.pickerH);
  renderHueStrip(document.getElementById('hue-canvas'));
  updateHueThumb();
  updateSLThumb();
  renderPickerRecentColors();
}

function closeColorPicker() {
  document.getElementById('color-picker-overlay').classList.remove('open');
}

function updatePickerColor() {
  const hex = hslToHex(app.pickerH, app.pickerS, app.pickerL);
  app.color = hex;
  syncColorUI(hex);
  document.getElementById('hex-input').value = hex;
  document.getElementById('picker-preview').style.background = hex;
}

function updateHueThumb() {
  const thumb = document.getElementById('hue-thumb');
  const canvas = document.getElementById('hue-canvas');
  if (!thumb || !canvas) return;
  const pct = app.pickerH / 360;
  thumb.style.left = (pct * canvas.offsetWidth) + 'px';
}

function updateSLThumb() {
  const thumb = document.getElementById('sl-thumb');
  const canvas = document.getElementById('sl-canvas');
  if (!thumb || !canvas) return;
  thumb.style.left = (app.pickerS / 100 * canvas.offsetWidth) + 'px';
  thumb.style.top = ((1 - app.pickerL / 100) * canvas.offsetHeight) + 'px';
}

function renderHueStrip(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  for (let i = 0; i <= 360; i += 30) {
    grad.addColorStop(i / 360, `hsl(${i},100%,50%)`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderSLGradient(canvas, hue) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const satGrad = ctx.createLinearGradient(0, 0, w, 0);
  satGrad.addColorStop(0, `hsl(${hue},0%,50%)`);
  satGrad.addColorStop(1, `hsl(${hue},100%,50%)`);
  ctx.fillStyle = satGrad;
  ctx.fillRect(0, 0, w, h);

  const lightGrad = ctx.createLinearGradient(0, 0, 0, h);
  lightGrad.addColorStop(0, 'rgba(255,255,255,1)');
  lightGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
  lightGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  lightGrad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = lightGrad;
  ctx.fillRect(0, 0, w, h);
}

function renderPickerRecentColors() {
  const container = document.getElementById('picker-recent');
  if (!container) return;
  container.innerHTML = '';
  app.recentColors.forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-swatch';
    div.style.background = c;
    container.appendChild(div);
  });
}

// ─── Color Conversion Utilities ───────────────────────────────────────────────

function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  const h = hex.replace('#', '');
  if (h.length === 6) {
    r = parseInt(h.substring(0, 2), 16) / 255;
    g = parseInt(h.substring(2, 4), 16) / 255;
    b = parseInt(h.substring(4, 6), 16) / 255;
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const lig = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lig > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(hue * 360), s: Math.round(sat * 100), l: Math.round(lig * 100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function hslToRgb(h, s, l) {
  const hex = hslToHex(h, s, l);
  return hexToRgb(hex);
}
