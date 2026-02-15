[Читать на русском](README_RU.md)

# 🎙️ Gemini Voice Advanced

> Made by [losyash](http://losyashded.ru/)

Chrome extension for recording and sending voice messages to [Google Gemini](https://gemini.google.com).

One click — the extension records audio from your microphone, pastes it into the Gemini chat, and sends it.

## Features

- Record voice directly from the extension popup
- Real-time audio visualization
- Recording timer
- Auto-paste audio into the active Gemini chat
- If Gemini isn't open — the extension opens a new tab automatically
- OGG Opus / WebM Opus format support

## Installation

1. Download or clone the repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the extension folder
6. On first launch a page will open requesting microphone access — grant it

## Usage

1. Open any page (or Gemini)
2. Click the extension icon in the Chrome toolbar
3. Click the microphone button to start recording
4. Click again to stop — the audio will be sent to Gemini automatically

## Project Structure

```
manifest.json       — extension configuration
background.js       — service worker, recording & tab management
content.js          — audio paste into Gemini editor
popup.html/js/css   — popup UI
offscreen.html/js   — audio recording via Offscreen API
welcome.html/js     — microphone permission page
icons/              — extension icons
```

## Technologies

- Chrome Extensions Manifest V3
- Offscreen API for audio recording
- MediaRecorder API
- Web Audio API (visualization)

## License

MIT
