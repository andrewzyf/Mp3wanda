/* ==========================================================================
   MP3 Wanda — Personal Offline Audio Studio
   100% Client-Side • IndexedDB Vault • ID3v2 Parser • Web Audio EQ & Mixer
   ========================================================================== */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. Safe Storage Helpers & HTML Escaping
  // --------------------------------------------------------------------------
  const memoryStore = {};
  const SafeStore = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memoryStore[key] ?? null;
      }
    },
    set(key, val) {
      try {
        window.localStorage.setItem(key, val);
      } catch {
        memoryStore[key] = val;
      }
    }
  };

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function formatDurationHuman(seconds) {
    const s = Math.round(seconds || 0);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${(s / 3600).toFixed(1)}h`;
  }

  function getTodayKey(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getWeekKey(dateObj = new Date()) {
    const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  function showToast(message) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 2700);
  }

  // --------------------------------------------------------------------------
  // 2. Offline IndexedDB Media Vault (with In-Memory Fallback)
  // --------------------------------------------------------------------------
  const memoryBlobs = new Map();
  const VaultDB = {
    dbName: 'MP3WandaVault',
    storeName: 'mediaBlobs',
    open() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('No IDB'));
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('IDB timeout'));
          }
        }, 1000);
        try {
          const req = indexedDB.open(this.dbName, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              db.createObjectStore(this.storeName);
            }
          };
          req.onsuccess = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(req.result);
            }
          };
          req.onerror = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(req.error);
            }
          };
          req.onblocked = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(new Error('IDB blocked'));
            }
          };
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      });
    },
    async saveFile(id, blob) {
      memoryBlobs.set(id, blob);
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          tx.objectStore(this.storeName).put(blob, id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch {
        return true;
      }
    },
    async getFileUrl(id) {
      if (memoryBlobs.has(id)) {
        return URL.createObjectURL(memoryBlobs.get(id));
      }
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readonly');
          const req = tx.objectStore(this.storeName).get(id);
          req.onsuccess = () => {
            if (req.result) {
              memoryBlobs.set(id, req.result);
              resolve(URL.createObjectURL(req.result));
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    },
    async deleteFile(id) {
      memoryBlobs.delete(id);
      try {
        const db = await this.open();
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(id);
      } catch {}
    }
  };

  // --------------------------------------------------------------------------
  // 3. Curated Cover Themes & Ambient Tint Map
  // --------------------------------------------------------------------------
  const COVER_THEMES = [
    { id: 'grad-emerald', label: 'Emerald', tint: 'rgba(16, 185, 129, 0.16)' },
    { id: 'grad-ocean',   label: 'Ocean',   tint: 'rgba(14, 165, 233, 0.16)' },
    { id: 'grad-amber',   label: 'Amber',   tint: 'rgba(245, 158, 11, 0.16)' },
    { id: 'grad-coral',   label: 'Coral',   tint: 'rgba(244, 63, 94, 0.16)' },
    { id: 'grad-sage',    label: 'Sage',    tint: 'rgba(52, 211, 153, 0.15)' },
    { id: 'grad-copper',  label: 'Copper',  tint: 'rgba(234, 88, 12, 0.15)' },
    { id: 'grad-forest',  label: 'Forest',  tint: 'rgba(34, 197, 94, 0.15)' },
    { id: 'grad-slate',   label: 'Slate',   tint: 'rgba(100, 116, 139, 0.18)' }
  ];

  function getTintForClass(gradClass) {
    const found = COVER_THEMES.find((t) => t.id === gradClass);
    return found ? found.tint : COVER_THEMES[0].tint;
  }

  // --------------------------------------------------------------------------
  // 4. Built-In Musical Demo Synthesizer (Warm Playable Stereo WAV Blobs)
  // --------------------------------------------------------------------------
  function encodeWavStereo(left, right, sampleRate) {
    const numSamples = left.length;
    const buffer = new ArrayBuffer(44 + numSamples * 4);
    const view = new DataView(buffer);

    function writeStr(offset, s) {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 4, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 4, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
      view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      offset += 4;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function synthesizeDemoBlob(preset) {
    const sr = 22050;
    const duration = 18;
    const total = sr * duration;
    const L = new Float32Array(total);
    const R = new Float32Array(total);

    if (preset === 'horizon') {
      // Warm electric-piano Maj7 chords + mellow pulse
      const chords = [
        [220.0, 261.63, 329.63, 392.0], // Am7
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [196.0, 246.94, 293.66, 392.0], // G6
        [164.81, 196.0, 246.94, 329.63] // Em7
      ];
      const chordLen = 4.5;
      for (let i = 0; i < total; i++) {
        const t = i / sr;
        const cIdx = Math.floor(t / chordLen) % chords.length;
        const localT = t % chordLen;
        const env = Math.min(1, localT / 0.09) * Math.exp(-localT * 0.42);
        const chord = chords[cIdx];
        let sL = 0;
        let sR = 0;
        for (let k = 0; k < chord.length; k++) {
          const f = chord[k];
          const tone = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-localT * 1.4);
          const pan = 0.35 + (k / (chord.length - 1)) * 0.3;
          sL += tone * (1 - pan) * 0.22;
          sR += tone * pan * 0.22;
        }
        // Soft low bass note
        const bass = Math.sin(2 * Math.PI * (chord[0] * 0.5) * t) * env * 0.28;
        // Soft rhythmic pulse every 0.75s
        const beatT = t % 0.75;
        const kick = Math.sin(2 * Math.PI * (52 + 65 * Math.exp(-beatT * 28)) * beatT) * Math.exp(-beatT * 12) * 0.18;
        const fade = Math.min(1, t / 0.35) * Math.min(1, (duration - t) / 0.6);
        L[i] = (sL * env + bass + kick) * fade;
        R[i] = (sR * env + bass + kick) * fade;
      }
    } else if (preset === 'pulse') {
      // Dreamy synth arpeggio with gentle stereo motion
      const notes = [261.63, 329.63, 392.0, 493.88, 392.0, 329.63, 293.66, 392.0];
      const step = 0.375;
      for (let i = 0; i < total; i++) {
        const t = i / sr;
        const stepIdx = Math.floor(t / step);
        const localT = t % step;
        const f = notes[stepIdx % notes.length];
        const env = Math.min(1, localT / 0.025) * Math.exp(-localT * 5.2);
        const arp = (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(6 * Math.PI * f * t)) * env * 0.3;
        const padFreq = (Math.floor(t / 4.5) % 2 === 0) ? 130.81 : 146.83;
        const pad = (Math.sin(2 * Math.PI * padFreq * t) + 0.5 * Math.sin(2 * Math.PI * padFreq * 1.5 * t)) * 0.16;
        const pan = 0.5 + 0.32 * Math.sin(t * 0.9);
        const fade = Math.min(1, t / 0.35) * Math.min(1, (duration - t) / 0.6);
        L[i] = (arp * (1 - pan * 0.6) + pad) * fade;
        R[i] = (arp * (0.4 + pan * 0.6) + pad) * fade;
      }
    } else {
      // Velvet Raindrop: Soft pentatonic ambient harp chimes
      const scale = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
      const step = 1.125;
      for (let i = 0; i < total; i++) {
        const t = i / sr;
        const idx = Math.floor(t / step);
        const localT = t % step;
        const f = scale[(idx * 2 + (idx % 3)) % scale.length];
        const pluck = Math.min(1, localT / 0.02) * Math.exp(-localT * 2.1);
        const chime = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t) * Math.exp(-localT * 3)) * pluck * 0.32;
        const drone = Math.sin(2 * Math.PI * 146.83 * t) * 0.13 + Math.sin(2 * Math.PI * 220.0 * t) * 0.09;
        const pan = idx % 2 === 0 ? 0.32 : 0.68;
        const fade = Math.min(1, t / 0.4) * Math.min(1, (duration - t) / 0.7);
        L[i] = (chime * (1 - pan) + drone) * fade;
        R[i] = (chime * pan + drone) * fade;
      }
    }

    return encodeWavStereo(L, R, sr);
  }

  function createDefaultDemoTracks() {
    const demos = [
      {
        id: 'demo_wanda_horizon',
        title: 'Wanda Horizon',
        artist: 'MP3 Wanda Studio',
        mediaType: 'wav',
        duration: 18,
        plays: 0,
        secondsListened: 0,
        liked: true,
        isDemo: true,
        demoPreset: 'horizon',
        color: 'grad-emerald',
        coverArt: null,
        lyrics: [
          '[00:00] Warm Rhodes chords drift across the quiet room',
          '[00:04] Open Studio on the right to sculpt the 5-band EQ',
          '[00:09] Layer soft rain or vinyl crackle under the melody',
          '[00:13] Click any lyric line to jump straight to that moment'
        ].join('\n'),
        isLocalBlob: true,
        cachedOffline: true
      },
      {
        id: 'demo_obsidian_pulse',
        title: 'Obsidian Pulse',
        artist: 'MP3 Wanda Studio',
        mediaType: 'wav',
        duration: 18,
        plays: 0,
        secondsListened: 0,
        liked: false,
        isDemo: true,
        demoPreset: 'pulse',
        color: 'grad-ocean',
        coverArt: null,
        lyrics: [
          '[00:00] Stereo synth arpeggios moving in calm motion',
          '[00:05] Tap the album art below to enter Focus View',
          '[00:10] Drop your own MP3 or MP4 files anywhere on this window',
          '[00:14] Everything stays private inside your offline Vault'
        ].join('\n'),
        isLocalBlob: true,
        cachedOffline: true
      },
      {
        id: 'demo_velvet_raindrop',
        title: 'Velvet Raindrop',
        artist: 'Acoustic Lab',
        mediaType: 'wav',
        duration: 18,
        plays: 0,
        secondsListened: 0,
        liked: false,
        isDemo: true,
        demoPreset: 'raindrop',
        color: 'grad-amber',
        coverArt: null,
        lyrics: [
          '[00:00] Soft pentatonic chimes for deep work and reading',
          '[00:06] Try the Sleep Timer icon to fade out automatically',
          '[00:12] Clear demo tracks anytime once your own library is ready'
        ].join('\n'),
        isLocalBlob: true,
        cachedOffline: true
      }
    ];
    return demos;
  }

  // --------------------------------------------------------------------------
  // 5. Pure JS ID3v2 Tag & Embedded Cover Art Parser (for Real MP3 Imports)
  // --------------------------------------------------------------------------
  async function extractId3Metadata(file) {
    const meta = { title: '', artist: '', lyrics: '', coverArt: null };
    try {
      const slice = file.slice(0, Math.min(file.size, 512 * 1024));
      const buf = await slice.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 10) return meta;
      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return meta; // "ID3"

      const version = bytes[3];
      if (version !== 3 && version !== 4) return meta;

      const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
      const limit = Math.min(bytes.length, 10 + tagSize);
      let pos = 10;

      const decodeText = (arr, encoding) => {
        if (!arr.length) return '';
        try {
          if (encoding === 1 || encoding === 2) {
            return new TextDecoder(encoding === 2 ? 'utf-16be' : 'utf-16').decode(arr).replace(/\0/g, '').trim();
          }
          if (encoding === 3) {
            return new TextDecoder('utf-8').decode(arr).replace(/\0/g, '').trim();
          }
          return new TextDecoder('iso-8859-1').decode(arr).replace(/\0/g, '').trim();
        } catch {
          return '';
        }
      };

      while (pos + 10 < limit) {
        const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;

        let frameSize;
        if (version === 4) {
          frameSize = ((bytes[pos + 4] & 0x7f) << 21) | ((bytes[pos + 5] & 0x7f) << 14) | ((bytes[pos + 6] & 0x7f) << 7) | (bytes[pos + 7] & 0x7f);
        } else {
          frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
        }
        if (frameSize <= 0 || pos + 10 + frameSize > limit) break;

        const frameData = bytes.subarray(pos + 10, pos + 10 + frameSize);
        const enc = frameData[0];

        if (id === 'TIT2') {
          meta.title = decodeText(frameData.subarray(1), enc);
        } else if (id === 'TPE1') {
          meta.artist = decodeText(frameData.subarray(1), enc);
        } else if (id === 'USLT' && frameData.length > 5) {
          // Skip encoding (1) + language (3) + description (null terminated)
          let idx = 4;
          while (idx < frameData.length && frameData[idx] !== 0) idx++;
          idx += (enc === 1 || enc === 2) ? 2 : 1;
          if (idx < frameData.length) {
            meta.lyrics = decodeText(frameData.subarray(idx), enc);
          }
        } else if (id === 'APIC' && !meta.coverArt) {
          let idx = 1;
          let mimeEnd = idx;
          while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) mimeEnd++;
          const mime = new TextDecoder('iso-8859-1').decode(frameData.subarray(idx, mimeEnd)) || 'image/jpeg';
          idx = mimeEnd + 2; // skip null + picture type byte
          // skip description
          if (enc === 1 || enc === 2) {
            while (idx + 1 < frameData.length && !(frameData[idx] === 0 && frameData[idx + 1] === 0)) idx += 2;
            idx += 2;
          } else {
            while (idx < frameData.length && frameData[idx] !== 0) idx++;
            idx += 1;
          }
          if (idx < frameData.length) {
            const imgBlob = new Blob([frameData.subarray(idx)], { type: mime.includes('/') ? mime : 'image/jpeg' });
            meta.coverArt = await compressImageBlob(imgBlob, 240);
          }
        }

        pos += 10 + frameSize;
      }
    } catch {}
    return meta;
  }

  function compressImageBlob(blob, size = 240) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function probeAudioDuration(url) {
    return new Promise((resolve) => {
      const probe = new Audio();
      probe.preload = 'metadata';
      const cleanup = () => {
        probe.src = '';
      };
      probe.onloadedmetadata = () => {
        const d = Number.isFinite(probe.duration) ? probe.duration : 0;
        cleanup();
        resolve(d);
      };
      probe.onerror = () => {
        cleanup();
        resolve(0);
      };
      probe.src = url;
    });
  }

  // --------------------------------------------------------------------------
  // 6. Application State
  // --------------------------------------------------------------------------
  const state = {
    theme: SafeStore.get('wanda_theme') || 'dark',
    currentView: 'all',
    searchQuery: '',
    sortBy: 'custom',
    currentTrackId: null,
    isPlaying: false,
    isShuffle: false,
    loopMode: 'off', // off | all | one
    playbackSpeed: 1.0,
    volume: 0.8,
    isMuted: false,
    studioOpen: false,
    studioTab: 'lyrics',
    focusOpen: false,
    lyricsEditMode: false,
    eqBands: [0, 0, 0, 0, 0],
    eqPreset: 'flat',
    ambientLevels: { rain: 0, vinyl: 0, brown: 0, hearth: 0 },
    editingTrackId: null,
    playlistModalMode: 'create',
    songToAssign: null,
    draggedIndex: null,
    countedCurrentTrackPlay: false,
    playlists: [],
    tracks: [],
    stats: {
      totalSecondsListened: 0,
      dailySeconds: {},
      weeklySeconds: {}
    }
  };

  // --------------------------------------------------------------------------
  // 7. Audio Engine (Native + Lazy Web Audio EQ, Visualizer & 4-Layer Mixer)
  // --------------------------------------------------------------------------
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.preservesPitch = true;

  let audioCtx = null;
  let sourceNode = null;
  let analyser = null;
  let eqFilters = [];
  const eqFreqs = [60, 230, 910, 3600, 14000];
  const ambientNodes = { rain: null, vinyl: null, brown: null, hearth: null };
  let visualizerStarted = false;
  let lastTickTimestamp = null;
  let sleepTimerInterval = null;
  let sleepRemainingSec = 0;
  let activePlayRequestId = 0;
  let lastActiveLyricIdx = -1;

  function ensureAudioContext(connectMediaElement = true) {
    try {
      if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        audioCtx = new AudioCtx();
      }
      if (audioCtx.state === 'suspended' && !document.hidden) {
        audioCtx.resume().catch(() => {});
      }

      if (connectMediaElement && !sourceNode) {
        sourceNode = audioCtx.createMediaElementSource(audio);
        eqFilters = eqFreqs.map((freq, idx) => {
          const filter = audioCtx.createBiquadFilter();
          filter.type = idx === 0 ? 'lowshelf' : (idx === eqFreqs.length - 1 ? 'highshelf' : 'peaking');
          filter.frequency.value = freq;
          filter.Q.value = 1.05;
          filter.gain.value = state.eqBands[idx] || 0;
          return filter;
        });

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.82;

        sourceNode.connect(eqFilters[0]);
        for (let i = 0; i < eqFilters.length - 1; i++) {
          eqFilters[i].connect(eqFilters[i + 1]);
        }
        eqFilters[eqFilters.length - 1].connect(analyser);
        analyser.connect(audioCtx.destination);

        if (!visualizerStarted) {
          visualizerStarted = true;
          startVisualizerLoop();
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function startVisualizerLoop() {
    const strip = document.getElementById('audio-visualizer');
    const stripCtx = strip ? strip.getContext('2d') : null;
    const focusCanvas = document.getElementById('focus-wave');
    const focusCtx = focusCanvas ? focusCanvas.getContext('2d') : null;
    const bins = analyser ? analyser.frequencyBinCount : 64;
    const data = new Uint8Array(bins);

    function frame() {
      requestAnimationFrame(frame);
      if (document.hidden) return;

      if (analyser && !audio.paused) {
        analyser.getByteFrequencyData(data);
      } else {
        data.fill(0);
      }

      // 1. Subtle Top Edge Strip on Player Bar
      if (strip && stripCtx) {
        const w = strip.offsetWidth;
        const h = strip.offsetHeight;
        if (strip.width !== w || strip.height !== h) {
          strip.width = w;
          strip.height = h;
        }
        stripCtx.clearRect(0, 0, w, h);
        if (!audio.paused) {
          const barW = w / 48;
          const grad = stripCtx.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, '#0ea5e9');
          grad.addColorStop(0.55, '#22c58b');
          grad.addColorStop(1, '#f2a649');
          stripCtx.fillStyle = grad;
          for (let i = 0; i < 48; i++) {
            const v = data[i] / 255;
            stripCtx.globalAlpha = Math.max(0.08, v * 0.95);
            stripCtx.fillRect(i * barW, 0, Math.max(1, barW - 1), h);
          }
          stripCtx.globalAlpha = 1;
        }
      }

      // 2. Smooth Centered Bars in Focus View
      if (state.focusOpen && focusCanvas && focusCtx) {
        const w = focusCanvas.offsetWidth;
        const h = focusCanvas.offsetHeight;
        if (focusCanvas.width !== w || focusCanvas.height !== h) {
          focusCanvas.width = w;
          focusCanvas.height = h;
        }
        focusCtx.clearRect(0, 0, w, h);
        const count = 36;
        const gap = 4;
        const barW = (w - gap * (count - 1)) / count;
        const grad = focusCtx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#0ea5e9');
        grad.addColorStop(0.5, '#22c58b');
        grad.addColorStop(1, '#f2a649');
        focusCtx.fillStyle = grad;
        for (let i = 0; i < count; i++) {
          const v = audio.paused ? 0.08 : Math.max(0.08, data[i] / 255);
          const bh = Math.max(3, v * h);
          const x = i * (barW + gap);
          const y = (h - bh) / 2;
          focusCtx.beginPath();
          focusCtx.roundRect(x, y, barW, bh, 3);
          focusCtx.fill();
        }
      }
    }
    frame();
  }

  // Live EQ Frequency Curve Renderer
  function drawEqCurve() {
    const canvas = document.getElementById('eq-curve-canvas');
    if (!canvas) return;
    const w = canvas.offsetWidth || 280;
    const h = canvas.offsetHeight || 76;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Center 0 dB hairline
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Compute smooth curve across 5 band anchor points
    const pts = state.eqBands.map((db, idx) => {
      const x = (idx / (state.eqBands.length - 1)) * (w - 24) + 12;
      const y = h / 2 - (db / 14) * (h * 0.42);
      return { x, y };
    });

    // Area gradient fill
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, 'rgba(34, 197, 139, 0.28)');
    fillGrad.addColorStop(1, 'rgba(34, 197, 139, 0.0)');

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

    ctx.strokeStyle = '#22c58b';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.lineTo(pts[pts.length - 1].x, h);
    ctx.lineTo(pts[0].x, h);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Anchor nodes
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#22c58b';
      ctx.fill();
    });
  }

  function updateStudioButtonIndicator() {
    const btn = document.getElementById('btn-studio');
    if (!btn) return;
    const eqActive = state.eqBands.some((v) => Math.abs(v) > 0.01);
    const ambActive = Object.values(state.ambientLevels).some((v) => v > 0);
    btn.classList.toggle('active', state.studioOpen || eqActive || ambActive);
  }

  window.setEqBand = (idx, rawVal) => {
    const val = parseFloat(rawVal) || 0;
    state.eqBands[idx] = val;
    const label = document.getElementById(`eq-val-${idx}`);
    if (label) label.textContent = `${val > 0 ? '+' : ''}${val} dB`;

    ensureAudioContext(true);
    if (eqFilters[idx] && audioCtx) {
      eqFilters[idx].gain.setTargetAtTime(val, audioCtx.currentTime, 0.03);
    }
    drawEqCurve();
    updateStudioButtonIndicator();
    saveLocalState();
  };

  window.applyEqPreset = (preset) => {
    const presets = {
      flat:       [0, 0, 0, 0, 0],
      warmBass:   [6, 3.5, -0.5, 1, 1.5],
      vocal:      [-1.5, 1, 4.5, 3.5, 2],
      lateNight:  [3, 2, -1, -1.5, -2.5],
      electronic: [5.5, 1.5, -1.5, 3.5, 5],
      acoustic:   [2.5, 2, 1, 2.5, 3.5]
    };
    const vals = presets[preset] || presets.flat;
    state.eqPreset = preset;
    const sel = document.getElementById('eq-preset-select');
    if (sel) sel.value = preset;
    vals.forEach((v, i) => {
      const slider = document.getElementById(`eq-slider-${i}`);
      if (slider) slider.value = v;
      window.setEqBand(i, v);
    });
  };

  window.setAmbientLevel = (type, rawPercent) => {
    const percent = Math.max(0, Math.min(100, parseInt(rawPercent, 10) || 0));
    state.ambientLevels[type] = percent;

    const valEl = document.getElementById(`amb-val-${type}`);
    const cardEl = document.getElementById(`amb-card-${type}`);
    if (valEl) valEl.textContent = `${percent}%`;
    if (cardEl) cardEl.classList.toggle('is-on', percent > 0);

    const gainLevel = (percent / 100) * 0.2;

    if (percent === 0) {
      if (ambientNodes[type] && audioCtx) {
        ambientNodes[type].gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.08);
      }
      updateStudioButtonIndicator();
      return;
    }

    ensureAudioContext(false);
    if (!audioCtx) return;

    if (!ambientNodes[type]) {
      const bufferSize = audioCtx.sampleRate * 3;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0;

      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'rain') {
          data[i] = white * 0.55;
        } else if (type === 'vinyl') {
          data[i] = Math.random() > 0.9965 ? (Math.random() * 2 - 1) * 0.9 : white * 0.035;
        } else if (type === 'hearth') {
          lastOut = (lastOut + 0.03 * white) / 1.03;
          const crackle = Math.random() > 0.9982 ? (Math.random() * 1.4 - 0.7) : 0;
          data[i] = lastOut * 2.8 + crackle;
        } else {
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 3.4;
        }
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = audioCtx.createBiquadFilter();
      if (type === 'rain') {
        filter.type = 'bandpass';
        filter.frequency.value = 920;
        filter.Q.value = 0.7;
      } else if (type === 'vinyl') {
        filter.type = 'highpass';
        filter.frequency.value = 1200;
      } else if (type === 'hearth') {
        filter.type = 'lowpass';
        filter.frequency.value = 650;
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 280;
      }

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.setTargetAtTime(gainLevel, audioCtx.currentTime, 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start();
      ambientNodes[type] = { noise, gain };
    } else {
      ambientNodes[type].gain.gain.setTargetAtTime(gainLevel, audioCtx.currentTime, 0.08);
    }

    updateStudioButtonIndicator();
  };

  window.resetAmbientMixer = () => {
    ['rain', 'vinyl', 'brown', 'hearth'].forEach((type) => {
      const slider = document.getElementById(`amb-slider-${type}`);
      if (slider) slider.value = 0;
      window.setAmbientLevel(type, 0);
    });
    showToast('Atmosphere muted');
  };

  // --------------------------------------------------------------------------
  // 8. State Persistence & Backup Export / Import
  // --------------------------------------------------------------------------
  function saveLocalState() {
    const payload = {
      version: 2,
      playlists: state.playlists,
      tracks: state.tracks.map((t) => ({
        ...t,
        blobUrl: null,
        src: t.isLocalBlob ? '' : (t.src || '')
      })),
      stats: state.stats,
      isShuffle: state.isShuffle,
      loopMode: state.loopMode,
      eqBands: state.eqBands,
      eqPreset: state.eqPreset
    };
    SafeStore.set('wanda_library_v1', JSON.stringify(payload));
  }

  function loadLocalState() {
    const raw = SafeStore.get('wanda_library_v1');
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      state.playlists = Array.isArray(parsed.playlists) ? parsed.playlists : [];
      state.tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
      if (parsed.stats) {
        state.stats = {
          totalSecondsListened: parsed.stats.totalSecondsListened || 0,
          dailySeconds: parsed.stats.dailySeconds || {},
          weeklySeconds: parsed.stats.weeklySeconds || {}
        };
      }
      state.isShuffle = !!parsed.isShuffle;
      state.loopMode = parsed.loopMode || 'off';
      if (Array.isArray(parsed.eqBands) && parsed.eqBands.length === 5) {
        state.eqBands = parsed.eqBands;
      }
      if (parsed.eqPreset) state.eqPreset = parsed.eqPreset;
      return true;
    } catch {
      return false;
    }
  }

  async function hydrateAllTrackUrls() {
    for (const track of state.tracks) {
      if (track.blobUrl && track.blobUrl.startsWith('blob:')) continue;
      if (track.isDemo && track.demoPreset) {
        const blob = synthesizeDemoBlob(track.demoPreset);
        track.blobUrl = URL.createObjectURL(blob);
        track.src = track.blobUrl;
        track.cachedOffline = true;
        VaultDB.saveFile(track.id, blob).catch(() => {});
        continue;
      }
      const restored = await VaultDB.getFileUrl(track.id);
      if (restored) {
        track.blobUrl = restored;
        track.cachedOffline = true;
        if (track.isLocalBlob || !track.src || !navigator.onLine) {
          track.src = restored;
        }
      }
    }
  }

  window.exportLibraryBackup = () => {
    const data = {
      app: 'MP3 Wanda',
      exportedAt: new Date().toISOString(),
      playlists: state.playlists,
      tracks: state.tracks.map((t) => ({
        ...t,
        blobUrl: null,
        src: t.isLocalBlob ? '' : (t.src || '')
      })),
      stats: state.stats
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mp3-wanda-backup-${getTodayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exported');
  };

  window.importLibraryBackup = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result || '{}');
        if (!Array.isArray(parsed.tracks) && !Array.isArray(parsed.playlists)) {
          showToast('Invalid backup file');
          return;
        }
        if (Array.isArray(parsed.tracks)) {
          const existingIds = new Set(state.tracks.map((t) => t.id));
          parsed.tracks.forEach((t) => {
            if (!existingIds.has(t.id)) state.tracks.push(t);
          });
        }
        if (Array.isArray(parsed.playlists)) {
          const existingPl = new Set(state.playlists.map((p) => p.id));
          parsed.playlists.forEach((p) => {
            if (!existingPl.has(p.id)) state.playlists.push(p);
          });
        }
        if (parsed.stats) {
          state.stats.totalSecondsListened = Math.max(
            state.stats.totalSecondsListened || 0,
            parsed.stats.totalSecondsListened || 0
          );
          state.stats.dailySeconds = { ...(parsed.stats.dailySeconds || {}), ...(state.stats.dailySeconds || {}) };
          state.stats.weeklySeconds = { ...(parsed.stats.weeklySeconds || {}), ...(state.stats.weeklySeconds || {}) };
        }
        await hydrateAllTrackUrls();
        saveLocalState();
        renderAll();
        closeModal('vault-modal');
        showToast('Backup merged into Vault');
      } catch {
        showToast('Could not parse backup JSON');
      }
    };
    reader.readAsText(file);
  };

  window.removeDemoTracks = async () => {
    const demos = state.tracks.filter((t) => t.isDemo);
    if (!demos.length) {
      showToast('No demo tracks in library');
      return;
    }
    const demoIds = new Set(demos.map((d) => d.id));
    for (const id of demoIds) await VaultDB.deleteFile(id);
    state.tracks = state.tracks.filter((t) => !t.isDemo);
    state.playlists.forEach((pl) => {
      pl.trackIds = pl.trackIds.filter((id) => !demoIds.has(id));
    });
    if (demoIds.has(state.currentTrackId)) {
      audio.pause();
      state.isPlaying = false;
      state.currentTrackId = null;
      resetPlayerDisplay();
    }
    saveLocalState();
    renderAll();
    showToast('Demo tracks cleared');
  };

  window.restoreDemoTracks = async () => {
    const existingIds = new Set(state.tracks.map((t) => t.id));
    const defaults = createDefaultDemoTracks().filter((d) => !existingIds.has(d.id));
    if (!defaults.length) {
      showToast('Demo tracks are already loaded');
      return;
    }
    state.tracks.unshift(...defaults);
    await hydrateAllTrackUrls();
    saveLocalState();
    renderAll();
    closeModal('vault-modal');
    showToast('Demo soundscapes restored');
  };

  // --------------------------------------------------------------------------
  // 9. Importing Local Files, Drag-and-Drop Anywhere, & URLs
  // --------------------------------------------------------------------------
  async function importAudioFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const lyricFiles = files.filter((f) => /\.(vtt|lrc|txt)$/i.test(f.name));
    const audioFiles = files.filter((f) => !/\.(vtt|lrc|txt)$/i.test(f.name));

    if (lyricFiles.length && state.currentTrackId) {
      readLyricsFile(lyricFiles[0]);
    }

    if (!audioFiles.length) return;

    const btnLabel = document.getElementById('upload-btn-label');
    if (btnLabel) btnLabel.textContent = `Importing ${audioFiles.length} file(s)...`;

    let addedCount = 0;
    let firstAddedId = null;

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const extMatch = file.name.match(/\.([^/.]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const parts = cleanName.split(' - ');
      let artist = parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
      let title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanName;
      let lyrics = '';
      let coverArt = null;

      if (ext === 'mp3' || file.type === 'audio/mpeg') {
        const id3 = await extractId3Metadata(file);
        if (id3.title) title = id3.title;
        if (id3.artist) artist = id3.artist;
        if (id3.lyrics) lyrics = id3.lyrics;
        if (id3.coverArt) coverArt = id3.coverArt;
      }

      const trackId = `trk_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
      await VaultDB.saveFile(trackId, file);
      const blobUrl = URL.createObjectURL(file);
      const duration = await probeAudioDuration(blobUrl);

      const newTrack = {
        id: trackId,
        title,
        artist,
        mediaType: ext,
        duration,
        plays: 0,
        secondsListened: 0,
        liked: false,
        isDemo: false,
        color: COVER_THEMES[(state.tracks.length + i) % COVER_THEMES.length].id,
        coverArt,
        lyrics,
        src: blobUrl,
        blobUrl,
        isLocalBlob: true,
        cachedOffline: true
      };

      state.tracks.push(newTrack);
      if (!firstAddedId) firstAddedId = newTrack.id;
      addedCount++;

      if (state.currentView.startsWith('pl_')) {
        const pl = state.playlists.find((p) => p.id === state.currentView);
        if (pl) pl.trackIds.push(newTrack.id);
      }
    }

    if (btnLabel) btnLabel.textContent = 'Choose Audio / Video Files';
    closeModal('add-music-modal');
    saveLocalState();
    renderAll();
    showToast(`Added ${addedCount} track${addedCount === 1 ? '' : 's'} to offline Vault`);

    if (!state.currentTrackId && firstAddedId) {
      loadTrackById(firstAddedId, true);
    }
  }

  window.handleFileUpload = async (event) => {
    const files = event.target.files;
    await importAudioFiles(files);
    event.target.value = '';
  };

  window.addTrackFromUrl = async () => {
    const title = document.getElementById('url-song-title').value.trim();
    const artist = document.getElementById('url-song-artist').value.trim() || 'Unknown Artist';
    const src = document.getElementById('url-song-src').value.trim();

    if (!title || !src) {
      showToast('Please enter both a track title and a direct audio URL');
      return;
    }

    const ext = src.toLowerCase().split('?')[0].endsWith('.mp4') ? 'mp4' : 'mp3';
    const newTrack = {
      id: `trk_${Date.now()}`,
      title,
      artist,
      mediaType: ext,
      duration: 0,
      plays: 0,
      secondsListened: 0,
      liked: false,
      isDemo: false,
      color: COVER_THEMES[state.tracks.length % COVER_THEMES.length].id,
      coverArt: null,
      lyrics: '',
      src,
      blobUrl: null,
      isLocalBlob: false,
      cachedOffline: false
    };

    state.tracks.push(newTrack);
    if (state.currentView.startsWith('pl_')) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (pl) pl.trackIds.push(newTrack.id);
    }

    document.getElementById('url-song-title').value = '';
    document.getElementById('url-song-artist').value = '';
    document.getElementById('url-song-src').value = '';
    closeModal('add-music-modal');
    saveLocalState();
    renderAll();
    showToast(`Added "${title}"`);

    // Attempt background offline caching if CORS permits
    try {
      const res = await fetch(src);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          await VaultDB.saveFile(newTrack.id, blob);
          newTrack.blobUrl = URL.createObjectURL(blob);
          newTrack.cachedOffline = true;
          newTrack.duration = await probeAudioDuration(newTrack.blobUrl);
          saveLocalState();
          renderAll();
        }
      }
    } catch {}
  };

  // --------------------------------------------------------------------------
  // 10. Playback Engine & Transport Controls
  // --------------------------------------------------------------------------
  function getActiveQueue() {
    const visible = getFilteredTracks();
    if (visible.length) return visible;
    return state.tracks;
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: 'MP3 Wanda'
      });
      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSong(true));
    } catch {}
  }

  function applyTrackAmbientTint(track) {
    const tint = getTintForClass(track?.color);
    document.documentElement.style.setProperty('--hero-tint', tint);
  }

  function renderPlayerArtwork(el, track, iconSize = 20) {
    if (!el) return;
    el.className = el.className.replace(/\bgrad-\w+\b/g, '').trim();
    if (!track) {
      el.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>`;
      return;
    }
    if (track.coverArt) {
      el.innerHTML = `<img src="${track.coverArt}" alt="" />`;
    } else {
      el.classList.add(track.color || 'grad-emerald');
      el.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    }
  }

  function resetPlayerDisplay() {
    document.getElementById('player-title').textContent = 'Ready to play';
    document.getElementById('player-artist').textContent = 'Select a track from your library';
    document.getElementById('time-current').textContent = '0:00';
    document.getElementById('time-total').textContent = '0:00';
    document.getElementById('seek-bar').value = 0;
    renderPlayerArtwork(document.getElementById('player-art'), null);
    updatePlayButtonsUI();
    updateLikeButtonUI();
  }

  async function loadTrackById(trackId, autoPlay = true) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const reqId = ++activePlayRequestId;
    let resolvedSrc = track.blobUrl || track.src;

    if (!resolvedSrc || (!navigator.onLine && !resolvedSrc.startsWith('blob:'))) {
      const vaultUrl = await VaultDB.getFileUrl(track.id);
      if (reqId !== activePlayRequestId) return;
      if (vaultUrl) {
        track.blobUrl = vaultUrl;
        track.cachedOffline = true;
        resolvedSrc = vaultUrl;
      }
    }

    if (!resolvedSrc) {
      showToast('Audio file missing — link a direct URL or re-import');
      openEditSongModal(track.id);
      return;
    }

    lastTickTimestamp = null;
    state.currentTrackId = track.id;
    state.countedCurrentTrackPlay = false;
    lastActiveLyricIdx = -1;

    if (resolvedSrc.startsWith('blob:')) {
      audio.removeAttribute('crossOrigin');
    } else {
      audio.crossOrigin = 'anonymous';
    }

    audio.src = resolvedSrc;
    audio.playbackRate = state.playbackSpeed;
    audio.preservesPitch = true;

    applyTrackAmbientTint(track);
    updateMediaSession(track);
    updateNowPlayingUI(track);

    if (autoPlay) {
      state.isPlaying = true;
      updatePlayButtonsUI();
      ensureAudioContext(true);
      try {
        await audio.play();
        markTrackPlayed(track.id);
        lastTickTimestamp = Date.now();
      } catch {
        state.isPlaying = false;
        updatePlayButtonsUI();
      }
    } else {
      state.isPlaying = false;
      updatePlayButtonsUI();
    }

    renderTrackList();
    renderLyricsPanel();
  }

  function updateNowPlayingUI(track) {
    if (!track) return;
    document.getElementById('player-title').textContent = track.title;
    document.getElementById('player-artist').textContent = track.artist;
    document.getElementById('time-current').textContent = '0:00';
    document.getElementById('time-total').textContent = track.duration ? formatTime(track.duration) : '0:00';
    document.getElementById('seek-bar').value = 0;

    const artEl = document.getElementById('player-art');
    renderPlayerArtwork(artEl, track, 20);
    const expandOverlay = document.createElement('div');
    expandOverlay.className = 'player-art-expand';
    expandOverlay.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/></svg>`;
    artEl.appendChild(expandOverlay);

    // Sync Focus View
    document.getElementById('focus-title').textContent = track.title;
    document.getElementById('focus-artist').textContent = track.artist;
    renderPlayerArtwork(document.getElementById('focus-art'), track, 64);

    updateLikeButtonUI();
  }

  function markTrackPlayed(trackId) {
    if (state.countedCurrentTrackPlay) return;
    state.countedCurrentTrackPlay = true;
    const track = state.tracks.find((t) => t.id === trackId);
    if (track) {
      track.plays = (track.plays || 0) + 1;
      saveLocalState();
      renderAnalytics();
    }
  }

  window.playById = (trackId) => {
    if (state.currentTrackId === trackId) {
      window.togglePlayPause();
    } else {
      loadTrackById(trackId, true);
    }
  };

  window.playCurrentView = (shuffle = false) => {
    const queue = getActiveQueue();
    if (!queue.length) {
      openAddMusicModal();
      return;
    }
    if (shuffle) {
      state.isShuffle = true;
      updateTransportUI();
      const pick = queue[Math.floor(Math.random() * queue.length)];
      loadTrackById(pick.id, true);
    } else {
      loadTrackById(queue[0].id, true);
    }
  };

  window.togglePlayPause = async () => {
    if (!state.currentTrackId) {
      const queue = getActiveQueue();
      if (queue.length) loadTrackById(queue[0].id, true);
      return;
    }
    if (audio.paused) {
      state.isPlaying = true;
      ensureAudioContext(true);
      try {
        await audio.play();
        markTrackPlayed(state.currentTrackId);
        lastTickTimestamp = Date.now();
      } catch {
        state.isPlaying = false;
      }
    } else {
      state.isPlaying = false;
      audio.pause();
      lastTickTimestamp = null;
    }
    updatePlayButtonsUI();
    renderTrackList();
  };

  window.nextSong = (manual = true) => {
    const queue = getActiveQueue();
    if (!queue.length) return;
    if (state.isShuffle && queue.length > 1) {
      let pick;
      do {
        pick = queue[Math.floor(Math.random() * queue.length)];
      } while (pick.id === state.currentTrackId);
      loadTrackById(pick.id, true);
      return;
    }
    const idx = queue.findIndex((t) => t.id === state.currentTrackId);
    const nextIdx = idx + 1;
    if (nextIdx < queue.length) {
      loadTrackById(queue[nextIdx].id, true);
    } else if (state.loopMode === 'all' || manual) {
      loadTrackById(queue[0].id, true);
    } else {
      state.isPlaying = false;
      updatePlayButtonsUI();
      renderTrackList();
    }
  };

  window.prevSong = () => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const queue = getActiveQueue();
    if (!queue.length) return;
    const idx = queue.findIndex((t) => t.id === state.currentTrackId);
    const prevIdx = (idx - 1 + queue.length) % queue.length;
    loadTrackById(queue[prevIdx].id, true);
  };

  window.toggleShuffle = () => {
    state.isShuffle = !state.isShuffle;
    updateTransportUI();
    saveLocalState();
    showToast(state.isShuffle ? 'Shuffle on' : 'Shuffle off');
  };

  window.cycleLoopMode = () => {
    const order = ['off', 'all', 'one'];
    state.loopMode = order[(order.indexOf(state.loopMode) + 1) % order.length];
    updateTransportUI();
    saveLocalState();
    const names = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat current track' };
    showToast(names[state.loopMode]);
  };

  window.seekAudio = (percent) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (percent / 100) * audio.duration;
      updateSyncedLyricsHighlight(audio.currentTime, true);
    }
  };

  window.changeVolume = (val) => {
    state.volume = Math.max(0, Math.min(1, val / 100));
    audio.volume = state.volume;
    state.isMuted = state.volume === 0;
    updateVolumeIcon();
  };

  window.toggleMute = () => {
    state.isMuted = !state.isMuted;
    audio.volume = state.isMuted ? 0 : state.volume;
    document.getElementById('volume-bar').value = state.isMuted ? 0 : Math.round(state.volume * 100);
    updateVolumeIcon();
  };

  window.cyclePlaybackSpeed = () => {
    const speeds = [1.0, 1.15, 1.25, 1.5, 0.75, 0.85];
    const next = speeds[(speeds.indexOf(state.playbackSpeed) + 1) % speeds.length];
    state.playbackSpeed = next;
    audio.playbackRate = next;
    audio.preservesPitch = true;
    const btn = document.getElementById('btn-speed');
    btn.textContent = `${next.toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}x`;
    btn.classList.toggle('active', next !== 1.0);
    showToast(`Speed ${btn.textContent}`);
  };

  window.cycleSleepTimer = () => {
    const presets = [0, 15, 30, 45, 60];
    const currentMin = Math.ceil(sleepRemainingSec / 60);
    const nextMin = presets.find((m) => m > currentMin) ?? 0;

    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }

    const btn = document.getElementById('btn-sleep');
    const label = document.getElementById('sleep-timer-label');

    if (nextMin === 0) {
      sleepRemainingSec = 0;
      audio.volume = state.isMuted ? 0 : state.volume;
      label.classList.add('hidden');
      btn.classList.remove('active');
      showToast('Sleep timer off');
      return;
    }

    sleepRemainingSec = nextMin * 60;
    label.textContent = `${nextMin}m`;
    label.classList.remove('hidden');
    btn.classList.add('active');
    showToast(`Sleep timer set for ${nextMin} min`);

    sleepTimerInterval = setInterval(() => {
      sleepRemainingSec -= 1;
      // Gentle 10-second volume fade-out
      if (sleepRemainingSec > 0 && sleepRemainingSec <= 10 && !state.isMuted) {
        audio.volume = Math.max(0, state.volume * (sleepRemainingSec / 10));
      }
      if (sleepRemainingSec <= 0) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
        audio.pause();
        audio.volume = state.isMuted ? 0 : state.volume;
        state.isPlaying = false;
        updatePlayButtonsUI();
        label.classList.add('hidden');
        btn.classList.remove('active');
        showToast('Sleep timer paused playback');
      } else {
        label.textContent = `${Math.ceil(sleepRemainingSec / 60)}m`;
      }
    }, 1000);
  };

  function updatePlayButtonsUI() {
    const playSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>`;
    const pauseSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
    const icon = state.isPlaying ? pauseSvg : playSvg;
    const btn = document.getElementById('btn-play');
    const focusBtn = document.getElementById('focus-play-btn');
    if (btn) btn.innerHTML = icon;
    if (focusBtn) focusBtn.innerHTML = icon;

    const focusArt = document.getElementById('focus-art');
    if (focusArt) focusArt.classList.toggle('is-playing', state.isPlaying);
  }

  function updateTransportUI() {
    const shuffleBtn = document.getElementById('btn-shuffle');
    const loopBtn = document.getElementById('btn-loop');
    const badge = document.getElementById('loop-badge');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', state.isShuffle);
    if (loopBtn) {
      loopBtn.classList.toggle('active', state.loopMode !== 'off');
      loopBtn.title = `Loop: ${state.loopMode}`;
    }
    if (badge) badge.classList.toggle('hidden', state.loopMode !== 'one');
  }

  function updateVolumeIcon() {
    const btn = document.getElementById('btn-mute');
    if (!btn) return;
    if (state.isMuted || audio.volume === 0) {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M16 9l5 6M21 9l-5 6"/></svg>`;
    } else {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.8 5.8a9 9 0 0 1 0 12.4"/></svg>`;
    }
  }

  // --------------------------------------------------------------------------
  // 11. Synced Lyrics (.VTT / .LRC / Manual + Live Timestamp Stamper)
  // --------------------------------------------------------------------------
  function parseVttToLrc(raw) {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let currentStamp = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || /^\d+$/.test(line)) continue;
      const m = line.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,]\d{1,3}\s*-->/);
      if (m) {
        const hrs = parseInt(m[1] || '0', 10);
        const mins = parseInt(m[2], 10) + hrs * 60;
        currentStamp = `[${String(mins).padStart(2, '0')}:${m[3]}]`;
        continue;
      }
      const clean = line.replace(/<[^>]+>/g, '').trim();
      if (clean) {
        out.push(currentStamp ? `${currentStamp} ${clean}` : clean);
        currentStamp = null;
      }
    }
    return out.join('\n');
  }

  function readLyricsFile(file) {
    const track = state.tracks.find((t) => t.id === state.currentTrackId);
    if (!track) {
      showToast('Select or play a track before importing lyrics');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = String(e.target.result || '');
      const isVtt = /\.vtt$/i.test(file.name) || content.trim().startsWith('WEBVTT') || content.includes('-->');
      track.lyrics = isVtt ? parseVttToLrc(content) : content.trim();
      state.lyricsEditMode = false;
      saveLocalState();
      renderLyricsPanel();
      showToast('Lyrics imported');
    };
    reader.readAsText(file);
  }

  window.handleLyricsFileUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) readLyricsFile(file);
  };

  function buildLyricsHtml(lyricsText) {
    if (!lyricsText || !lyricsText.trim()) {
      return `<p style="color:var(--text-muted);font-size:13px;margin:0;">No lyrics saved for this track yet. Import a .VTT/.LRC file or click <strong>Edit</strong> to write synced lyrics.</p>`;
    }
    return lyricsText.split('\n').map((line) => {
      const m = line.match(/^\[(\d{1,3}):(\d{2})(?:\.\d+)?\]\s*(.*)$/);
      if (m) {
        const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        return `<div class="lyric-line synced" data-sec="${sec}" onclick="jumpToLyric(${sec})">${esc(m[3] || '♪')}</div>`;
      }
      return `<div class="lyric-line">${esc(line)}</div>`;
    }).join('');
  }

  function renderLyricsPanel() {
    const track = state.tracks.find((t) => t.id === state.currentTrackId);
    const label = document.getElementById('lyrics-track-label');
    const display = document.getElementById('lyrics-display');
    const editor = document.getElementById('lyrics-editor');
    const textarea = document.getElementById('lyrics-textarea');
    const focusLyrics = document.getElementById('focus-lyrics');

    if (!track) {
      label.textContent = 'No track selected';
      const emptyMsg = `<p style="color:var(--text-muted);font-size:13px;margin:0;">Play a track to view or add synced lyrics.</p>`;
      display.innerHTML = emptyMsg;
      if (focusLyrics) focusLyrics.innerHTML = emptyMsg;
      return;
    }

    label.textContent = `${track.title} — ${track.artist}`;
    textarea.value = track.lyrics || '';

    display.classList.toggle('hidden', state.lyricsEditMode);
    editor.classList.toggle('hidden', !state.lyricsEditMode);

    const html = buildLyricsHtml(track.lyrics);
    display.innerHTML = html;
    if (focusLyrics) focusLyrics.innerHTML = html;
    lastActiveLyricIdx = -1;
    updateSyncedLyricsHighlight(audio.currentTime || 0, true);
  }

  function updateSyncedLyricsHighlight(currentSec, force = false) {
    const containers = [
      document.getElementById('lyrics-display'),
      document.getElementById('focus-lyrics')
    ].filter(Boolean);

    containers.forEach((box) => {
      const lines = Array.from(box.querySelectorAll('.lyric-line.synced'));
      if (!lines.length) return;
      let activeIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const t = parseFloat(lines[i].getAttribute('data-sec'));
        if (currentSec >= t) activeIdx = i;
      }
      if (!force && activeIdx === lastActiveLyricIdx && box.id === 'lyrics-display') return;

      lines.forEach((el, idx) => {
        const isActive = idx === activeIdx;
        el.classList.toggle('active', isActive);
        if (isActive && (force || activeIdx !== lastActiveLyricIdx)) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
      if (box.id === 'lyrics-display') lastActiveLyricIdx = activeIdx;
    });
  }

  window.jumpToLyric = (sec) => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = sec;
      if (audio.paused) window.togglePlayPause();
      updateSyncedLyricsHighlight(sec, true);
    }
  };

  window.toggleLyricsEdit = (forceState) => {
    if (!state.currentTrackId) {
      showToast('Select a track first');
      return;
    }
    state.lyricsEditMode = typeof forceState === 'boolean' ? forceState : !state.lyricsEditMode;
    renderLyricsPanel();
  };

  window.stampCurrentLyricTime = () => {
    const ta = document.getElementById('lyrics-textarea');
    if (!ta) return;
    const t = Math.floor(audio.currentTime || 0);
    const stamp = `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}] `;
    const start = ta.selectionStart;
    const val = ta.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    ta.value = val.slice(0, lineStart) + stamp + val.slice(lineStart);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + stamp.length;
  };

  window.saveTrackLyrics = () => {
    const track = state.tracks.find((t) => t.id === state.currentTrackId);
    if (!track) return;
    const raw = document.getElementById('lyrics-textarea').value;
    track.lyrics = raw.includes('-->') ? parseVttToLrc(raw) : raw;
    state.lyricsEditMode = false;
    saveLocalState();
    renderLyricsPanel();
    showToast('Lyrics saved');
  };

  // --------------------------------------------------------------------------
  // 12. Playlists, Track Editing, Reordering & Covers
  // --------------------------------------------------------------------------
  window.toggleLike = (trackId, event) => {
    if (event) event.stopPropagation();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.liked = !track.liked;
    saveLocalState();
    updateLikeButtonUI();
    renderAll();
  };

  window.toggleLikeCurrent = () => {
    if (state.currentTrackId) window.toggleLike(state.currentTrackId);
  };

  function updateLikeButtonUI() {
    const btn = document.getElementById('player-like-btn');
    const current = state.tracks.find((t) => t.id === state.currentTrackId);
    const liked = !!(current && current.liked);
    btn.classList.toggle('is-liked', liked);
    btn.innerHTML = liked
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.2-9C1.4 7.8 4.1 4.5 7.7 4.5c2 0 3.5 1 4.3 2.4.8-1.4 2.3-2.4 4.3-2.4 3.6 0 6.3 3.3 4.9 7-1.7 4.4-9.2 9-9.2 9z"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9C1.4 7.8 4.1 4.5 7.7 4.5c2 0 3.5 1 4.3 2.4.8-1.4 2.3-2.4 4.3-2.4 3.6 0 6.3 3.3 4.9 7-1.7 4.4-9.2 9-9.2 9z"/></svg>`;
  }

  window.openEditSongModal = (trackId, event) => {
    if (event) event.stopPropagation();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    state.editingTrackId = trackId;
    document.getElementById('edit-song-title').value = track.title || '';
    document.getElementById('edit-song-artist').value = track.artist || '';
    document.getElementById('edit-song-src').value = track.isLocalBlob ? '' : (track.src || '');
    openModal('edit-song-modal');
  };

  window.saveEditedSong = () => {
    const track = state.tracks.find((t) => t.id === state.editingTrackId);
    if (!track) return;
    const title = document.getElementById('edit-song-title').value.trim();
    const artist = document.getElementById('edit-song-artist').value.trim();
    const src = document.getElementById('edit-song-src').value.trim();

    if (title) track.title = title;
    if (artist) track.artist = artist;
    if (src) {
      track.src = src;
      track.isLocalBlob = false;
      track.cachedOffline = false;
    }

    if (state.currentTrackId === track.id) {
      updateNowPlayingUI(track);
      renderLyricsPanel();
    }

    closeModal('edit-song-modal');
    saveLocalState();
    renderAll();
    showToast('Track updated');
  };

  window.deleteOrRemoveSong = async (trackId, event) => {
    if (event) event.stopPropagation();
    if (state.currentView.startsWith('pl_')) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (pl) {
        pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
        saveLocalState();
        renderAll();
        showToast('Removed from playlist');
      }
      return;
    }

    await VaultDB.deleteFile(trackId);
    state.tracks = state.tracks.filter((t) => t.id !== trackId);
    state.playlists.forEach((pl) => {
      pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
    });

    if (state.currentTrackId === trackId) {
      audio.pause();
      state.isPlaying = false;
      state.currentTrackId = null;
      resetPlayerDisplay();
    }

    saveLocalState();
    renderAll();
    showToast('Track deleted from Vault');
  };

  window.moveSongInSequence = (idx, dir, event) => {
    if (event) event.stopPropagation();
    const target = idx + dir;
    if (state.currentView.startsWith('pl_')) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (!pl || target < 0 || target >= pl.trackIds.length) return;
      [pl.trackIds[idx], pl.trackIds[target]] = [pl.trackIds[target], pl.trackIds[idx]];
    } else if (state.currentView === 'all') {
      if (target < 0 || target >= state.tracks.length) return;
      [state.tracks[idx], state.tracks[target]] = [state.tracks[target], state.tracks[idx]];
    }
    saveLocalState();
    renderTrackList();
  };

  window.handleRowDragStart = (idx) => { state.draggedIndex = idx; };
  window.handleRowDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };
  window.handleRowDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
  };
  window.handleRowDrop = (targetIdx, e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const fromIdx = state.draggedIndex;
    state.draggedIndex = null;
    if (fromIdx === null || fromIdx === targetIdx) return;

    if (state.currentView.startsWith('pl_')) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (!pl) return;
      const [moved] = pl.trackIds.splice(fromIdx, 1);
      pl.trackIds.splice(targetIdx, 0, moved);
    } else if (state.currentView === 'all') {
      const [moved] = state.tracks.splice(fromIdx, 1);
      state.tracks.splice(targetIdx, 0, moved);
    }
    saveLocalState();
    renderTrackList();
  };

  window.openPlaylistModal = (mode) => {
    state.playlistModalMode = mode;
    const heading = document.getElementById('playlist-modal-heading');
    const input = document.getElementById('playlist-name-input');
    if (mode === 'rename') {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (!pl) return;
      heading.textContent = 'Rename Playlist';
      input.value = pl.name;
    } else {
      heading.textContent = 'Create Playlist';
      input.value = '';
    }
    openModal('playlist-modal');
    setTimeout(() => input.focus(), 40);
  };

  window.confirmPlaylistModal = () => {
    const name = document.getElementById('playlist-name-input').value.trim();
    if (!name) return;
    if (state.playlistModalMode === 'create') {
      const newPl = {
        id: `pl_${Date.now()}`,
        name,
        coverColor: COVER_THEMES[state.playlists.length % COVER_THEMES.length].id,
        coverImage: null,
        trackIds: []
      };
      state.playlists.push(newPl);
      state.currentView = newPl.id;
      showToast(`Created "${name}"`);
    } else {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (pl) {
        pl.name = name;
        showToast('Playlist renamed');
      }
    }
    closeModal('playlist-modal');
    saveLocalState();
    renderAll();
  };

  window.deletePlaylistById = (plId, event) => {
    if (event) event.stopPropagation();
    state.playlists = state.playlists.filter((p) => p.id !== plId);
    if (state.currentView === plId) state.currentView = 'all';
    saveLocalState();
    renderAll();
    showToast('Playlist deleted');
  };

  window.deleteCurrentPlaylist = () => {
    if (state.currentView.startsWith('pl_')) window.deletePlaylistById(state.currentView);
  };

  window.openAssignPlaylistModal = (trackId, event) => {
    if (event) event.stopPropagation();
    state.songToAssign = trackId;
    renderAssignPlaylistOptions();
    openModal('assign-playlist-modal');
  };

  function renderAssignPlaylistOptions() {
    const box = document.getElementById('assign-playlist-options');
    if (!state.playlists.length) {
      box.innerHTML = `<p style="font-size:12.5px;color:var(--text-secondary);text-align:center;margin:12px 0;">No playlists yet. Click <strong>+</strong> in the sidebar to create one.</p>`;
      return;
    }
    box.innerHTML = state.playlists.map((pl) => {
      const inside = pl.trackIds.includes(state.songToAssign);
      return `
        <button class="assign-row ${inside ? 'in' : ''}" onclick="toggleTrackInPlaylist('${esc(pl.id)}')">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pl.name)}</span>
          <span class="status">${inside ? '✓ Added' : '+ Add'}</span>
        </button>
      `;
    }).join('');
  }

  window.toggleTrackInPlaylist = (plId) => {
    const pl = state.playlists.find((p) => p.id === plId);
    if (!pl || !state.songToAssign) return;
    const idx = pl.trackIds.indexOf(state.songToAssign);
    if (idx === -1) pl.trackIds.push(state.songToAssign);
    else pl.trackIds.splice(idx, 1);
    saveLocalState();
    renderAssignPlaylistOptions();
    renderPlaylistsSidebar();
    if (state.currentView === plId) renderMainView();
  };

  window.openCoverModal = () => {
    const pl = state.playlists.find((p) => p.id === state.currentView);
    if (!pl) return;
    const grid = document.getElementById('cover-color-grid');
    grid.innerHTML = COVER_THEMES.map((theme) => {
      const selected = !pl.coverImage && (pl.coverColor || 'grad-emerald') === theme.id;
      return `
        <button class="cover-swatch ${selected ? 'selected' : ''}" onclick="selectPlaylistCoverColor('${theme.id}')">
          <div class="cover-swatch-dot ${theme.id}"></div>
          <span>${theme.label}</span>
        </button>
      `;
    }).join('');
    openModal('cover-modal');
  };

  window.selectPlaylistCoverColor = (gradId) => {
    const pl = state.playlists.find((p) => p.id === state.currentView);
    if (!pl) return;
    pl.coverColor = gradId;
    pl.coverImage = null;
    saveLocalState();
    renderAll();
    window.openCoverModal();
  };

  window.handleCoverImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const pl = state.playlists.find((p) => p.id === state.currentView);
    if (!file || !pl) return;
    const dataUrl = await compressImageBlob(file, 300);
    if (dataUrl) {
      pl.coverImage = dataUrl;
      saveLocalState();
      renderAll();
      closeModal('cover-modal');
      showToast('Playlist cover updated');
    }
  };

  window.revertPlaylistCover = () => {
    const pl = state.playlists.find((p) => p.id === state.currentView);
    if (!pl) return;
    pl.coverColor = 'grad-emerald';
    pl.coverImage = null;
    saveLocalState();
    renderAll();
    window.openCoverModal();
  };

  // --------------------------------------------------------------------------
  // 13. Navigation, Theme, Modals, Studio Drawer & Focus View
  // --------------------------------------------------------------------------
  window.switchView = (viewId) => {
    state.currentView = viewId;
    toggleMobileSidebar(false);
    ['all', 'liked', 'analytics', 'guide'].forEach((id) => {
      const el = document.getElementById(`nav-${id}`);
      if (el) el.classList.toggle('active', viewId === id);
    });
    renderAll();
  };

  window.handleSearchInput = () => {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const kbd = document.getElementById('search-kbd');
    state.searchQuery = input.value;
    const hasText = state.searchQuery.trim().length > 0;
    clearBtn.classList.toggle('hidden', !hasText);
    kbd.classList.toggle('hidden', hasText);
    if (hasText && (state.currentView === 'analytics' || state.currentView === 'guide')) {
      window.switchView('all');
      return;
    }
    renderMainView();
  };

  window.clearSearchInput = () => {
    document.getElementById('search-input').value = '';
    state.searchQuery = '';
    document.getElementById('clear-search-btn').classList.add('hidden');
    document.getElementById('search-kbd').classList.remove('hidden');
    renderMainView();
  };

  window.changeSortOrder = (val) => {
    state.sortBy = val;
    renderTrackList();
  };

  window.toggleStudioDrawer = (force) => {
    state.studioOpen = typeof force === 'boolean' ? force : !state.studioOpen;
    document.getElementById('studio-drawer').classList.toggle('hidden', !state.studioOpen);
    updateStudioButtonIndicator();
    if (state.studioOpen) {
      if (state.studioTab === 'eq') setTimeout(drawEqCurve, 30);
      if (state.studioTab === 'lyrics') renderLyricsPanel();
    }
  };

  window.switchStudioTab = (tab) => {
    state.studioTab = tab;
    ['lyrics', 'eq', 'ambient'].forEach((t) => {
      document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
      document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== tab);
    });
    if (tab === 'eq') setTimeout(drawEqCurve, 20);
    if (tab === 'lyrics') renderLyricsPanel();
  };

  window.toggleFocusMode = (force) => {
    if (!state.currentTrackId && force !== false) {
      showToast('Play a track first to open Focus View');
      return;
    }
    state.focusOpen = typeof force === 'boolean' ? force : !state.focusOpen;
    document.getElementById('focus-overlay').classList.toggle('hidden', !state.focusOpen);
    if (state.focusOpen) {
      const track = state.tracks.find((t) => t.id === state.currentTrackId);
      if (track) updateNowPlayingUI(track);
      renderLyricsPanel();
      updatePlayButtonsUI();
    }
  };

  window.toggleTheme = () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    SafeStore.set('wanda_theme', state.theme);
  };

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    if (state.theme === 'light') {
      icon.innerHTML = `<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`;
    } else {
      icon.innerHTML = `<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/>`;
    }
  }

  window.toggleMobileSidebar = (force) => {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    const next = typeof force === 'boolean' ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', next);
    bd.classList.toggle('open', next);
  };

  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  window.closeModal = (id) => {
    document.getElementById(id)?.classList.add('hidden');
  };

  window.closeModalOnBackdrop = (event, id) => {
    if (event.target.id === id) window.closeModal(id);
  };

  window.openAddMusicModal = () => openModal('add-music-modal');

  window.openVaultModal = () => {
    document.getElementById('vault-track-count').textContent = state.tracks.length;
    document.getElementById('vault-net-status').textContent = navigator.onLine ? 'Online' : 'Offline';
    openModal('vault-modal');
  };

  // --------------------------------------------------------------------------
  // 14. Rendering Engine (Sidebar, Hero, Tracklist, Insights)
  // --------------------------------------------------------------------------
  function getFilteredTracks() {
    const q = state.searchQuery.trim().toLowerCase();
    let list = [];
    if (state.currentView.startsWith('pl_')) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      if (pl) {
        list = pl.trackIds.map((id) => state.tracks.find((t) => t.id === id)).filter(Boolean);
      }
    } else if (state.currentView === 'liked') {
      list = state.tracks.filter((t) => t.liked);
    } else {
      list = [...state.tracks];
    }

    if (q) {
      list = list.filter((t) =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q)
      );
    }

    if (state.sortBy === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (state.sortBy === 'artist') {
      list.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (state.sortBy === 'plays') {
      list.sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.secondsListened || 0) - (a.secondsListened || 0));
    }

    return list;
  }

  function renderAll() {
    renderSidebarBadges();
    renderPlaylistsSidebar();
    renderMainView();
    renderAnalytics();
    updateVaultBadge();
  }

  function renderSidebarBadges() {
    document.getElementById('badge-all').textContent = state.tracks.length;
    document.getElementById('badge-liked').textContent = state.tracks.filter((t) => t.liked).length;
  }

  function renderPlaylistsSidebar() {
    const container = document.getElementById('playlist-sidebar');
    if (!state.playlists.length) {
      container.innerHTML = `<div class="playlist-empty">No playlists yet. Click + above.</div>`;
      return;
    }

    container.innerHTML = state.playlists.map((pl) => {
      const active = state.currentView === pl.id;
      const thumb = pl.coverImage
        ? `<div class="playlist-thumb"><img src="${pl.coverImage}" alt="" /></div>`
        : `<div class="playlist-thumb ${esc(pl.coverColor || 'grad-emerald')}">♪</div>`;
      return `
        <div class="playlist-item ${active ? 'active' : ''}" onclick="switchView('${esc(pl.id)}')">
          ${thumb}
          <span class="playlist-name">${esc(pl.name)}</span>
          <span class="playlist-count">${pl.trackIds.length}</span>
          <button class="playlist-del" title="Delete playlist" onclick="deletePlaylistById('${esc(pl.id)}', event)">✕</button>
        </div>
      `;
    }).join('');
  }

  function renderMainView() {
    const coverEl = document.getElementById('view-cover');
    const kickerEl = document.getElementById('view-kicker');
    const titleEl = document.getElementById('view-title');
    const subtitleEl = document.getElementById('view-subtitle');
    const trackSec = document.getElementById('track-section');
    const analyticsSec = document.getElementById('analytics-section');
    const guideSec = document.getElementById('guide-section');
    const heroPlay = document.getElementById('btn-hero-play');
    const heroShuffle = document.getElementById('btn-hero-shuffle');
    const plActions = document.getElementById('playlist-manage-actions');
    const demoStrip = document.getElementById('demo-strip');

    trackSec.classList.add('hidden');
    analyticsSec.classList.add('hidden');
    guideSec.classList.add('hidden');
    plActions.classList.add('hidden');

    const isPl = state.currentView.startsWith('pl_');
    const isTrackView = state.currentView === 'all' || state.currentView === 'liked' || isPl;

    heroPlay.classList.toggle('hidden', !isTrackView);
    heroShuffle.classList.toggle('hidden', !isTrackView);

    const hasDemos = state.tracks.some((t) => t.isDemo);
    demoStrip.classList.toggle('hidden', !(state.currentView === 'all' && hasDemos && !state.searchQuery.trim()));

    coverEl.className = 'view-cover';

    if (state.currentView === 'analytics') {
      coverEl.classList.add('grad-emerald');
      coverEl.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19h16"/><rect x="6" y="11" width="3" height="8" rx="1"/><rect x="11" y="7" width="3" height="12" rx="1"/><rect x="16" y="4" width="3" height="15" rx="1"/></svg>`;
      kickerEl.textContent = 'Private Analytics';
      titleEl.textContent = 'Listening Insights';
      subtitleEl.textContent = 'Tracked locally in your browser — never shared';
      analyticsSec.classList.remove('hidden');
      renderAnalytics();
      return;
    }

    if (state.currentView === 'guide') {
      coverEl.classList.add('grad-ocean');
      coverEl.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><circle cx="12" cy="8.5" r="0.8" fill="currentColor"/></svg>`;
      kickerEl.textContent = 'MP3 Wanda';
      titleEl.textContent = 'Quick Guide';
      subtitleEl.textContent = 'Everything you need — without clutter';
      guideSec.classList.remove('hidden');
      return;
    }

    trackSec.classList.remove('hidden');
    const filtered = getFilteredTracks();
    const totalSec = filtered.reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalMins = Math.round(totalSec / 60);
    const metaSummary = `${filtered.length} track${filtered.length === 1 ? '' : 's'}${totalMins > 0 ? ` • ${totalMins} min` : ''}`;

    if (state.currentView === 'all') {
      coverEl.classList.add('grad-emerald');
      coverEl.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>`;
      kickerEl.textContent = 'MP3 Wanda Vault';
      titleEl.textContent = 'Library';
      subtitleEl.textContent = state.searchQuery.trim()
        ? `Search results for "${state.searchQuery.trim()}" • ${filtered.length} found`
        : `${metaSummary} • Offline ready`;
    } else if (state.currentView === 'liked') {
      coverEl.classList.add('grad-coral');
      coverEl.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.2-9C1.4 7.8 4.1 4.5 7.7 4.5c2 0 3.5 1 4.3 2.4.8-1.4 2.3-2.4 4.3-2.4 3.6 0 6.3 3.3 4.9 7-1.7 4.4-9.2 9-9.2 9z"/></svg>`;
      kickerEl.textContent = 'Collection';
      titleEl.textContent = 'Favorites';
      subtitleEl.textContent = metaSummary;
    } else if (isPl) {
      const pl = state.playlists.find((p) => p.id === state.currentView);
      kickerEl.textContent = 'Playlist';
      titleEl.textContent = pl ? pl.name : 'Playlist';
      subtitleEl.textContent = metaSummary;
      plActions.classList.remove('hidden');

      if (pl?.coverImage) {
        coverEl.innerHTML = `<img src="${pl.coverImage}" alt="" /><div class="view-cover-edit" onclick="openCoverModal()">Edit Cover</div>`;
      } else {
        coverEl.classList.add(pl?.coverColor || 'grad-emerald');
        coverEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><div class="view-cover-edit" onclick="openCoverModal()">Edit Cover</div>`;
      }
    }

    renderTrackList();
  }

  function renderTrackList() {
    const listEl = document.getElementById('song-list');
    const countEl = document.getElementById('track-toolbar-count');
    const filtered = getFilteredTracks();
    const isPl = state.currentView.startsWith('pl_');
    const canReorder = (state.currentView === 'all' || isPl) && !state.searchQuery.trim() && state.sortBy === 'custom';

    countEl.textContent = `${filtered.length} track${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
          <h3>${state.searchQuery.trim() ? 'No matching tracks' : 'Your collection is quiet'}</h3>
          <p>${state.searchQuery.trim() ? `Nothing matched "${esc(state.searchQuery.trim())}". Try another keyword.` : 'Drop MP3, MP4, or WAV files onto this window, or click Add Music to build your offline Vault.'}</p>
          ${!state.searchQuery.trim() ? `<button class="btn-primary" style="margin-top:6px;" onclick="openAddMusicModal()">Add Music</button>` : ''}
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map((track, idx) => {
      const isCurrent = state.currentTrackId === track.id;
      const artHtml = track.coverArt
        ? `<div class="track-art"><img src="${track.coverArt}" alt="" /></div>`
        : `<div class="track-art ${esc(track.color || 'grad-emerald')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;

      const tagHtml = track.isDemo
        ? `<span class="track-tag">Demo</span>`
        : (track.mediaType === 'mp4' ? `<span class="track-tag">MP4</span>` : '');

      const indexVisual = isCurrent && state.isPlaying
        ? `<span class="eq-bars" aria-label="Playing"><span></span><span></span><span></span></span>`
        : `<span>${idx + 1}</span>`;

      const dragAttrs = canReorder
        ? `draggable="true" ondragstart="handleRowDragStart(${idx})" ondragover="handleRowDragOver(event)" ondragleave="handleRowDragLeave(event)" ondrop="handleRowDrop(${idx}, event)"`
        : '';

      return `
        <div class="track-row ${isCurrent ? 'is-current' : ''}" ${dragAttrs} onclick="playById('${esc(track.id)}')">
          <div class="track-index" onclick="event.stopPropagation()">
            ${indexVisual}
            ${canReorder ? `
              <div class="reorder-arrows">
                <button title="Move up" onclick="moveSongInSequence(${idx}, -1, event)">
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><polygon points="6,2 11,9 1,9"/></svg>
                </button>
                <button title="Move down" onclick="moveSongInSequence(${idx}, 1, event)">
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><polygon points="6,10 11,3 1,3"/></svg>
                </button>
              </div>
            ` : ''}
          </div>

          <div class="track-main">
            ${artHtml}
            <div class="track-info">
              <div class="track-title-line">
                <span class="track-title">${esc(track.title)}</span>
                ${tagHtml}
              </div>
              <div class="track-sub-mobile">${esc(track.artist)}</div>
            </div>
          </div>

          <div class="track-artist">${esc(track.artist)}</div>
          <div class="track-duration">${track.duration ? formatTime(track.duration) : '—'}</div>
          <div class="track-plays">${track.plays || 0}</div>

          <div class="track-actions" onclick="event.stopPropagation()">
            <button class="row-btn ${track.liked ? 'is-liked' : ''}" title="Favorite" onclick="toggleLike('${esc(track.id)}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${track.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 20.5s-7.5-4.6-9.2-9C1.4 7.8 4.1 4.5 7.7 4.5c2 0 3.5 1 4.3 2.4.8-1.4 2.3-2.4 4.3-2.4 3.6 0 6.3 3.3 4.9 7-1.7 4.4-9.2 9-9.2 9z"/></svg>
            </button>
            <button class="row-btn" title="Add to playlist" onclick="openAssignPlaylistModal('${esc(track.id)}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h11M4 12h11M4 17h7M18 14v6M15 17h6"/></svg>
            </button>
            <button class="row-btn" title="Edit details" onclick="openEditSongModal('${esc(track.id)}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z"/></svg>
            </button>
            <button class="row-btn danger" title="${isPl ? 'Remove from playlist' : 'Delete track'}" onclick="deleteOrRemoveSong('${esc(track.id)}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function computeStreakDays() {
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const key = getTodayKey(d);
      if ((state.stats.dailySeconds[key] || 0) > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else if (i === 0) {
        // Allow streak to continue if user hasn't listened yet today
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function renderAnalytics() {
    const weekKey = getWeekKey();
    const weeklySec = state.stats.weeklySeconds[weekKey] || 0;
    const totalSec = state.stats.totalSecondsListened || 0;
    const totalPlays = state.tracks.reduce((sum, t) => sum + (t.plays || 0), 0);

    document.getElementById('stat-weekly-hours').textContent = `${(weeklySec / 3600).toFixed(1)}h`;
    document.getElementById('stat-weekly-sub').textContent = `${Math.round(weeklySec / 60)} mins (${weekKey})`;

    document.getElementById('stat-total-hours').textContent = `${(totalSec / 3600).toFixed(1)}h`;
    document.getElementById('stat-total-plays').textContent = `${totalPlays} total stream${totalPlays === 1 ? '' : 's'}`;

    const activeDays = Object.values(state.stats.dailySeconds).filter((v) => v > 0).length || 1;
    document.getElementById('stat-daily-avg').textContent = `${Math.round((totalSec / 60) / activeDays)}m`;
    const streak = computeStreakDays();
    document.getElementById('stat-streak-sub').textContent = `${streak}-day listening streak`;

    // 7-day bar chart
    const days = [];
    const todayStr = getTodayKey();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = getTodayKey(d);
      days.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        sec: state.stats.dailySeconds[key] || 0,
        isToday: key === todayStr
      });
    }
    const maxSec = Math.max(...days.map((d) => d.sec), 60);
    document.getElementById('weekly-bar-chart').innerHTML = days.map((d) => {
      const pct = Math.max(5, Math.round((d.sec / maxSec) * 100));
      return `
        <div class="bar-col ${d.isToday ? 'is-today' : ''}">
          <span class="bar-val">${Math.round(d.sec / 60)}m</span>
          <div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div>
          <span class="bar-day">${d.label}</span>
        </div>
      `;
    }).join('');

    // Top tracks & artists
    const topSongsEl = document.getElementById('top-songs-list');
    const topArtistsEl = document.getElementById('top-artists-list');

    const sortedTracks = [...state.tracks]
      .filter((t) => (t.secondsListened || 0) > 0 || (t.plays || 0) > 0)
      .sort((a, b) => (b.secondsListened || 0) - (a.secondsListened || 0) || (b.plays || 0) - (a.plays || 0))
      .slice(0, 5);

    if (!sortedTracks.length) {
      topSongsEl.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);text-align:center;padding:24px 0;">Start playing tracks to populate your top songs.</p>`;
    } else {
      topSongsEl.innerHTML = sortedTracks.map((t, i) => `
        <div class="rank-item" onclick="playById('${esc(t.id)}')">
          <span class="rank-num">${i + 1}</span>
          <div class="rank-avatar ${t.coverArt ? '' : esc(t.color || 'grad-emerald')}">
            ${t.coverArt ? `<img src="${t.coverArt}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : '♪'}
          </div>
          <div class="rank-info">
            <div class="rank-name">${esc(t.title)}</div>
            <div class="rank-sub">${esc(t.artist)}</div>
          </div>
          <div class="rank-metric">${formatDurationHuman(t.secondsListened)}<small>${t.plays || 0} plays</small></div>
        </div>
      `).join('');
    }

    const artistMap = {};
    state.tracks.forEach((t) => {
      if ((t.secondsListened || 0) === 0 && (t.plays || 0) === 0) return;
      const name = t.artist || 'Unknown Artist';
      if (!artistMap[name]) artistMap[name] = { seconds: 0, plays: 0 };
      artistMap[name].seconds += t.secondsListened || 0;
      artistMap[name].plays += t.plays || 0;
    });

    const topArtists = Object.entries(artistMap)
      .sort((a, b) => b[1].seconds - a[1].seconds || b[1].plays - a[1].plays)
      .slice(0, 5);

    if (!topArtists.length) {
      document.getElementById('stat-top-artist').textContent = '—';
      document.getElementById('stat-top-artist-sub').textContent = 'No listening yet';
      topArtistsEl.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);text-align:center;padding:24px 0;">Your most listened artists will appear here.</p>`;
    } else {
      document.getElementById('stat-top-artist').textContent = topArtists[0][0];
      document.getElementById('stat-top-artist-sub').textContent = `${formatDurationHuman(topArtists[0][1].seconds)} • ${topArtists[0][1].plays} plays`;
      topArtistsEl.innerHTML = topArtists.map(([artist, info], i) => `
        <div class="rank-item" style="cursor:default;">
          <span class="rank-num">${i + 1}</span>
          <div class="rank-avatar round">${esc(artist.charAt(0).toUpperCase())}</div>
          <div class="rank-info">
            <div class="rank-name">${esc(artist)}</div>
            <div class="rank-sub">${info.plays} stream${info.plays === 1 ? '' : 's'}</div>
          </div>
          <div class="rank-metric">${formatDurationHuman(info.seconds)}</div>
        </div>
      `).join('');
    }
  }

  function updateVaultBadge() {
    const dot = document.getElementById('vault-dot');
    const text = document.getElementById('vault-status-text');
    const offline = !navigator.onLine;
    if (dot) dot.classList.toggle('offline', offline);
    if (text) {
      text.textContent = offline
        ? `Offline Vault (${state.tracks.length})`
        : `Vault Ready (${state.tracks.length})`;
    }
  }

  // --------------------------------------------------------------------------
  // 15. Audio Events, Global Drag-Drop, Keyboard Shortcuts & Boot
  // --------------------------------------------------------------------------
  function setupGlobalDrop() {
    let dragDepth = 0;
    const overlay = document.getElementById('global-drop-overlay');

    window.addEventListener('dragenter', (e) => {
      if (state.draggedIndex !== null) return; // Internal row reorder
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      overlay.classList.remove('hidden');
    });

    window.addEventListener('dragover', (e) => {
      if (state.draggedIndex !== null) return;
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    });

    window.addEventListener('dragleave', () => {
      if (dragDepth > 0) dragDepth--;
      if (dragDepth === 0) overlay.classList.add('hidden');
    });

    window.addEventListener('drop', (e) => {
      if (state.draggedIndex !== null) return;
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.add('hidden');
      importAudioFiles(e.dataTransfer.files);
    });
  }

  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') document.activeElement.blur();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        window.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      } else if (e.code === 'ArrowLeft') {
        audio.currentTime = Math.max(0, audio.currentTime - 5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        const nextVol = Math.min(100, Math.round(state.volume * 100) + 5);
        document.getElementById('volume-bar').value = nextVol;
        window.changeVolume(nextVol);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(0, Math.round(state.volume * 100) - 5);
        document.getElementById('volume-bar').value = nextVol;
        window.changeVolume(nextVol);
      } else if (e.key === 'm' || e.key === 'M') {
        window.toggleMute();
      } else if (e.key === 's' || e.key === 'S') {
        window.toggleStudioDrawer();
      } else if (e.key === 'f' || e.key === 'F') {
        window.toggleFocusMode();
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      } else if (e.key === 'Escape') {
        if (state.focusOpen) window.toggleFocusMode(false);
        ['add-music-modal', 'edit-song-modal', 'playlist-modal', 'assign-playlist-modal', 'cover-modal', 'vault-modal'].forEach((id) => window.closeModal(id));
      }
    });
  }

  function setupAudioListeners() {
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        document.getElementById('time-total').textContent = formatTime(audio.duration);
        const track = state.tracks.find((t) => t.id === state.currentTrackId);
        if (track && (!track.duration || Math.abs(track.duration - audio.duration) > 1)) {
          track.duration = audio.duration;
          saveLocalState();
          renderTrackList();
        }
      }
    });

    audio.addEventListener('timeupdate', () => {
      if (document.hidden) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        document.getElementById('seek-bar').value = (audio.currentTime / audio.duration) * 100;
        document.getElementById('time-current').textContent = formatTime(audio.currentTime);
        document.getElementById('time-total').textContent = formatTime(audio.duration);
        updateSyncedLyricsHighlight(audio.currentTime);
      }
    });

    audio.addEventListener('ended', () => {
      lastTickTimestamp = null;
      if (state.loopMode === 'one') {
        audio.currentTime = 0;
        state.countedCurrentTrackPlay = false;
        audio.play().then(() => markTrackPlayed(state.currentTrackId)).catch(() => {});
      } else {
        window.nextSong(false);
      }
    });

    audio.addEventListener('pause', () => {
      lastTickTimestamp = null;
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });

    audio.addEventListener('play', () => {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });

    // Accurate listening stats ticker (skips DOM work when tab is hidden)
    let unsavedSec = 0;
    setInterval(() => {
      if (!audio.paused && state.currentTrackId) {
        const now = Date.now();
        if (lastTickTimestamp) {
          const delta = (now - lastTickTimestamp) / 1000;
          if (delta > 0 && delta < 10) {
            const track = state.tracks.find((t) => t.id === state.currentTrackId);
            if (track) track.secondsListened = (track.secondsListened || 0) + delta;
            const today = getTodayKey();
            const week = getWeekKey();
            state.stats.totalSecondsListened = (state.stats.totalSecondsListened || 0) + delta;
            state.stats.dailySeconds[today] = (state.stats.dailySeconds[today] || 0) + delta;
            state.stats.weeklySeconds[week] = (state.stats.weeklySeconds[week] || 0) + delta;
            unsavedSec += delta;
            if (unsavedSec >= 5) {
              unsavedSec = 0;
              saveLocalState();
              if (!document.hidden && state.currentView === 'analytics') renderAnalytics();
            }
          }
        }
        lastTickTimestamp = now;
      } else {
        lastTickTimestamp = null;
      }
    }, 1000);
  }

  window.addEventListener('online', updateVaultBadge);
  window.addEventListener('offline', updateVaultBadge);

  async function bootApp() {
    applyTheme();
    const hadSaved = loadLocalState();

    // First-time launch: load 3 warm synthesized studio demos so every feature works immediately
    if (!hadSaved && state.tracks.length === 0) {
      state.tracks = createDefaultDemoTracks();
      state.playlists = [
        {
          id: 'pl_wanda_focus',
          name: 'Studio Essentials',
          coverColor: 'grad-emerald',
          coverImage: null,
          trackIds: state.tracks.map((t) => t.id)
        }
      ];
      saveLocalState();
    }

    // Restore EQ slider UI
    state.eqBands.forEach((v, i) => {
      const slider = document.getElementById(`eq-slider-${i}`);
      const label = document.getElementById(`eq-val-${i}`);
      if (slider) slider.value = v;
      if (label) label.textContent = `${v > 0 ? '+' : ''}${v} dB`;
    });
    const presetSel = document.getElementById('eq-preset-select');
    if (presetSel) presetSel.value = state.eqPreset || 'flat';

    audio.volume = state.volume;
    updateTransportUI();
    updateVolumeIcon();
    updateStudioButtonIndicator();
    setupAudioListeners();
    setupGlobalDrop();
    setupKeyboardShortcuts();
    renderAll();
    drawEqCurve();

    // Hydrate audio blobs in the background without delaying initial UI paint
    await hydrateAllTrackUrls();
    renderAll();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootApp);
  } else {
    bootApp();
  }
})();
