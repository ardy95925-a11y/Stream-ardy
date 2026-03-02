/* ========================================================
   ProDraw — iPad Drawing Studio  |  app.js
   Full drawing engine with Apple Pencil support
   ======================================================== */
'use strict';

const MAX_UNDO = 40;
const DEFAULT_PALETTE = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#ff5722','#795548',
  '#607d8b','#000000','#ffffff','#bdc3c7','#7f8c8d'
];

// ── STATE ────────────────────────────────────────────────────
const state = {
  tool: 'brush', color: '#000000', bgColor: '#ffffff',
  size: 20, opacity: 1, hardness: 0.8, flow: 1,
  spacing: 10, angle: 0, roundness: 1,
  pressureSize: true, pressureOpacity: true,
  tiltTexture: false, stabilizer: false, smoothAmount: 0.5,
  blendMode: 'source-over', brushPreset: 'basic',
  currentShape: 'rect', shapeFill: false,
  textFont: 'Arial', textSize: 32, textBold: false, textItalic: false,
  zoom: 1, rotation: 0, panX: 0, panY: 0,
  symmetry: false, gridVisible: false,
  pencilOnly: false, strokeSmoothing: true,
  activeLayerIdx: 1, layers: [],
  undoStack: [], redoStack: [],
  isDrawing: false, lastX: 0, lastY: 0,
  lastPressure: 0.5, lastTilt: 0,
  smoothedX: 0, smoothedY: 0,
  lassoPoints: [], hasSelection: false,
  refLoaded: false, refOpacity: 0.8, refVisible: false,
  refGray: false, refFlipH: false, refFlipV: false,
  refSize: 40, refX: 20, refY: 20,
  palette: [...DEFAULT_PALETTE], colorHistory: [],
  canvasW: 2048, canvasH: 2732,
};

// ── DOM ──────────────────────────────────────────────────────
const mainCanvas = document.getElementById('main-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const gridCanvas = document.getElementById('grid-canvas');
const selCanvas = document.getElementById('selection-canvas');
const canvasArea = document.getElementById('canvas-area');
const canvasWrapper = document.getElementById('canvas-wrapper');
const colorWheelCanvas = document.getElementById('color-wheel');
const refOverlay = document.getElementById('reference-overlay');
const refImg = document.getElementById('ref-img');
const symmetryGuide = document.getElementById('symmetry-guide');
const textOverlay = document.getElementById('text-overlay');
const textInput = document.getElementById('text-input');
const contextMenu = document.getElementById('context-menu');
const toastEl = document.getElementById('toast');

let ctx, octx, gctx, sctx;

// ── INIT ─────────────────────────────────────────────────────
function init() {
  ctx  = mainCanvas.getContext('2d', { willReadFrequently: true });
  octx = overlayCanvas.getContext('2d');
  gctx = gridCanvas.getContext('2d');
  sctx = selCanvas.getContext('2d');
  initCanvasSize(state.canvasW, state.canvasH);
  initLayers();
  initColorWheel();
  buildPalette();
  buildColorHistory();
  bindUI();
  bindPointer();
  bindKeyboard();
  bindGestures();
  bindReference();
  applyTransform();
  setActiveTool('brush');
  showToast('ProDraw ready ✏️ Apple Pencil supported');
}

// ── CANVAS SIZE ──────────────────────────────────────────────
function initCanvasSize(w, h) {
  state.canvasW = w; state.canvasH = h;
  [mainCanvas, overlayCanvas, gridCanvas, selCanvas].forEach(c => {
    c.width = w; c.height = h;
    c.style.width = w + 'px'; c.style.height = h + 'px';
  });
  drawGrid();
  renderAllLayers();
}

// ── LAYERS ───────────────────────────────────────────────────
function createLayer(name) {
  const c = document.createElement('canvas');
  c.width = state.canvasW; c.height = state.canvasH;
  return { canvas: c, ctx: c.getContext('2d'), name: name || 'Layer', visible: true, opacity: 1, blendMode: 'source-over', locked: false };
}
function initLayers() {
  state.layers = [];
  const bg = createLayer('Background');
  bg.ctx.fillStyle = '#ffffff';
  bg.ctx.fillRect(0, 0, state.canvasW, state.canvasH);
  state.layers.push(bg);
  state.layers.push(createLayer('Layer 1'));
  state.activeLayerIdx = 1;
  renderLayersPanel();
  renderAllLayers();
}
function renderAllLayers() {
  ctx.clearRect(0, 0, state.canvasW, state.canvasH);
  state.layers.forEach(l => {
    if (!l.visible) return;
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blendMode;
    ctx.drawImage(l.canvas, 0, 0);
    ctx.restore();
  });
}
function activeLayer() { return state.layers[state.activeLayerIdx]; }
function activeCtx()   { return activeLayer().ctx; }

function renderLayersPanel() {
  const list = document.getElementById('layers-list');
  list.innerHTML = '';
  [...state.layers].reverse().forEach((layer, ri) => {
    const idx = state.layers.length - 1 - ri;
    const div = document.createElement('div');
    div.className = 'layer-item' + (idx === state.activeLayerIdx ? ' active' : '');
    div.dataset.idx = idx;
    // thumb
    const thumb = document.createElement('div'); thumb.className = 'layer-thumb';
    const tc = document.createElement('canvas'); tc.width=32; tc.height=32;
    tc.getContext('2d').drawImage(layer.canvas, 0, 0, 32, 32);
    thumb.appendChild(tc); div.appendChild(thumb);
    // name
    const nm = document.createElement('span'); nm.className = 'layer-name'; nm.textContent = layer.name;
    nm.ondblclick = () => startRenameLayer(nm, idx);
    div.appendChild(nm);
    // vis
    const vis = document.createElement('span'); vis.className = 'layer-vis';
    vis.textContent = layer.visible ? '👁' : '🚫';
    vis.onclick = e => { e.stopPropagation(); layer.visible = !layer.visible; renderAllLayers(); renderLayersPanel(); };
    div.appendChild(vis);
    div.onclick = () => selectLayer(idx);
    list.appendChild(div);
  });
  document.getElementById('layer-count').textContent = state.layers.length + ' layer' + (state.layers.length>1?'s':'');
}
function selectLayer(idx) {
  state.activeLayerIdx = idx;
  const layer = activeLayer();
  document.getElementById('layer-opacity').value = Math.round(layer.opacity * 100);
  document.getElementById('layer-opacity-val').textContent = Math.round(layer.opacity * 100);
  document.getElementById('layer-blend-mode').value = layer.blendMode;
  document.getElementById('layer-lock').checked = layer.locked;
  renderLayersPanel();
}
function startRenameLayer(el, idx) {
  const input = document.createElement('input');
  input.className = 'layer-name-input';
  input.value = state.layers[idx].name;
  el.replaceWith(input);
  input.focus();
  const commit = () => { state.layers[idx].name = input.value || state.layers[idx].name; renderLayersPanel(); };
  input.onblur = commit;
  input.onkeydown = e => { if (e.key === 'Enter') commit(); };
}

// ── UNDO / REDO ──────────────────────────────────────────────
function pushUndo() {
  const snap = state.layers.map(l => {
    const c = document.createElement('canvas');
    c.width = state.canvasW; c.height = state.canvasH;
    c.getContext('2d').drawImage(l.canvas, 0, 0);
    return { canvas: c, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, locked: l.locked };
  });
  state.undoStack.push(snap);
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}
function captureCurrent() {
  return state.layers.map(l => {
    const c = document.createElement('canvas');
    c.width = state.canvasW; c.height = state.canvasH;
    c.getContext('2d').drawImage(l.canvas, 0, 0);
    return { canvas: c, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, locked: l.locked };
  });
}
function restoreSnapshot(snap) {
  state.layers = snap.map(s => {
    const layer = createLayer(s.name);
    layer.ctx.drawImage(s.canvas, 0, 0);
    layer.visible = s.visible; layer.opacity = s.opacity;
    layer.blendMode = s.blendMode; layer.locked = s.locked;
    return layer;
  });
  if (state.activeLayerIdx >= state.layers.length) state.activeLayerIdx = state.layers.length - 1;
  renderAllLayers(); renderLayersPanel();
}
function undo() {
  if (!state.undoStack.length) { showToast('Nothing to undo'); return; }
  state.redoStack.push(captureCurrent());
  restoreSnapshot(state.undoStack.pop());
}
function redo() {
  if (!state.redoStack.length) { showToast('Nothing to redo'); return; }
  state.undoStack.push(captureCurrent());
  restoreSnapshot(state.redoStack.pop());
}

// ── TRANSFORM ────────────────────────────────────────────────
function applyTransform() {
  canvasWrapper.style.transform =
    `rotate(${state.rotation}deg) scale(${state.zoom}) translate(${state.panX}px, ${state.panY}px)`;
  document.getElementById('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
}
function screenToCanvas(sx, sy) {
  const rect = mainCanvas.getBoundingClientRect();
  return { x: (sx - rect.left) / state.zoom, y: (sy - rect.top) / state.zoom };
}

// ── BRUSH ENGINE ─────────────────────────────────────────────
function getBrushParams(pressure) {
  const p = (pressure != null && pressure > 0) ? pressure : 0.5;
  let size = state.size;
  let alpha = state.opacity * state.flow;
  if (state.pressureSize)    size *= (0.15 + p * 0.85);
  if (state.pressureOpacity) alpha *= (0.15 + p * 0.85);
  return { size: Math.max(0.5, size), alpha: Math.min(1, alpha) };
}

function drawDab(lctx, x, y, pressure, tilt) {
  const { size, alpha } = getBrushParams(pressure);
  const r = size / 2;
  const tool = state.tool;
  lctx.save();

  if (tool === 'eraser') {
    lctx.globalCompositeOperation = 'destination-out';
    lctx.globalAlpha = alpha;
    const g = lctx.createRadialGradient(x, y, r * state.hardness, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI*2); lctx.fill();
    lctx.restore(); return;
  }

  lctx.globalCompositeOperation = state.blendMode;

  if (tool === 'airbrush') {
    lctx.globalAlpha = alpha * 0.06;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      lctx.beginPath(); lctx.arc(x+Math.cos(a)*d, y+Math.sin(a)*d, r*.07, 0, Math.PI*2);
      lctx.fillStyle = state.color; lctx.fill();
    }
    lctx.restore(); return;
  }
  if (tool === 'watercolor') {
    lctx.globalAlpha = alpha * 0.03;
    for (let i = 0; i < 10; i++) {
      const jx = x + (Math.random()-.5)*size*.7, jy = y + (Math.random()-.5)*size*.7;
      const jr = r * (.4 + Math.random()*.6);
      const g2 = lctx.createRadialGradient(jx, jy, 0, jx, jy, jr);
      g2.addColorStop(0, state.color); g2.addColorStop(1, 'transparent');
      lctx.fillStyle = g2; lctx.beginPath(); lctx.arc(jx,jy,jr,0,Math.PI*2); lctx.fill();
    }
    lctx.restore(); return;
  }
  if (tool === 'marker') {
    lctx.globalAlpha = alpha * 0.55; lctx.globalCompositeOperation = 'multiply';
    lctx.translate(x,y); lctx.rotate(state.angle*Math.PI/180);
    lctx.beginPath(); lctx.rect(-r, -r*.22, r*2, r*.44);
    lctx.fillStyle = state.color; lctx.fill();
    lctx.restore(); return;
  }
  if (tool === 'pencil') {
    lctx.globalAlpha = alpha * (.4 + Math.random()*.6);
    lctx.beginPath(); lctx.arc(x+(Math.random()-.5)*1.5, y+(Math.random()-.5)*1.5, r*(.5+Math.random()*.5), 0, Math.PI*2);
    lctx.fillStyle = state.color; lctx.fill();
    lctx.restore(); return;
  }
  if (tool === 'pen') {
    const ps = Math.max(0.3, size * (0.05 + pressure * 0.95));
    lctx.globalAlpha = Math.min(1, alpha * 1.2);
    lctx.beginPath(); lctx.arc(x, y, ps/2, 0, Math.PI*2);
    lctx.fillStyle = state.color; lctx.fill();
    lctx.restore(); return;
  }

  // Presets
  if (state.brushPreset === 'dots') {
    lctx.globalAlpha = alpha;
    for (let i=0;i<5;i++){const a=i*Math.PI*2/5;lctx.beginPath();lctx.arc(x+Math.cos(a)*r*.5,y+Math.sin(a)*r*.5,r*.22,0,Math.PI*2);lctx.fillStyle=state.color;lctx.fill();}
    lctx.restore(); return;
  }
  if (state.brushPreset === 'splatter') {
    const cnt = Math.floor(3 + pressure * 10);
    lctx.globalAlpha = alpha*.8;
    for(let i=0;i<cnt;i++){const a=Math.random()*Math.PI*2,d=Math.random()*r*1.6,sr=r*(.04+Math.random()*.14);lctx.beginPath();lctx.arc(x+Math.cos(a)*d,y+Math.sin(a)*d,sr,0,Math.PI*2);lctx.fillStyle=state.color;lctx.fill();}
    lctx.restore(); return;
  }
  if (state.brushPreset === 'calligraphy') {
    lctx.globalAlpha = alpha;
    lctx.translate(x,y); lctx.rotate((state.angle+45)*Math.PI/180);
    lctx.beginPath(); lctx.ellipse(0,0,r,r*.18,0,0,Math.PI*2);
    lctx.fillStyle=state.color; lctx.fill();
    lctx.restore(); return;
  }

  // Default round
  lctx.globalAlpha = alpha;
  const hard = Math.max(0.001, Math.min(.999, state.hardness));
  const grad = lctx.createRadialGradient(x,y,r*hard,x,y,r);
  grad.addColorStop(0, state.color); grad.addColorStop(1, hexWithAlpha(state.color, 0));
  lctx.fillStyle = grad;
  if (state.roundness < 0.99) {
    lctx.translate(x,y); lctx.rotate(state.angle*Math.PI/180); lctx.scale(1, state.roundness);
    lctx.beginPath(); lctx.arc(0,0,r,0,Math.PI*2); lctx.fill();
  } else {
    lctx.beginPath(); lctx.arc(x,y,r,0,Math.PI*2); lctx.fill();
  }
  lctx.restore();
}

function drawDabsInterp(lctx, x1, y1, x2, y2, pressure) {
  const dx = x2-x1, dy = y2-y1;
  const dist = Math.sqrt(dx*dx+dy*dy);
  const spacing = Math.max(0.5, state.size * state.spacing / 100);
  const steps = Math.max(1, Math.floor(dist / spacing));
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i/steps : 0;
    drawDab(lctx, x1+dx*t, y1+dy*t, pressure);
  }
}

// ── SMUDGE ──────────────────────────────────────────────────
function smudgeDab(lctx, x, y, px, py, pressure) {
  const r = Math.max(2, state.size * (.3 + pressure * .7));
  const sx = Math.round(px - r), sy = Math.round(py - r), sw = r*2, sh = r*2;
  if (sx < 0 || sy < 0 || sx+sw > state.canvasW || sy+sh > state.canvasH) return;
  const data = lctx.getImageData(sx, sy, sw, sh);
  const tmp = document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
  tmp.getContext('2d').putImageData(data, 0, 0);
  lctx.save(); lctx.globalAlpha = 0.45;
  lctx.drawImage(tmp, x-r, y-r);
  lctx.restore();
}

// ── FILL ────────────────────────────────────────────────────
function floodFill(lctx, startX, startY, fillColor) {
  const W = state.canvasW, H = state.canvasH;
  const img = lctx.getImageData(0, 0, W, H);
  const d = img.data;
  const si = (Math.floor(startY)*W + Math.floor(startX))*4;
  const [tr, tg, tb, ta] = [d[si], d[si+1], d[si+2], d[si+3]];
  const [fr, fg, fb, fa] = hexToRgba(fillColor);
  if (tr===fr&&tg===fg&&tb===fb&&ta===fa) return;
  const tol = 35;
  const stack = [Math.floor(startX) + Math.floor(startY)*W];
  const vis = new Uint8Array(W*H);
  const match = i => Math.abs(d[i]-tr)+Math.abs(d[i+1]-tg)+Math.abs(d[i+2]-tb)+Math.abs(d[i+3]-ta) < tol*4;
  while (stack.length) {
    const idx = stack.pop(); if (vis[idx]) continue; vis[idx]=1;
    const pi = idx*4; if (!match(pi)) continue;
    d[pi]=fr; d[pi+1]=fg; d[pi+2]=fb; d[pi+3]=fa;
    const x = idx%W, y = Math.floor(idx/W);
    if (x>0) stack.push(idx-1); if (x<W-1) stack.push(idx+1);
    if (y>0) stack.push(idx-W); if (y<H-1) stack.push(idx+W);
  }
  lctx.putImageData(img, 0, 0);
}

// ── SHAPES ───────────────────────────────────────────────────
function drawShape(lctx, x1, y1, x2, y2) {
  lctx.save();
  lctx.strokeStyle = state.color; lctx.fillStyle = state.color;
  lctx.lineWidth = Math.max(1, state.size * 0.15);
  lctx.globalAlpha = state.opacity;
  lctx.globalCompositeOperation = state.blendMode;
  const [l, t, r, b] = [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)];
  const [w, h, cx, cy] = [r-l, b-t, (l+r)/2, (t+b)/2];
  lctx.beginPath();
  switch (state.currentShape) {
    case 'rect':     lctx.rect(l,t,w,h); break;
    case 'ellipse':  lctx.ellipse(cx,cy,Math.max(1,w/2),Math.max(1,h/2),0,0,Math.PI*2); break;
    case 'line':     lctx.moveTo(x1,y1); lctx.lineTo(x2,y2); break;
    case 'arrow': {
      lctx.moveTo(x1,y1); lctx.lineTo(x2,y2);
      const ang=Math.atan2(y2-y1,x2-x1),al=18;
      lctx.moveTo(x2,y2); lctx.lineTo(x2-al*Math.cos(ang-.5),y2-al*Math.sin(ang-.5));
      lctx.moveTo(x2,y2); lctx.lineTo(x2-al*Math.cos(ang+.5),y2-al*Math.sin(ang+.5));
      break;
    }
    case 'triangle': lctx.moveTo(cx,t); lctx.lineTo(r,b); lctx.lineTo(l,b); lctx.closePath(); break;
    case 'star': {
      const pts=5,ir=Math.min(w,h)/4,or=Math.min(w,h)/2;
      for(let i=0;i<pts*2;i++){const a=i*Math.PI/pts-Math.PI/2,rad=i%2===0?or:ir; i===0?lctx.moveTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad):lctx.lineTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);}
      lctx.closePath(); break;
    }
  }
  state.shapeFill ? lctx.fill() : lctx.stroke();
  lctx.restore();
}

// ── TEXT ─────────────────────────────────────────────────────
let textPos = {x:0,y:0};
function activateText(x, y) {
  textPos = {x,y};
  textOverlay.style.display = 'block';
  textOverlay.style.left = x + 'px'; textOverlay.style.top = y + 'px';
  textInput.style.fontFamily = state.textFont;
  textInput.style.fontSize   = state.textSize + 'px';
  textInput.style.fontWeight = state.textBold ? 'bold' : 'normal';
  textInput.style.fontStyle  = state.textItalic ? 'italic' : 'normal';
  textInput.style.color      = state.color;
  textInput.value = ''; textInput.focus();
}
function commitText() {
  const val = textInput.value.trim(); if (!val) { textOverlay.style.display='none'; return; }
  pushUndo();
  const lctx = activeCtx(); lctx.save();
  lctx.font = `${state.textItalic?'italic ':''} ${state.textBold?'bold ':''} ${state.textSize}px "${state.textFont}"`;
  lctx.fillStyle = state.color; lctx.globalAlpha = state.opacity;
  lctx.globalCompositeOperation = state.blendMode;
  val.split('\n').forEach((line,i)=>lctx.fillText(line, textPos.x, textPos.y+(i+1)*state.textSize));
  lctx.restore(); renderAllLayers();
  textOverlay.style.display = 'none';
}

// ── POINTER EVENTS (Apple Pencil + Touch + Mouse) ────────────
let pointerDown = false, shapeStart = null;
let lassoPath = [];
let transformStart = null, transformSnap = null;
let isPinching = false, pinchDist = 0, pinchZoom = 0;
let touchPanStart = null;

overlayCanvas.addEventListener('pointerdown',  onPDown, {passive:false});
overlayCanvas.addEventListener('pointermove',  onPMove, {passive:false});
overlayCanvas.addEventListener('pointerup',    onPUp,   {passive:false});
overlayCanvas.addEventListener('pointercancel',onPUp,   {passive:false});

function evData(e) {
  const {x,y} = screenToCanvas(e.clientX, e.clientY);
  const pressure = (e.pressure != null && e.pressure > 0) ? e.pressure : (e.buttons > 0 ? 0.5 : 0);
  const tilt = Math.sqrt((e.tiltX||0)**2 + (e.tiltY||0)**2);
  return {x, y, pressure, tilt, isPen: e.pointerType==='pen'};
}

function onPDown(e) {
  e.preventDefault();
  const ev = evData(e);
  if (state.pencilOnly && !ev.isPen) return;
  if (activeLayer().locked) { showToast('Layer is locked'); return; }

  pointerDown = true; state.isDrawing = true;
  state.lastX = ev.x; state.lastY = ev.y;
  state.smoothedX = ev.x; state.smoothedY = ev.y;
  state.lastPressure = ev.pressure;
  updateStatus(ev.x, ev.y, ev.pressure, ev.tilt);

  if (state.tool === 'eyedropper') { pickColor(ev.x, ev.y); return; }
  if (state.tool === 'fill')  { pushUndo(); floodFill(activeCtx(), ev.x, ev.y, state.color); renderAllLayers(); return; }
  if (state.tool === 'text')  { activateText(ev.x, ev.y); return; }
  if (state.tool === 'lasso') { lassoPath = [{x:ev.x,y:ev.y}]; return; }
  if (state.tool === 'shape') { shapeStart = {x:ev.x, y:ev.y}; return; }
  if (state.tool === 'transform') { transformStart = {x:ev.x,y:ev.y}; transformSnap = activeCtx().getImageData(0,0,state.canvasW,state.canvasH); return; }

  pushUndo();
  drawDab(activeCtx(), ev.x, ev.y, ev.pressure);
  if (state.symmetry) drawDab(activeCtx(), state.canvasW-ev.x, ev.y, ev.pressure);
  renderAllLayers();
}

function onPMove(e) {
  e.preventDefault();
  if (!e.buttons) pointerDown = false;
  const ev = evData(e);
  updateStatus(ev.x, ev.y, ev.pressure, ev.tilt);
  if (!pointerDown || !state.isDrawing) return;
  if (state.pencilOnly && !ev.isPen) return;

  if (state.tool === 'eyedropper') { pickColor(ev.x, ev.y); return; }
  if (state.tool === 'lasso') { lassoPath.push({x:ev.x,y:ev.y}); drawLassoOverlay(); return; }
  if (state.tool === 'shape') { drawShapePreview(ev.x, ev.y); return; }
  if (state.tool === 'transform') { doTransform(ev.x, ev.y); return; }

  let tx = ev.x, ty = ev.y;
  if (state.stabilizer) {
    const s = state.smoothAmount;
    state.smoothedX = state.smoothedX*s + ev.x*(1-s);
    state.smoothedY = state.smoothedY*s + ev.y*(1-s);
    tx = state.smoothedX; ty = state.smoothedY;
  }

  const lctx = activeCtx();
  if (state.tool === 'smudge') {
    smudgeDab(lctx, tx, ty, state.lastX, state.lastY, ev.pressure);
  } else {
    drawDabsInterp(lctx, state.lastX, state.lastY, tx, ty, ev.pressure);
    if (state.symmetry) drawDabsInterp(lctx, state.canvasW-state.lastX, state.lastY, state.canvasW-tx, ty, ev.pressure);
  }
  state.lastX = tx; state.lastY = ty;
  renderAllLayers();
}

function onPUp(e) {
  if (!state.isDrawing) return;
  state.isDrawing = false; pointerDown = false;

  if (state.tool === 'lasso')  { closeLasso(); return; }
  if (state.tool === 'shape' && shapeStart) {
    const ev = evData(e);
    pushUndo();
    drawShape(activeCtx(), shapeStart.x, shapeStart.y, ev.x, ev.y);
    octx.clearRect(0,0,state.canvasW,state.canvasH);
    shapeStart = null; renderAllLayers(); return;
  }
  if (state.tool === 'transform') { transformStart=null; transformSnap=null; return; }
}

// shape preview
function drawShapePreview(x,y) {
  if (!shapeStart) return;
  octx.clearRect(0,0,state.canvasW,state.canvasH);
  drawShape(octx, shapeStart.x, shapeStart.y, x, y);
}

// transform
function doTransform(x,y) {
  if (!transformStart || !transformSnap) return;
  const dx = x-transformStart.x, dy = y-transformStart.y;
  const lctx = activeCtx();
  lctx.clearRect(0,0,state.canvasW,state.canvasH);
  const tmp = document.createElement('canvas');
  tmp.width=state.canvasW; tmp.height=state.canvasH;
  tmp.getContext('2d').putImageData(transformSnap,0,0);
  lctx.save(); lctx.translate(dx,dy); lctx.drawImage(tmp,0,0); lctx.restore();
  renderAllLayers();
}

// ── LASSO ────────────────────────────────────────────────────
function drawLassoOverlay() {
  sctx.clearRect(0,0,state.canvasW,state.canvasH);
  if (lassoPath.length < 2) return;
  sctx.save(); sctx.strokeStyle='#4f8ef7'; sctx.lineWidth=1.5; sctx.setLineDash([6,4]);
  sctx.beginPath(); lassoPath.forEach((p,i)=>i?sctx.lineTo(p.x,p.y):sctx.moveTo(p.x,p.y));
  sctx.stroke(); sctx.restore();
}
function closeLasso() {
  if (lassoPath.length < 3) { lassoPath=[]; sctx.clearRect(0,0,state.canvasW,state.canvasH); return; }
  sctx.save(); sctx.strokeStyle='#4f8ef7'; sctx.lineWidth=1.5; sctx.setLineDash([6,4]);
  sctx.beginPath(); lassoPath.forEach((p,i)=>i?sctx.lineTo(p.x,p.y):sctx.moveTo(p.x,p.y));
  sctx.closePath(); sctx.stroke(); sctx.restore();
  state.hasSelection = true;
}
function clearSelection() { sctx.clearRect(0,0,state.canvasW,state.canvasH); state.hasSelection=false; lassoPath=[]; }
function fillSelection() {
  if (!state.hasSelection||lassoPath.length<3) return; pushUndo();
  const lctx=activeCtx(); lctx.save();
  lctx.beginPath(); lassoPath.forEach((p,i)=>i?lctx.lineTo(p.x,p.y):lctx.moveTo(p.x,p.y));
  lctx.closePath(); lctx.clip();
  lctx.fillStyle=state.color; lctx.globalAlpha=state.opacity;
  lctx.fillRect(0,0,state.canvasW,state.canvasH); lctx.restore(); renderAllLayers();
}
function clearSelArea() {
  if (!state.hasSelection||lassoPath.length<3) return; pushUndo();
  const lctx=activeCtx(); lctx.save();
  lctx.beginPath(); lassoPath.forEach((p,i)=>i?lctx.lineTo(p.x,p.y):lctx.moveTo(p.x,p.y));
  lctx.closePath(); lctx.clip(); lctx.clearRect(0,0,state.canvasW,state.canvasH);
  lctx.restore(); renderAllLayers();
}

// ── EYEDROPPER ───────────────────────────────────────────────
function pickColor(x,y) {
  const p = ctx.getImageData(Math.max(0,Math.floor(x)), Math.max(0,Math.floor(y)), 1, 1).data;
  const hex = '#'+[p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  setColor(hex); showToast('Color picked: '+hex);
}

// ── GRID ─────────────────────────────────────────────────────
function drawGrid() {
  gctx.clearRect(0,0,state.canvasW,state.canvasH);
  if (!state.gridVisible) return;
  gctx.strokeStyle = 'rgba(100,100,255,0.25)'; gctx.lineWidth=1;
  const gs = 50;
  for (let x=0;x<=state.canvasW;x+=gs){gctx.beginPath();gctx.moveTo(x,0);gctx.lineTo(x,state.canvasH);gctx.stroke();}
  for (let y=0;y<=state.canvasH;y+=gs){gctx.beginPath();gctx.moveTo(0,y);gctx.lineTo(state.canvasW,y);gctx.stroke();}
  // thick lines every 5
  gctx.strokeStyle='rgba(100,100,255,0.5)';
  for (let x=0;x<=state.canvasW;x+=gs*5){gctx.beginPath();gctx.moveTo(x,0);gctx.lineTo(x,state.canvasH);gctx.stroke();}
  for (let y=0;y<=state.canvasH;y+=gs*5){gctx.beginPath();gctx.moveTo(0,y);gctx.lineTo(state.canvasW,y);gctx.stroke();}
}

// ── REFERENCE IMAGE ──────────────────────────────────────────
function setupReference(src) {
  refImg.src = src;
  const prev = document.getElementById('reference-preview');
  prev.src = src; prev.style.display='block';
  state.refLoaded = true;
  refImg.onload = () => updateRefOverlay();
  if (state.refVisible) refOverlay.classList.add('visible');
}
function updateRefOverlay() {
  if (!state.refLoaded) return;
  const aw = canvasArea.offsetWidth;
  const w = (aw * state.refSize / 100);
  const ar = (refImg.naturalHeight||1)/(refImg.naturalWidth||1);
  refImg.style.width  = w+'px';
  refImg.style.height = (w*ar)+'px';
  refImg.style.opacity = state.refOpacity;
  let filter = '';
  if (state.refGray)  filter += 'grayscale(1) ';
  if (state.refFlipH) filter += 'scaleX(-1) ';
  if (state.refFlipV) filter += 'scaleY(-1) ';
  refImg.style.filter = filter;
  refOverlay.style.left = state.refX+'px';
  refOverlay.style.top  = state.refY+'px';
  if (state.refVisible) refOverlay.classList.add('visible');
  else refOverlay.classList.remove('visible');
}

// Make reference draggable
function bindReference() {
  let drag=false, rx=0, ry=0, ox=0, oy=0;
  refOverlay.addEventListener('pointerdown', e=>{
    if (e.target===document.getElementById('ref-handle')) return;
    drag=true; rx=e.clientX-state.refX; ry=e.clientY-state.refY;
    refOverlay.setPointerCapture(e.pointerId);
  });
  refOverlay.addEventListener('pointermove', e=>{
    if (!drag) return;
    state.refX = e.clientX-rx; state.refY = e.clientY-ry;
    refOverlay.style.left=state.refX+'px'; refOverlay.style.top=state.refY+'px';
  });
  refOverlay.addEventListener('pointerup', ()=> drag=false);
  // resize handle
  const handle = document.getElementById('ref-handle');
  let resizing=false, rs0=40, rx0=0;
  handle.addEventListener('pointerdown', e=>{
    e.stopPropagation(); resizing=true; rs0=state.refSize; rx0=e.clientX;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e=>{
    if (!resizing) return;
    const delta = (e.clientX-rx0)/canvasArea.offsetWidth*100;
    state.refSize = Math.max(10,Math.min(100,rs0+delta));
    document.getElementById('ref-size').value = state.refSize;
    document.getElementById('ref-size-val').textContent = Math.round(state.refSize);
    updateRefOverlay();
  });
  handle.addEventListener('pointerup', ()=> resizing=false);
}

// ── PINCH-TO-ZOOM (2-finger gesture) ─────────────────────────
function bindGestures() {
  let pts = {};
  canvasArea.addEventListener('touchstart', e=>{
    if (e.touches.length===1) return; // handled by pointer events
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t=> pts[t.identifier]={x:t.clientX,y:t.clientY});
  },{passive:false});
  canvasArea.addEventListener('touchmove', e=>{
    if (e.touches.length<2) return; e.preventDefault();
    const ts = Array.from(e.touches);
    if (ts.length===2) {
      const [a,b] = ts;
      const d = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
      if (!pinchDist) { pinchDist=d; pinchZoom=state.zoom; return; }
      state.zoom = Math.max(0.1, Math.min(10, pinchZoom*(d/pinchDist)));
      applyTransform();
    }
  },{passive:false});
  canvasArea.addEventListener('touchend', e=>{ if (e.touches.length<2) pinchDist=0; },{passive:true});
  // Two finger pan
  let panning=false, panTouchStart=null, panStateStart=null;
  canvasArea.addEventListener('touchstart', e=>{
    if (e.touches.length===2) { panning=true; panTouchStart={x:(e.touches[0].clientX+e.touches[1].clientX)/2,y:(e.touches[0].clientY+e.touches[1].clientY)/2}; panStateStart={x:state.panX,y:state.panY}; }
    else panning=false;
  },{passive:true});
  canvasArea.addEventListener('touchmove', e=>{
    if (!panning||e.touches.length<2) return;
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2, cy=(e.touches[0].clientY+e.touches[1].clientY)/2;
    state.panX = panStateStart.x+(cx-panTouchStart.x)/state.zoom;
    state.panY = panStateStart.y+(cy-panTouchStart.y)/state.zoom;
    applyTransform();
  },{passive:true});
}

// ── COLOR ENGINE ─────────────────────────────────────────────
function setColor(hex) {
  state.color = hex;
  document.getElementById('color-fg').style.background = hex;
  document.getElementById
// ── COLOR ENGINE (continuation) ──────────────────────────────
function setColor(hex) {
  state.color = hex;
  document.getElementById('color-fg').style.background = hex;
  document.getElementById('hex-input').value = hex;
  document.getElementById('native-color-picker').value = hex;
  const hsl = hexToHsl(hex);
  document.getElementById('hue-slider').value = hsl.h;
  document.getElementById('sat-slider').value = hsl.s;
  document.getElementById('lit-slider').value = hsl.l;
  document.getElementById('h-val').textContent = Math.round(hsl.h);
  document.getElementById('s-val').textContent = Math.round(hsl.s);
  document.getElementById('l-val').textContent = Math.round(hsl.l);
  updateColorWheelDot(hsl.h, hsl.s / 100, hsl.l / 100);
  addColorHistory(hex);
}

function addColorHistory(hex) {
  state.colorHistory = state.colorHistory.filter(c => c !== hex);
  state.colorHistory.unshift(hex);
  if (state.colorHistory.length > 20) state.colorHistory.pop();
  buildColorHistory();
}

function buildColorHistory() {
  const div = document.getElementById('color-history');
  div.innerHTML = '';
  state.colorHistory.slice(0, 20).forEach(c => {
    const el = document.createElement('div');
    el.className = 'hist-color';
    el.style.background = c;
    el.title = c;
    el.onclick = () => setColor(c);
    div.appendChild(el);
  });
}

function buildPalette() {
  const div = document.getElementById('color-palette');
  div.innerHTML = '';
  state.palette.forEach(c => {
    const el = document.createElement('div');
    el.className = 'pal-color';
    el.style.background = c;
    el.title = c;
    el.onclick = () => setColor(c);
    el.oncontextmenu = e => { e.preventDefault(); state.palette.splice(state.palette.indexOf(c),1); buildPalette(); };
    div.appendChild(el);
  });
}

// ── COLOR WHEEL ──────────────────────────────────────────────
let cwCtx;
function initColorWheel() {
  cwCtx = colorWheelCanvas.getContext('2d');
  drawColorWheel();
  let picking = false;
  colorWheelCanvas.addEventListener('pointerdown', e => { picking=true; pickFromWheel(e); });
  colorWheelCanvas.addEventListener('pointermove', e => { if(picking) pickFromWheel(e); });
  colorWheelCanvas.addEventListener('pointerup',   () => picking=false);
}

function drawColorWheel() {
  const W = colorWheelCanvas.width, H = colorWheelCanvas.height;
  const cx = W/2, cy = H/2, R = W/2 - 2;
  cwCtx.clearRect(0,0,W,H);
  // Hue ring
  for (let a = 0; a < 360; a++) {
    const rad = a * Math.PI / 180;
    const grad = cwCtx.createLinearGradient(
      cx + Math.cos(rad)*R*0.55, cy + Math.sin(rad)*R*0.55,
      cx + Math.cos(rad)*R, cy + Math.sin(rad)*R
    );
    grad.addColorStop(0, `hsla(${a},100%,50%,0)`);
    grad.addColorStop(1, `hsl(${a},100%,50%)`);
    cwCtx.fillStyle = grad;
    cwCtx.beginPath();
    cwCtx.moveTo(cx, cy);
    cwCtx.arc(cx, cy, R, rad - 0.02, rad + 0.04);
    cwCtx.fill();
  }
  // White center
  const radGrad = cwCtx.createRadialGradient(cx,cy,0,cx,cy,R*0.55);
  radGrad.addColorStop(0,'rgba(255,255,255,1)');
  radGrad.addColorStop(1,'rgba(255,255,255,0)');
  cwCtx.fillStyle = radGrad;
  cwCtx.beginPath(); cwCtx.arc(cx,cy,R*0.55,0,Math.PI*2); cwCtx.fill();
  // Black outer ring
  const darkGrad = cwCtx.createRadialGradient(cx,cy,R*0.6,cx,cy,R);
  darkGrad.addColorStop(0,'rgba(0,0,0,0)');
  darkGrad.addColorStop(1,'rgba(0,0,0,0.5)');
  cwCtx.fillStyle = darkGrad;
  cwCtx.beginPath(); cwCtx.arc(cx,cy,R,0,Math.PI*2); cwCtx.fill();
}

let cwDotH=0, cwDotS=0, cwDotL=0;
function updateColorWheelDot(h, s, l) { cwDotH=h; cwDotS=s; cwDotL=l; }

function pickFromWheel(e) {
  const rect = colorWheelCanvas.getBoundingClientRect();
  const ex = e.clientX-rect.left, ey = e.clientY-rect.top;
  const pixel = cwCtx.getImageData(Math.floor(ex), Math.floor(ey), 1, 1).data;
  if (pixel[3] < 10) return;
  const hex = '#'+[pixel[0],pixel[1],pixel[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  setColor(hex);
}

// ── STATUS BAR ────────────────────────────────────────────────
function updateStatus(x, y, pressure, tilt) {
  document.getElementById('coords-display').textContent = `x:${Math.floor(x)} y:${Math.floor(y)}`;
  document.getElementById('pressure-display').textContent = `⬤ ${pressure.toFixed(2)}`;
  document.getElementById('tilt-display').textContent = `↗ ${Math.floor(tilt)}°`;
}

// ── SAVE / EXPORT ─────────────────────────────────────────────
function saveAsPNG() {
  const tmp = document.createElement('canvas');
  tmp.width = state.canvasW; tmp.height = state.canvasH;
  const tc = tmp.getContext('2d');
  state.layers.forEach(l => { if (!l.visible) return; tc.save(); tc.globalAlpha=l.opacity; tc.globalCompositeOperation=l.blendMode; tc.drawImage(l.canvas,0,0); tc.restore(); });
  const link = document.createElement('a');
  link.download = 'prodraw-' + Date.now() + '.png';
  link.href = tmp.toDataURL('image/png');
  link.click();
  showToast('Saved as PNG!');
}
function saveAsJPG() {
  const tmp = document.createElement('canvas');
  tmp.width=state.canvasW; tmp.height=state.canvasH;
  const tc=tmp.getContext('2d');
  tc.fillStyle='#ffffff'; tc.fillRect(0,0,state.canvasW,state.canvasH);
  state.layers.forEach(l => { if (!l.visible) return; tc.save(); tc.globalAlpha=l.opacity; tc.globalCompositeOperation=l.blendMode; tc.drawImage(l.canvas,0,0); tc.restore(); });
  const link = document.createElement('a');
  link.download = 'prodraw-' + Date.now() + '.jpg';
  link.href = tmp.toDataURL('image/jpeg', 0.92);
  link.click();
  showToast('Exported as JPG!');
}

// ── TOAST ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ── UI BINDINGS ──────────────────────────────────────────────
function bindUI() {
  // Tools
  document.querySelectorAll('.tool-select').forEach(btn => {
    btn.onclick = () => setActiveTool(btn.dataset.tool);
  });

  // Quick colors
  document.querySelectorAll('.q-color').forEach(el => {
    el.onclick = () => { setColor(el.dataset.color); };
  });

  // Brush sliders
  function bindSlider(id, valId, stateProp, transform) {
    const el = document.getElementById(id);
    const vEl = document.getElementById(valId);
    el.oninput = () => {
      const v = transform ? transform(+el.value) : +el.value;
      state[stateProp] = v;
      vEl.textContent = el.value;
    };
  }
  bindSlider('brush-size', 'size-val', 'size');
  bindSlider('brush-opacity', 'opacity-val', 'opacity', v => v/100);
  bindSlider('brush-hardness','hardness-val','hardness', v => v/100);
  bindSlider('brush-flow',   'flow-val',   'flow',  v => v/100);
  bindSlider('brush-spacing','spacing-val','spacing');
  bindSlider('brush-angle',  'angle-val',  'angle');
  bindSlider('brush-roundness','roundness-val','roundness', v => v/100);
  bindSlider('brush-smooth', 'smooth-val', 'smoothAmount', v => v/100);

  document.getElementById('pressure-size').onchange = e => state.pressureSize = e.target.checked;
  document.getElementById('pressure-opacity').onchange = e => state.pressureOpacity = e.target.checked;
  document.getElementById('tilt-texture').onchange = e => state.tiltTexture = e.target.checked;
  document.getElementById('stabilizer').onchange = e => {
    state.stabilizer = e.target.checked;
    document.getElementById('stabilizer-section').style.display = e.target.checked ? 'block' : 'none';
  };
  document.getElementById('blend-mode').onchange = e => state.blendMode = e.target.value;

  // Brush presets
  document.querySelectorAll('.brush-preset').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.brush-preset').forEach(e=>e.classList.remove('active'));
      el.classList.add('active');
      state.brushPreset = el.dataset.preset;
      const presetMap = {
        basic:       {hardness:80, roundness:100, spacing:10, angle:0},
        soft:        {hardness:0,  roundness:100, spacing:8,  angle:0},
        rough:       {hardness:50, roundness:70,  spacing:15, angle:0},
        calligraphy: {hardness:90, roundness:20,  spacing:5,  angle:45},
        dots:        {hardness:90, roundness:100, spacing:60, angle:0},
        splatter:    {hardness:70, roundness:100, spacing:40, angle:0},
      };
      const p = presetMap[state.brushPreset];
      if (p) {
        state.hardness = p.hardness/100; state.roundness = p.roundness/100;
        state.spacing = p.spacing; state.angle = p.angle;
        ['brush-hardness','brush-roundness','brush-spacing','brush-angle'].forEach(id => {
          const el2 = document.getElementById(id);
          const key = id.replace('brush-','');
          el2.value = {hardness:p.hardness,roundness:p.roundness,spacing:p.spacing,angle:p.angle}[key];
        });
      }
    };
  });

  // Shape picker
  document.querySelectorAll('.shape-btn').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.shape-btn').forEach(e=>e.classList.remove('active'));
      el.classList.add('active'); state.currentShape = el.dataset.shape;
    };
  });
  document.getElementById('shape-fill').onchange = e => state.shapeFill = e.target.checked;

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.panel-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(c=>c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).classList.add('active');
    };
  });

  // Color panel
  document.getElementById('hue-slider').oninput = updateFromSliders;
  document.getElementById('sat-slider').oninput = updateFromSliders;
  document.getElementById('lit-slider').oninput = updateFromSliders;
  document.getElementById('alpha-slider').oninput = e => {
    state.opacity = +e.target.value/100;
    document.getElementById('a-val').textContent = e.target.value;
    document.getElementById('brush-opacity').value = e.target.value;
    document.getElementById('opacity-val').textContent = e.target.value;
  };
  function updateFromSliders() {
    const h = +document.getElementById('hue-slider').value;
    const s = +document.getElementById('sat-slider').value;
    const l = +document.getElementById('lit-slider').value;
    document.getElementById('h-val').textContent = h;
    document.getElementById('s-val').textContent = s;
    document.getElementById('l-val').textContent = l;
    const hex = hslToHex(h, s, l);
    state.color = hex;
    document.getElementById('color-fg').style.background = hex;
    document.getElementById('hex-input').value = hex;
    document.getElementById('native-color-picker').value = hex;
    addColorHistory(hex);
  }

  document.getElementById('hex-input').onchange = e => {
    let v = e.target.value.trim();
    if (!v.startsWith('#')) v='#'+v;
    if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v);
  };
  document.getElementById('native-color-picker').oninput = e => setColor(e.target.value);

  document.getElementById('btn-swap-colors').onclick = () => {
    [state.color, state.bgColor] = [state.bgColor, state.color];
    document.getElementById('color-fg').style.background = state.color;
    document.getElementById('color-bg').style.background = state.bgColor;
    setColor(state.color);
  };
  document.getElementById('btn-default-colors').onclick = () => { setColor('#000000'); state.bgColor='#ffffff'; document.getElementById('color-bg').style.background='#ffffff'; };
  document.getElementById('color-fg').onclick = () => document.getElementById('native-color-picker').click();
  document.getElementById('btn-add-palette').onclick = () => { if (!state.palette.includes(state.color)) { state.palette.unshift(state.color); buildPalette(); showToast('Added to palette'); } };

  // Layers
  document.getElementById('btn-add-layer').onclick = () => { pushUndo(); const l=createLayer('Layer '+(state.layers.length+1)); state.layers.push(l); state.activeLayerIdx=state.layers.length-1; renderLayersPanel(); renderAllLayers(); };
  document.getElementById('btn-dupe-layer').onclick = () => { pushUndo(); const src=activeLayer(); const l=createLayer(src.name+' copy'); l.ctx.drawImage(src.canvas,0,0); l.opacity=src.opacity; l.blendMode=src.blendMode; state.layers.splice(state.activeLayerIdx+1,0,l); state.activeLayerIdx++; renderLayersPanel(); renderAllLayers(); };
  document.getElementById('btn-del-layer').onclick = () => { if(state.layers.length<=1){showToast('Need at least 1 layer');return;} pushUndo(); state.layers.splice(state.activeLayerIdx,1); state.activeLayerIdx=Math.min(state.activeLayerIdx,state.layers.length-1); renderLayersPanel(); renderAllLayers(); };
  document.getElementById('btn-merge-down').onclick = () => { if(state.activeLayerIdx<=0){showToast('No layer below');return;} pushUndo(); const top=activeLayer(),bot=state.layers[state.activeLayerIdx-1]; bot.ctx.save(); bot.ctx.globalAlpha=top.opacity; bot.ctx.globalCompositeOperation=top.blendMode; bot.ctx.drawImage(top.canvas,0,0); bot.ctx.restore(); state.layers.splice(state.activeLayerIdx,1); state.activeLayerIdx--; renderLayersPanel(); renderAllLayers(); };
  document.getElementById('btn-flatten').onclick = () => { pushUndo(); const tmp=createLayer('Flattened'); state.layers.forEach(l=>{if(!l.visible)return;tmp.ctx.save();tmp.ctx.globalAlpha=l.opacity;tmp.ctx.globalCompositeOperation=l.blendMode;tmp.ctx.drawImage(l.canvas,0,0);tmp.ctx.restore();}); state.layers=[tmp]; state.activeLayerIdx=0; renderLayersPanel(); renderAllLayers(); showToast('Layers flattened'); };

  document.getElementById('layer-opacity').oninput = e => { activeLayer().opacity=+e.target.value/100; document.getElementById('layer-opacity-val').textContent=e.target.value; renderAllLayers(); };
  document.getElementById('layer-blend-mode').onchange = e => { activeLayer().blendMode=e.target.value; renderAllLayers(); };
  document.getElementById('layer-lock').onchange = e => activeLayer().locked=e.target.checked;

  // Zoom
  document.getElementById('btn-zoom-in').onclick  = () => { state.zoom = Math.min(10, state.zoom*1.25); applyTransform(); };
  document.getElementById('btn-zoom-out').onclick = () => { state.zoom = Math.max(.05, state.zoom*.8); applyTransform(); };
  document.getElementById('btn-fit').onclick = () => {
    const aw=canvasArea.offsetWidth, ah=canvasArea.offsetHeight;
    state.zoom = Math.min(aw/state.canvasW, ah/state.canvasH) * 0.9;
    state.panX=0; state.panY=0; applyTransform();
  };
  document.getElementById('btn-rotate-cw').onclick  = () => { state.rotation=(state.rotation+15)%360; applyTransform(); };
  document.getElementById('btn-rotate-ccw').onclick = () => { state.rotation=(state.rotation-15+360)%360; applyTransform(); };

  // Toggles
  document.getElementById('btn-symmetry').onclick = e => { state.symmetry=!state.symmetry; e.currentTarget.classList.toggle('on',state.symmetry); symmetryGuide.classList.toggle('visible',state.symmetry); showToast(state.symmetry?'Symmetry ON':'Symmetry OFF'); };
  document.getElementById('btn-grid').onclick = e => { state.gridVisible=!state.gridVisible; e.currentTarget.classList.toggle('on',state.gridVisible); gridCanvas.style.display=state.gridVisible?'block':'none'; drawGrid(); showToast(state.gridVisible?'Grid ON':'Grid OFF'); };
  document.getElementById('btn-layers-toggle').onclick = e => { const p=document.getElementById('panel-right'); p.classList.toggle('collapsed'); e.currentTarget.classList.toggle('on'); };
  document.getElementById('btn-reference').onclick = e => { document.querySelectorAll('.panel-tab').forEach(t=>{if(t.dataset.panel==='reference-panel'){t.click();}}); const p=document.getElementById('panel-right'); if(p.classList.contains('collapsed')) p.classList.remove('collapsed'); };
  document.getElementById('btn-fullscreen').onclick = () => { document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen(); };
  document.getElementById('btn-pencil-only').onclick = e => { state.pencilOnly=!state.pencilOnly; e.currentTarget.classList.toggle('on',state.pencilOnly); document.body.classList.toggle('pencil-only-mode',state.pencilOnly); showToast(state.pencilOnly?'Pencil only mode ON':'Pencil only mode OFF'); };
  document.getElementById('btn-smoothing').onclick = e => { state.stabilizer=!state.stabilizer; e.currentTarget.classList.toggle('on',state.stabilizer); showToast(state.stabilizer?'Stabilizer ON':'Stabilizer OFF'); };

  // File
  document.getElementById('btn-new').onclick = () => { if(confirm('Start new canvas? Unsaved changes will be lost.')) { initCanvasSize(state.canvasW,state.canvasH); initLayers(); showToast('New canvas created'); } };
  document.getElementById('btn-save').onclick = saveAsPNG;
  document.getElementById('btn-export-jpg').onclick = saveAsJPG;
  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-redo').onclick = redo;
  document.getElementById('btn-clear').onclick = () => { if(confirm('Clear current layer?')) { pushUndo(); activeCtx().clearRect(0,0,state.canvasW,state.canvasH); renderAllLayers(); } };

  // Canvas size
  document.getElementById('canvas-size-preset').onchange = e => {
    const v=e.target.value;
    if(v==='custom'){document.getElementById('modal-backdrop').style.display='flex';return;}
    const [w,h]=v.split('x').map(Number);
    if(confirm(`Resize canvas to ${w}×${h}? This will clear layers.`)){pushUndo(); resizeCanvas(w,h);}
    else e.target.value=state.canvasW+'x'+state.canvasH;
  };
  document.getElementById('modal-ok').onclick = () => {
    const w=+document.getElementById('custom-w').value, h=+document.getElementById('custom-h').value;
    document.getElementById('modal-backdrop').style.display='none';
    if(confirm(`Resize canvas to ${w}×${h}?`)){pushUndo();resizeCanvas(w,h);}
  };
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-backdrop').style.display='none';

  // Reference
  document.getElementById('btn-load-reference').onclick = () => document.getElementById('reference-file').click();
  document.getElementById('reference-file').onchange = e => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader(); reader.onload=ev=>setupReference(ev.target.result); reader.readAsDataURL(file);
    showToast('Reference loaded!');
  };
  document.getElementById('ref-opacity').oninput = e => {
    state.refOpacity=+e.target.value/100; document.getElementById('ref-opacity-val').textContent=e.target.value; updateRefOverlay();
  };
  document.getElementById('ref-visible').onchange = e => { state.refVisible=e.target.checked; updateRefOverlay(); };
  document.getElementById('ref-flip-h').onchange = e => { state.refFlipH=e.target.checked; updateRefOverlay(); };
  document.getElementById('ref-flip-v').onchange = e => { state.refFlipV=e.target.checked; updateRefOverlay(); };
  document.getElementById('ref-gray').onchange = e => { state.refGray=e.target.checked; updateRefOverlay(); };
  document.getElementById('ref-size').oninput = e => { state.refSize=+e.target.value; document.getElementById('ref-size-val').textContent=e.target.value; updateRefOverlay(); };

  // Text tool
  document.getElementById('text-confirm').onclick = commitText;
  document.getElementById('text-cancel').onclick = () => { textOverlay.style.display='none'; };
  document.getElementById('text-font').onchange = e => { state.textFont=e.target.value; textInput.style.fontFamily=e.target.value; };
  document.getElementById('text-size').oninput = e => { state.textSize=+e.target.value; textInput.style.fontSize=e.target.value+'px'; };
  document.getElementById('text-bold').onclick = e => { state.textBold=!state.textBold; textInput.style.fontWeight=state.textBold?'bold':'normal'; e.target.classList.toggle('active',state.textBold); };
  document.getElementById('text-italic').onclick = e => { state.textItalic=!state.textItalic; textInput.style.fontStyle=state.textItalic?'italic':'normal'; e.target.classList.toggle('active',state.textItalic); };

  // Context menu
  document.addEventListener('contextmenu', e=>{ e.preventDefault(); showContextMenu(e.clientX,e.clientY); });
  document.addEventListener('click', ()=>{ contextMenu.style.display='none'; });
  document.getElementById('ctx-fill').onclick = fillSelection;
  document.getElementById('ctx-clear-sel').onclick = clearSelArea;
  document.getElementById('ctx-deselect').onclick = clearSelection;
  document.getElementById('ctx-copy').onclick = copyLayer;
  document.getElementById('ctx-paste').onclick = pasteLayer;

  // Wheel zoom
  canvasArea.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.max(.05, Math.min(10, state.zoom*delta));
    applyTransform();
  }, {passive:false});
}

function showContextMenu(x, y) {
  contextMenu.style.display = 'block';
  contextMenu.style.left = x+'px'; contextMenu.style.top = y+'px';
}

let copiedLayer = null;
function copyLayer() { copiedLayer = document.createElement('canvas'); copiedLayer.width=state.canvasW; copiedLayer.height=state.canvasH; copiedLayer.getContext('2d').drawImage(activeLayer().canvas,0,0); showToast('Layer copied'); }
function pasteLayer() { if(!copiedLayer){showToast('Nothing to paste');return;} pushUndo(); activeCtx().drawImage(copiedLayer,0,0); renderAllLayers(); showToast('Layer pasted'); }

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
function bindKeyboard() {
  const toolKeys = {b:'brush',p:'pencil',i:'pen',m:'marker',w:'watercolor',a:'airbrush',s:'smudge',e:'eraser',f:'fill',k:'eyedropper',l:'lasso',t:'transform',h:'shape',x:'text'};
  document.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (toolKeys[key]) { setActiveTool(toolKeys[key]); return; }
    if (e.metaKey || e.ctrlKey) {
      if (key==='z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (key==='z' &&  e.shiftKey) { e.preventDefault(); redo(); }
      if (key==='y') { e.preventDefault(); redo(); }
      if (key==='s') { e.preventDefault(); saveAsPNG(); }
      if (key==='+' || key==='=') { state.zoom=Math.min(10,state.zoom*1.25); applyTransform(); }
      if (key==='-') { state.zoom=Math.max(.05,state.zoom*.8); applyTransform(); }
      if (key==='0') { document.getElementById('btn-fit').click(); }
      return;
    }
    if (key === '[') { state.size = Math.max(1, state.size-2); syncSizeSlider(); }
    if (key === ']') { state.size = Math.min(300, state.size+2); syncSizeSlider(); }
    if (key === 'escape') { clearSelection(); textOverlay.style.display='none'; contextMenu.style.display='none'; }
  });
}
function syncSizeSlider() {
  document.getElementById('brush-size').value = state.size;
  document.getElementById('size-val').textContent = state.size;
}

// ── TOOL SWITCH ───────────────────────────────────────────────
function setActiveTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-select').forEach(btn => btn.classList.toggle('active', btn.dataset.tool===tool));
  document.body.className = document.body.className.replace(/tool-\S+/g,'').trim();
  document.body.classList.add('tool-'+tool);
  document.getElementById('shape-options').style.display = tool==='shape' ? 'block' : 'none';
  showToast(tool.charAt(0).toUpperCase()+tool.slice(1)+' selected');
}

// ── CANVAS RESIZE ─────────────────────────────────────────────
function resizeCanvas(w, h) {
  const snap = captureCurrent();
  state.canvasW = w; state.canvasH = h;
  state.layers = snap.map(s => {
    const l = createLayer(s.name);
    l.ctx.drawImage(s.canvas, 0, 0, w, h);
    l.visible=s.visible; l.opacity=s.opacity; l.blendMode=s.blendMode; l.locked=s.locked;
    return l;
  });
  [mainCanvas,overlayCanvas,gridCanvas,selCanvas].forEach(c => { c.width=w; c.height=h; c.style.width=w+'px'; c.style.height=h+'px'; });
  drawGrid(); renderAllLayers(); renderLayersPanel();
  showToast('Canvas resized to '+w+'×'+h);
}

// ── COLOR UTILS ───────────────────────────────────────────────
function hexToHsl(hex) {
  let [r,g,b] = hexToRgba(hex);
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s, l=(max+min)/2;
  if (max===min) { h=s=0; }
  else {
    const d=max-min;
    s = l>.5 ? d/(2-max-min) : d/(max+min);
    switch(max){ case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; case b: h=(r-g)/d+4; }
    h/=6;
  }
  return {h:Math.round(h*360), s:Math.round(s*100), l:Math.round(l*100)};
}
function hslToHex(h,s,l) {
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}
  return '#'+[r+m,g+m,b+m].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
function hexToRgba(hex) {
  hex = hex.replace('#','');
  if (hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
}
function hexWithAlpha(hex, alpha) {
  const [r,g,b] = hexToRgba(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── START ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
