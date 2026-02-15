// Gemini Voice Advanced - Content Script

/**
 * Конвертация base64 строки в Blob
 * @param {string} base64 - base64-encoded строка
 * @param {string} mimeType - MIME-тип (например, 'audio/ogg')
 * @returns {Blob}
 */
function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteArray = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Создание объекта File из Blob с уникальным именем (timestamp)
 * @param {Blob} blob - аудио Blob
 * @returns {File}
 */
function createAudioFile(blob) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `voice_${timestamp}.ogg`;
  return new File([blob], fileName, { type: 'audio/ogg' });
}

/**
 * Поиск редактора ввода Gemini (Quill editor)
 * @returns {HTMLElement|null}
 */
function findEditor() {
  return document.querySelector('div.ql-editor');
}

/**
 * Поиск кнопки отправки (множественные селекторы для устойчивости к изменениям UI и локализации)
 * @returns {HTMLElement|null}
 */
function findSendButton() {
  const selectors = [
    'button.send-button',
    'button[aria-label="Отправить сообщение"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]'
  ];
  for (const selector of selectors) {
    const btn = document.querySelector(selector);
    if (btn) return btn;
  }
  return null;
}

/**
 * Вставка файла в редактор через симуляцию ClipboardEvent paste
 * @param {File} file - файл для вставки
 */
function pasteFileToEditor(file) {
  const editor = findEditor();
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer
  });
  editor.dispatchEvent(pasteEvent);
}

/**
 * Ожидание появления и активации кнопки отправки, затем клик
 * Polling каждые 200мс, таймаут 5 секунд
 * @returns {Promise<void>}
 */
function clickSendButton() {
  return new Promise((resolve, reject) => {
    const POLL_INTERVAL = 200;
    const TIMEOUT = 5000;
    let elapsed = 0;

    const interval = setInterval(() => {
      const button = findSendButton();
      if (button && !button.disabled) {
        clearInterval(interval);
        button.click();
        resolve();
        return;
      }
      elapsed += POLL_INTERVAL;
      if (elapsed >= TIMEOUT) {
        clearInterval(interval);
        reject(new Error('Кнопка отправки не найдена или неактивна'));
      }
    }, POLL_INTERVAL);
  });
}

/**
 * Ожидание появления редактора ввода
 * @returns {Promise<HTMLElement>}
 */
function waitForEditor() {
  return new Promise((resolve, reject) => {
    const POLL_INTERVAL = 300;
    const TIMEOUT = 10000;
    let elapsed = 0;

    // Check immediately
    const existing = findEditor();
    if (existing) { resolve(existing); return; }

    const interval = setInterval(() => {
      const editor = findEditor();
      if (editor) {
        clearInterval(interval);
        resolve(editor);
        return;
      }
      elapsed += POLL_INTERVAL;
      if (elapsed >= TIMEOUT) {
        clearInterval(interval);
        reject(new Error('Редактор ввода не найден'));
      }
    }, POLL_INTERVAL);
  });
}

/**
 * Обработчик сообщения PASTE_AUDIO
 */
function handlePasteAudio(message, sender, sendResponse) {
  if (message.type !== 'PASTE_AUDIO') return false;

  (async () => {
    try {
      const editor = await waitForEditor();

      const mimeType = message.mimeType || 'audio/ogg';
      const blob = base64ToBlob(message.data, mimeType);
      const file = createAudioFile(blob);

      pasteFileToEditor(file);

      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
}

// Регистрация обработчика сообщений от Service Worker
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handlePasteAudio);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    base64ToBlob,
    createAudioFile,
    findEditor,
    findSendButton,
    pasteFileToEditor,
    clickSendButton,
    handlePasteAudio
  };
}
