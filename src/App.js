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
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  'volume-A':  { min: 0, max: 1, sens: 0.004, type: 'slider' },
  'volume-B':  { min: 0, max: 1, sens: 0.004, type: 'slider' },
  'pitch-A':   { min: 0.5, max: 1.5, sens: 0.004, type: 'slider' },
  'pitch-B':   { min: 0.5, max: 1.5, sens: 0.004, type: 'slider' },
  'eq-low-A':  { min: -12, max: 12, sens: 0.1 },
  'eq-mid-A':  { min: -12, max: 12, sens: 0.1 },
  'eq-high-A': { min: -12, max: 12, sens: 0.1 },
  'eq-low-B':  { min: -12, max: 12, sens: 0.1 },
  'eq-mid-B':  { min: -12, max: 12, sens: 0.1 },
  'eq-high-B': { min: -12, max: 12, sens: 0.1 },
  'filter-A':  { min: 60, max: 20000, sens: 80 },
  'filter-B':  { min: 60, max: 20000, sens: 80 },
  'delay-A':   { min: 0, max: 1, sens: 0.004 },
  'delay-B':   { min: 0, max: 1, sens: 0.004 },
  crossfader:  { min: 0, max: 1, sens: 0.004, type: 'slider', horizontal: true },
};

function magneticSnap(rawX, rawY) {
  const controls = document.querySelectorAll('[data-control]');
  let nearest = null, nearestDist = Infinity, cx = rawX, cy = rawY;
  controls.forEach((el) => {
    const r = el.getBoundingClientRect();
    const ecx = r.left + r.width / 2, ecy = r.top + r.height / 2;
    const d = Math.hypot(rawX - ecx, rawY - ecy);
    if (d < nearestDist) { nearestDist = d; nearest = el.dataset.control; cx = ecx; cy = ecy; }
  });
  if (nearest && nearestDist < SNAP_RADIUS) {
    const t = SNAP_STRENGTH * (1 - nearestDist / SNAP_RADIUS);
    return { x: rawX + (cx - rawX) * t, y: rawY + (cy - rawY) * t, snappedTo: nearest };
  }
  return { x: rawX, y: rawY, snappedTo: null };
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [djState, setDjState] = useState({
    A: { loaded: false, trackName: '', playing: false, pitch: 1.0, volume: 0.8, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 20000, delay: 0 },
    B: { loaded: false, trackName: '', playing: false, pitch: 1.0, volume: 0.8, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 20000, delay: 0 },
    crossfader: 0.5,
  });
  const [handPositions, setHandPositions] = useState([]);
  const [hoveredControl, setHoveredControl] = useState(null);
  const [grabbedControl, setGrabbedControl] = useState(null);
  const [snappedControl, setSnappedControl] = useState(null);
  const [playbackPos, setPlaybackPos] = useState({ A: 0, B: 0 });
  const [jogAngles, setJogAngles] = useState({ A: 0, B: 0 });
  const [activePads, setActivePads] = useState({});

  const interactionRef = useRef([
    { grabbed: null, lastY: 0, lastX: 0, deadZonePassed: false, pinchStartTime: 0, pinchStartPos: { x: 0, y: 0 } },
    { grabbed: null, lastY: 0, lastX: 0, deadZonePassed: false, pinchStartTime: 0, pinchStartPos: { x: 0, y: 0 } },
  ]);
  const padAudioCtxRef = useRef(null);
  const djStateRef = useRef(djState);
  useEffect(() => { djStateRef.current = djState; }, [djState]);
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
    engine.init();
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

  const triggerPad = useCallback((padIndex) => {
    if (!padAudioCtxRef.current) padAudioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = padAudioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    PAD_SOUNDS[padIndex]?.play(ctx);
    setActivePads((p) => ({ ...p, [padIndex]: true }));
    setTimeout(() => setActivePads((p) => ({ ...p, [padIndex]: false })), 150);
  }, []);

  const togglePlay = useCallback((deck) => { engine.init(); const p = engine.togglePlay(deck); setDjState((s) => ({ ...s, [deck]: { ...s[deck], playing: p } })); }, []);

  const loadTrack = useCallback(async (deck, file) => {
    engine.init();
    await engine.loadTrack(deck, file);
    setDjState((s) => ({ ...s, [deck]: { ...s[deck], loaded: true, trackName: file.name, playing: false } }));
  }, []);

  const handleDrop = useCallback((deck) => (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith('audio/')) loadTrack(deck, f); e.currentTarget.classList.remove('drag-over'); }, [loadTrack]);
  const handleDragOver = (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
  const handleDragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };

  const handleHandData = useCallback((handsData) => {
    let newHovered = null, newGrabbed = null, newSnapped = null;
    const displayPositions = [];
    handsData.forEach((hand, i) => {
      const interaction = interactionRef.current[i];
      const isGrabbing = hand.pinching && interaction.grabbed;
      let cursorX, cursorY, snapInfo;
      if (isGrabbing) { cursorX = hand.x; cursorY = hand.y; snapInfo = { snappedTo: interaction.grabbed }; }
      else { snapInfo = magneticSnap(hand.x, hand.y); cursorX = snapInfo.x; cursorY = snapInfo.y; }
      displayPositions.push({ x: cursorX, y: cursorY, pinching: hand.pinching, snapped: snapInfo.snappedTo !== null && !isGrabbing });
      if (snapInfo.snappedTo) newSnapped = snapInfo.snappedTo;
      const el = document.elementFromPoint(cursorX, cursorY);
      const controlEl = el?.closest('[data-control]');
      const controlId = controlEl?.dataset?.control || snapInfo.snappedTo;
      if (controlId) newHovered = controlId;
      if (hand.justPinched) {
        interaction.pinchStartTime = performance.now();
        interaction.pinchStartPos = { x: hand.x, y: hand.y };
        if (controlId) {
          if (controlId.startsWith('play-')) { togglePlay(controlId.split('-')[1]); }
          else if (controlId.startsWith('pad-')) {
            triggerPad(parseInt(controlId.split('-')[1], 10));
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
          const padEl = document.elementFromPoint(hand.x, hand.y)?.closest('[data-control^="pad-"]');
          if (padEl && !controlId?.startsWith('pad-')) {
            triggerPad(parseInt(padEl.dataset.control.split('-')[1], 10));
          }
        }
        interaction.grabbed = null;
      } else if (isGrabbing) {
        const cid = interaction.grabbed;
        const def = CONTROL_DEFS[cid];
        const cel = document.querySelector(`[data-control="${cid}"]`);
        if (cel) { const r = cel.getBoundingClientRect(); if (Math.hypot(hand.x - (r.left+r.width/2), hand.y - (r.top+r.height/2)) > MAX_DRAG_DIST) { interaction.grabbed = null; return; } }
        newGrabbed = cid;
        if (def) {
          const dx = hand.x - interaction.lastX;
          const dy = interaction.lastY - hand.y;
          if (!interaction.deadZonePassed) {
            const dist = def.horizontal ? Math.abs(dx) : Math.abs(dy);
            if (dist > DEAD_ZONE) {
              interaction.deadZonePassed = true;
              interaction.lastX = hand.x;
              interaction.lastY = hand.y;
            }
          } else {
            const delta = def.horizontal ? dx : dy;
            const curVal = getControlValue(cid);
            applyControl(cid, curVal + delta * def.sens);
            interaction.lastX = hand.x;
            interaction.lastY = hand.y;
          }
        }
      } else if (!hand.pinching) { interaction.grabbed = null; }
    });
    for (let i = handsData.length; i < 2; i++) interactionRef.current[i].grabbed = null;
    setHandPositions(displayPositions); setHoveredControl(newHovered); setGrabbedControl(newGrabbed); setSnappedControl(newSnapped);
  }, [getControlValue, applyControl, togglePlay, triggerPad]);

  const mouseInteraction = useRef({ active: false, controlId: null, startY: 0, startX: 0, startValue: 0 });
  const handleMouseDown = useCallback((controlId) => (e) => {
    e.preventDefault();
    if (controlId.startsWith('play-')) { togglePlay(controlId.split('-')[1]); return; }
    if (controlId.startsWith('pad-')) { triggerPad(parseInt(controlId.split('-')[1], 10)); return; }
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

    const peaks = engine.getWaveformPeaks(deckId);
    const pos = engine.getPlaybackPosition(deckId);
    if (peaks) {
      const barW = w / peaks.length;
      peaks.forEach((peak, i) => {
        const x = i * barW, bh = peak * h * 0.7;
        ctx.fillStyle = (i / peaks.length) < pos ? 'rgba(232,130,12,0.3)' : 'rgba(232,130,12,0.08)';
        ctx.fillRect(x, (h - bh) / 2, barW - 1, bh);
      });
      ctx.beginPath(); ctx.moveTo(pos * w, 0); ctx.lineTo(pos * w, h);
      ctx.strokeStyle = '#e8820c'; ctx.lineWidth = 2; ctx.stroke();
    }

    const freqData = engine.getFrequencyData(deckId);
    if (freqData) {
      const barCount = 48;
      const step = Math.floor(freqData.length / barCount);
      const bw = w / barCount;
      const gap = 2;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqData[i * step + j];
        const avg = sum / step / 255;
        const barH = avg * h * 0.9;
        const x = i * bw;
        if (avg > 0.01) {
          ctx.fillStyle = `rgba(232, 130, 12, ${0.4 + avg * 0.5})`;
          ctx.fillRect(x + gap / 2, h - barH, bw - gap, barH);
          if (barH > 3) {
            ctx.fillStyle = `rgba(255, 170, 40, ${0.6 + avg * 0.4})`;
            ctx.fillRect(x + gap / 2, h - barH, bw - gap, 2);
          }
        }
      }
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
            <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadTrack(deckId, f); }} />
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

          <div className="tempo-wrap">
            <span className="tempo-label">TEMPO</span>
            <div className="fader-slot">
              <div className="fader-ticks">
                {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 5 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
              <div className={`tempo-track${cc(`pitch-${deckId}`)}`} data-control={`pitch-${deckId}`} onMouseDown={handleMouseDown(`pitch-${deckId}`)}>
                <div className="tempo-thumb" style={{ bottom: `${pitchPct}%` }} />
              </div>
              <div className="fader-ticks">
                {[...Array(11)].map((_, i) => <div className={`fader-tick${i === 5 ? ' tick-bold' : ''}`} key={i} />)}
              </div>
            </div>
            <span className="tempo-val">{d.pitch.toFixed(2)}x</span>
          </div>
        </div>

        <div className="transport">
          <div className={`play-btn${d.playing ? ' playing' : ''}`} data-control={`play-${deckId}`} onMouseDown={handleMouseDown(`play-${deckId}`)}>
            {d.playing ? '\u23F8' : '\u25B6'}
          </div>
          <div className={`led${d.playing ? ' on' : ''}`} />
          <span className="time-display">{formatTime(pos * dur)} / {formatTime(dur)}</span>
        </div>

        <div className="pad-grid">
          {PAD_SOUNDS.slice(deckId === 'A' ? 0 : 4, deckId === 'A' ? 4 : 8).map((pad, i) => {
            const idx = deckId === 'A' ? i : i + 4;
            return (
              <div
                key={idx}
                className={`drum-pad${activePads[idx] ? ' pad-active' : ''}${cc(`pad-${idx}`)}`}
                data-control={`pad-${idx}`}
                onMouseDown={handleMouseDown(`pad-${idx}`)}
              >
                <span className="pad-name">{pad.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

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

  const handleStart = () => {
    setFadeOut(true);
    setTimeout(() => setStarted(true), 600);
  };

  if (!started) {
    return (
      <div className={`splash-screen${fadeOut ? ' fade-out' : ''}`} style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/splash-bg.png)` }}>
        <div className="splash-overlay" />
        <a href="https://anmolbhardwaj.com" target="_blank" rel="noopener noreferrer" className="splash-top-link">ANMOLBHARDWAJ.COM</a>
        <div className="splash-content">
          <img src={`${process.env.PUBLIC_URL}/maestro-logo.png`} alt="Maestro" className="splash-logo" />
          <button className="splash-start-btn" onClick={handleStart}>
            START MIXING
          </button>
        </div>
        <p className="splash-tagline">NO HARDWARE. NO TOUCH. JUST GESTURES.</p>
      </div>
    );
  }

  return (
    <div className="controller-bg" style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/splash-bg.png)` }}>
    <div className="controller fade-in">
      {showOnboarding && (
        <div className="onboarding-overlay" onClick={() => setShowOnboarding(false)}>
          <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="onboarding-title">HOW TO USE</h2>
            <div className="onboarding-steps">
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 40 40" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 36v-8M20 28c-2 0-3.5-1.5-3.5-3.5V14c0-1.5 1.5-3 3.5-3s3.5 1.5 3.5 3v10.5c0 2-1.5 3.5-3.5 3.5z"/>
                  <path d="M13.5 22V17c0-1.5 1.2-2.5 2.5-2.5s2.5 1 2.5 2.5"/>
                  <path d="M23.5 16.5V17c0-1.5 1.2-2.5 2.5-2.5s2.5 1 2.5 2.5v5"/>
                  <path d="M28.5 22v-3c0-1.5 1-2.5 2-2.5s2 1 2 2.5v5c0 6-4 12-12.5 12"/>
                  <path d="M7.5 22v-5c0-1.5 1-2.5 2.2-2.5s2.3 1 2.3 2.5"/>
                  <circle cx="20" cy="8" r="1.5" fill="rgba(232,130,12,0.4)" stroke="none"/>
                </svg>
                <div>
                  <strong>SHOW YOUR HAND</strong>
                  <p>Hold your hand up in front of the webcam. A cursor will follow your index finger.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 40 40" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 20c0-2 1.5-3.5 3.5-3.5"/>
                  <path d="M24 20c0-2-1.5-3.5-3.5-3.5"/>
                  <path d="M16 20v6c0 3 2 5 4 5s4-2 4-5v-6"/>
                  <path d="M13 18l3 2M27 18l-3 2"/>
                  <path d="M16 14l1-3M24 14l-1-3"/>
                  <circle cx="20" cy="16.5" r="2" fill="rgba(232,130,12,0.3)" stroke="rgba(232,130,12,0.7)"/>
                  <path d="M18 16.5h4" strokeDasharray="1 1.5"/>
                </svg>
                <div>
                  <strong>PINCH TO GRAB</strong>
                  <p>Pinch your thumb and index finger together to grab any knob, fader, or button.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 40 40" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 8v24"/>
                  <path d="M15 12l5-4 5 4"/>
                  <path d="M15 28l5 4 5-4"/>
                  <rect x="12" y="17" width="16" height="6" rx="2" fill="rgba(232,130,12,0.1)" stroke="rgba(232,130,12,0.5)"/>
                  <line x1="17" y1="19" x2="17" y2="21" strokeWidth="1"/>
                  <line x1="20" y1="19" x2="20" y2="21" strokeWidth="1"/>
                  <line x1="23" y1="19" x2="23" y2="21" strokeWidth="1"/>
                </svg>
                <div>
                  <strong>DRAG TO ADJUST</strong>
                  <p>While pinching, move your hand up/down to change values. Release to let go.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <svg className="onboarding-icon" viewBox="0 0 40 40" fill="none" stroke="rgba(232,130,12,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="12" width="28" height="16" rx="2" fill="rgba(232,130,12,0.05)"/>
                  <path d="M10 22h8M10 24h6"/>
                  <path d="M24 22h6M24 24h4"/>
                  <path d="M10 18h20" strokeDasharray="2 1.5"/>
                  <path d="M3 20l4-2v4zM37 20l-4-2v4z" fill="rgba(232,130,12,0.3)"/>
                </svg>
                <div>
                  <strong>LOAD TRACKS</strong>
                  <p>Drag and drop audio files onto the waveform area or click LOAD to browse.</p>
                </div>
              </div>
            </div>
            <p className="onboarding-disclaimer">This project is still in active development. Some features may not work as expected.</p>
            <button className="onboarding-close-btn" onClick={() => setShowOnboarding(false)}>GOT IT</button>
          </div>
        </div>
      )}
      <HandTracker onHandData={handleHandData} />
      {handPositions.map((h, i) => (
        <div key={i} className={`hand-cursor ${h.pinching ? 'pinched' : 'open'}${h.snapped ? ' snapped' : ''}`} style={{ left: h.x, top: h.y }} />
      ))}

      <div className="ctrl-header">
        <div className="brand">
          <span className="brand-title">MAESTRO</span>
          <span className="brand-sub">TOUCHLESS DJ CONTROLLER</span>
        </div>
        <div className="instructions">PINCH to grab &bull; DRAG to adjust &bull; TAP pads</div>
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
              {renderMixFader('filter-A', 'FLT', djState.A.filter, 60, 20000)}
              {renderMixFader('delay-A', 'FX', djState.A.delay, 0, 1)}
            </div>
            <div className="eq-col">
              {renderMixFader('eq-high-B', 'HI', djState.B.eqHigh, -12, 12)}
              {renderMixFader('eq-mid-B', 'MID', djState.B.eqMid, -12, 12)}
              {renderMixFader('eq-low-B', 'LOW', djState.B.eqLow, -12, 12)}
              {renderMixFader('filter-B', 'FLT', djState.B.filter, 60, 20000)}
              {renderMixFader('delay-B', 'FX', djState.B.delay, 0, 1)}
            </div>
          </div>

          <div className="faders-row">
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
  );
}
