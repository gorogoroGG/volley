// =============================================
// CONFIGURATION - Ably APIキーをここに設定してください
// https://ably.com で無料アカウント作成後、APIキーを取得
// =============================================
const ABLY_API_KEY = 'jLJE4g.VLr98w:v36wFu40ADOPh78A1OIL6XR0vAs7bdpOiusN5MeyscE';

// =============================================
// STATE
// =============================================
let objects = [];       // 全描画オブジェクト（正規化座標 0-1）
let undoStack = [];     // 各エントリ: { action, data } undoに使う逆操作
let redoStack = [];

let currentTool = 'pen';
let currentColor = '#FF4444';
let currentSize = 4;

// Drawing temp
let isPointerDown = false;
let currentPoints = [];   // pen stroke
let arrowStart = null;    // arrow start point (normalized)
let tempArrow = null;     // preview

// Select/drag
let selectedId = null;
let isDragging = false;
let dragStartNorm = null;
let dragObjOrigPos = null;

// Player placement
let placingPlayer = null; // { team:'own'|'opp', number }

// Canvas
let courtCanvas, courtCtx, drawCanvas, drawCtx;
let canvasW = 1, canvasH = 1;
let courtBounds = { x: 0, y: 0, w: 0, h: 0 };

// Ably
let ably, channel;
let roomId = '';
let myClientId = 'u-' + Math.random().toString(36).substr(2, 8);
let connectedCount = 1;
let isNewRoom = false;

// ID generator
function uid() { return Math.random().toString(36).substr(2, 9); }

// =============================================
// INIT
// =============================================
window.addEventListener('DOMContentLoaded', () => {
  courtCanvas = document.getElementById('court-canvas');
  drawCanvas = document.getElementById('draw-canvas');
  courtCtx = courtCanvas.getContext('2d');
  drawCtx = drawCanvas.getContext('2d');

  // Room ID from URL
  const params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    roomId = params.get('room');
    isNewRoom = false;
  } else {
    roomId = genRoomId();
    isNewRoom = true;
    const u = new URL(window.location.href);
    u.searchParams.set('room', roomId);
    window.history.replaceState({}, '', u.toString());
  }
  document.getElementById('room-id').textContent = roomId;

  resizeAll();
  window.addEventListener('resize', () => { resizeAll(); redraw(); });

  setupToolbar();
  setupCanvasEvents();
  setupKeyboard();
  setupModals();
  initAbly();

  if (isNewRoom) showToast();
});

function genRoomId() {
  const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => C[Math.floor(Math.random() * C.length)]).join('');
}

// =============================================
// RESIZE
// =============================================
function resizeAll() {
  const cont = document.getElementById('canvas-container');
  const r = cont.getBoundingClientRect();
  canvasW = r.width;
  canvasH = r.height;
  courtCanvas.width = drawCanvas.width = canvasW;
  courtCanvas.height = drawCanvas.height = canvasH;
  drawCourt();
  redraw();
}

// =============================================
// COURT DRAWING
// =============================================
function drawCourt() {
  const ctx = courtCtx;
  const W = canvasW, H = canvasH;

  // Background
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, W, H);

  // Court size: 18m x 9m (2:1)
  const mg = Math.min(W, H) * 0.07;
  let cW, cH;
  const avW = W - mg * 2, avH = H - mg * 2;
  if (avW / avH >= 2) { cH = avH; cW = cH * 2; }
  else { cW = avW; cH = cW / 2; }
  const cX = (W - cW) / 2, cY = (H - cH) / 2;
  courtBounds = { x: cX, y: cY, w: cW, h: cH };

  // Court floor gradient
  const g = ctx.createLinearGradient(cX, cY, cX + cW, cY + cH);
  g.addColorStop(0, '#143352');
  g.addColorStop(0.5, '#1b4570');
  g.addColorStop(1, '#143352');
  ctx.fillStyle = g;
  ctx.fillRect(cX, cY, cW, cH);

  const lw = Math.max(1.5, cW / 160);

  // Court border
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = lw * 1.5;
  ctx.strokeRect(cX, cY, cW, cH);

  // Center line (net)
  ctx.lineWidth = lw * 2;
  ctx.beginPath();
  ctx.moveTo(cX + cW / 2, cY);
  ctx.lineTo(cX + cW / 2, cY + cH);
  ctx.stroke();

  // Attack lines (3m from net = cW/6 from center)
  ctx.setLineDash([cW / 55, cW / 70]);
  ctx.lineWidth = lw;
  [cX + cW / 2 - cW / 6, cX + cW / 2 + cW / 6].forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, cY);
    ctx.lineTo(x, cY + cH);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Net pole
  ctx.fillStyle = '#ccc';
  ctx.fillRect(cX + cW / 2 - lw, cY - cH * 0.08, lw * 2, cH + cH * 0.16);

  // Net mesh
  ctx.strokeStyle = 'rgba(200,200,200,0.35)';
  ctx.lineWidth = 0.5;
  const netCells = 14;
  for (let i = 0; i <= netCells; i++) {
    const ny = cY + (cH / netCells) * i;
    ctx.beginPath();
    ctx.moveTo(cX + cW / 2 - lw * 2, ny);
    ctx.lineTo(cX + cW / 2 + lw * 2, ny);
    ctx.stroke();
  }

  // Zone labels
  const fs = Math.max(10, cW / 38);
  ctx.font = `bold ${fs}px 'Segoe UI',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('自チーム', cX + cW * 0.25, cY + cH / 2);
  ctx.fillText('相手チーム', cX + cW * 0.75, cY + cH / 2);

  const fs2 = Math.max(8, cW / 60);
  ctx.font = `${fs2}px 'Segoe UI',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ['自', '相'].forEach((_, i) => {
    const bx = cX + cW * (i === 0 ? 0.25 : 0.75);
    ctx.fillText('フロント', bx, cY + cH * 0.13);
    ctx.fillText('バック', bx, cY + cH * 0.87);
  });
}

// =============================================
// COORDINATE UTILS
// =============================================
function toNorm(px, py) { return { x: px / canvasW, y: py / canvasH }; }
function fromNorm(nx, ny) { return { x: nx * canvasW, y: ny * canvasH }; }

function getPos(e) {
  const r = drawCanvas.getBoundingClientRect();
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
  }
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const playerRadius = () => Math.max(16, Math.min(canvasW, canvasH) * 0.038);

function hitTestPlayer(nx, ny) {
  const r = playerRadius();
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type !== 'player') continue;
    const px = fromNorm(o.x, o.y);
    const dx = nx * canvasW - px.x;
    const dy = ny * canvasH - px.y;
    if (dx * dx + dy * dy <= r * r) return o;
  }
  return null;
}

function hitTestAny(nx, ny) {
  const r = playerRadius();
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type === 'player') {
      const px = fromNorm(o.x, o.y);
      const dx = nx * canvasW - px.x;
      const dy = ny * canvasH - px.y;
      if (dx * dx + dy * dy <= r * r) return o;
    } else if (o.type === 'text') {
      const pos = fromNorm(o.x, o.y);
      if (Math.abs(nx * canvasW - pos.x) < 80 && Math.abs(ny * canvasH - pos.y) < 20) return o;
    }
  }
  return null;
}

// =============================================
// REDRAW
// =============================================
function redraw() {
  drawCtx.clearRect(0, 0, canvasW, canvasH);
  objects.forEach(o => drawObject(drawCtx, o));
  if (tempArrow) drawArrowObj(drawCtx, tempArrow, true);
  // Draw current live stroke
  if (isPointerDown && currentTool === 'pen' && currentPoints.length > 1) {
    drawLiveStroke(drawCtx, currentPoints, currentColor, currentSize);
  }
}

function drawObject(ctx, obj) {
  switch (obj.type) {
    case 'stroke': drawStrokeObj(ctx, obj); break;
    case 'arrow': drawArrowObj(ctx, obj, false); break;
    case 'player': drawPlayerObj(ctx, obj); break;
    case 'text': drawTextObj(ctx, obj); break;
  }
}

function drawStrokeObj(ctx, obj) {
  if (!obj.points || obj.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = obj.color;
  ctx.lineWidth = obj.width;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  const f = fromNorm(obj.points[0].x, obj.points[0].y);
  ctx.moveTo(f.x, f.y);
  for (let i = 1; i < obj.points.length; i++) {
    const p = fromNorm(obj.points[i].x, obj.points[i].y);
    if (i < obj.points.length - 1) {
      const q = fromNorm(obj.points[i + 1].x, obj.points[i + 1].y);
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawLiveStroke(ctx, pts, color, width) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (i < pts.length - 1) {
      const q = pts[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawArrowObj(ctx, obj, preview) {
  const f = fromNorm(obj.x1, obj.y1);
  const t = fromNorm(obj.x2, obj.y2);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = obj.color;
  ctx.lineWidth = obj.width;
  ctx.lineCap = 'round';
  if (preview) { ctx.setLineDash([8, 5]); ctx.globalAlpha = 0.7; }
  ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(t.y - f.y, t.x - f.x);
  const hLen = Math.max(14, obj.width * 4);
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(t.x - hLen * Math.cos(ang - Math.PI / 6), t.y - hLen * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(t.x - hLen * Math.cos(ang + Math.PI / 6), t.y - hLen * Math.sin(ang + Math.PI / 6));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPlayerObj(ctx, obj) {
  const pos = fromNorm(obj.x, obj.y);
  const r = playerRadius();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  // Circle fill
  const isOwn = obj.team === 'own';
  const gradient = ctx.createRadialGradient(pos.x - r * 0.3, pos.y - r * 0.3, r * 0.1, pos.x, pos.y, r);
  gradient.addColorStop(0, isOwn ? '#6aabff' : '#ff7777');
  gradient.addColorStop(1, isOwn ? '#2255cc' : '#cc2222');
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  // Border
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = isOwn ? '#88ccff' : '#ff9999';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Number
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(12, r * 0.72)}px 'Segoe UI',sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 3;
  ctx.fillText(String(obj.number), pos.x, pos.y);
  // Selection ring
  if (obj.id === selectedId) {
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawTextObj(ctx, obj) {
  const pos = fromNorm(obj.x, obj.y);
  ctx.save();
  ctx.fillStyle = obj.color;
  ctx.font = `bold ${obj.size || 18}px 'Segoe UI',sans-serif`;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.fillText(obj.content, pos.x, pos.y);
  ctx.restore();
}

// =============================================
// TOOLBAR SETUP
// =============================================
function setupToolbar() {
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTool = btn.dataset.tool;
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCursor();
      placingPlayer = null;
    });
  });

  // Color buttons
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentColor = btn.dataset.color;
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Size buttons
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSize = +btn.dataset.size;
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Undo / Redo / Clear
  document.getElementById('undo-btn').addEventListener('click', doUndo);
  document.getElementById('redo-btn').addEventListener('click', doRedo);
  document.getElementById('clear-btn').addEventListener('click', confirmClear);

  // Player add buttons
  document.getElementById('add-own-btn').addEventListener('click', () => startPlacingPlayer('own'));
  document.getElementById('add-opp-btn').addEventListener('click', () => startPlacingPlayer('opp'));
}

function updateCursor() {
  const dc = drawCanvas;
  dc.classList.remove('cur-select', 'cur-eraser', 'cur-text', 'cur-player');
  if (currentTool === 'select') dc.classList.add('cur-select');
  else if (currentTool === 'eraser') dc.classList.add('cur-eraser');
  else if (currentTool === 'text') dc.classList.add('cur-text');
  else if (currentTool === 'player') dc.classList.add('cur-player');
}

function startPlacingPlayer(team) {
  const nums = objects.filter(o => o.type === 'player' && o.team === team).map(o => o.number);
  let n = 1;
  while (nums.includes(n)) n++;
  placingPlayer = { team, number: n };
  drawCanvas.classList.add('cur-player');
  // Switch to select so clicks place then go back
  currentTool = 'player_place';
}

// =============================================
// CANVAS EVENTS
// =============================================
function setupCanvasEvents() {
  const dc = drawCanvas;

  // Pointer events (covers mouse + touch)
  dc.addEventListener('pointerdown', onPointerDown);
  dc.addEventListener('pointermove', onPointerMove);
  dc.addEventListener('pointerup', onPointerUp);
  dc.addEventListener('pointercancel', onPointerUp);
  dc.addEventListener('contextmenu', onRightClick);

  // Touch disable scroll while on canvas
  dc.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  dc.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
}

function onPointerDown(e) {
  e.preventDefault();
  dc_capture(e);
  const raw = getPos(e);
  const n = toNorm(raw.x, raw.y);

  if (currentTool === 'player_place' && placingPlayer) {
    placePlayer(n.x, n.y);
    return;
  }

  if (currentTool === 'select') {
    const hit = hitTestAny(n.x, n.y);
    if (hit) {
      selectedId = hit.id;
      isDragging = true;
      dragStartNorm = n;
      dragObjOrigPos = { x: hit.x, y: hit.y };
    } else {
      selectedId = null;
    }
    redraw();
    return;
  }

  if (currentTool === 'eraser') {
    eraseAt(raw.x, raw.y);
    isPointerDown = true;
    return;
  }

  if (currentTool === 'pen') {
    isPointerDown = true;
    currentPoints = [raw];
    return;
  }

  if (currentTool === 'arrow') {
    isPointerDown = true;
    arrowStart = n;
    return;
  }

  if (currentTool === 'text') {
    showTextInput(raw.x, raw.y, n.x, n.y);
    return;
  }
}

function dc_capture(e) {
  try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) { }
}

function onPointerMove(e) {
  e.preventDefault();
  const raw = getPos(e);
  const n = toNorm(raw.x, raw.y);

  if (currentTool === 'select' && isDragging && selectedId) {
    const obj = objects.find(o => o.id === selectedId);
    if (obj) {
      const dx = n.x - dragStartNorm.x;
      const dy = n.y - dragStartNorm.y;
      obj.x = dragObjOrigPos.x + dx;
      obj.y = dragObjOrigPos.y + dy;
      redraw();
    }
    return;
  }

  if (currentTool === 'eraser' && isPointerDown) {
    eraseAt(raw.x, raw.y);
    return;
  }

  if (currentTool === 'pen' && isPointerDown) {
    currentPoints.push(raw);
    redraw();
    return;
  }

  if (currentTool === 'arrow' && isPointerDown && arrowStart) {
    tempArrow = { type: 'arrow', x1: arrowStart.x, y1: arrowStart.y, x2: n.x, y2: n.y, color: currentColor, width: currentSize };
    redraw();
    return;
  }
}

function onPointerUp(e) {
  e.preventDefault();
  const raw = getPos(e);
  const n = toNorm(raw.x, raw.y);

  if (currentTool === 'select' && isDragging && selectedId) {
    const obj = objects.find(o => o.id === selectedId);
    if (obj) {
      const prev = { ...dragObjOrigPos };
      pushUndo({ action: 'move', id: obj.id, prevX: prev.x, prevY: prev.y, newX: obj.x, newY: obj.y });
      redoStack = [];
      publishOp({ type: 'move', id: obj.id, x: obj.x, y: obj.y });
    }
    isDragging = false;
    isPointerDown = false;
    return;
  }

  if (currentTool === 'pen' && isPointerDown) {
    isPointerDown = false;
    if (currentPoints.length >= 2) {
      const pts = currentPoints.map(p => toNorm(p.x, p.y));
      const obj = { id: uid(), type: 'stroke', points: pts, color: currentColor, width: currentSize };
      addObject(obj, true);
    }
    currentPoints = [];
    redraw();
    return;
  }

  if (currentTool === 'arrow' && isPointerDown) {
    isPointerDown = false;
    if (arrowStart) {
      const obj = { id: uid(), type: 'arrow', x1: arrowStart.x, y1: arrowStart.y, x2: n.x, y2: n.y, color: currentColor, width: currentSize };
      addObject(obj, true);
    }
    arrowStart = null;
    tempArrow = null;
    redraw();
    return;
  }

  isPointerDown = false;
}

function onRightClick(e) {
  e.preventDefault();
  const raw = getPos(e);
  const n = toNorm(raw.x, raw.y);
  const hit = hitTestAny(n.x, n.y);
  if (hit) removeObject(hit.id, true);
}

function eraseAt(px, py) {
  const r2 = (playerRadius() * 1.2) ** 2;
  const n = toNorm(px, py);
  // Remove player/text by proximity
  let removed = null;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type === 'player' || o.type === 'text') {
      const pos = fromNorm(o.x, o.y);
      const dx = px - pos.x, dy = py - pos.y;
      if (dx * dx + dy * dy < r2) { removed = objects.splice(i, 1)[0]; break; }
    }
  }
  if (removed) {
    pushUndo({ action: 'remove', obj: JSON.parse(JSON.stringify(removed)) });
    redoStack = [];
    publishOp({ type: 'remove', id: removed.id });
  }
  // For strokes: erase any stroke whose points come near cursor
  const eraseR2 = (currentSize * 12) ** 2;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type !== 'stroke') continue;
    for (const pt of o.points) {
      const p = fromNorm(pt.x, pt.y);
      const dx = px - p.x, dy = py - p.y;
      if (dx * dx + dy * dy < eraseR2) {
        const removed2 = objects.splice(i, 1)[0];
        pushUndo({ action: 'remove', obj: JSON.parse(JSON.stringify(removed2)) });
        redoStack = [];
        publishOp({ type: 'remove', id: removed2.id });
        break;
      }
    }
  }
  redraw();
}

// =============================================
// OBJECT OPERATIONS
// =============================================
function addObject(obj, broadcast) {
  objects.push(obj);
  // obj を保存しておき、Redo時に復元できるようにする
  pushUndo({ action: 'add', id: obj.id, obj: JSON.parse(JSON.stringify(obj)) });
  redoStack = [];
  redraw();
  if (broadcast) publishOp({ type: 'add', object: obj });
}

function removeObject(id, broadcast) {
  const idx = objects.findIndex(o => o.id === id);
  if (idx < 0) return;
  const removed = objects.splice(idx, 1)[0];
  pushUndo({ action: 'remove', obj: JSON.parse(JSON.stringify(removed)) });
  redoStack = [];
  redraw();
  if (broadcast) publishOp({ type: 'remove', id });
}

function placePlayer(nx, ny) {
  if (!placingPlayer) return;
  const obj = {
    id: uid(), type: 'player',
    x: nx, y: ny,
    number: placingPlayer.number,
    team: placingPlayer.team
  };
  addObject(obj, true);
  placingPlayer = null;
  drawCanvas.classList.remove('cur-player');
  currentTool = 'select';
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === 'select');
  });
}

// =============================================
// TEXT INPUT
// =============================================
function showTextInput(px, py, nx, ny) {
  const overlay = document.getElementById('text-overlay');
  const input = document.getElementById('text-input');
  overlay.style.display = 'block';
  overlay.style.left = px + 'px';
  overlay.style.top = py + 'px';
  input.value = '';
  input.focus();

  const commit = () => {
    const content = input.value.trim();
    overlay.style.display = 'none';
    if (!content) return;
    const obj = { id: uid(), type: 'text', x: nx, y: ny, content, color: currentColor, size: Math.max(14, currentSize * 4) };
    addObject(obj, true);
  };
  input.onkeydown = e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') overlay.style.display = 'none'; };
  input.onblur = commit;
}

// =============================================
// UNDO / REDO
// =============================================
function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > 60) undoStack.shift();
}

function doUndo() {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  redoStack.push(entry);

  if (entry.action === 'add') {
    const idx = objects.findIndex(o => o.id === entry.id);
    if (idx >= 0) {
      const obj = objects.splice(idx, 1)[0];
      publishOp({ type: 'remove', id: obj.id });
    }
  } else if (entry.action === 'remove') {
    objects.push(entry.obj);
    publishOp({ type: 'add', object: entry.obj });
  } else if (entry.action === 'move') {
    const obj = objects.find(o => o.id === entry.id);
    if (obj) { obj.x = entry.prevX; obj.y = entry.prevY; }
    publishOp({ type: 'move', id: entry.id, x: entry.prevX, y: entry.prevY });
  } else if (entry.action === 'clear') {
    objects.push(...entry.objects);
    // Don't sync clear-undo to avoid complexity
  }
  redraw();
}

function doRedo() {
  if (!redoStack.length) return;
  const entry = redoStack.pop();
  undoStack.push(entry);

  if (entry.action === 'add') {
    // We need the object... store it in undo entry
    // For simplicity, re-publish if we stored it
    if (entry.obj) {
      objects.push(entry.obj);
      publishOp({ type: 'add', object: entry.obj });
    }
  } else if (entry.action === 'remove') {
    const idx = objects.findIndex(o => o.id === entry.obj.id);
    if (idx >= 0) { objects.splice(idx, 1); publishOp({ type: 'remove', id: entry.obj.id }); }
  } else if (entry.action === 'move') {
    const obj = objects.find(o => o.id === entry.id);
    if (obj) { obj.x = entry.newX; obj.y = entry.newY; }
    publishOp({ type: 'move', id: entry.id, x: entry.newX, y: entry.newY });
  }
  redraw();
}

function confirmClear() {
  if (!objects.length) return;
  if (!window.confirm('ボードを全消去しますか？')) return;
  const snap = JSON.parse(JSON.stringify(objects));
  pushUndo({ action: 'clear', objects: snap });
  redoStack = [];
  objects = [];
  redraw();
  publishOp({ type: 'clear' });
}

// =============================================
// KEYBOARD SHORTCUTS
// =============================================
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); doRedo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) { removeObject(selectedId, true); selectedId = null; }
    }
  });
}

// =============================================
// MODALS & TOAST
// =============================================
function setupModals() {
  const shareUrl = () => window.location.href;

  // Header buttons
  document.getElementById('copy-url-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl()).then(() => flashCopied('copy-url-btn'));
  });
  document.getElementById('qr-btn').addEventListener('click', openQR);

  // QR modal
  document.getElementById('close-qr-btn').addEventListener('click', () => {
    document.getElementById('qr-modal').classList.add('hidden');
  });
  document.getElementById('modal-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl()).then(() => flashCopied('modal-copy-btn'));
  });

  // Toast
  document.getElementById('toast-share-btn').addEventListener('click', openQR);
}

function openQR() {
  const modal = document.getElementById('qr-modal');
  const el = document.getElementById('qr-code-el');
  const url = window.location.href;
  modal.classList.remove('hidden');
  el.innerHTML = '';
  document.getElementById('share-url-input').value = url;
  if (typeof QRCode !== 'undefined') {
    new QRCode(el, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  } else {
    el.textContent = url;
  }
}

function flashCopied(btnId) {
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.textContent = '✅';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

function showToast() {
  const toast = document.getElementById('welcome-toast');
  document.getElementById('toast-room-id').textContent = roomId;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 6000);
}

// =============================================
// ABLY REALTIME
// =============================================
function initAbly() {
  setStatus('connecting');

  if (ABLY_API_KEY === 'YOUR_ABLY_API_KEY_HERE') {
    console.warn('[VolleyBoard] Ably APIキーが未設定です。app.js の ABLY_API_KEY を設定してください。');
    setStatus('disconnected');
    document.getElementById('status-text').textContent = 'オフライン(APIキー未設定)';
    return;
  }

  ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myClientId });
  ably.connection.on('connected', () => {
    setStatus('connected');
    document.getElementById('status-text').textContent = '接続済み';
    joinChannel();
  });
  ably.connection.on('disconnected', () => {
    setStatus('disconnected');
    document.getElementById('status-text').textContent = '切断';
  });
  ably.connection.on('failed', () => {
    setStatus('disconnected');
    document.getElementById('status-text').textContent = '接続失敗';
  });
}

function joinChannel() {
  channel = ably.channels.get('volley-board-' + roomId);

  // Receive operations
  channel.subscribe('op', msg => {
    if (msg.clientId === myClientId) return; // ignore own
    applyRemoteOp(msg.data);
  });

  // Receive full state (for late joiners)
  channel.subscribe('state', msg => {
    if (msg.clientId === myClientId) return;
    if (objects.length === 0) {
      objects = msg.data.objects || [];
      redraw();
    }
  });

  // Presence: when someone joins, send full state
  channel.presence.subscribe('enter', member => {
    if (member.clientId === myClientId) return;
    // Send current state to new joiner
    channel.publish('state', { objects }, err => { if (err) console.error(err); });
    updateUserCount();
  });
  channel.presence.subscribe('leave', () => updateUserCount());

  channel.presence.enter({ name: myClientId }, () => {
    channel.presence.get((err, members) => {
      if (!err) {
        connectedCount = members.length;
        document.getElementById('user-count').textContent = '👥 ' + connectedCount;
      }
    });
  });
}

function updateUserCount() {
  if (!channel) return;
  channel.presence.get((err, members) => {
    if (!err) {
      connectedCount = members.length;
      document.getElementById('user-count').textContent = '👥 ' + connectedCount;
    }
  });
}

function publishOp(op) {
  if (!channel) return;
  channel.publish('op', op, err => { if (err) console.error('publish error:', err); });
}

function applyRemoteOp(op) {
  switch (op.type) {
    case 'add': {
      if (!objects.find(o => o.id === op.object.id)) {
        objects.push(op.object);
      }
      break;
    }
    case 'move': {
      const obj = objects.find(o => o.id === op.id);
      if (obj) { obj.x = op.x; obj.y = op.y; }
      break;
    }
    case 'remove': {
      const idx = objects.findIndex(o => o.id === op.id);
      if (idx >= 0) objects.splice(idx, 1);
      break;
    }
    case 'clear': {
      objects = [];
      break;
    }
  }
  redraw();
}

function setStatus(state) {
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + state;
}
