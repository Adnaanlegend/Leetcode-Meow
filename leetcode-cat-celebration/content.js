/*
 * LeetCode Cat Celebration - content script (isolated world).
 *
 * Triggers:
 *   1. "lc-cat:accepted" events from page-hook.js (submission / run check
 *      responses with status_code 10).
 *   2. A DOM fallback MutationObserver that looks for a green "Accepted"
 *      label on problem pages, in case the API hook misses something.
 *
 * On trigger: a cat pops up from the bottom of the screen with confetti
 * poppers, sparkler bursts and a synthesized meow, then disappears.
 */
(() => {
  'use strict';

  const COOLDOWN_MS = 12000; // min gap between celebrations
  const CELEBRATION_MS = 4300; // total show length

  let settings = { enabled: true, sound: true };
  let lastCelebration = 0;
  const celebrated = new Set();

  // ---------------------------------------------------------------- settings
  try {
    chrome.storage.sync.get({ enabled: true, sound: true }, (s) => {
      if (s) settings = Object.assign(settings, s);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.enabled) settings.enabled = changes.enabled.newValue;
      if (changes.sound) settings.sound = changes.sound.newValue;
    });
  } catch (_) {
    /* storage unavailable: run with defaults */
  }

  // ------------------------------------------------------------------- sound
  let audioCtx = null;
  let pendingSound = null;

  function ensureAudio() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
        if (audioCtx.state !== 'running') {
          // Browsers gate audio behind a user gesture; play once we get one.
          const unlock = () => {
            audioCtx.resume().then(() => {
              if (pendingSound) {
                const fn = pendingSound;
                pendingSound = null;
                fn();
              }
            }).catch(() => {});
          };
          window.addEventListener('pointerdown', unlock, { once: true });
          window.addEventListener('keydown', unlock, { once: true });
        }
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function safePlay(fn) {
    if (!settings.sound) return;
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'running') {
      try {
        fn(ctx);
      } catch (_) {
        /* ignore */
      }
    } else {
      pendingSound = () => {
        const c = ensureAudio();
        if (c) {
          try {
            fn(c);
          } catch (_) {
            /* ignore */
          }
        }
      };
    }
  }

  // Warm the audio context up on the first interaction.
  ['pointerdown', 'keydown'].forEach((type) =>
    window.addEventListener(
      type,
      () => {
        if (settings.sound) ensureAudio();
      },
      { once: true, passive: true }
    )
  );

  function playMeow(ctx, when, baseHz, dur) {
    const t = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;

    // Pitch contour: rise, hold, fall - the classic meow shape.
    osc.frequency.setValueAtTime(baseHz * 0.72, t);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 1.25, t + dur * 0.22);
    osc.frequency.setValueAtTime(baseHz * 1.22, t + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.5, t + dur);

    // Sweep a resonant filter like a vocal formant.
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.25);
    filter.frequency.exponentialRampToValueAtTime(800, t + dur);

    // Slight vibrato.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(5.5, t);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = baseHz * 0.035;
    lfo.connect(lfoGain).connect(osc.frequency);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.12);
    gain.gain.setValueAtTime(0.2, t + dur * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  function playMeowSequence(ctx) {
    playMeow(ctx, ctx.currentTime + 0.02, 660, 0.62);
    playMeow(ctx, ctx.currentTime + 1.55, 760, 0.5);
  }

  function playPop(ctx, when) {
    const t = Math.max(when, ctx.currentTime);
    const dur = 0.16;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2800, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(t);
  }

  // ---------------------------------------------------------------- triggers
  window.addEventListener('lc-cat:accepted', (ev) => {
    const detail = (ev && ev.detail) || {};
    trigger(detail.submissionId ? 'sub:' + detail.submissionId : 'api:' + Date.now());
  });

  function trigger(key) {
    if (!settings.enabled) return;
    const now = Date.now();
    if (celebrated.has(key)) return;
    if (now - lastCelebration < COOLDOWN_MS) return;
    celebrated.add(key);
    if (celebrated.size > 300) celebrated.clear();
    lastCelebration = now;
    celebrate();
  }

  // DOM fallback: a freshly added, green-ish "Accepted" label on a problem page.
  function looksLikeAccepted(node) {
    if (!/\/(problems|playground)\//.test(location.pathname)) return false;
    let candidates = [];
    try {
      if (node.matches && node.matches('span,div,button,p')) candidates.push(node);
      if (node.querySelectorAll) {
        candidates = candidates.concat(Array.from(node.querySelectorAll('span,div,button,p')).slice(0, 400));
      }
    } catch (_) {
      return false;
    }
    for (const el of candidates) {
      if (el.childElementCount > 0) continue;
      if ((el.textContent || '').trim() !== 'Accepted') continue;
      let color = '';
      try {
        color = getComputedStyle(el).color || '';
      } catch (_) {
        continue;
      }
      const m = color.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) continue;
      const r = +m[1];
      const g = +m[2];
      const b = +m[3];
      if (g > r && g > b && g > 90) return true;
    }
    return false;
  }

  function startDomObserver() {
    const attach = () => {
      if (!document.body) {
        requestAnimationFrame(attach);
        return;
      }
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type !== 'childList') continue;
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (looksLikeAccepted(node)) {
              trigger('dom:' + Date.now());
              return;
            }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    };
    attach();
  }
  startDomObserver();

  // -------------------------------------------------------------- celebration
  const CAT_SVG = `
    <svg class="cat" viewBox="0 0 220 190" width="220" height="190" aria-hidden="true">
      <path class="tail" d="M176 168 C 210 160 214 110 188 96" fill="none" stroke="#FCA64D" stroke-width="16" stroke-linecap="round"/>
      <path d="M58 74 L70 24 L106 56 Z" fill="#FCA64D" stroke="#7C4A1E" stroke-width="4" stroke-linejoin="round"/>
      <path d="M162 74 L150 24 L114 56 Z" fill="#FCA64D" stroke="#7C4A1E" stroke-width="4" stroke-linejoin="round"/>
      <path d="M70 62 L76 38 L94 54 Z" fill="#F79FB0"/>
      <path d="M150 62 L144 38 L126 54 Z" fill="#F79FB0"/>
      <ellipse cx="110" cy="104" rx="58" ry="50" fill="#FCA64D" stroke="#7C4A1E" stroke-width="4"/>
      <ellipse cx="110" cy="118" rx="34" ry="22" fill="#FFF1DC"/>
      <path class="eye" d="M74 96 q12 -14 24 0" fill="none" stroke="#5A3416" stroke-width="5" stroke-linecap="round"/>
      <path class="eye" d="M122 96 q12 -14 24 0" fill="none" stroke="#5A3416" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="70" cy="114" rx="9" ry="6" fill="#F79FB0" opacity="0.55"/>
      <ellipse cx="150" cy="114" rx="9" ry="6" fill="#F79FB0" opacity="0.55"/>
      <path d="M104 110 h12 l-6 8 Z" fill="#EF7D97" stroke="#D9607E" stroke-width="1.5" stroke-linejoin="round"/>
      <path class="mouth-smile" d="M96 118 c3 8 11 8 14 0 c3 8 11 8 14 0" fill="none" stroke="#5A3416" stroke-width="4" stroke-linecap="round"/>
      <ellipse class="mouth-meow" cx="110" cy="124" rx="9" ry="11" fill="#E2596F" stroke="#B8455E" stroke-width="2"/>
      <path d="M28 100 L64 106 M28 118 L64 116" stroke="#7C4A1E" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
      <path d="M192 100 L156 106 M192 118 L156 116" stroke="#7C4A1E" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
      <ellipse cx="80" cy="176" rx="19" ry="13" fill="#FFF1DC" stroke="#7C4A1E" stroke-width="4"/>
      <ellipse cx="140" cy="176" rx="19" ry="13" fill="#FFF1DC" stroke="#7C4A1E" stroke-width="4"/>
      <path d="M72 168 v8 M80 166 v10 M88 168 v8" stroke="#D8B48B" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M132 168 v8 M140 166 v10 M148 168 v8" stroke="#D8B48B" stroke-width="2.5" stroke-linecap="round"/>
      <text class="note note-1" x="30" y="58" font-size="26">&#9834;</text>
      <text class="note note-2" x="184" y="46" font-size="22">&#9835;</text>
    </svg>`;

  const CSS = `
    .confetti { position: fixed; inset: 0; pointer-events: none; }
    .stage { position: fixed; right: 44px; bottom: -8px; width: 230px; height: 200px; pointer-events: none; }
    .cat {
      width: 100%; height: 100%; overflow: visible;
      transform-origin: 50% 100%;
      animation: catPop 4.2s cubic-bezier(.2,.9,.3,1.15) forwards;
      filter: drop-shadow(0 10px 14px rgba(0,0,0,.28));
    }
    @keyframes catPop {
      0%   { transform: translateY(108%) scale(.8) rotate(-8deg); opacity: 0; }
      14%  { transform: translateY(-6%) scale(1.05) rotate(3deg);  opacity: 1; }
      22%  { transform: translateY(0) scale(1) rotate(0deg); }
      30%  { transform: translateY(-3%) scale(1.02) rotate(-2deg); }
      38%  { transform: translateY(0) rotate(2deg); }
      46%  { transform: translateY(-2%) rotate(-1.5deg); }
      70%  { transform: translateY(0) rotate(0deg); opacity: 1; }
      86%  { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(114%) scale(.85) rotate(10deg); opacity: 0; }
    }
    .mouth-smile { animation: smileHide 4.2s steps(1, end) forwards; }
    @keyframes smileHide {
      0%, 11% { opacity: 1; }
      12%, 26% { opacity: 0; }
      27%, 37% { opacity: 1; }
      38%, 48% { opacity: 0; }
      49%, 100% { opacity: 1; }
    }
    .mouth-meow {
      opacity: 0; transform-box: view-box; transform-origin: 110px 120px;
      animation: meowMouth 4.2s ease-in-out forwards;
    }
    @keyframes meowMouth {
      0%, 11%  { opacity: 0; transform: scale(.4); }
      14%      { opacity: 1; transform: scale(1.15); }
      18%      { transform: scale(.9); }
      22%      { transform: scale(1.1); }
      25%      { opacity: 1; transform: scale(.85); }
      27%, 37% { opacity: 0; transform: scale(.4); }
      40%      { opacity: 1; transform: scale(1.1); }
      44%      { transform: scale(.9); }
      47%      { opacity: 1; transform: scale(1.05); }
      49%, 100%{ opacity: 0; transform: scale(.4); }
    }
    .tail { transform-box: view-box; transform-origin: 176px 168px; animation: wag 1.1s ease-in-out infinite; }
    @keyframes wag { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(10deg); } }
    .note { fill: #ff5d8f; opacity: 0; font-weight: 700; animation: noteFloat 4.2s ease-out forwards; }
    .note-2 { fill: #4cc9f0; animation-delay: .55s; }
    @keyframes noteFloat {
      0%, 16% { opacity: 0; transform: translateY(6px); }
      24%     { opacity: 1; transform: translateY(-4px); }
      42%     { opacity: .85; transform: translateY(-20px); }
      58%, 100% { opacity: 0; transform: translateY(-38px); }
    }
    .bubble {
      position: absolute; left: -34px; top: 0;
      background: #fff; color: #33302b;
      border: 3px solid #33302b; border-radius: 16px;
      padding: 7px 12px; font: 700 15px/1.2 system-ui, -apple-system, sans-serif;
      white-space: nowrap; transform-origin: 100% 100%;
      animation: bubblePop 4.2s cubic-bezier(.2,.9,.3,1.3) forwards;
    }
    .bubble::after {
      content: ''; position: absolute; right: -10px; bottom: 12px;
      border: 7px solid transparent; border-left-color: #33302b;
    }
    @keyframes bubblePop {
      0%, 10%  { opacity: 0; transform: scale(.2) rotate(-8deg); }
      17%      { opacity: 1; transform: scale(1.12) rotate(2deg); }
      21%      { transform: scale(1) rotate(0); }
      84%      { opacity: 1; transform: scale(1); }
      94%, 100%{ opacity: 0; transform: scale(.8) translateY(6px); }
    }`;

  function celebrate() {
    safePlay((ctx) => {
      const t = ctx.currentTime;
      playPop(ctx, t + 0.02);
      playPop(ctx, t + 0.18);
      playPop(ctx, t + 0.36);
      playMeowSequence(ctx);
    });

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';

    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.innerHTML = '<div class="bubble">Meow! &#127881;</div>' + CAT_SVG;

    shadow.appendChild(style);
    shadow.appendChild(canvas);
    shadow.appendChild(stage);
    (document.body || document.documentElement).appendChild(host);

    const stopConfetti = runConfetti(canvas);
    setTimeout(() => {
      stopConfetti();
      host.remove();
    }, CELEBRATION_MS);
  }

  function runConfetti(canvas) {
    const ctx2d = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#ff5d8f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff924c', '#ffffff'];
    const parts = [];

    function burst(x, y, count, angle, spread, speed) {
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const s = speed * (0.55 + Math.random() * 0.75);
        parts.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          w: 5 + Math.random() * 7,
          h: 4 + Math.random() * 10,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.35,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          shape: Math.random() < 0.35 ? 'circle' : Math.random() < 0.5 ? 'tri' : 'rect',
          life: 0,
          maxLife: 75 + Math.random() * 55,
          wave: Math.random() * Math.PI * 2
        });
      }
    }

    // Popper bursts from both bottom corners, then a burst around the cat.
    burst(70, H - 10, 55, -Math.PI / 2 + 0.35, 1.1, 11);
    burst(W - 70, H - 10, 55, -Math.PI / 2 - 0.35, 1.1, 11);
    const sparkleTimer = setTimeout(() => burst(W - 210, H - 170, 32, -Math.PI / 2, 2.6, 6), 520);

    let raf = 0;
    function frame() {
      ctx2d.clearRect(0, 0, W, H);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.vy += 0.16;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx + Math.sin((p.life + p.wave) * 0.12) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.life > p.maxLife || p.y > H + 40) {
          parts.splice(i, 1);
          continue;
        }
        const alpha = Math.min(1, (p.maxLife - p.life) / 20);
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.5 + 0.5 * Math.abs(Math.cos(p.life * 0.15))));
        } else if (p.shape === 'circle') {
          ctx2d.beginPath();
          ctx2d.arc(0, 0, p.w / 2.5, 0, Math.PI * 2);
          ctx2d.fill();
        } else {
          ctx2d.beginPath();
          ctx2d.moveTo(0, -p.h / 2);
          ctx2d.lineTo(p.w / 2, p.h / 2);
          ctx2d.lineTo(-p.w / 2, p.h / 2);
          ctx2d.closePath();
          ctx2d.fill();
        }
        ctx2d.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(sparkleTimer);
      window.removeEventListener('resize', resize);
    };
  }
})();
