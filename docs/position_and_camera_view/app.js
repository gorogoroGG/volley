// =============================================
// CONFIGURATION - Ably API繧ｭ繝ｼ繧偵％縺薙↓險ｭ螳壹＠縺ｦ縺上□縺輔＞
// https://ably.com 縺ｧ辟｡譁吶い繧ｫ繧ｦ繝ｳ繝井ｽ懈・蠕後、PI繧ｭ繝ｼ繧貞叙蠕・
// =============================================
const ABLY_API_KEY = 'jLJE4g.VLr98w:v36wFu40ADOPh78A1OIL6XR0vAs7bdpOiusN5MeyscE';

// =============================================
// STATE
// =============================================
let objects = [];       // 蜈ｨ謠冗判繧ｪ繝悶ず繧ｧ繧ｯ繝茨ｼ域ｭ｣隕丞喧蠎ｧ讓・0-1・・
let undoStack = [];     // 蜷・お繝ｳ繝医Μ: { action, data } undo縺ｫ菴ｿ縺・・桃菴・
let redoStack = [];

let currentTool = 'pen';
let currentColor = '#FF4444';
let currentSize = 4;
let showPositions = false;
let cameraView = 'top';

// Drawing temp
let isPointerDown = false;
let currentPoints = [];   // pen stroke
let arrowStart = null;    // arrow start point (normalized)
let tempArrow = null;     // preview
let areaStart = null;     // area start point
let tempArea = null;      // preview

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
  ctx.fillText('閾ｪ繝√・繝', cX + cW * 0.25, cY + cH / 2);
  ctx.fillText('逶ｸ謇九メ繝ｼ繝', cX + cW * 0.75, cY + cH / 2);

  const fs2 = Math.max(8, cW / 60);
  ctx.font = `${fs2}px 'Segoe UI',sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ['閾ｪ', '逶ｸ'].forEach((_, i) => {
    const bx = cX + cW * (i === 0 ? 0.25 : 0.75);
    ctx.fillText('繝輔Ο繝ｳ繝・, bx, cY + cH * 0.13);
    ctx.fillText('繝舌ャ繧ｯ', bx, cY + cH * 0.87);
  });
}

// =============================================
// COORDINATE UTILS
// =============================================
// 蠎ｧ讓吶・繧ｳ繝ｼ繝磯伜沺 (courtBounds) 繧貞渕貅悶↓豁｣隕丞喧縺吶ｋ縲・
// 縺薙ｌ縺ｫ繧医ｊ逕ｻ髱｢豈皮紫縺檎焚縺ｪ繧九ョ繝舌う繧ｹ髢薙〒繧ょ酔縺倥さ繝ｼ繝井ｸ翫・菴咲ｽｮ縺悟酔縺伜､縺ｫ縺ｪ繧九・
function toNorm(px, py) {
  const { x: cx, y: cy, w: cw, h: ch } = courtBounds;
  if (!cw || !ch) return { x: px / canvasW, y: py / canvasH }; // 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
  return { x: (px - cx) / cw, y: (py - cy) / ch };
}
function fromNorm(nx, ny) {
  const { x: cx, y: cy, w: cw, h: ch } = courtBounds;
  if (!cw || !ch) return { x: nx * canvasW, y: ny * canvasH }; // 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
  return { x: cx + nx * cw, y: cy + ny * ch };
}

function getPos(e) {
  if (e.offsetX !== undefined && e.offsetY !== undefined) {
    return { x: e.offsetX, y: e.offsetY };
  }
  const r = drawCanvas.getBoundingClientRect();
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
  }
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const playerRadius = () => Math.max(16, Math.min(canvasW, canvasH) * 0.038);

function hitTestPlayer(nx, ny) {
  const r = playerRadius();
  const hitPx = fromNorm(nx, ny);
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type !== 'player' && o.type !== 'ball') continue;
    const px = fromNorm(o.x, o.y);
    const tr = o.type === 'ball' ? r * 0.7 : r;
    const dx = hitPx.x - px.x;
    const dy = hitPx.y - px.y;
    if (dx * dx + dy * dy <= tr * tr) return o;
  }
  return null;
}

function hitTestAny(nx, ny) {
  const r = playerRadius();
  const hitPx = fromNorm(nx, ny);
  // 荳翫↓謠冗判縺輔ｌ繧九ｂ縺ｮ・医ユ繧ｭ繧ｹ繝医・驕ｸ謇九・繝懊・繝ｫ・峨ｒ蜈医↓蛻､螳・
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type === 'player' || o.type === 'ball') {
      const px = fromNorm(o.x, o.y);
      const tr = o.type === 'ball' ? r * 0.7 : r;
      const dx = hitPx.x - px.x;
      const dy = hitPx.y - px.y;
      if (dx * dx + dy * dy <= tr * tr) return o;
    } else if (o.type === 'text') {
      const pos = fromNorm(o.x, o.y);
      if (Math.abs(hitPx.x - pos.x) < 80 && Math.abs(hitPx.y - pos.y) < 20) return o;
    }
  }
  // 閭梧勹蛛ｴ縺ｮ繧ゅ・・医お繝ｪ繧｢・峨ｒ谺｡縺ｫ蛻､螳・
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type === 'area') {
      const p1 = fromNorm(o.x1, o.y1);
      const p2 = fromNorm(o.x2, o.y2);
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      if (hitPx.x >= minX && hitPx.x <= maxX && hitPx.y >= minY && hitPx.y <= maxY) {
        return o;
      }
    }
  }
  return null;
}

// =============================================
// REDRAW
// =============================================
function redraw() {
  drawCtx.clearRect(0, 0, canvasW, canvasH);

  // 1螻､逶ｮ: 閭梧勹繝ｻ邱・(area, stroke, arrow)
  objects.forEach(o => {
    if (o.type === 'area' || o.type === 'stroke' || o.type === 'arrow') {
      drawObject(drawCtx, o);
    }
  });

  if (tempArea) drawAreaObj(drawCtx, tempArea);
  if (tempArrow) drawArrowObj(drawCtx, tempArrow, true);
  if (isPointerDown && currentTool === 'pen' && currentPoints.length > 1) {
    drawLiveStroke(drawCtx, currentPoints, currentColor, currentSize);
  }

  // 2螻､逶ｮ: 蜑肴勹 (player, ball, text)
  objects.forEach(o => {
    if (o.type === 'player' || o.type === 'ball' || o.type === 'text') {
      drawObject(drawCtx, o);
    }
  });
}

function drawObject(ctx, obj) {
  switch (obj.type) {
    case 'area': drawAreaObj(ctx, obj); break;
    case 'stroke': drawStrokeObj(ctx, obj); break;
    case 'arrow': drawArrowObj(ctx, obj, false); break;
    case 'player': drawPlayerObj(ctx, obj); break;
    case 'text': drawTextObj(ctx, obj); break;
    case 'ball': drawBallObj(ctx, obj); break;
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

function drawAreaObj(ctx, obj) {
  const p1 = fromNorm(obj.x1, obj.y1);
  const p2 = fromNorm(obj.x2, obj.y2);
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);

  ctx.save();
  ctx.globalAlpha = 0.35; // 蜊企乗・
  ctx.fillStyle = obj.color;
  ctx.fillRect(x, y, w, h);

  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = obj.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  if (obj.id === selectedId) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawPlayerObj(ctx, obj) {
  const pos = fromNorm(obj.x, obj.y);
  let r = playerRadius();

  // 繝昴ャ繝励い繝九Γ繝ｼ繧ｷ繝ｧ繝ｳ
  const anim = popAnimMap[obj.id];
  if (anim) {
    const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
    // easeOutBack
    const c1 = 1.70158, c3 = c1 + 1;
    const scale = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    r *= Math.max(0.01, scale);
  }

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

  // Position Text
  if (showPositions && obj.position) {
    ctx.font = `bold ${Math.max(10, r * 0.55)}px 'Segoe UI',sans-serif`;
    ctx.shadowBlur = 2;
    ctx.fillText(obj.position, pos.x, pos.y + r + 13);
  }

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

function drawBallObj(ctx, obj) {
  const pos = fromNorm(obj.x, obj.y);
  let r = playerRadius() * 0.7; // size of ball

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // Draw Mikasa style ball
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffdf00'; // yellow base
  ctx.fill();

  ctx.save();
  ctx.clip(); // clip to circle
  ctx.lineWidth = r * 0.45;
  ctx.strokeStyle = '#0055ff'; // blue stripes

  ctx.beginPath();
  ctx.arc(pos.x - r, pos.y, r * 1.3, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pos.x + r, pos.y, r * 1.3, Math.PI - Math.PI / 3, Math.PI + Math.PI / 3);
  ctx.stroke();
  ctx.restore();

  // Border
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // Selection ring
  if (obj.id === selectedId) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  document.getElementById('add-ball-btn').addEventListener('click', () => {
    // 荳ｭ螟ｮ縺ｮ蟆代＠荳翫↓縺ｽ縺､繧薙→繝懊・繝ｫ繧定ｿｽ蜉
    const obj = { id: uid(), type: 'ball', x: 0.5, y: 0.5 };
    addObject(obj, true);
    currentTool = 'select';
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === 'select');
    });
    updateCursor();
  });

  // Display toggles
  document.getElementById('toggle-pos-btn').addEventListener('click', (e) => {
    showPositions = !showPositions;
    e.target.textContent = showPositions ? '捷・・Pos: 繧ｪ繝ｳ' : '捷・・Pos: 繧ｪ繝・;
    e.target.classList.toggle('active', showPositions);
    redraw();
  });

  document.getElementById('toggle-camera-btn').addEventListener('click', (e) => {
    cameraView = cameraView === 'top' ? 'tv' : 'top';
    e.target.textContent = cameraView === 'top' ? '磁 縺ｾ荳・ : '磁 TV隕也せ';
    e.target.classList.toggle('active', cameraView === 'tv');
    document.getElementById('canvas-container').classList.toggle('perspective-tv', cameraView === 'tv');
  });
}

function updateCursor() {
  const dc = drawCanvas;
  dc.classList.remove('cur-select', 'cur-eraser', 'cur-text', 'cur-player', 'cur-area');
  if (currentTool === 'select') dc.classList.add('cur-select');
  else if (currentTool === 'eraser') dc.classList.add('cur-eraser');
  else if (currentTool === 'text') dc.classList.add('cur-text');
  else if (currentTool === 'player') dc.classList.add('cur-player');
  else if (currentTool === 'area') dc.classList.add('cur-area'); // use crosshair in css
}

// =============================================
// VOLLEYBALL POSITION LAYOUT
// =============================================
// 蠎ｧ讓吶・courtBounds豁｣隕丞喧 (0,0)=繧ｳ繝ｼ繝亥ｷｦ荳・ (1,1)=繧ｳ繝ｼ繝亥承荳・
// 閾ｪ繝√・繝 x: 0.0縲・.5, 逶ｸ謇九メ繝ｼ繝 x: 0.5縲・.0
function getVolleyPositions(team) {
  const isOwn = team === 'own';
  // courtBounds縺ｫ萓晏ｭ倥○縺壹さ繝ｼ繝育嶌蟇ｾ蠎ｧ讓吶〒逶ｴ謗･螳夂ｾｩ
  // isOwn: rx * 0.5 縺ｧ蟾ｦ蜊雁・ (0縲・.5)
  // isOpp: 1 - rx * 0.5 縺ｧ繝溘Λ繝ｼ (0.5縲・.0)
  const toNx = (rx) => isOwn ? rx * 0.5 : 1 - rx * 0.5;
  const toNy = (ry) => ry;

  return [
    { number: 4, position: 'OH', nx: toNx(0.1), ny: toNy(0.18) }, // 繝輔Ο繝ｳ繝医Ξ繝輔ヨ
    { number: 3, position: 'MB', nx: toNx(0.5), ny: toNy(0.18) }, // 繝輔Ο繝ｳ繝医そ繝ｳ繧ｿ繝ｼ
    { number: 2, position: 'OP', nx: toNx(0.85), ny: toNy(0.18) }, // 繝輔Ο繝ｳ繝医Λ繧､繝・
    { number: 5, position: 'OH', nx: toNx(0.1), ny: toNy(0.82) }, // 繝舌ャ繧ｯ繝ｬ繝輔ヨ
    { number: 6, position: 'L', nx: toNx(0.5), ny: toNy(0.82) }, // 繝舌ャ繧ｯ繧ｻ繝ｳ繧ｿ繝ｼ(繝ｪ繝吶Ο)
    { number: 1, position: 'S', nx: toNx(0.85), ny: toNy(0.82) }, // 繝舌ャ繧ｯ繝ｩ繧､繝・
  ];
}

// 霑代￥縺ｫ驕ｸ謇九′縺・↑縺・°遒ｺ隱阪＠縲√°縺ｶ繧句ｴ蜷医・縺壹ｉ縺・
function findFreePosition(baseNx, baseNy, team) {
  const r = playerRadius();
  const cw = courtBounds.w || canvasW;
  const ch = courtBounds.h || canvasH;
  const minDistPx = r * 2.2; // 譛菴弱％縺ｮ霍晞屬縺ｯ髮｢縺・
  const minDistNx = minDistPx / cw;
  const minDistNy = minDistPx / ch;

  const maxTries = 8;
  const offsets = [
    [0, 0],
    [minDistNx, 0], [-minDistNx, 0],
    [0, minDistNy], [0, -minDistNy],
    [minDistNx, minDistNy], [-minDistNx, minDistNy],
    [minDistNx, -minDistNy],
  ];

  for (let t = 0; t < maxTries; t++) {
    const [dx, dy] = offsets[t];
    const cx = baseNx + dx, cy = baseNy + dy;
    const isColliding = objects.some(o => {
      if (o.type !== 'player') return false;
      const distX = (o.x - cx) * cw;
      const distY = (o.y - cy) * ch;
      return Math.sqrt(distX * distX + distY * distY) < minDistPx * 0.9;
    });
    if (!isColliding) return { nx: cx, ny: cy };
  }
  // 縺昴ｌ縺ｧ繧り｡晉ｪ√☆繧句ｴ蜷医・蟆代＠繝ｩ繝ｳ繝繝繧ｪ繝輔そ繝・ヨ
  return {
    nx: baseNx + (Math.random() - 0.5) * minDistNx * 2,
    ny: baseNy + (Math.random() - 0.5) * minDistNy * 2,
  };
}

function startPlacingPlayer(team) {
  // 譌｢蟄倥・驕ｸ謇狗分蜿ｷ繧堤｢ｺ隱・
  const existingNums = objects
    .filter(o => o.type === 'player' && o.team === team)
    .map(o => o.number);

  // 縺ｾ縺驟咲ｽｮ縺輔ｌ縺ｦ縺・↑縺・・繧ｸ繧ｷ繝ｧ繝ｳ繧貞叙蠕・
  const positions = getVolleyPositions(team);
  const missing = positions.filter(p => !existingNums.includes(p.number));

  if (missing.length === 0) {
    // 縺吶〒縺ｫ6莠ｺ蜈ｨ蜩｡縺・ｋ蝣ｴ蜷医・菴輔ｂ縺励↑縺・(縺ｾ縺溘・繝医・繧ｹ繝郁｡ｨ遉ｺ)
    showAutoPlaceToast(team, 0);
    return;
  }

  // 繧｢繝九Γ繝ｼ繧ｷ繝ｧ繝ｳ: 1莠ｺ縺壹▽髢馴囈繧堤ｽｮ縺・※繝昴Φ繝昴Φ縺ｨ霑ｽ蜉
  const delay = 120; // ms per player
  missing.forEach((pos, idx) => {
    setTimeout(() => {
      const free = findFreePosition(pos.nx, pos.ny, team);
      const obj = {
        id: uid(), type: 'player',
        x: free.nx, y: free.ny,
        number: pos.number,
        position: pos.position,
        team,
        popAnim: true,  // 繧｢繝九Γ繝ｼ繧ｷ繝ｧ繝ｳ繝輔Λ繧ｰ
      };
      addObject(obj, true);
      // 繝昴ャ繝励い繝九Γ繝ｼ繧ｷ繝ｧ繝ｳ
      animatePlayerPop(obj.id);
    }, idx * delay);
  });

  showAutoPlaceToast(team, missing.length);
}

// 繝昴ャ繝励い繝九Γ繝ｼ繧ｷ繝ｧ繝ｳ
let popAnimMap = {}; // id -> startTime
function animatePlayerPop(id) {
  popAnimMap[id] = { start: performance.now(), duration: 350 };
  requestPopRedraw();
}

let popRedrawScheduled = false;
function requestPopRedraw() {
  if (popRedrawScheduled) return;
  popRedrawScheduled = true;
  requestAnimationFrame(function loop() {
    const now = performance.now();
    let still = false;
    for (const id in popAnimMap) {
      const a = popAnimMap[id];
      if (now - a.start < a.duration) still = true;
      else delete popAnimMap[id];
    }
    redraw();
    if (still) requestAnimationFrame(loop);
    else popRedrawScheduled = false;
  });
}

function showAutoPlaceToast(team, count) {
  const label = team === 'own' ? '閾ｪ繝√・繝' : '逶ｸ謇九メ繝ｼ繝';
  const msg = count > 0
    ? `${label}: ${count}莠ｺ繧定・蜍暮・鄂ｮ縺励∪縺励◆`
    : `${label}: 縺吶〒縺ｫ蜈ｨ蜩｡驟咲ｽｮ貂医∩縺ｧ縺兪;
  // 邁｡譏薙ヨ繝ｼ繧ｹ繝・
  let el = document.getElementById('auto-place-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auto-place-toast';
    el.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(30,60,100,0.95);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:9999;pointer-events:none;transition:opacity 0.3s;border:1px solid rgba(100,180,255,0.4);';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2000);
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

  if (currentTool === 'area') {
    isPointerDown = true;
    areaStart = n;
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
      if (obj.type === 'area') {
        // For area, move both corners
        const wNorm = obj.x2 - obj.x1;
        const hNorm = obj.y2 - obj.y1;
        obj.x1 = dragObjOrigPos.x1 + dx;
        obj.y1 = dragObjOrigPos.y1 + dy;
        obj.x2 = obj.x1 + wNorm;
        obj.y2 = obj.y1 + hNorm;
      } else {
        obj.x = dragObjOrigPos.x + dx;
        obj.y = dragObjOrigPos.y + dy;
      }
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

  if (currentTool === 'area' && isPointerDown) {
    if (areaStart) {
      tempArea = { type: 'area', x1: areaStart.x, y1: areaStart.y, x2: n.x, y2: n.y, color: currentColor };
      redraw();
    }
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
      if (obj.type === 'area') {
        const prev = { ...dragObjOrigPos };
        pushUndo({ action: 'moveArea', id: obj.id, prevX1: prev.x1, prevY1: prev.y1, prevX2: prev.x2, prevY2: prev.y2, newX1: obj.x1, newY1: obj.y1, newX2: obj.x2, newY2: obj.y2 });
        redoStack = [];
        publishOp({ type: 'moveArea', id: obj.id, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 });
      } else {
        const prev = { ...dragObjOrigPos };
        pushUndo({ action: 'move', id: obj.id, prevX: prev.x, prevY: prev.y, newX: obj.x, newY: obj.y });
        redoStack = [];
        publishOp({ type: 'move', id: obj.id, x: obj.x, y: obj.y });
      }
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
    if (arrowStart && (arrowStart.x !== n.x || arrowStart.y !== n.y)) {
      const obj = { id: uid(), type: 'arrow', x1: arrowStart.x, y1: arrowStart.y, x2: n.x, y2: n.y, color: currentColor, width: currentSize };
      addObject(obj, true);
    }
    arrowStart = null;
    tempArrow = null;
    redraw();
    return;
  }

  if (currentTool === 'area' && isPointerDown) {
    isPointerDown = false;
    // ensure area has some size
    if (areaStart && Math.abs(areaStart.x - n.x) > 0.01 && Math.abs(areaStart.y - n.y) > 0.01) {
      const obj = { id: uid(), type: 'area', x1: areaStart.x, y1: areaStart.y, x2: n.x, y2: n.y, color: currentColor };
      addObject(obj, true);
    }
    areaStart = null;
    tempArea = null;
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
    if (o.type === 'player' || o.type === 'text' || o.type === 'ball') {
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
  // For areas: erase if clicked inside
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type !== 'area') continue;
    const p1 = fromNorm(o.x1, o.y1);
    const p2 = fromNorm(o.x2, o.y2);
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      const removed3 = objects.splice(i, 1)[0];
      pushUndo({ action: 'remove', obj: JSON.parse(JSON.stringify(removed3)) });
      redoStack = [];
      publishOp({ type: 'remove', id: removed3.id });
      break;
    }
  }
  redraw();
}

// =============================================
// OBJECT OPERATIONS
// =============================================
function addObject(obj, broadcast) {
  objects.push(obj);
  // obj 繧剃ｿ晏ｭ倥＠縺ｦ縺翫″縲ヽedo譎ゅ↓蠕ｩ蜈・〒縺阪ｋ繧医≧縺ｫ縺吶ｋ
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
  } else if (entry.action === 'moveArea') {
    const obj = objects.find(o => o.id === entry.id);
    if (obj) { obj.x1 = entry.prevX1; obj.y1 = entry.prevY1; obj.x2 = entry.prevX2; obj.y2 = entry.prevY2; }
    publishOp({ type: 'moveArea', id: entry.id, x1: entry.prevX1, y1: entry.prevY1, x2: entry.prevX2, y2: entry.prevY2 });
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
  } else if (entry.action === 'moveArea') {
    const obj = objects.find(o => o.id === entry.id);
    if (obj) { obj.x1 = entry.newX1; obj.y1 = entry.newY1; obj.x2 = entry.newX2; obj.y2 = entry.newY2; }
    publishOp({ type: 'moveArea', id: entry.id, x1: entry.newX1, y1: entry.newY1, x2: entry.newX2, y2: entry.newY2 });
  }
  redraw();
}

function confirmClear() {
  if (!objects.length) return;
  if (!window.confirm('繝懊・繝峨ｒ蜈ｨ豸亥悉縺励∪縺吶°・・)) return;
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
  btn.textContent = '笨・;
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
    console.warn('[VolleyBoard] Ably API繧ｭ繝ｼ縺梧悴險ｭ螳壹〒縺吶Ｂpp.js 縺ｮ ABLY_API_KEY 繧定ｨｭ螳壹＠縺ｦ縺上□縺輔＞縲・);
    setStatus('disconnected');
    document.getElementById('status-text').textContent = '繧ｪ繝輔Λ繧､繝ｳ(API繧ｭ繝ｼ譛ｪ險ｭ螳・';
    return;
  }

  ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myClientId });
  ably.connection.on('connected', () => {
    setStatus('connected');
    document.getElementById('status-text').textContent = '謗･邯壽ｸ医∩';
    joinChannel();
  });
  ably.connection.on('disconnected', () => {
    setStatus('disconnected');
    document.getElementById('status-text').textContent = '蛻・妙';
  });
  ably.connection.on('failed', () => {
    setStatus('disconnected');
    document.getElementById('status-text').textContent = '謗･邯壼､ｱ謨・;
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
        document.getElementById('user-count').textContent = '則 ' + connectedCount;
      }
    });
  });
}

function updateUserCount() {
  if (!channel) return;
  channel.presence.get((err, members) => {
    if (!err) {
      connectedCount = members.length;
      document.getElementById('user-count').textContent = '則 ' + connectedCount;
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
    case 'moveArea': {
      const obj = objects.find(o => o.id === op.id);
      if (obj) { obj.x1 = op.x1; obj.y1 = op.y1; obj.x2 = op.x2; obj.y2 = op.y2; }
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

