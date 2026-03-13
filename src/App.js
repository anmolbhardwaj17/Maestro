import React, { useState, useCallback, useRef, useEffect } from 'react';
import HandTracker from './HandTracker';
import engine from './audioEngine';
import './styles.css';

const PAD_SOUNDS = [
  { name: 'KICK',   play: (ctx) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.15); g.gain.setValueAtTime(1, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3); }},
  { name: 'SNARE',  play: (ctx) => { const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); n.buffer = buf; const g = ctx.createGain(); g.gain.setValueAtTime(0.8, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15); const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(200, ctx.currentTime); const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.7, ctx.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08); o.connect(g2); g2.connect(ctx.destination); n.connect(g); g.connect(ctx.destination); n.start(); o.start(); o.stop(ctx.currentTime + 0.08); }},
  { name: 'HIHAT',  play: (ctx) => { const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); n.buffer = buf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const g = ctx.createGain(); g.gain.setValueAtTime(0.5, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06); n.connect(hp); hp.connect(g); g.connect(ctx.destination); n.start(); }},
  { name: 'CLAP',   play: (ctx) => { for (let k = 0; k < 3; k++) { const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1); n.buffer = buf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 2; const g = ctx.createGain(); g.gain.setValueAtTime(0.6, ctx.currentTime + k * 0.015); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + k * 0.015 + 0.08); n.connect(bp); bp.connect(g); g.connect(ctx.destination); n.start(ctx.currentTime + k * 0.015); } }},
  { name: 'TOM',    play: (ctx) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(200, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.2); g.gain.setValueAtTime(0.8, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25); }},
  { name: 'RIM',    play: (ctx) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'square'; o.frequency.setValueAtTime(800, ctx.currentTime); g.gain.setValueAtTime(0.5, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.04); }},
  { name: 'PERC',   play: (ctx) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(600, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1); g.gain.setValueAtTime(0.6, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12); }},
  { name: 'FX',     play: (ctx) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(300, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15); g.gain.setValueAtTime(0.4, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.2); }},
];

const TAP_MAX_DURATION = 300;
const TAP_MAX_MOVE = 20;

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const SEGMENTS = {
  '0': [1,1,1,0,1,1,1], '1': [0,0,1,0,0,1,0], '2': [1,0,1,1,1,0,1],
  '3': [1,0,1,1,0,1,1], '4': [0,1,1,1,0,1,0], '5': [1,1,0,1,0,1,1],
  '6': [1,1,0,1,1,1,1], '7': [1,0,1,0,0,1,0], '8': [1,1,1,1,1,1,1],
  '9': [1,1,1,1,0,1,1], ':': 'colon',
};

function SevenSegChar({ char }) {
  const segs = SEGMENTS[char];
  if (segs === 'colon') return <div className="seg-colon"><i /><i /></div>;
  if (!segs) return null;
  return (
    <div className="seg-digit">
      <i className={`seg seg-a${segs[0] ? ' on' : ''}`} />
      <i className={`seg seg-b${segs[1] ? ' on' : ''}`} />
      <i className={`seg seg-c${segs[2] ? ' on' : ''}`} />
      <i className={`seg seg-d${segs[3] ? ' on' : ''}`} />
      <i className={`seg seg-e${segs[4] ? ' on' : ''}`} />
      <i className={`seg seg-f${segs[5] ? ' on' : ''}`} />
      <i className={`seg seg-g${segs[6] ? ' on' : ''}`} />
    </div>
  );
}

function LedTime({ seconds }) {
  const str = formatTime(seconds);
  return (
    <div className="led-time">
      {str.split('').map((ch, i) => <SevenSegChar key={i} char={ch} />)}
    </div>
  );
}

function valueToPercent(value, min, max) {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

const SNAP_RADIUS = 130;
const SNAP_STRENGTH = 0.6;
const DEAD_ZONE = 6;
const MAX_DRAG_DIST = 250;

const VALUE_SNAPS = {
  'pitch':      [{ at: 1.0, range: 0.01 }],
  'volume':     [{ at: 0, range: 0.01 }, { at: 1.0, range: 0.01 }],
  'eq-low':     [{ at: 0, range: 0.3 }],
  'eq-mid':     [{ at: 0, range: 0.3 }],
  'eq-high':    [{ at: 0, range: 0.3 }],
  'filter':     [{ at: 20000, range: 400 }],
  'delay':      [{ at: 0, range: 0.01 }],
  'crossfader': [{ at: 0.5, range: 0.01 }],
};

function applyValueSnap(controlId, rawValue) {
  let key = controlId;
  if (controlId !== 'crossfader') {
    const parts = controlId.split('-');
    key = parts.slice(0, -1).join('-');
  }
  const snaps = VALUE_SNAPS[key];
  if (!snaps) return rawValue;
  for (const snap of snaps) {
    if (Math.abs(rawValue - snap.at) < snap.range) return snap.at;
  }
  return rawValue;
}

const CONTROL_DEFS = {
  'volume-A':  { min: 0, max: 1, sens: 0.006, type: 'slider' },
  'volume-B':  { min: 0, max: 1, sens: 0.006, type: 'slider' },
  'pitch-A':   { min: 0.5, max: 1.5, sens: 0.006, type: 'slider' },
  'pitch-B':   { min: 0.5, max: 1.5, sens: 0.006, type: 'slider' },
  'eq-low-A':  { min: -12, max: 12, sens: 0.15 },
  'eq-mid-A':  { min: -12, max: 12, sens: 0.15 },
  'eq-high-A': { min: -12, max: 12, sens: 0.15 },
  'eq-low-B':  { min: -12, max: 12, sens: 0.15 },
  'eq-mid-B':  { min: -12, max: 12, sens: 0.15 },
  'eq-high-B': { min: -12, max: 12, sens: 0.15 },
  'filter-A':  { min: 60, max: 20000, sens: 120 },
  'filter-B':  { min: 60, max: 20000, sens: 120 },
  'delay-A':   { min: 0, max: 1, sens: 0.006 },
  'delay-B':   { min: 0, max: 1, sens: 0.006 },
  crossfader:  { min: 0, max: 1, sens: 0.006, type: 'slider', horizontal: true },
};

// Get transform info from #root using the browser's own DOMMatrix.
// This avoids manual coordinate math that can break on mobile Safari
// due to dvh/innerHeight mismatches with address bar, safe areas, bottom nav.
function getTransformInfo(isRotated) {
  if (!isRotated) return null;
  const root = document.getElementById('root');
  if (!root) return null;
  const matrix = new DOMMatrix(getComputedStyle(root).transform);
  const rootRect = root.getBoundingClientRect();
  return {
    matrix,
    invMatrix: matrix.inverse(),
    vpCx: rootRect.left + rootRect.width / 2,
    vpCy: rootRect.top + rootRect.height / 2,
    ox: root.offsetWidth / 2,
    oy: root.offsetHeight / 2,
  };
}

// Container coords → viewport coords (uses browser's own transform math)
function containerToViewport(cx, cy, txInfo) {
  if (!txInfo) return { vx: cx, vy: cy };
  const pt = txInfo.matrix.transformPoint(new DOMPoint(cx - txInfo.ox, cy - txInfo.oy));
  return { vx: txInfo.vpCx + pt.x, vy: txInfo.vpCy + pt.y };
}

// Viewport coords → container coords (inverse of above)
function viewportToContainer(vx, vy, txInfo) {
  if (!txInfo) return { x: vx, y: vy };
  const pt = txInfo.invMatrix.transformPoint(new DOMPoint(vx - txInfo.vpCx, vy - txInfo.vpCy));
  return { x: txInfo.ox + pt.x, y: txInfo.oy + pt.y };
}

function magneticSnap(rawX, rawY, scale = 1, txInfo = null) {
  const radius = SNAP_RADIUS / scale;
  // Convert hand position to viewport space
  const { vx: hvx, vy: hvy } = containerToViewport(rawX, rawY, txInfo);
  const controls = document.querySelectorAll('[data-control]');
  let nearest = null, nearestDist = Infinity, nvx = hvx, nvy = hvy;
  controls.forEach((el) => {
    const r = el.getBoundingClientRect();
    const ecx = r.left + r.width / 2, ecy = r.top + r.height / 2;
    const d = Math.hypot(hvx - ecx, hvy - ecy);
    if (d < nearestDist) { nearestDist = d; nearest = el.dataset.control; nvx = ecx; nvy = ecy; }
  });
  if (nearest && nearestDist < radius) {
    const t = SNAP_STRENGTH * (1 - nearestDist / radius);
    const snapVx = hvx + (nvx - hvx) * t;
    const snapVy = hvy + (nvy - hvy) * t;
    // Convert snapped position back to container space
    const { x, y } = viewportToContainer(snapVx, snapVy, txInfo);
    return { x, y, snappedTo: nearest };
  }
  return { x: rawX, y: rawY, snappedTo: null };
}

export default function App() {
  const [showMobileWarning, setShowMobileWarning] = useState(() => {
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 900;
  });
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (process.env.NODE_ENV === 'development') return true;
    const lastSeen = localStorage.getItem('maestro-onboarding-seen');
    if (!lastSeen) return true;
    const daysSince = (Date.now() - parseInt(lastSeen, 10)) / (1000 * 60 * 60 * 24);
    return daysSince >= 7;
  });
  const [djState, setDjState] = useState({
    A: { loaded: false, trackName: '', playing: false, pitch: 1.0, volume: 0.8, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 20000, delay: 0 },
    B: { loaded: false, trackName: '', playing: false, pitch: 1.0, volume: 0.8, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 20000, delay: 0 },
    crossfader: 0.5,
  });
  const isMobile = typeof window !== 'undefined' && (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 900);
  const [mobileScale, setMobileScale] = useState(() => {
    if (!isMobile) return 1;
    const vp = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
    const isPortrait = vp.height > vp.width;
    const availW = isPortrait ? vp.height : vp.width;
    const availH = isPortrait ? vp.width : vp.height;
    return Math.min(availW / 1440, availH / 880) * 0.96;
  });
  const [desktopScale, setDesktopScale] = useState(1);
  const [isRotated, setIsRotated] = useState(false);

  // Desktop scale: uniformly shrink controller on smaller screens
  useEffect(() => {
    if (isMobile) return;
    const calcDesktopScale = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Controller wants 1400x860, reserve 120px for page title + tagline + breathing room
      const scaleW = (vw * 0.92) / 1400;
      const scaleH = (vh - 120) / 860;
      const s = Math.min(scaleW, scaleH, 1); // never scale up beyond 1
      setDesktopScale(s);
    };
    calcDesktopScale();
    window.addEventListener('resize', calcDesktopScale);
    return () => window.removeEventListener('resize', calcDesktopScale);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const calcScale = () => {
      const vp = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
      const isPortrait = vp.height > vp.width;
      const availW = isPortrait ? vp.height : vp.width;
      const availH = isPortrait ? vp.width : vp.height;
      const s = Math.min(availW / 1440, availH / 880) * 0.96;
      setMobileScale(s);
    };
    calcScale();
    window.addEventListener('resize', calcScale);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', calcScale);
    return () => { window.removeEventListener('resize', calcScale); if (window.visualViewport) window.visualViewport.removeEventListener('resize', calcScale); };
  }, [isMobile]);

  // Add rotated class to #root only in portrait mode when warning is dismissed
  useEffect(() => {
    if (!isMobile || showMobileWarning) {
      document.getElementById('root')?.classList.remove('rotated');
      return;
    }
    const update = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      if (isPortrait) {
        document.getElementById('root')?.classList.add('rotated');
        setIsRotated(true);
      } else {
        document.getElementById('root')?.classList.remove('rotated');
        setIsRotated(false);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isMobile, showMobileWarning]);

  const [handPositions, setHandPositions] = useState([]);
  const [hoveredControl, setHoveredControl] = useState(null);
  const [grabbedControl, setGrabbedControl] = useState(null);
  const [snappedControl, setSnappedControl] = useState(null);
  const [playbackPos, setPlaybackPos] = useState({ A: 0, B: 0 });
  const [jogAngles, setJogAngles] = useState({ A: 0, B: 0 });
  const [activePads, setActivePads] = useState({});

  const DRAG_SMOOTH = 0.4;
  const interactionRef = useRef([
    { grabbed: null, lastY: 0, lastX: 0, smoothDx: 0, smoothDy: 0, deadZonePassed: false, pinchStartTime: 0, pinchStartPos: { x: 0, y: 0 } },
    { grabbed: null, lastY: 0, lastX: 0, smoothDx: 0, smoothDy: 0, deadZonePassed: false, pinchStartTime: 0, pinchStartPos: { x: 0, y: 0 } },
  ]);
  const padAudioCtxRef = useRef(null);
  const djStateRef = useRef(djState);
  useEffect(() => { djStateRef.current = djState; }, [djState]);

  // Audio setup: fetch raw mp3 data on mount, create AudioContext on first gesture
  const trackNamesRef = useRef({ A: 'House Track 1', B: 'House Track 2' });
  useEffect(() => {
    // 1. Pre-fetch mp3 files as raw ArrayBuffers (no AudioContext needed)
    const fetchRaw = async () => {
      const tracks = [
        { url: `${process.env.PUBLIC_URL}/house_1.mp3`, deck: 'A' },
        { url: `${process.env.PUBLIC_URL}/house_2.mp3`, deck: 'B' },
      ];
      for (const t of tracks) {
        try {
          const resp = await fetch(t.url);
          if (!resp.ok) continue;
          const buf = await resp.arrayBuffer();
          engine.storeRawTrack(t.deck, buf);
        } catch (e) { /* fetch failed */ }
      }
    };
    fetchRaw();

    // 2. On first user gesture: create AudioContext + unlock + decode pending tracks
    const unlockOnGesture = () => {
      engine.unlock();
      ['A', 'B'].forEach((deck) => {
        engine.setVolume(deck, 0.8);
        engine.setPitch(deck, 1.0);
        engine.setEQ(deck, 'low', 0);
        engine.setEQ(deck, 'mid', 0);
        engine.setEQ(deck, 'high', 0);
        engine.setFilter(deck, 20000);
        engine.setDelayMix(deck, 0);
      });
      engine.setCrossfader(0.5);
      document.removeEventListener('touchstart', unlockOnGesture, true);
      document.removeEventListener('touchend', unlockOnGesture, true);
      document.removeEventListener('click', unlockOnGesture, true);
    };
    document.addEventListener('touchstart', unlockOnGesture, true);
    document.addEventListener('touchend', unlockOnGesture, true);
    document.addEventListener('click', unlockOnGesture, true);

    // 3. Poll for decoded tracks and update UI state (avoids callback race conditions)
    const poll = setInterval(() => {
      ['A', 'B'].forEach((deck) => {
        if (engine.decks[deck]?.buffer) {
          setDjState((s) => {
            if (s[deck].loaded) return s; // already set
            return { ...s, [deck]: { ...s[deck], loaded: true, trackName: trackNamesRef.current[deck] } };
          });
        }
      });
      // Stop polling once both loaded
      if (engine.decks['A']?.buffer && engine.decks['B']?.buffer) clearInterval(poll);
    }, 200);

    return () => {
      clearInterval(poll);
      document.removeEventListener('touchstart', unlockOnGesture, true);
      document.removeEventListener('touchend', unlockOnGesture, true);
      document.removeEventListener('click', unlockOnGesture, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waveformCanvasA = useRef(null);
  const waveformCanvasB = useRef(null);
  const animFrameRef = useRef(null);

  const getControlValue = useCallback((controlId) => {
    const s = djStateRef.current;
    if (controlId === 'crossfader') return s.crossfader;
    const parts = controlId.split('-');
    const deck = parts[parts.length - 1];
    const key = parts.slice(0, -1).join('-');
    const d = s[deck]; if (!d) return 0;
    switch (key) {
      case 'volume': return d.volume; case 'pitch': return d.pitch;
      case 'eq-low': return d.eqLow; case 'eq-mid': return d.eqMid; case 'eq-high': return d.eqHigh;
      case 'filter': return d.filter; case 'delay': return d.delay; default: return 0;
    }
  }, []);

  const applyControl = useCallback((controlId, value) => {
    const def = CONTROL_DEFS[controlId]; if (!def) return;
    engine.unlock();
    const snapped = applyValueSnap(controlId, Math.max(def.min, Math.min(def.max, value)));
    if (controlId === 'crossfader') { engine.setCrossfader(snapped); setDjState((s) => ({ ...s, crossfader: snapped })); return; }
    const parts = controlId.split('-'); const deck = parts[parts.length - 1]; const key = parts.slice(0, -1).join('-');
    switch (key) {
      case 'volume': engine.setVolume(deck, snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], volume: snapped } })); break;
      case 'pitch': engine.setPitch(deck, snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], pitch: snapped } })); break;
      case 'eq-low': engine.setEQ(deck, 'low', snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], eqLow: snapped } })); break;
      case 'eq-mid': engine.setEQ(deck, 'mid', snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], eqMid: snapped } })); break;
      case 'eq-high': engine.setEQ(deck, 'high', snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], eqHigh: snapped } })); break;
      case 'filter': engine.setFilter(deck, snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], filter: snapped } })); break;
      case 'delay': engine.setDelayMix(deck, snapped); setDjState((s) => ({ ...s, [deck]: { ...s[deck], delay: snapped } })); break;
      default: break;
    }
  }, []);

  const triggerPad = useCallback((padKey) => {
    if (!padAudioCtxRef.current) padAudioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = padAudioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const idx = parseInt(padKey.split('-').pop(), 10);
    PAD_SOUNDS[idx]?.play(ctx);
    setActivePads((p) => ({ ...p, [padKey]: true }));
    setTimeout(() => setActivePads((p) => ({ ...p, [padKey]: false })), 150);
  }, []);

  const togglePlay = useCallback((deck) => {
    engine.unlock();
    // If tracks are still decoding after unlock, wait for them
    if (!engine.decks[deck]?.buffer) {
      const check = setInterval(() => {
        if (engine.decks[deck]?.buffer) {
          clearInterval(check);
          const p = engine.togglePlay(deck);
          setDjState((s) => ({ ...s, [deck]: { ...s[deck], playing: p } }));
        }
      }, 100);
      // Give up after 5 seconds
      setTimeout(() => clearInterval(check), 5000);
      return;
    }
    const p = engine.togglePlay(deck);
    setDjState((s) => ({ ...s, [deck]: { ...s[deck], playing: p } }));
  }, []);

  const loadTrack = useCallback(async (deck, file) => {
    engine.unlock();
    await engine.loadTrack(deck, file);
    setDjState((s) => ({ ...s, [deck]: { ...s[deck], loaded: true, trackName: file.name, playing: false } }));
  }, []);

  const handleDrop = useCallback((deck) => (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith('audio/')) loadTrack(deck, f); e.currentTarget.classList.remove('drag-over'); }, [loadTrack]);
  const handleDragOver = (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
  const handleDragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };

  const handleHandData = useCallback((handsData) => {
    // Get transform info once per frame (uses browser's DOMMatrix — correct for any CSS transform)
    const txInfo = getTransformInfo(isRotated);
    let newHovered = null, newGrabbed = null, newSnapped = null;
    const displayPositions = [];
    handsData.forEach((hand, i) => {
      const interaction = interactionRef.current[i];
      const isGrabbing = hand.pinching && interaction.grabbed;
      let cursorX, cursorY, snapInfo;
      if (isGrabbing) { cursorX = hand.x; cursorY = hand.y; snapInfo = { snappedTo: interaction.grabbed }; }
      else { snapInfo = magneticSnap(hand.x, hand.y, isMobile ? mobileScale : desktopScale, txInfo); cursorX = snapInfo.x; cursorY = snapInfo.y; }
      displayPositions.push({ x: cursorX, y: cursorY, pinching: hand.pinching, snapped: snapInfo.snappedTo !== null && !isGrabbing });
      if (snapInfo.snappedTo) newSnapped = snapInfo.snappedTo;
      // Use elementFromPoint with correct viewport coords (works for both rotated and non-rotated)
      const { vx: hvx, vy: hvy } = containerToViewport(cursorX, cursorY, txInfo);
      const el = document.elementFromPoint(hvx, hvy);
      const controlEl = el?.closest('[data-control]');
      let controlId = controlEl?.dataset?.control || snapInfo.snappedTo;
      if (controlId) newHovered = controlId;
      if (hand.justPinched) {
        interaction.pinchStartTime = performance.now();
        interaction.pinchStartPos = { x: hand.x, y: hand.y };
        if (controlId) {
          if (controlId.startsWith('play-')) { togglePlay(controlId.split('-')[1]); }
          else if (controlId.startsWith('pad-')) {
            triggerPad(controlId.replace('pad-', ''));
          }
          else {
            interaction.grabbed = controlId;
            interaction.lastY = hand.y;
            interaction.lastX = hand.x;
            interaction.deadZonePassed = false;
            newGrabbed = controlId;
          }
        }
      } else if (hand.justReleased) {
        const dt = performance.now() - interaction.pinchStartTime;
        const dist = Math.hypot(hand.x - interaction.pinchStartPos.x, hand.y - interaction.pinchStartPos.y);
        if (dt < TAP_MAX_DURATION && dist < TAP_MAX_MOVE) {
          const { vx: pvx, vy: pvy } = containerToViewport(hand.x, hand.y, txInfo);
          const padEl = document.elementFromPoint(pvx, pvy)?.closest('[data-control^="pad-"]');
          if (padEl) {
            triggerPad(padEl.dataset.control.replace('pad-', ''));
          }
        }
        interaction.grabbed = null;
      } else if (isGrabbing) {
        const cid = interaction.grabbed;
        const def = CONTROL_DEFS[cid];
        const cel = document.querySelector(`[data-control="${cid}"]`);
        if (cel) {
          const r = cel.getBoundingClientRect();
          const { x: ecx, y: ecy } = viewportToContainer(r.left + r.width / 2, r.top + r.height / 2, txInfo);
          if (Math.hypot(hand.x - ecx, hand.y - ecy) > MAX_DRAG_DIST / (isMobile ? mobileScale : desktopScale)) { interaction.grabbed = null; return; }
        }
        newGrabbed = cid;
        if (def) {
          const rawDx = hand.x - interaction.lastX;
          const rawDy = interaction.lastY - hand.y;
          interaction.smoothDx += DRAG_SMOOTH * (rawDx - interaction.smoothDx);
          interaction.smoothDy += DRAG_SMOOTH * (rawDy - interaction.smoothDy);
          if (!interaction.deadZonePassed) {
            const dist = def.horizontal ? Math.abs(rawDx) : Math.abs(rawDy);
            if (dist > DEAD_ZONE) {
              interaction.deadZonePassed = true;
              interaction.lastX = hand.x;
              interaction.lastY = hand.y;
              interaction.smoothDx = 0;
              interaction.smoothDy = 0;
            }
          } else {
            const delta = def.horizontal ? interaction.smoothDx : interaction.smoothDy;
            const curVal = getControlValue(cid);
            applyControl(cid, curVal + delta * def.sens);
            interaction.lastX += interaction.smoothDx * (def.horizontal ? 1 : 0);
            interaction.lastY -= interaction.smoothDy * (def.horizontal ? 0 : 1);
          }
        }
      } else if (!hand.pinching) { interaction.grabbed = null; }
    });
    for (let i = handsData.length; i < 2; i++) interactionRef.current[i].grabbed = null;
    setHandPositions(displayPositions); setHoveredControl(newHovered); setGrabbedControl(newGrabbed); setSnappedControl(newSnapped);
  }, [getControlValue, applyControl, togglePlay, triggerPad, mobileScale, desktopScale, isMobile, isRotated]);

  const mouseInteraction = useRef({ active: false, controlId: null, startY: 0, startX: 0, startValue: 0 });
  const handleMouseDown = useCallback((controlId) => (e) => {
    e.preventDefault();
    if (controlId.startsWith('play-')) { togglePlay(controlId.split('-')[1]); return; }
    if (controlId.startsWith('pad-')) { triggerPad(controlId.replace('pad-', '')); return; }
    const def = CONTROL_DEFS[controlId]; if (!def) return;
    mouseInteraction.current = { active: true, controlId, startY: e.clientY, startX: e.clientX, startValue: getControlValue(controlId) };
    const onMove = (ev) => {
      const mi = mouseInteraction.current; if (!mi.active) return;
      const def2 = CONTROL_DEFS[mi.controlId];
      const d = def2.horizontal ? ev.clientX - mi.startX : mi.startY - ev.clientY;
      applyControl(mi.controlId, mi.startValue + d * def2.sens);
    };
    const onUp = () => { mouseInteraction.current.active = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [getControlValue, applyControl, togglePlay, triggerPad]);

  const drawWaveform = useCallback((canvas, deckId) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const dotSize = 2;
    const dotGap = 5;
    const cols = Math.floor(w / dotGap);
    const rows = Math.floor(h / dotGap);

    // Draw dim background grid
    ctx.fillStyle = 'rgba(232,100,12,0.04)';
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        ctx.beginPath();
        ctx.arc(col * dotGap + dotGap / 2, row * dotGap + dotGap / 2, dotSize * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const freqData = engine.getFrequencyData(deckId);
    const peaks = engine.getWaveformPeaks(deckId);
    const pos = engine.getPlaybackPosition(deckId);

    if (freqData) {
      // Live frequency bars as dot matrix
      const barCols = Math.min(cols, 64);
      const step = Math.floor(freqData.length / barCols);
      const colWidth = cols / barCols;
      for (let i = 0; i < barCols; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqData[i * step + j];
        const avg = sum / step / 255;
        const litRows = Math.ceil(avg * rows * 0.95);
        const startCol = Math.floor(i * colWidth);
        const endCol = Math.floor((i + 1) * colWidth);
        for (let col = startCol; col < endCol; col++) {
          for (let row = 0; row < rows; row++) {
            const fromBottom = rows - 1 - row;
            if (fromBottom < litRows) {
              const x = col * dotGap + dotGap / 2;
              const y = row * dotGap + dotGap / 2;
              const brightness = 0.5 + avg * 0.5;
              ctx.beginPath(); ctx.arc(x, y, dotSize, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(232,100,12,${brightness})`;
              ctx.fill();
            }
          }
        }
      }
      // Glow pass on top
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < barCols; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqData[i * step + j];
        const avg = sum / step / 255;
        if (avg < 0.05) continue;
        const litRows = Math.ceil(avg * rows * 0.95);
        const startCol = Math.floor(i * colWidth);
        const endCol = Math.floor((i + 1) * colWidth);
        for (let col = startCol; col < endCol; col++) {
          for (let row = 0; row < rows; row++) {
            const fromBottom = rows - 1 - row;
            if (fromBottom < litRows) {
              const x = col * dotGap + dotGap / 2;
              const y = row * dotGap + dotGap / 2;
              ctx.beginPath(); ctx.arc(x, y, dotSize * 1.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(232,100,12,${avg * 0.15})`;
              ctx.fill();
            }
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (peaks) {
      // Static waveform when not playing
      const midRow = rows / 2;
      for (let col = 0; col < cols; col++) {
        const peakIdx = Math.floor((col / cols) * peaks.length);
        const peak = peaks[peakIdx] || 0;
        const litRows = Math.ceil(peak * rows * 0.8);
        const isPast = (col / cols) < pos;
        for (let row = 0; row < rows; row++) {
          const distFromMid = Math.abs(row - midRow);
          if (distFromMid < litRows / 2) {
            const x = col * dotGap + dotGap / 2;
            const y = row * dotGap + dotGap / 2;
            ctx.beginPath(); ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fillStyle = isPast ? 'rgba(232,100,12,0.8)' : 'rgba(232,100,12,0.15)';
            ctx.fill();
          }
        }
      }
    }

    // Playback position line
    if (peaks && pos > 0) {
      ctx.beginPath(); ctx.moveTo(pos * w, 0); ctx.lineTo(pos * w, h);
      ctx.strokeStyle = 'rgba(232,100,12,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const animate = () => {
      [['A', waveformCanvasA], ['B', waveformCanvasB]].forEach(([id, ref]) => {
        if (ref.current) { ref.current.width = ref.current.parentElement.clientWidth; ref.current.height = ref.current.parentElement.clientHeight; drawWaveform(ref.current, id); }
      });
      setPlaybackPos({ A: engine.getPlaybackPosition('A'), B: engine.getPlaybackPosition('B') });
      setJogAngles((prev) => ({
        A: djStateRef.current.A.playing ? prev.A + 1.5 * djStateRef.current.A.pitch : prev.A,
        B: djStateRef.current.B.playing ? prev.B + 1.5 * djStateRef.current.B.pitch : prev.B,
      }));
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawWaveform]);

  const cc = (id) => {
    let c = '';
    if (snappedControl === id) c += ' snapped';
    if (hoveredControl === id) c += ' hovered';
    if (grabbedControl === id) c += ' grabbed';
    return c;
  };

  const renderMixFader = (controlId, label, value, min, max) => {
    const pct = valueToPercent(value, min, max);
    return (
      <div className="fader-group" key={controlId}>
        <span className="fader-label">{label}</span>
        <div className="fader-slot">
          <div className="fader-ticks">
            {[...Array(9)].map((_, i) => <div className="fader-tick" key={i} />)}
          </div>
          <div className={`fader-track${cc(controlId)}`} data-control={controlId} onMouseDown={handleMouseDown(controlId)}>
            <div className="fader-fill" style={{ height: `${pct}%` }} />
            <div className="fader-thumb" style={{ bottom: `${pct}%` }} />
          </div>
          <div className="fader-ticks">
            {[...Array(9)].map((_, i) => <div className="fader-tick" key={i} />)}
          </div>
        </div>
      </div>
    );
  };

  const renderDeck = (deckId) => {
    const d = djState[deckId];
    const canvasRef = deckId === 'A' ? waveformCanvasA : waveformCanvasB;
    const pos = playbackPos[deckId];
    const dur = engine.getDuration(deckId);
    const jogAngle = jogAngles[deckId];
    const pitchPct = valueToPercent(d.pitch, 0.5, 1.5);

    return (
      <div className="deck-section" key={deckId}>
        <div className="deck-top">
          <div className="waveform" onDrop={handleDrop(deckId)} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
            {d.loaded ? <canvas ref={canvasRef} /> : <div className="waveform-empty">DROP AUDIO</div>}
          </div>
          <label className="load-btn">
            LOAD
            <input type="file" accept=".mp3,audio/mpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadTrack(deckId, f); }} />
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="track-name">{d.trackName || 'No track loaded'}</span>
        </div>

        <div className="deck-mid">
          <div className="jog-wheel-wrap">
            <div className="jog-wheel" style={{ transform: `rotate(${jogAngle}deg)` }}>
              <div className="jog-dot" />
              <div className="jog-inner">
                <span className="jog-label">DECK {deckId}</span>
              </div>
            </div>
          </div>

        </div>

        <div className="tempo-time-row">
          <div className="time-display">
            <LedTime seconds={pos * dur} />
            <span className="time-sep">/</span>
            <LedTime seconds={dur} />
          </div>
          <div className="tempo-wrap">
            <span className="tempo-label">TEMPO</span>
            <div className="fader-slot">
              <div className="fader-ticks">
                {[...Array(9)].map((_, i) => <div className={`fader-tick${i === 4 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
              <div className={`tempo-track${cc(`pitch-${deckId}`)}`} data-control={`pitch-${deckId}`} onMouseDown={handleMouseDown(`pitch-${deckId}`)}>
                <div className="tempo-thumb" style={{ bottom: `${pitchPct}%` }} />
              </div>
              <div className="fader-ticks">
                {[...Array(9)].map((_, i) => <div className={`fader-tick${i === 4 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
            </div>
            <span className="tempo-val">{d.pitch.toFixed(2)}x</span>
          </div>
        </div>

        <div className="deck-bottom">
          <div className="transport">
            <div className={`play-btn${d.playing ? ' playing' : ''}`} data-control={`play-${deckId}`} onMouseDown={handleMouseDown(`play-${deckId}`)}>
              {d.playing ? '\u23F8' : '\u25B6'}
            </div>
          </div>

          <div className="pad-grid">
            {PAD_SOUNDS.map((pad, idx) => (
                <div
                  key={`${deckId}-${idx}`}
                  className={`drum-pad${activePads[`${deckId}-${idx}`] ? ' pad-active' : ''}${cc(`pad-${deckId}-${idx}`)}`}
                  data-control={`pad-${deckId}-${idx}`}
                  onMouseDown={handleMouseDown(`pad-${deckId}-${idx}`)}
                >
                  <span className="pad-name">{pad.name}</span>
                </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const dismissOnboarding = useCallback(() => {
    engine.unlock();
    setShowOnboarding(false);
    localStorage.setItem('maestro-onboarding-seen', Date.now().toString());
  }, []);

  const renderMeter = (deckId) => {
    const freqData = engine.getFrequencyData(deckId);
    let level = 0;
    if (freqData) {
      let sum = 0;
      for (let i = 0; i < freqData.length; i++) sum += freqData[i];
      level = (sum / freqData.length / 255) * 100;
    }
    return (
      <div className="level-meter" key={`meter-${deckId}`}>
        <div className="meter-bar"><div className="meter-fill" style={{ height: `${level}%` }} /></div>
        <div className="meter-bar"><div className="meter-fill" style={{ height: `${level * 0.85}%` }} /></div>
      </div>
    );
  };

  if (showMobileWarning) {
    return (
      <div className="mobile-overlay">
        <div className="mobile-modal">
          <img src={`${process.env.PUBLIC_URL}/maestro-logo.png`} alt="Maestro" className="mobile-logo" />
          <p className="mobile-text">WORKS BEST ON DESKTOP</p>
          <p className="mobile-sub">Maestro requires a webcam and a larger screen for the best gesture control experience.</p>
          <button className="mobile-btn" onClick={() => { engine.unlock(); setShowMobileWarning(false); }}>CONTINUE ANYWAY</button>
        </div>
        <p style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center', color: '#e8640c', fontSize: 12, margin: 0, padding: '0 20px' }}>Turn off silent mode to hear audio<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e8640c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginLeft: 6 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></p>
      </div>
    );
  }

  return (
    <div className="controller-bg">
<div className="page-title">
      <img src={`${process.env.PUBLIC_URL}/maestro-logo.png`} alt="Maestro" className="page-logo" />
      <span className="page-title-sub">NO HARDWARE &middot; NO TOUCH &middot; JUST GESTURES</span>
    </div>
    <HandTracker onHandData={handleHandData} rotated={isRotated} mobileScale={isMobile ? mobileScale : desktopScale} />
    {handPositions.map((h, i) => (
      <div key={i} className={`hand-cursor ${h.pinching ? 'pinched' : 'open'}${h.snapped ? ' snapped' : ''}`} style={{ left: h.x, top: h.y }} />
    ))}
    {showOnboarding && (
      <div className="onboarding-overlay" onClick={dismissOnboarding}>
        <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="onboarding-title">HOW TO USE</h2>
          <div className="onboarding-steps">
            <div className="onboarding-step">
              <svg className="onboarding-icon" viewBox="0 0 48 48" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                {/* Palm */}
                <path d="M24 38v-4c0-1 0-2-1-3l-3-4" />
                <path d="M20 27v-12c0-1.8 1.2-3 2.5-3s2.5 1.2 2.5 3v10" fill="rgba(232,130,12,0.08)" />
                {/* Index finger */}
                <path d="M25 15v-5c0-1.8 1.2-3 2.5-3s2.5 1.2 2.5 3v10" fill="rgba(232,130,12,0.08)" />
                {/* Ring finger */}
                <path d="M30 17v-4.5c0-1.8 1.2-3 2.5-3s2.5 1.2 2.5 3V23" fill="rgba(232,130,12,0.08)" />
                {/* Pinky */}
                <path d="M35 23v-6c0-1.8 1-2.5 2-2.5s2 .7 2 2.5v8c0 7-4 13-11 15" fill="rgba(232,130,12,0.08)" />
                {/* Thumb */}
                <path d="M20 21h-3c-1.8 0-3 1-3 2.2s1.2 2.3 3 2.3h3" fill="rgba(232,130,12,0.08)" />
                {/* Cursor dot */}
                <circle cx="27.5" cy="6" r="2" fill="rgba(232,130,12,0.5)" stroke="none" />
                <circle cx="27.5" cy="6" r="4" fill="none" stroke="rgba(232,130,12,0.2)" strokeWidth="0.8" />
              </svg>
              <div>
                <strong>SHOW YOUR HAND</strong>
                <p>Hold your hand up in front of the webcam. A cursor will follow your index finger.</p>
              </div>
            </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 48 48" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  {/* Thumb coming from left */}
                  <path d="M10 22c0-1.5 1.5-3 3-3h5v6h-5c-1.5 0-3-1.5-3-3z" fill="rgba(232,130,12,0.08)" />
                  {/* Index finger coming from right, tips touching */}
                  <path d="M25 16v-6c0-1.8 1.2-3 2.5-3s2.5 1.2 2.5 3v12" fill="rgba(232,130,12,0.08)" />
                  {/* Middle finger */}
                  <path d="M30 22v-10c0-1.8 1.2-3 2.5-3s2.5 1.2 2.5 3v12" fill="rgba(232,130,12,0.08)" />
                  {/* Ring + pinky curled */}
                  <path d="M35 24v-5c0-1.5 1-2.5 2-2.5s2 1 2 2.5v6c0 7-4 12-11 14" fill="rgba(232,130,12,0.08)" />
                  {/* Palm body */}
                  <path d="M18 19v8c0 5 3 9 8 11" fill="rgba(232,130,12,0.05)" />
                  {/* Pinch point glow */}
                  <circle cx="21" cy="19" r="3" fill="rgba(232,130,12,0.15)" stroke="rgba(232,130,12,0.8)" strokeWidth="1.5" />
                  <circle cx="21" cy="19" r="5.5" fill="none" stroke="rgba(232,130,12,0.15)" strokeWidth="0.8" />
                </svg>
                <div>
                  <strong>PINCH TO GRAB</strong>
                  <p>Pinch your thumb and index finger together to grab any knob, fader, or button.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 48 48" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  {/* Fader track */}
                  <rect x="22" y="6" width="4" height="36" rx="2" fill="rgba(232,130,12,0.06)" stroke="rgba(232,130,12,0.3)" />
                  {/* Fader knob */}
                  <rect x="18" y="18" width="12" height="6" rx="2" fill="rgba(232,130,12,0.15)" stroke="rgba(232,130,12,0.7)" strokeWidth="1.5" />
                  <line x1="22" y1="20" x2="22" y2="22" strokeWidth="0.8" />
                  <line x1="24" y1="20" x2="24" y2="22" stroke="rgba(232,130,12,0.9)" strokeWidth="1" />
                  <line x1="26" y1="20" x2="26" y2="22" strokeWidth="0.8" />
                  {/* Up arrow */}
                  <path d="M10 16l4-5 4 5" strokeWidth="1.5" />
                  <line x1="14" y1="11" x2="14" y2="21" strokeWidth="1" strokeDasharray="2 2" />
                  {/* Down arrow */}
                  <path d="M34 28l4 5 4-5" strokeWidth="1.5" />
                  <line x1="38" y1="33" x2="38" y2="23" strokeWidth="1" strokeDasharray="2 2" />
                </svg>
                <div>
                  <strong>DRAG TO ADJUST</strong>
                  <p>While pinching, move your hand up/down to change values. Release to let go.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 48 48" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  {/* Waveform box */}
                  <rect x="4" y="10" width="40" height="20" rx="3" fill="rgba(232,130,12,0.05)" />
                  {/* Waveform bars */}
                  <line x1="10" y1="24" x2="10" y2="16" strokeWidth="2" stroke="rgba(232,130,12,0.3)" />
                  <line x1="14" y1="26" x2="14" y2="14" strokeWidth="2" stroke="rgba(232,130,12,0.4)" />
                  <line x1="18" y1="25" x2="18" y2="15" strokeWidth="2" stroke="rgba(232,130,12,0.5)" />
                  <line x1="22" y1="23" x2="22" y2="17" strokeWidth="2" stroke="rgba(232,130,12,0.6)" />
                  <line x1="26" y1="26" x2="26" y2="14" strokeWidth="2" stroke="rgba(232,130,12,0.5)" />
                  <line x1="30" y1="24" x2="30" y2="16" strokeWidth="2" stroke="rgba(232,130,12,0.4)" />
                  <line x1="34" y1="25" x2="34" y2="15" strokeWidth="2" stroke="rgba(232,130,12,0.3)" />
                  <line x1="38" y1="23" x2="38" y2="17" strokeWidth="2" stroke="rgba(232,130,12,0.2)" />
                  {/* Drop arrow */}
                  <path d="M24 32v8" strokeWidth="1.5" />
                  <path d="M20 37l4 4 4-4" strokeWidth="1.5" />
                  {/* Music note */}
                  <circle cx="11" cy="42" r="2" fill="rgba(232,130,12,0.4)" stroke="none" />
                  <path d="M13 42v-6l6-2v6" strokeWidth="1.2" />
                  <circle cx="19" cy="40" r="2" fill="rgba(232,130,12,0.4)" stroke="none" />
                </svg>
                <div>
                  <strong>LOAD TRACKS</strong>
                  <p>Drag and drop audio files onto the waveform area or click LOAD to browse.</p>
                </div>
              </div>
            </div>
          <p className="onboarding-disclaimer">This project is still in active development. Some features may not work as expected.</p>
          <button className="onboarding-close-btn" onClick={dismissOnboarding}>GOT IT</button>
        </div>
      </div>
    )}
    <div className={isMobile ? 'mobile-scale-wrap' : 'desktop-scale-wrap'} style={isMobile ? { width: 1400 * mobileScale, height: 860 * mobileScale } : undefined}>
    <div className="controller fade-in" style={isMobile ? { transform: `scale(${mobileScale})`, transformOrigin: 'top left' } : desktopScale < 1 ? { transform: `scale(${desktopScale})` } : undefined}>
      <div className="ctrl-header">
        <div className="brand">
          <img src={`${process.env.PUBLIC_URL}/maestro-logo.png`} alt="Maestro" className="brand-logo" />
          <span className="brand-sub">GESTURE CONTROLLED DJ CONSOLE</span>
        </div>
        <div className="instructions">
          PINCH to grab &bull; DRAG to adjust &bull; TAP pads
          <button className="help-btn" onClick={() => setShowOnboarding(true)}>HELP</button>
        </div>
      </div>

      <div className="ctrl-main">
        {renderDeck('A')}

        <div className="mixer">
          <span className="mixer-label">MIXER</span>
          <div className="eq-row">
            <div className="eq-col">
              {renderMixFader('eq-high-A', 'HI', djState.A.eqHigh, -12, 12)}
              {renderMixFader('eq-mid-A', 'MID', djState.A.eqMid, -12, 12)}
              {renderMixFader('eq-low-A', 'LOW', djState.A.eqLow, -12, 12)}
            </div>
            <div className="eq-col">
              {renderMixFader('eq-high-B', 'HI', djState.B.eqHigh, -12, 12)}
              {renderMixFader('eq-mid-B', 'MID', djState.B.eqMid, -12, 12)}
              {renderMixFader('eq-low-B', 'LOW', djState.B.eqLow, -12, 12)}
            </div>
          </div>

          <div className="dot-grid" />

          <div className="faders-row">
            {renderMixFader('filter-A', 'FLT', djState.A.filter, 60, 20000)}
            {renderMixFader('delay-A', 'FX', djState.A.delay, 0, 1)}
            {renderMeter('A')}
            <div className="fader-group vol-fader">
              <span className="fader-label">CH 1</span>
              <div className="fader-slot">
                <div className="fader-ticks">
                  {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 0 ? ' tick-bold' : ''}`} key={i} />)}
                </div>
                <div className={`fader-track${cc('volume-A')}`} data-control="volume-A" onMouseDown={handleMouseDown('volume-A')}>
                  <div className="fader-fill" style={{ height: `${djState.A.volume * 100}%` }} />
                  <div className="fader-thumb" style={{ bottom: `${djState.A.volume * 100}%` }} />
                </div>
                <div className="fader-ticks">
                  {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 0 ? ' tick-bold' : ''}`} key={i} />)}
                </div>
              </div>
            </div>
            <div className="fader-group vol-fader">
              <span className="fader-label">CH 2</span>
              <div className="fader-slot">
                <div className="fader-ticks">
                  {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 0 ? ' tick-bold' : ''}`} key={i} />)}
                </div>
                <div className={`fader-track${cc('volume-B')}`} data-control="volume-B" onMouseDown={handleMouseDown('volume-B')}>
                  <div className="fader-fill" style={{ height: `${djState.B.volume * 100}%` }} />
                  <div className="fader-thumb" style={{ bottom: `${djState.B.volume * 100}%` }} />
                </div>
                <div className="fader-ticks">
                  {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 0 ? ' tick-bold' : ''}`} key={i} />)}
                </div>
              </div>
            </div>
            {renderMeter('B')}
            {renderMixFader('filter-B', 'FLT', djState.B.filter, 60, 20000)}
            {renderMixFader('delay-B', 'FX', djState.B.delay, 0, 1)}
          </div>

          <div className="crossfader-area">
            <div className="cf-labels"><span>A</span><span>B</span></div>
            <div className="cf-slot">
              <div className="cf-ticks">
                {[...Array(11)].map((_, i) => <div className={`cf-tick${i === 5 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
              <div className={`cf-track${cc('crossfader')}`} data-control="crossfader" onMouseDown={handleMouseDown('crossfader')}>
                <div className="cf-thumb" style={{ left: `${djState.crossfader * 100}%` }} />
              </div>
              <div className="cf-ticks">
                {[...Array(11)].map((_, i) => <div className={`cf-tick${i === 5 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
            </div>
          </div>
        </div>

        {renderDeck('B')}
      </div>
    </div>
    </div>
    <a href="https://anmolbhardwaj.com" target="_blank" rel="noopener noreferrer" className="controller-tagline">ANMOLBHARDWAJ.COM</a>
    </div>
  );
}
