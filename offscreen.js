// Gemini Voice Advanced - Offscreen Document (audio recording via port)

let mediaRecorder = null;
let audioChunks = [];
let port = null;

function connectPort() {
  console.log('[OFF] Connecting port...');
  port = chrome.runtime.connect({ name: 'offscreen' });

  port.onMessage.addListener((message) => {
    console.log('[OFF] Received message:', message.type);
    if (message.type === 'START_RECORDING') {
      startRecording();
    }
    if (message.type === 'STOP_RECORDING') {
      stopRecording();
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[OFF] Port disconnected');
    port = null;
    // Reconnect after a short delay (service worker may have restarted)
    setTimeout(() => {
      if (!port) connectPort();
    }, 500);
  });
}

// Initial connection
connectPort();

async function startRecording() {
  console.log('[OFF] startRecording called, existing recorder:', !!mediaRecorder, mediaRecorder?.state);
  // Clean up any previous recorder
  if (mediaRecorder) {
    try {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    } catch (_) { /* ignore */ }
    mediaRecorder = null;
    audioChunks = [];
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    // Try OGG first, fall back to WebM
    let mimeType = 'audio/ogg; codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/ogg';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm; codecs=opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.start();
    console.log('[OFF] MediaRecorder started, state:', mediaRecorder.state);
    safeSend({ type: 'RECORDING_STARTED', success: true, mimeType });
  } catch (err) {
    safeSend({
      type: 'RECORDING_STARTED',
      success: false,
      error: err.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён' : err.message
    });
  }
}

function stopRecording() {
  console.log('[OFF] stopRecording called, recorder:', !!mediaRecorder, mediaRecorder?.state);
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    safeSend({ type: 'RECORDING_DATA', success: false, error: 'Запись не активна' });
    return;
  }

  mediaRecorder.addEventListener('stop', async () => {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    const actualMime = mediaRecorder.mimeType;
    const blob = new Blob(audioChunks, { type: actualMime });
    audioChunks = [];
    mediaRecorder = null;

    // Проверка минимального размера (защита от случайных кликов)
    if (blob.size < 1024) {
      safeSend({ type: 'RECORDING_DATA', success: false, error: 'Запись слишком короткая. Попробуйте ещё раз.' });
      return;
    }

    try {
      const base64 = await blobToBase64(blob);
      safeSend({ type: 'RECORDING_DATA', success: true, data: base64, mimeType: actualMime });
    } catch (err) {
      safeSend({ type: 'RECORDING_DATA', success: false, error: 'Ошибка конвертации аудио' });
    }
  }, { once: true });

  mediaRecorder.addEventListener('error', () => {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    audioChunks = [];
    safeSend({ type: 'RECORDING_DATA', success: false, error: 'Ошибка во время записи' });
  }, { once: true });

  mediaRecorder.stop();
}

function safeSend(msg) {
  try {
    if (port) {
      port.postMessage(msg);
    }
  } catch (_) {
    // Port disconnected — try to reconnect and resend
    connectPort();
    try {
      if (port) port.postMessage(msg);
    } catch (_) { /* give up */ }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
