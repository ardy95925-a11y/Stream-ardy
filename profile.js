// ═══════════════════════════════════════════════════════════════
// PULSE2 — profile.js   Rich Profile Customisation System
//   · Animated profile banners (gradient, particles, waves, aurora)
//   · Profile effects (glow, holographic, glitch, sparkle)
//   · Custom badges & role tags
//   · Profile card preview (Discord-style user card)
//   · Avatar frame / border styles
//   · Profile accent themes per-user
//   · Activity / "now playing" status
//   · Profile completeness meter
// ═══════════════════════════════════════════════════════════════
import {
  state, db, showToast, escHtml,
  doc, getDoc, updateDoc, serverTimestamp,
  showModal, closeAllModals
} from "./app.js";

// ─── CONSTANTS ──────────────────────────────────────────────────

export const BANNER_PRESETS = [
  { id: 'none',        label: 'None',      preview: 'transparent' },
  { id: 'gradient1',   label: 'Ember',     preview: 'linear-gradient(135deg,#ff6b1a,#ff1a6b,#6b1aff)' },
  { id: 'gradient2',   label: 'Ocean',     preview: 'linear-gradient(135deg,#0099ff,#00e5ff,#00ff99)' },
  { id: 'gradient3',   label: 'Aurora',    preview: 'linear-gradient(135deg,#00ff88,#00b4d8,#9b59b6)' },
  { id: 'gradient4',   label: 'Midnight',  preview: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460,#e94560)' },
  { id: 'gradient5',   label: 'Gold',      preview: 'linear-gradient(135deg,#f7971e,#ffd200)' },
  { id: 'gradient6',   label: 'Sakura',    preview: 'linear-gradient(135deg,#ff9a9e,#fecfef,#ffecd2)' },
  { id: 'gradient7',   label: 'Void',      preview: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
  { id: 'particles',   label: 'Particles', preview: 'linear-gradient(135deg,#1a1a2e,#0f3460)', animated: true },
  { id: 'waves',       label: 'Waves',     preview: 'linear-gradient(135deg,#0099ff,#00e5ff)',  animated: true },
  { id: 'aurora_anim', label: 'Aurora ✦',  preview: 'linear-gradient(135deg,#00ff88,#00b4d8)',  animated: true },
  { id: 'glitch_anim', label: 'Glitch ✦',  preview: 'linear-gradient(135deg,#ff0080,#00ffff)',  animated: true },
];

export const AVATAR_FRAMES = [
  { id: 'none',        label: 'Default',   style: '' },
  { id: 'fire',        label: 'Fire 🔥',   style: 'fire-frame' },
  { id: 'ice',         label: 'Ice ❄️',    style: 'ice-frame' },
  { id: 'gold',        label: 'Gold ⭐',   style: 'gold-frame' },
  { id: 'rainbow',     label: 'Rainbow 🌈', style: 'rainbow-frame' },
  { id: 'neon',        label: 'Neon ⚡',   style: 'neon-frame' },
  { id: 'holographic', label: 'Holo 💎',   style: 'holo-frame' },
  { id: 'pulse_frame', label: 'Pulse 💫',  style: 'pulse-frame' },
];

export const PROFILE_EFFECTS = [
  { id: 'none',       label: 'None' },
  { id: 'sparkle',    label: '✦ Sparkle' },
  { id: 'glow',       label: '◉ Glow' },
  { id: 'confetti',   label: '🎊 Confetti' },
  { id: 'snow',       label: '❄ Snow' },
  { id: 'hearts',     label: '♥ Hearts' },
  { id: 'lightning',  label: '⚡ Lightning' },
];

export const BADGES = [
  { id: 'early',     icon: '🌟', label: 'Early Supporter',   desc: 'Joined during beta' },
  { id: 'verified',  icon: '✓',  label: 'Verified',          desc: 'Identity verified' },
  { id: 'dev',       icon: '⚙',  label: 'Developer',         desc: 'Uses the API' },
  { id: 'creative',  icon: '🎨', label: 'Creative',          desc: 'Profile fully customised' },
  { id: 'social',    icon: '💬', label: 'Chatty',            desc: 'Sent 1,000+ messages' },
  { id: 'og',        icon: '👑', label: 'OG',                desc: 'One of the first users' },
];

// ─── OPEN RICH PROFILE EDITOR ────────────────────────────────────

export function openRichProfile() {
  const uDoc = state.userDoc;
  if (!uDoc) return;

  // Remove old if exists
  let existing = document.getElementById('rich-profile-modal');
  if (existing) { existing.remove(); }

  const overlay = document.getElementById('modal-overlay');
  const modal   = document.createElement('div');
  modal.id        = 'rich-profile-modal';
  modal.className = 'modal rich-profile-modal';
  modal.innerHTML = buildRichProfileHTML(uDoc);

  overlay.appendChild(modal);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  initRichProfileLogic(modal, uDoc);
  livePreviewUpdate(modal, uDoc);
}

function buildRichProfileHTML(uDoc) {
  const prof = uDoc.profile || {};
  const bannerId = prof.bannerId || 'none';
  const frameId  = prof.frameId  || 'none';
  const effectId = prof.effectId || 'none';
  const accent   = prof.accentColor || uDoc.avatarColor || '#FF6B1A';
  const pronouns = prof.pronouns  || '';
  const activity = prof.activity  || '';

  const bannerOptionsHTML = BANNER_PRESETS.map(b => `
    <div class="banner-option${bannerId === b.id ? ' selected' : ''}" data-id="${b.id}"
         style="background:${b.preview};position:relative">
      ${b.animated ? '<span class="anim-badge">ANIM</span>' : ''}
      <span>${b.label}</span>
    </div>
  `).join('');

  const frameOptionsHTML = AVATAR_FRAMES.map(f => `
    <div class="frame-option${frameId === f.id ? ' selected' : ''}" data-id="${f.id}" data-style="${f.style}">
      <div class="frame-preview-mini ${f.style}" style="background:${uDoc.avatarColor || '#FF6B1A'}">
        ${(uDoc.displayName || '?').charAt(0).toUpperCase()}
      </div>
      <span>${f.label}</span>
    </div>
  `).join('');

  const effectOptionsHTML = PROFILE_EFFECTS.map(e => `
    <div class="effect-option${effectId === e.id ? ' selected' : ''}" data-id="${e.id}">
      ${e.label}
    </div>
  `).join('');

  const accentColors = ['#FF6B1A','#e74c3c','#9b59b6','#3498db','#2ecc71','#f39c12','#1abc9c','#e91e63','#00bcd4','#ff1493','#7fff00','#ff6347'];

  return `
    <div class="rp-layout">

      <!-- LEFT: Live Preview Card -->
      <div class="rp-preview-col">
        <div class="rp-section-label">PREVIEW</div>
        <div class="profile-card" id="rp-card">
          <canvas class="profile-card-banner" id="rp-banner-canvas"></canvas>
          <div class="profile-card-body">
            <div class="profile-card-avatar-wrap">
              <div class="profile-card-avatar ${AVATAR_FRAMES.find(f=>f.id===frameId)?.style||''}" id="rp-avatar"
                   style="background:${uDoc.avatarColor||'#FF6B1A'}">
                ${(uDoc.displayName||'?').charAt(0).toUpperCase()}
              </div>
              <div class="profile-card-status-dot" id="rp-status-dot"></div>
            </div>
            <div class="profile-card-effect" id="rp-effect"></div>
            <div class="profile-card-info">
              <div class="profile-card-name" id="rp-name">${escHtml(uDoc.displayName||'User')}</div>
              <div class="profile-card-handle">@${escHtml(uDoc.username||'')}</div>
              <div class="profile-card-pronouns" id="rp-pronouns">${escHtml(pronouns)}</div>
              <div class="profile-card-badges" id="rp-badges"></div>
              <div class="profile-card-activity" id="rp-activity" style="display:${activity?'flex':'none'}">
                <span class="activity-dot"></span>
                <span id="rp-activity-text">${escHtml(activity)}</span>
              </div>
              <div class="profile-card-bio" id="rp-bio">${escHtml(uDoc.bio||'No bio yet.')}</div>
              <div class="profile-card-accent-bar" id="rp-accent-bar" style="background:${accent}"></div>
            </div>
          </div>
        </div>
        <div class="rp-completeness">
          <div class="completeness-label">
            <span>Profile Complete</span>
            <span id="completeness-pct">0%</span>
          </div>
          <div class="completeness-bar">
            <div class="completeness-fill" id="completeness-fill"></div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Editor -->
      <div class="rp-editor-col">
        <div class="rp-editor-header">
          <h3>✦ Customise Profile</h3>
          <button class="modal-close" id="rp-close">✕</button>
        </div>

        <div class="rp-tabs">
          <button class="rp-tab active" data-tab="identity">Identity</button>
          <button class="rp-tab" data-tab="style">Style</button>
          <button class="rp-tab" data-tab="flair">Flair</button>
        </div>

        <!-- IDENTITY TAB -->
        <div class="rp-tab-content active" id="rp-tab-identity">
          <div class="input-group">
            <label>Display Name</label>
            <input type="text" id="rp-name-input" value="${escHtml(uDoc.displayName||'')}" maxlength="30" placeholder="Your name"/>
          </div>
          <div class="input-group">
            <label>Bio</label>
            <textarea id="rp-bio-input" maxlength="190" rows="3" placeholder="Tell the world about yourself...">${escHtml(uDoc.bio||'')}</textarea>
            <span class="char-hint" id="rp-bio-count">0 / 190</span>
          </div>
          <div class="input-group">
            <label>Pronouns</label>
            <input type="text" id="rp-pronouns-input" value="${escHtml(pronouns)}" maxlength="20" placeholder="e.g. they/them"/>
          </div>
          <div class="input-group">
            <label>Activity / Now Playing</label>
            <input type="text" id="rp-activity-input" value="${escHtml(activity)}" maxlength="60" placeholder="🎵 Listening to something..."/>
          </div>
          <div class="input-group">
            <label>Status</label>
            <div class="status-row" id="rp-status-picker">
              <button class="status-chip${(!uDoc.status||uDoc.status==='online')?' active':''}" data-status="online">🟢 Online</button>
              <button class="status-chip${uDoc.status==='idle'?' active':''}" data-status="idle">🌙 Idle</button>
              <button class="status-chip${uDoc.status==='dnd'?' active':''}" data-status="dnd">🔴 Busy</button>
              <button class="status-chip${uDoc.status==='invisible'?' active':''}" data-status="invisible">⚫ Invisible</button>
            </div>
          </div>
          <div class="input-group">
            <label>Avatar Color</label>
            <div class="color-picker-row" id="rp-avatar-color">
              ${accentColors.map(c=>`<div class="color-swatch${(uDoc.avatarColor===c)?' active':''}" data-color="${c}" style="background:${c}"></div>`).join('')}
            </div>
          </div>
        </div>

        <!-- STYLE TAB -->
        <div class="rp-tab-content" id="rp-tab-style">
          <div class="rp-section-label">PROFILE BANNER</div>
          <div class="banner-grid" id="banner-grid">
            ${bannerOptionsHTML}
          </div>
          <div class="rp-section-label" style="margin-top:16px">AVATAR FRAME</div>
          <div class="frame-grid" id="frame-grid">
            ${frameOptionsHTML}
          </div>
          <div class="rp-section-label" style="margin-top:16px">ACCENT COLOR</div>
          <div class="color-picker-row" id="rp-accent-color">
            ${accentColors.map(c=>`<div class="color-swatch${(accent===c)?' active':''}" data-color="${c}" style="background:${c}"></div>`).join('')}
          </div>
        </div>

        <!-- FLAIR TAB -->
        <div class="rp-tab-content" id="rp-tab-flair">
          <div class="rp-section-label">PROFILE EFFECT</div>
          <div class="effect-grid" id="effect-grid">
            ${effectOptionsHTML}
          </div>
          <div class="rp-section-label" style="margin-top:16px">BADGES</div>
          <div class="badges-grid" id="rp-badges-earned">
            ${BADGES.map(b=>`
              <div class="badge-card" title="${b.desc}">
                <span class="badge-icon">${b.icon}</span>
                <span class="badge-label">${b.label}</span>
              </div>
            `).join('')}
          </div>
          <div style="font-size:11px;color:var(--text-600);font-family:var(--font-mono);margin-top:8px">
            Badges are awarded automatically based on activity.
          </div>
        </div>

        <button class="btn-primary" id="rp-save-btn" style="margin-top:auto">Save Profile →</button>
      </div>
    </div>
  `;
}

// ─── LOGIC ───────────────────────────────────────────────────────

function initRichProfileLogic(modal, uDoc) {
  // Close button
  modal.querySelector('#rp-close').addEventListener('click', () => {
    stopBannerAnimation();
    modal.remove();
    const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
    if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');
  });

  // Tabs
  modal.querySelectorAll('.rp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.rp-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.rp-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`#rp-tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Live inputs
  modal.querySelector('#rp-name-input').addEventListener('input', e => {
    modal.querySelector('#rp-name').textContent = e.target.value || 'User';
    liveUpdateCompleteness(modal, uDoc);
  });

  modal.querySelector('#rp-bio-input').addEventListener('input', e => {
    modal.querySelector('#rp-bio').textContent = e.target.value || 'No bio yet.';
    const len = e.target.value.length;
    modal.querySelector('#rp-bio-count').textContent = `${len} / 190`;
    liveUpdateCompleteness(modal, uDoc);
  });
  modal.querySelector('#rp-bio-count').textContent = `${(uDoc.bio||'').length} / 190`;

  modal.querySelector('#rp-pronouns-input').addEventListener('input', e => {
    modal.querySelector('#rp-pronouns').textContent = e.target.value;
  });

  modal.querySelector('#rp-activity-input').addEventListener('input', e => {
    const act = modal.querySelector('#rp-activity');
    const txt = modal.querySelector('#rp-activity-text');
    txt.textContent = e.target.value;
    act.style.display = e.target.value ? 'flex' : 'none';
  });

  // Status chips
  modal.querySelectorAll('#rp-status-picker .status-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('#rp-status-picker .status-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateStatusDot(modal, btn.dataset.status);
    });
  });

  // Avatar color
  modal.querySelectorAll('#rp-avatar-color .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      modal.querySelectorAll('#rp-avatar-color .color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      modal.querySelector('#rp-avatar').style.background = sw.dataset.color;
      liveUpdateCompleteness(modal, uDoc);
    });
  });

  // Banner
  modal.querySelectorAll('#banner-grid .banner-option').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('#banner-grid .banner-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      playBanner(modal, opt.dataset.id);
      liveUpdateCompleteness(modal, uDoc);
    });
  });

  // Avatar frame
  modal.querySelectorAll('#frame-grid .frame-option').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('#frame-grid .frame-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const av = modal.querySelector('#rp-avatar');
      av.className = 'profile-card-avatar ' + (opt.dataset.style || '');
    });
  });

  // Accent color
  modal.querySelectorAll('#rp-accent-color .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      modal.querySelectorAll('#rp-accent-color .color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      modal.querySelector('#rp-accent-bar').style.background = sw.dataset.color;
    });
  });

  // Effects
  modal.querySelectorAll('#effect-grid .effect-option').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('#effect-grid .effect-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      playEffect(modal, opt.dataset.id);
    });
  });

  // Save
  modal.querySelector('#rp-save-btn').addEventListener('click', () => saveRichProfile(modal));

  // Initial state
  const initialBanner = (uDoc.profile?.bannerId) || 'none';
  playBanner(modal, initialBanner);

  const initialStatus = uDoc.status || 'online';
  updateStatusDot(modal, initialStatus);

  const initialEffect = (uDoc.profile?.effectId) || 'none';
  playEffect(modal, initialEffect);

  liveUpdateCompleteness(modal, uDoc);
  renderCardBadges(modal, uDoc);
}

// ─── LIVE COMPLETENESS ────────────────────────────────────────────

function liveUpdateCompleteness(modal, uDoc) {
  const checks = [
    () => (modal.querySelector('#rp-name-input')?.value || '').length >= 2,
    () => (modal.querySelector('#rp-bio-input')?.value || '').length >= 10,
    () => (modal.querySelector('#rp-pronouns-input')?.value || '').length > 0,
    () => (modal.querySelector('#rp-activity-input')?.value || '').length > 0,
    () => (modal.querySelector('#banner-grid .banner-option.selected')?.dataset.id || 'none') !== 'none',
    () => (modal.querySelector('#frame-grid .frame-option.selected')?.dataset.id || 'none') !== 'none',
    () => (modal.querySelector('#effect-grid .effect-option.selected')?.dataset.id || 'none') !== 'none',
  ];
  const score = checks.filter(c => c()).length;
  const pct   = Math.round((score / checks.length) * 100);

  const fill = modal.querySelector('#completeness-fill');
  const pctEl = modal.querySelector('#completeness-pct');
  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';

  // Unlock creative badge at 100%
  if (pct === 100 && fill) {
    fill.style.background = 'linear-gradient(90deg,#FF6B1A,#ff1493,#7fff00,#FF6B1A)';
    fill.style.backgroundSize = '200% 100%';
    fill.style.animation = 'completenessShine 2s linear infinite';
  }
}

// ─── STATUS DOT ───────────────────────────────────────────────────

function updateStatusDot(modal, status) {
  const dot = modal.querySelector('#rp-status-dot');
  if (!dot) return;
  const colors = { online: '#23d18b', idle: '#faa61a', dnd: '#f04747', invisible: '#747f8d', offline: '#747f8d' };
  dot.style.background = colors[status] || '#23d18b';
  if (status === 'dnd') {
    dot.style.background = '#f04747';
    dot.innerHTML = '<span class="dnd-dash">—</span>';
  } else {
    dot.innerHTML = '';
    dot.style.background = colors[status] || '#23d18b';
  }
}

// ─── BADGES ───────────────────────────────────────────────────────

function renderCardBadges(modal, uDoc) {
  const container = modal.querySelector('#rp-badges');
  if (!container) return;
  const earned = uDoc.badges || [];
  // Auto-grant early badge for all existing users
  const toShow = BADGES.filter(b => earned.includes(b.id) || b.id === 'early');
  container.innerHTML = toShow.map(b => `
    <div class="profile-badge" title="${b.label}: ${b.desc}">
      ${b.icon}
    </div>
  `).join('');
}

// ─── BANNER ANIMATION ENGINE ──────────────────────────────────────

let bannerAnimFrame = null;
let bannerParticles = [];

function stopBannerAnimation() {
  if (bannerAnimFrame) { cancelAnimationFrame(bannerAnimFrame); bannerAnimFrame = null; }
  bannerParticles = [];
}

function playBanner(modal, bannerId) {
  stopBannerAnimation();
  const canvas = modal.querySelector('#rp-banner-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = 340;
  canvas.height = 120;

  const preset = BANNER_PRESETS.find(b => b.id === bannerId);
  if (!preset) return;

  if (bannerId === 'none') {
    ctx.clearRect(0, 0, 340, 120);
    ctx.fillStyle = '#1c1c26';
    ctx.fillRect(0, 0, 340, 120);
    return;
  }

  if (bannerId === 'particles') {
    animateParticles(canvas, ctx);
  } else if (bannerId === 'waves') {
    animateWaves(canvas, ctx);
  } else if (bannerId === 'aurora_anim') {
    animateAurora(canvas, ctx);
  } else if (bannerId === 'glitch_anim') {
    animateGlitch(canvas, ctx);
  } else {
    // Static gradient
    const colors = extractGradientColors(preset.preview);
    const grad   = ctx.createLinearGradient(0, 0, 340, 120);
    colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 340, 120);
  }
}

function extractGradientColors(css) {
  const matches = css.match(/#[0-9a-f]{3,8}/gi) || ['#FF6B1A','#ff1a6b'];
  return matches;
}

function animateParticles(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  const pts = Array.from({length: 60}, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 0.5, a: Math.random()
  }));

  function draw(t) {
    ctx.fillStyle = '#0f1020';
    ctx.fillRect(0, 0, W, H);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,107,26,${0.3 + 0.5 * Math.abs(Math.sin(t * 0.002 + p.a))})`;
      ctx.fill();
    });
    // Connect nearby particles
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 40) {
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = `rgba(255,107,26,${0.12 * (1 - d / 40)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    bannerAnimFrame = requestAnimationFrame(draw);
  }
  bannerAnimFrame = requestAnimationFrame(draw);
}

function animateWaves(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  function draw(t) {
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W, H);
    for (let w = 0; w < 4; w++) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x++) {
        const y = H * 0.5 + Math.sin((x / W) * Math.PI * 3 + t * 0.001 + w * 0.8) * (20 + w * 10)
                           + Math.sin((x / W) * Math.PI * 6 + t * 0.0015 + w) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      const alpha = 0.15 + w * 0.08;
      ctx.fillStyle = `rgba(0,${153 + w * 20},${255 - w * 30},${alpha})`;
      ctx.fill();
    }
    bannerAnimFrame = requestAnimationFrame(draw);
  }
  bannerAnimFrame = requestAnimationFrame(draw);
}

function animateAurora(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  function draw(t) {
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);
    const auroras = [
      { hue: 160, speed: 0.0008 },
      { hue: 200, speed: 0.0012 },
      { hue: 280, speed: 0.0006 },
    ];
    auroras.forEach(({ hue, speed }) => {
      for (let y = 0; y < H; y++) {
        const wave = Math.sin(y * 0.04 + t * speed) * 30
                   + Math.sin(y * 0.02 + t * speed * 1.3) * 20;
        const alpha = Math.max(0, 0.06 - Math.abs(y - H * 0.4 + wave) / H * 0.2);
        ctx.fillStyle = `hsla(${hue},100%,60%,${alpha})`;
        ctx.fillRect(0, y, W, 1);
      }
    });
    bannerAnimFrame = requestAnimationFrame(draw);
  }
  bannerAnimFrame = requestAnimationFrame(draw);
}

function animateGlitch(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  let glitchTimer = 0;
  function draw(t) {
    // Base gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1a0030'); grad.addColorStop(1, '#000a1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Scan lines
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, y, W, 1);
    }

    // Glitch slices
    glitchTimer++;
    if (Math.random() < 0.04) {
      const slices = Math.floor(Math.random() * 4) + 1;
      for (let s = 0; s < slices; s++) {
        const y = Math.random() * H;
        const h = Math.random() * 8 + 2;
        const offset = (Math.random() - 0.5) * 30;
        const imageData = ctx.getImageData(0, y, W, h);
        ctx.putImageData(imageData, offset, y);
        ctx.fillStyle = `rgba(${Math.random()<0.5?255:0},${Math.random()<0.5?0:255},${Math.random()<0.5?255:0},0.3)`;
        ctx.fillRect(0, y, W, h);
      }
    }

    // Neon glow lines
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(0,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.4 + Math.sin(t * 0.003) * 15);
    ctx.bezierCurveTo(W*0.3, H*0.35, W*0.7, H*0.5, W, H*0.4 + Math.cos(t*0.003)*15);
    ctx.stroke();
    ctx.shadowBlur = 0;

    bannerAnimFrame = requestAnimationFrame(draw);
  }
  bannerAnimFrame = requestAnimationFrame(draw);
}

// ─── PROFILE EFFECTS ─────────────────────────────────────────────

let effectIntervals = [];

function stopAllEffects(modal) {
  effectIntervals.forEach(id => clearInterval(id));
  effectIntervals = [];
  const el = modal?.querySelector('#rp-effect');
  if (el) el.innerHTML = '';
}

function playEffect(modal, effectId) {
  stopAllEffects(modal);
  const container = modal?.querySelector('#rp-effect');
  if (!container || effectId === 'none') return;

  const configs = {
    sparkle:   { char: '✦', count: 8, colors: ['#fff','#FF6B1A','#ffd700','#00ffff'] },
    glow:      { char: '◉', count: 4, colors: ['#FF6B1A','#ff1493'] },
    confetti:  { char: '●', count: 12, colors: ['#FF6B1A','#ff1493','#00ffff','#ffd700','#7fff00'] },
    snow:      { char: '❄', count: 10, colors: ['#fff','#b0e0ff','#e0f0ff'] },
    hearts:    { char: '♥', count: 7,  colors: ['#ff1493','#ff69b4','#ff6b6b'] },
    lightning: { char: '⚡', count: 5,  colors: ['#ffd700','#fff','#FF6B1A'] },
  };

  const cfg = configs[effectId];
  if (!cfg) return;

  function spawnParticle() {
    const span = document.createElement('span');
    span.className = 'effect-particle';
    span.textContent = cfg.char;
    span.style.cssText = `
      position: absolute;
      color: ${cfg.colors[Math.floor(Math.random() * cfg.colors.length)]};
      font-size: ${8 + Math.random() * 10}px;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      opacity: 0;
      pointer-events: none;
      animation: effectFloat ${1.5 + Math.random() * 2}s ease-out forwards;
      animation-delay: ${Math.random() * 0.5}s;
    `;
    container.appendChild(span);
    setTimeout(() => span.remove(), 4000);
  }

  for (let i = 0; i < cfg.count; i++) spawnParticle();
  const id = setInterval(() => {
    for (let i = 0; i < 2; i++) spawnParticle();
  }, 800);
  effectIntervals.push(id);
}

// ─── LIVE PREVIEW ─────────────────────────────────────────────────

function livePreviewUpdate(modal, uDoc) {
  // Initial completeness
  liveUpdateCompleteness(modal, uDoc);
}

// ─── SAVE ─────────────────────────────────────────────────────────

async function saveRichProfile(modal) {
  const name      = modal.querySelector('#rp-name-input')?.value.trim();
  const bio       = modal.querySelector('#rp-bio-input')?.value.trim() || '';
  const pronouns  = modal.querySelector('#rp-pronouns-input')?.value.trim() || '';
  const activity  = modal.querySelector('#rp-activity-input')?.value.trim() || '';
  const status    = modal.querySelector('#rp-status-picker .status-chip.active')?.dataset.status || 'online';
  const avatarColor = modal.querySelector('#rp-avatar-color .color-swatch.active')?.dataset.color || state.userDoc?.avatarColor || '#FF6B1A';
  const bannerId  = modal.querySelector('#banner-grid .banner-option.selected')?.dataset.id || 'none';
  const frameId   = modal.querySelector('#frame-grid .frame-option.selected')?.dataset.id   || 'none';
  const effectId  = modal.querySelector('#effect-grid .effect-option.selected')?.dataset.id || 'none';
  const accentColor = modal.querySelector('#rp-accent-color .color-swatch.active')?.dataset.color || '#FF6B1A';

  if (!name || name.length < 1) { showToast('Display name cannot be empty.', 'error'); return; }

  const btn = modal.querySelector('#rp-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  // Calculate completeness for badge
  const pct = parseInt(modal.querySelector('#completeness-pct')?.textContent) || 0;
  const badgesArr = [...(state.userDoc?.badges || [])];
  if (!badgesArr.includes('early')) badgesArr.push('early');
  if (pct === 100 && !badgesArr.includes('creative')) badgesArr.push('creative');

  try {
    await updateDoc(doc(db, 'users', state.user.uid), {
      displayName:  name,
      bio,
      status,
      avatarColor,
      badges:       badgesArr,
      lastSeen:     serverTimestamp(),
      profile: {
        pronouns, activity, bannerId, frameId, effectId, accentColor
      }
    });

    // Update local state
    state.userDoc = {
      ...state.userDoc,
      displayName: name, bio, status, avatarColor, badges: badgesArr,
      profile: { pronouns, activity, bannerId, frameId, effectId, accentColor }
    };

    // Update sidebar UI
    ['sidebar-avatar', 'rail-avatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = name.charAt(0).toUpperCase(); el.style.background = avatarColor; }
    });
    const unEl = document.getElementById('sidebar-username');
    if (unEl) unEl.textContent = name;

    stopBannerAnimation();
    stopAllEffects(modal);
    modal.remove();
    const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
    if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');

    showToast('✦ Profile saved!', 'success');
  } catch (err) {
    showToast('Failed to save profile.', 'error');
    console.error(err);
    btn.disabled = false; btn.textContent = 'Save Profile →';
  }
}

// ─── RICH USER POPUP (shown when clicking someone's name) ─────────

export function buildRichUserCard(user) {
  const prof       = user.profile || {};
  const bannerId   = prof.bannerId   || 'none';
  const frameId    = prof.frameId    || 'none';
  const effectId   = prof.effectId   || 'none';
  const accentColor = prof.accentColor || user.avatarColor || '#FF6B1A';
  const frameStyle = AVATAR_FRAMES.find(f => f.id === frameId)?.style || '';

  const modal = document.createElement('div');
  modal.id        = 'rich-user-card';
  modal.className = 'modal rich-user-card';

  const statusColors = { online:'#23d18b', idle:'#faa61a', dnd:'#f04747', invisible:'#747f8d', offline:'#747f8d' };
  const statusColor  = statusColors[user.status] || '#747f8d';
  const statusLabel  = { online:'Online', idle:'Idle', dnd:'Do Not Disturb', invisible:'Invisible', offline:'Offline' }[user.status] || 'Offline';

  const badgesHTML = (user.badges || ['early']).map(id => {
    const b = BADGES.find(x => x.id === id);
    return b ? `<div class="profile-badge" title="${b.label}">${b.icon}</div>` : '';
  }).join('');

  modal.innerHTML = `
    <button class="modal-close card-close" id="card-close-btn" style="position:absolute;top:10px;right:10px;z-index:5">✕</button>
    <canvas class="uc-banner" id="uc-banner-canvas" width="380" height="110"></canvas>
    <div class="uc-body">
      <div class="uc-avatar-wrap">
        <div class="user-avatar uc-avatar ${frameStyle}"
             style="width:72px;height:72px;font-size:28px;background:${user.avatarColor||'#FF6B1A'}">
          ${(user.displayName||'?').charAt(0).toUpperCase()}
        </div>
        <div class="uc-status-dot" style="background:${statusColor}"></div>
        <div class="uc-effect" id="uc-effect"></div>
      </div>
      <div class="uc-info">
        <div class="uc-name-row">
          <span class="uc-name">${escHtml(user.displayName||'Unknown')}</span>
          ${prof.pronouns ? `<span class="uc-pronouns">${escHtml(prof.pronouns)}</span>` : ''}
        </div>
        <div class="uc-handle">@${escHtml(user.username||'')}</div>
        <div class="uc-status-row"><span style="color:${statusColor}">●</span> ${statusLabel}</div>
        ${prof.activity ? `
          <div class="uc-activity">
            <span class="activity-dot" style="background:${accentColor}"></span>
            ${escHtml(prof.activity)}
          </div>` : ''}
        ${(user.badges||['early']).length ? `<div class="uc-badges">${badgesHTML}</div>` : ''}
        <div class="uc-bio">${escHtml(user.bio||'No bio set.')}</div>
        <div class="uc-accent-bar" style="background:${accentColor}"></div>
        <button class="btn-primary uc-dm-btn" id="uc-dm-btn" data-uid="${user.uid||''}"
                style="display:${user.uid===state.user?.uid?'none':'block'}">
          💬 Send Message
        </button>
      </div>
    </div>
  `;

  const overlay = document.getElementById('modal-overlay');
  // Remove old card
  document.getElementById('rich-user-card')?.remove();
  overlay.appendChild(modal);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  // Banner
  const canvas = modal.querySelector('#uc-banner-canvas');
  const ctx    = canvas.getContext('2d');
  renderStaticBanner(canvas, ctx, bannerId, user.avatarColor || '#FF6B1A');

  // Effect
  playEffectOnEl(modal.querySelector('#uc-effect'), effectId);

  // Close
  modal.querySelector('#card-close-btn').addEventListener('click', () => {
    stopAllEffects(modal);
    stopBannerAnimation();
    modal.remove();
    const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
    if (!anyOpen) overlay.classList.add('hidden');
  });

  // DM button
  modal.querySelector('#uc-dm-btn')?.addEventListener('click', async () => {
    const uid = modal.querySelector('#uc-dm-btn').dataset.uid;
    if (!uid) return;
    stopAllEffects(modal);
    modal.remove();
    overlay.classList.add('hidden');
    const { openOrCreateDM } = await import('./app.js');
    const uSnap = await import('./app.js').then(m => m.getDoc(m.doc(m.db, 'users', uid)));
    if (uSnap.exists()) openOrCreateDM(uid, uSnap.data());
  });
}

// Render a single frame of a banner (for user cards where we don't want full animation)
function renderStaticBanner(canvas, ctx, bannerId, fallbackColor) {
  const W = canvas.width, H = canvas.height;
  const preset = BANNER_PRESETS.find(b => b.id === bannerId);

  if (!preset || bannerId === 'none') {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, adjustBrightness(fallbackColor, -60));
    grad.addColorStop(1, adjustBrightness(fallbackColor, -100));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    return;
  }

  if (preset.animated) {
    // Draw one frame of the animated banner
    if (bannerId === 'particles') {
      ctx.fillStyle = '#0f1020'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        ctx.arc(Math.random()*W, Math.random()*H, Math.random()*1.5+0.5, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,107,26,${Math.random()*0.5+0.2})`;
        ctx.fill();
      }
    } else if (bannerId === 'waves') {
      ctx.fillStyle = '#0a1628'; ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, 'rgba(0,153,255,0.6)'); grad.addColorStop(1, 'rgba(0,229,255,0.3)');
      ctx.fillStyle = grad; ctx.fillRect(0, H*0.4, W, H*0.6);
    } else {
      const colors = extractGradientColors(preset.preview);
      const grad = ctx.createLinearGradient(0, 0, W, H);
      colors.forEach((c, i) => grad.addColorStop(i/(colors.length-1), c));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
  } else {
    const colors = extractGradientColors(preset.preview);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    colors.forEach((c, i) => grad.addColorStop(i/(colors.length-1), c));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }
}

function playEffectOnEl(container, effectId) {
  if (!container || effectId === 'none') return;
  const configs = {
    sparkle:   { char: '✦', count: 6,  colors: ['#fff','#FF6B1A','#ffd700'] },
    glow:      { char: '◉', count: 3,  colors: ['#FF6B1A'] },
    confetti:  { char: '●', count: 10, colors: ['#FF6B1A','#ff1493','#00ffff','#ffd700'] },
    snow:      { char: '❄', count: 8,  colors: ['#fff','#b0e0ff'] },
    hearts:    { char: '♥', count: 5,  colors: ['#ff1493','#ff69b4'] },
    lightning: { char: '⚡', count: 4,  colors: ['#ffd700','#fff'] },
  };
  const cfg = configs[effectId]; if (!cfg) return;

  function spawn() {
    const s = document.createElement('span');
    s.className = 'effect-particle';
    s.textContent = cfg.char;
    s.style.cssText = `
      position:absolute; pointer-events:none; z-index:10;
      color:${cfg.colors[Math.floor(Math.random()*cfg.colors.length)]};
      font-size:${8+Math.random()*8}px;
      left:${Math.random()*100}%;
      top:${Math.random()*100}%;
      opacity:0;
      animation:effectFloat ${1.5+Math.random()*1.5}s ease-out forwards;
    `;
    container.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }

  for (let i = 0; i < cfg.count; i++) spawn();
  const id = setInterval(() => spawn(), 700);
  effectIntervals.push(id);
}

// ─── HELPER ───────────────────────────────────────────────────────

function adjustBrightness(hex, amount) {
  try {
    const num = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
    const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  } catch { return '#1a1a2e'; }
}

// ─── CSS ──────────────────────────────────────────────────────────

export function injectProfileStyles() {
  if (document.getElementById('profile-styles')) return;
  const style = document.createElement('style');
  style.id = 'profile-styles';
  style.textContent = `

  /* ── Rich Profile Modal Layout ── */
  .rich-profile-modal {
    max-width: 800px !important;
    width: 96vw !important;
    padding: 0 !important;
    overflow: hidden !important;
    gap: 0 !important;
  }
  .rp-layout {
    display: flex;
    height: 600px;
    max-height: 90vh;
  }

  /* ── Preview Column ── */
  .rp-preview-col {
    width: 300px;
    flex-shrink: 0;
    background: var(--bg-900);
    border-right: 1px solid var(--border);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .rp-section-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-600);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  /* ── Profile Card ── */
  .profile-card {
    background: var(--bg-800);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
    position: relative;
  }
  .profile-card-banner {
    width: 100%;
    height: 100px;
    object-fit: cover;
    display: block;
  }
  .profile-card-body {
    padding: 0 16px 16px;
    position: relative;
  }
  .profile-card-avatar-wrap {
    position: relative;
    display: inline-block;
    margin-top: -28px;
    margin-bottom: 8px;
  }
  .profile-card-avatar {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    color: #fff;
    border: 3px solid var(--bg-800);
    position: relative;
    z-index: 2;
  }
  .profile-card-status-dot {
    position: absolute;
    bottom: 1px; right: -2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    border: 2.5px solid var(--bg-800);
    background: #23d18b;
    z-index: 3;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; color: #fff; font-weight: 900;
  }
  .dnd-dash { font-size: 9px; font-weight: 900; color: #fff; }
  .profile-card-effect {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
    border-radius: 16px;
  }
  .profile-card-name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 17px;
    color: var(--text-100);
    letter-spacing: -0.3px;
  }
  .profile-card-handle {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-600);
    margin-bottom: 4px;
  }
  .profile-card-pronouns {
    font-size: 11px;
    color: var(--text-400);
    font-family: var(--font-mono);
    margin-bottom: 6px;
    font-style: italic;
  }
  .profile-card-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .profile-badge {
    width: 26px; height: 26px;
    background: var(--bg-600);
    border: 1px solid var(--border);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px;
    cursor: help;
    transition: transform 0.15s var(--spring);
  }
  .profile-badge:hover { transform: scale(1.2); }
  .profile-card-activity {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--bg-700);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-400);
    font-family: var(--font-mono);
    margin-bottom: 6px;
    border: 1px solid var(--border);
  }
  .activity-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--orange);
    animation: activityPulse 2s ease infinite;
    flex-shrink: 0;
  }
  @keyframes activityPulse {
    0%,100% { opacity:1; transform:scale(1); }
    50%      { opacity:0.5; transform:scale(0.8); }
  }
  .profile-card-bio {
    font-size: 12px;
    color: var(--text-400);
    line-height: 1.5;
    margin: 6px 0;
    padding: 8px 10px;
    background: var(--bg-700);
    border-radius: 8px;
    border: 1px solid var(--border);
    min-height: 36px;
  }
  .profile-card-accent-bar {
    height: 3px;
    border-radius: 2px;
    margin-top: 10px;
    background: var(--orange);
    transition: background 0.3s;
  }

  /* ── Editor Column ── */
  .rp-editor-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .rp-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 0;
  }
  .rp-editor-header h3 {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 18px;
    color: var(--text-100);
  }
  .rp-tabs {
    display: flex;
    gap: 2px;
    padding: 14px 24px 0;
    border-bottom: 1px solid var(--border);
  }
  .rp-tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-400);
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: var(--t);
    margin-bottom: -1px;
  }
  .rp-tab:hover { color: var(--text-100); }
  .rp-tab.active { color: var(--orange); border-bottom-color: var(--orange); }

  .rp-tab-content {
    display: none;
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    flex-direction: column;
    gap: 14px;
  }
  .rp-tab-content.active { display: flex; }

  /* ── Banner Grid ── */
  .banner-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .banner-option {
    height: 50px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    padding: 4px 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: rgba(255,255,255,0.8);
    transition: var(--t) var(--spring);
    position: relative;
    overflow: hidden;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }
  .banner-option:hover { transform: scale(1.04); border-color: rgba(255,255,255,0.3); }
  .banner-option.selected { border-color: #fff; box-shadow: 0 0 0 2px var(--orange); }
  .anim-badge {
    position: absolute; top: 4px; right: 4px;
    background: var(--orange); color: #fff;
    font-size: 8px; padding: 1px 4px; border-radius: 3px;
    font-family: var(--font-mono); font-weight: 700;
  }

  /* ── Frame Grid ── */
  .frame-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .frame-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 6px;
    background: var(--bg-700);
    border: 2px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-400);
    transition: var(--t);
    text-align: center;
  }
  .frame-option:hover { border-color: var(--border-h); color: var(--text-100); }
  .frame-option.selected { border-color: var(--orange); background: var(--orange-dim); color: var(--orange); }

  .frame-preview-mini {
    width: 34px; height: 34px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-weight: 800; font-size: 14px; color: #fff;
  }

  /* ── Avatar Frames ── */
  .fire-frame  { box-shadow: 0 0 0 3px #ff6b1a, 0 0 14px #ff6b1a, 0 0 30px rgba(255,107,26,0.4) !important; animation: fireFlicker 1.5s ease infinite !important; }
  .ice-frame   { box-shadow: 0 0 0 3px #00e5ff, 0 0 14px #00e5ff, 0 0 30px rgba(0,229,255,0.3) !important; }
  .gold-frame  { box-shadow: 0 0 0 3px #ffd700, 0 0 14px #ffd700, 0 0 30px rgba(255,215,0,0.4) !important; animation: goldShine 3s ease infinite !important; }
  .rainbow-frame { animation: rainbowBorder 3s linear infinite !important; }
  .neon-frame  { box-shadow: 0 0 0 2px #39ff14, 0 0 20px #39ff14, 0 0 40px rgba(57,255,20,0.3) !important; }
  .holo-frame  { animation: holoBorder 4s linear infinite !important; }
  .pulse-frame { animation: pulseBorder 2s ease infinite !important; }

  @keyframes fireFlicker {
    0%,100% { box-shadow: 0 0 0 3px #ff6b1a, 0 0 14px #ff6b1a, 0 0 30px rgba(255,107,26,0.4); }
    50%      { box-shadow: 0 0 0 3px #ff2200, 0 0 20px #ff4400, 0 0 40px rgba(255,68,0,0.6); }
  }
  @keyframes goldShine {
    0%,100% { box-shadow: 0 0 0 3px #ffd700, 0 0 14px #ffd700; filter: brightness(1); }
    50%      { box-shadow: 0 0 0 3px #fff176, 0 0 22px #fff176; filter: brightness(1.2); }
  }
  @keyframes rainbowBorder {
    0%   { box-shadow: 0 0 0 3px #ff0000, 0 0 16px #ff0000; }
    17%  { box-shadow: 0 0 0 3px #ff8800, 0 0 16px #ff8800; }
    33%  { box-shadow: 0 0 0 3px #ffff00, 0 0 16px #ffff00; }
    50%  { box-shadow: 0 0 0 3px #00ff00, 0 0 16px #00ff00; }
    67%  { box-shadow: 0 0 0 3px #0088ff, 0 0 16px #0088ff; }
    83%  { box-shadow: 0 0 0 3px #8800ff, 0 0 16px #8800ff; }
    100% { box-shadow: 0 0 0 3px #ff0000, 0 0 16px #ff0000; }
  }
  @keyframes holoBorder {
    0%   { box-shadow: 0 0 0 3px rgba(255,107,26,0.9), 0 0 20px rgba(255,107,26,0.5); filter: hue-rotate(0deg); }
    100% { box-shadow: 0 0 0 3px rgba(255,107,26,0.9), 0 0 20px rgba(255,107,26,0.5); filter: hue-rotate(360deg); }
  }
  @keyframes pulseBorder {
    0%,100% { box-shadow: 0 0 0 2px var(--orange), 0 0 8px var(--orange); }
    50%      { box-shadow: 0 0 0 5px var(--orange), 0 0 20px var(--orange), 0 0 40px rgba(255,107,26,0.3); }
  }

  /* ── Effect Grid ── */
  .effect-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .effect-option {
    padding: 8px 14px;
    background: var(--bg-700);
    border: 2px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-400);
    cursor: pointer;
    transition: var(--t);
  }
  .effect-option:hover { border-color: var(--border-h); color: var(--text-100); }
  .effect-option.selected { border-color: var(--orange); background: var(--orange-dim); color: var(--orange); }

  /* ── Badges Grid ── */
  .badges-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .badge-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-700);
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    color: var(--text-200);
    cursor: help;
    transition: var(--t);
  }
  .badge-card:hover { border-color: var(--orange); background: var(--orange-dim); }
  .badge-icon { font-size: 14px; }
  .badge-label { font-family: var(--font-mono); font-size: 11px; }

  /* ── Completeness ── */
  .rp-completeness { margin-top: auto; }
  .completeness-label {
    display: flex; justify-content: space-between;
    font-size: 11px; font-family: var(--font-mono);
    color: var(--text-600); margin-bottom: 5px;
  }
  #completeness-pct { color: var(--orange); font-weight: 700; }
  .completeness-bar {
    height: 5px;
    background: var(--bg-500);
    border-radius: 3px;
    overflow: hidden;
  }
  .completeness-fill {
    height: 100%;
    background: var(--orange);
    border-radius: 3px;
    transition: width 0.4s var(--ease);
  }
  @keyframes completenessShine {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Effect Particles ── */
  .effect-particle {
    position: absolute;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 0 8px currentColor;
  }
  @keyframes effectFloat {
    0%   { opacity:0; transform: translate(0, 0) scale(0.5) rotate(0deg); }
    20%  { opacity:1; }
    100% { opacity:0; transform: translate(${(Math.random()-0.5)*60|0}px, -40px) scale(1.2) rotate(${Math.random()*360|0}deg); }
  }
  /* Static version for consistent keyframe */
  @keyframes effectFloat {
    0%   { opacity:0; transform: translateY(0) scale(0.5); }
    20%  { opacity:1; }
    100% { opacity:0; transform: translateY(-35px) scale(1.1); }
  }

  /* ── Rich User Card Modal ── */
  .rich-user-card {
    padding: 0 !important;
    overflow: hidden !important;
    max-width: 340px !important;
    gap: 0 !important;
  }
  .uc-banner {
    width: 100%;
    height: 100px;
    display: block;
  }
  .uc-body {
    padding: 0 18px 20px;
  }
  .uc-avatar-wrap {
    position: relative;
    display: inline-block;
    margin-top: -36px;
    margin-bottom: 10px;
  }
  .uc-avatar {
    border: 4px solid var(--bg-800) !important;
    border-radius: 18px !important;
    position: relative;
    z-index: 2;
  }
  .uc-status-dot {
    position: absolute;
    bottom: 0; right: -4px;
    width: 16px; height: 16px;
    border-radius: 50%;
    border: 3px solid var(--bg-800);
    z-index: 3;
  }
  .uc-effect {
    position: absolute;
    inset: -20px;
    pointer-events: none;
    overflow: visible;
    z-index: 5;
  }
  .uc-info { display: flex; flex-direction: column; gap: 4px; }
  .uc-name-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .uc-name {
    font-family: var(--font-display);
    font-weight: 800; font-size: 20px; color: var(--text-100);
  }
  .uc-pronouns {
    font-size: 11px; font-family: var(--font-mono);
    color: var(--text-600); font-style: italic;
  }
  .uc-handle {
    font-family: var(--font-mono); font-size: 12px;
    color: var(--text-600);
  }
  .uc-status-row {
    font-size: 12px; font-family: var(--font-mono);
    color: var(--text-400); display: flex; align-items: center; gap: 4px;
    margin-bottom: 2px;
  }
  .uc-activity {
    display: flex; align-items: center; gap: 7px;
    padding: 5px 9px;
    background: var(--bg-700);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px; font-family: var(--font-mono);
    color: var(--text-400);
    margin: 4px 0;
  }
  .uc-badges {
    display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0;
  }
  .uc-bio {
    font-size: 12.5px; color: var(--text-400);
    line-height: 1.5; padding: 8px 10px;
    background: var(--bg-700);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 6px 0;
    min-height: 38px;
  }
  .uc-accent-bar {
    height: 3px; border-radius: 2px;
    background: var(--orange); margin-bottom: 12px;
    transition: background 0.3s;
  }
  .uc-dm-btn { width: 100%; }

  /* ── Char hint ── */
  .char-hint {
    font-size: 10px; font-family: var(--font-mono);
    color: var(--text-600); align-self: flex-end;
    margin-top: -8px;
  }

  /* ── Responsive ── */
  @media (max-width: 680px) {
    .rp-layout { flex-direction: column; height: auto; max-height: 95vh; }
    .rp-preview-col { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
    .banner-grid { grid-template-columns: repeat(2, 1fr); }
    .frame-grid  { grid-template-columns: repeat(3, 1fr); }
  }
  `;
  document.head.appendChild(style);
}
