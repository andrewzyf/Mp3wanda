# MP3 Wanda

**MP3 Wanda** is a calm, offline-first personal music studio built with pure HTML, CSS, and JavaScript — zero external CDN dependencies, zero ads, and 100% private local storage.

## Highlights

- **Offline IndexedDB Media Vault** — Drop `.mp3`, `.mp4` (audio), `.wav`, `.m4a`, `.ogg`, or `.flac` files anywhere onto the window to store and play them completely offline.
- **Automatic ID3v2 Parsing** — Extracts embedded title, artist, lyrics (`USLT`), and album cover artwork (`APIC`) directly from `.mp3` files.
- **Built-in Demo Soundscapes** — Three synthesized stereo WAV tracks with pre-synced lyrics load on first launch so you can test playback, EQ, lyrics, and Atmosphere immediately (removable in one click).
- **Slide-Over Audio Studio (`S`)**:
  - **Synced Lyrics** — Import `.vtt` or `.lrc` files, click any line to seek, auto-scroll active lines, or use **+ Stamp Time** while editing to sync lyrics live.
  - **Visual 5-Band Equalizer** — Live frequency response curve canvas, smooth gain ramping, and 6 tuned presets.
  - **4-Layer Atmosphere Mixer** — Blend procedural Soft Rain, Vinyl Crackle, Warm Brown Noise, and Gentle Hearth underneath any track.
- **Focus View (`F`)** — Click the album art in the bottom bar for a distraction-free Now Playing screen with a live waveform and synced lyrics.
- **Private Insights & JSON Backups** — Track weekly listening hours, streaks, top tracks, and top artists locally, and export/import your library as a `.json` backup anytime.
- **Light & Dark Themes** — Warm Studio Obsidian (dark) and Warm Paper (light).

## Hosting on GitHub Pages

1. Push the contents of this folder (`index.html`, `styles.css`, `app.js`) to a GitHub repository (for example, `mp3wanda/mp3wanda.github.io` or `mp3wanda/music`).
2. Enable **Settings → Pages → Deploy from branch (`main`, root `/`)**.
3. Open your live site — no build step required.
