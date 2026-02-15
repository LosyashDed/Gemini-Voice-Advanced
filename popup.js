// Gemini Voice Advanced - Popup Logic

const State = { IDLE: 'idle', RECORDING: 'recording', SENDING: 'sending', ERROR: 'error' };

let currentState = State.IDLE;

// --- Timer state ---
let timerInterval = null;
let recordingStartTime = 0;

// --- Visualizer state ---
let analyser = null;
let animationFrameId = null;
let visualizerAudioCtx = null;
let vizStream = null;

// --- UI ---

function updateUI(state, message) {
  currentState = state;
  const body = document.body;
  const status = document.getElementById('status');

  body.className = state;

  switch (state) {
    case State.IDLE:
      status.textContent = 'Нажмите для записи';
      stopTimer();
      stopVisualizer();
      break;
    case State.RECORDING:
      status.textContent = 'Запись... (нажмите для остановки)';
      startTimer();
      startVisualizer();
      break;
    case State.SENDING:
      status.textContent = 'Отправка...';
      stopTimer();
      stopVisualizer();
      break;
    case State.ERROR:
      status.textContent = message || 'Произошла ошибка';
      stopTimer();
      stopVisualizer();
      setTimeout(() => {
        if (currentState === State.ERROR) {
          updateUI(State.IDLE);
        }
      }, 3000);
      break;
  }
}

// --- Timer (dynamic DOM) ---

function startTimer() {
  stopTimer(); // clean up any previous
  const container = document.querySelector('.container');
  const status = document.getElementById('status');

  const timerEl = document.createElement('div');
  timerEl.id = 'timer';
  timerEl.className = 'timer';
  timerEl.textContent = '00:00';
  container.insertBefore(timerEl, status);

  recordingStartTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.remove();
}

function updateTimer() {
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  timerEl.textContent = `${minutes}:${seconds}`;
}

// --- Visualizer (dynamic DOM) ---

function startVisualizer() {
  stopVisualizer(); // clean up any previous

  const container = document.querySelector('.container');
  const status = document.getElementById('status');

  const canvas = document.createElement('canvas');
  canvas.id = 'visualizer';
  canvas.className = 'visualizer';
  canvas.width = 200;
  canvas.height = 40;
  container.insertBefore(canvas, status);

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      vizStream = stream;
      visualizerAudioCtx = new AudioContext();
      const source = visualizerAudioCtx.createMediaStreamSource(stream);
      analyser = visualizerAudioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      drawVisualizer(canvas);
    })
    .catch(() => {
      // Visualization is non-critical — silently remove canvas
      canvas.remove();
    });
}

function drawVisualizer(canvas) {
  if (!analyser) return;
  const ctx = canvas.getContext('2d');

  animationFrameId = requestAnimationFrame(() => drawVisualizer(canvas));

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const barCount = 32;
  const barWidth = (width / barCount) - 2;
  const step = Math.floor(bufferLength / barCount);

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i * step];
    const barHeight = (value / 255) * height * 0.9;
    const x = i * (barWidth + 2);
    const y = (height - barHeight) / 2;

    const intensity = value / 255;
    const r = Math.round(138 + (234 - 138) * intensity);
    const g = Math.round(180 + (67 - 180) * intensity);
    const b = Math.round(248 + (53 - 248) * intensity);

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.6 + intensity * 0.4})`;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barWidth, Math.max(barHeight, 2), 2);
    } else {
      ctx.rect(x, y, barWidth, Math.max(barHeight, 2));
    }
    ctx.fill();
  }
}

function stopVisualizer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  analyser = null;
  if (visualizerAudioCtx) {
    visualizerAudioCtx.close().catch(() => {});
    visualizerAudioCtx = null;
  }
  if (vizStream) {
    vizStream.getTracks().forEach(track => track.stop());
    vizStream = null;
  }
  const canvas = document.getElementById('visualizer');
  if (canvas) canvas.remove();
}

// --- Recording via Background + Offscreen ---

async function startRecording() {
  try {
    console.log('[POPUP] Sending START_REC');
    const response = await chrome.runtime.sendMessage({ type: 'START_REC' });
    console.log('[POPUP] START_REC response:', JSON.stringify(response));
    if (response && response.success) {
      updateUI(State.RECORDING);
    } else {
      const errMsg = (response && response.error) || 'Не удалось начать запись';
      if (errMsg.includes('микрофон') || errMsg.includes('NotAllowed') || errMsg.includes('Permission') || errMsg.includes('запрещён')) {
        updateUI(State.ERROR, 'Нет доступа к микрофону. Открываю настройку...');
        setTimeout(() => {
          chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
        }, 1000);
      } else if (errMsg.includes('NotFound') || errMsg.includes('не найден')) {
        updateUI(State.ERROR, 'Микрофон не найден. Подключите микрофон.');
      } else {
        updateUI(State.ERROR, errMsg);
      }
    }
  } catch (err) {
    updateUI(State.ERROR, 'Не удалось начать запись');
  }
}

async function stopRecording() {
  updateUI(State.SENDING);
  try {
    console.log('[POPUP] Sending STOP_REC');
    const response = await chrome.runtime.sendMessage({ type: 'STOP_REC' });
    console.log('[POPUP] STOP_REC response:', JSON.stringify(response));
    if (response && response.success) {
      updateUI(State.IDLE);
    } else {
      updateUI(State.ERROR, (response && response.error) || 'Ошибка отправки');
    }
  } catch (err) {
    updateUI(State.ERROR, err.message || 'Ошибка отправки');
  }
}

// --- Event handling ---

function handleMicClick() {
  switch (currentState) {
    case State.IDLE:
      startRecording();
      break;
    case State.RECORDING:
      stopRecording();
      break;
    // Ignore clicks during sending or error states
  }
}

document.getElementById('mic-btn').addEventListener('click', handleMicClick);

// Export for testing (when running outside browser extension context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { State, updateUI, startRecording, stopRecording, handleMicClick };
}
