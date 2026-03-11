class DJAudioEngine {
  constructor() {
    this.ctx = null;
    this.decks = {};
    this.crossfader = 0.5;
    this.masterGain = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    ['A', 'B'].forEach((id) => {
      const gain = this.ctx.createGain();
      gain.gain.value = 0.8;

      const eqLow = this.ctx.createBiquadFilter();
      eqLow.type = 'lowshelf';
      eqLow.frequency.value = 320;
      eqLow.gain.value = 0;

      const eqMid = this.ctx.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1000;
      eqMid.Q.value = 0.5;
      eqMid.gain.value = 0;

      const eqHigh = this.ctx.createBiquadFilter();
      eqHigh.type = 'highshelf';
      eqHigh.frequency.value = 3200;
      eqHigh.gain.value = 0;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 1;

      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.value = 0.3;
      const delayFeedback = this.ctx.createGain();
      delayFeedback.gain.value = 0;
      const delayWet = this.ctx.createGain();
      delayWet.gain.value = 0;

      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(filter);
      filter.connect(gain);

      filter.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(gain);

      gain.connect(this.masterGain);

      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);

      this.decks[id] = {
        buffer: null, source: null, gain, eqLow, eqMid, eqHigh, filter,
        delay, delayFeedback, delayWet, analyser, entryNode: eqLow,
        playing: false, startTime: 0, pauseOffset: 0, pitch: 1.0, volume: 0.8,
        waveformPeaks: null,
      };
    });

    this.initialized = true;
  }

  async loadTrack(deckId, file) {
    this.init();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    const deck = this.decks[deckId];
    if (deck.playing) this.stop(deckId);
    deck.buffer = audioBuffer;
    deck.pauseOffset = 0;

    const channelData = audioBuffer.getChannelData(0);
    const numSamples = 300;
    const step = Math.floor(channelData.length / numSamples);
    const peaks = [];
    for (let i = 0; i < numSamples; i++) {
      let max = 0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < channelData.length) {
          const abs = Math.abs(channelData[idx]);
          if (abs > max) max = abs;
        }
      }
      peaks.push(max);
    }
    deck.waveformPeaks = peaks;
    return audioBuffer;
  }

  play(deckId) {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const deck = this.decks[deckId];
    if (!deck || !deck.buffer || deck.playing) return;

    const source = this.ctx.createBufferSource();
    source.buffer = deck.buffer;
    source.playbackRate.value = deck.pitch;
    source.connect(deck.entryNode);
    source.start(0, deck.pauseOffset);

    deck.source = source;
    deck.startTime = this.ctx.currentTime;
    deck.playing = true;

    source.onended = () => {
      if (deck.playing) {
        deck.playing = false;
        deck.pauseOffset = 0;
      }
    };
  }

  pause(deckId) {
    const deck = this.decks[deckId];
    if (!deck.playing || !deck.source) return;
    const elapsed = this.ctx.currentTime - deck.startTime;
    deck.pauseOffset = deck.pauseOffset + elapsed * deck.pitch;
    if (deck.buffer && deck.pauseOffset >= deck.buffer.duration) deck.pauseOffset = 0;
    deck.source.stop();
    deck.source.disconnect();
    deck.source = null;
    deck.playing = false;
  }

  stop(deckId) {
    const deck = this.decks[deckId];
    if (deck.source) {
      try { deck.source.stop(); } catch (e) {}
      deck.source.disconnect();
      deck.source = null;
    }
    deck.playing = false;
    deck.pauseOffset = 0;
  }

  togglePlay(deckId) {
    this.init();
    const deck = this.decks[deckId];
    if (!deck) return false;
    if (deck.playing) this.pause(deckId);
    else this.play(deckId);
    return deck.playing;
  }

  setPitch(deckId, rate) {
    const deck = this.decks[deckId];
    if (deck.playing && deck.source) {
      const elapsed = this.ctx.currentTime - deck.startTime;
      deck.pauseOffset = deck.pauseOffset + elapsed * deck.pitch;
      deck.startTime = this.ctx.currentTime;
      deck.source.playbackRate.value = rate;
    }
    deck.pitch = rate;
  }

  setVolume(deckId, vol) {
    const deck = this.decks[deckId];
    deck.volume = Math.max(0, Math.min(1, vol));
    this._updateGains();
  }

  setCrossfader(value) {
    this.crossfader = Math.max(0, Math.min(1, value));
    this._updateGains();
  }

  _updateGains() {
    const cf = this.crossfader;
    const gainA = Math.cos(cf * Math.PI / 2);
    const gainB = Math.sin(cf * Math.PI / 2);
    if (this.decks['A']) this.decks['A'].gain.gain.value = this.decks['A'].volume * gainA;
    if (this.decks['B']) this.decks['B'].gain.gain.value = this.decks['B'].volume * gainB;
  }

  setEQ(deckId, band, value) {
    const deck = this.decks[deckId];
    const dbValue = Math.max(-12, Math.min(12, value));
    if (band === 'low') deck.eqLow.gain.value = dbValue;
    else if (band === 'mid') deck.eqMid.gain.value = dbValue;
    else if (band === 'high') deck.eqHigh.gain.value = dbValue;
  }

  setFilter(deckId, freq) {
    this.decks[deckId].filter.frequency.value = Math.max(60, Math.min(20000, freq));
  }

  setDelayMix(deckId, mix) {
    const deck = this.decks[deckId];
    const val = Math.max(0, Math.min(1, mix));
    deck.delayFeedback.gain.value = val * 0.6;
    deck.delayWet.gain.value = val * 0.5;
  }

  getPlaybackPosition(deckId) {
    const deck = this.decks[deckId];
    if (!deck || !deck.buffer) return 0;
    if (!deck.playing) return deck.pauseOffset / deck.buffer.duration;
    const elapsed = this.ctx.currentTime - deck.startTime;
    const pos = deck.pauseOffset + elapsed * deck.pitch;
    return (pos % deck.buffer.duration) / deck.buffer.duration;
  }

  getDuration(deckId) {
    const deck = this.decks[deckId];
    if (!deck || !deck.buffer) return 0;
    return deck.buffer.duration;
  }

  getWaveformPeaks(deckId) {
    if (!this.decks[deckId]) return null;
    return this.decks[deckId].waveformPeaks || null;
  }

  getFrequencyData(deckId) {
    const deck = this.decks[deckId];
    if (!deck?.analyser) return null;
    const data = new Uint8Array(deck.analyser.frequencyBinCount);
    deck.analyser.getByteFrequencyData(data);
    return data;
  }
}

const engine = new DJAudioEngine();
export default engine;
