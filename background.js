// Gemini Voice Advanced - Service Worker

// --- Open welcome page on install to request mic permission ---
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    }
  });
}

// --- URL Utilities ---

function isGeminiUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try { return new URL(url).hostname === 'gemini.google.com'; }
  catch { return false; }
}

function hasActiveDialog(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const match = new URL(url).pathname.match(/^\/app\/(.+)/);
    return match !== null && match[1].length > 0;
  } catch { return false; }
}

function classifyUrl(url) {
  if (!isGeminiUrl(url)) return 'not_gemini';
  try {
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith('/app')) return 'not_gemini';
    if (hasActiveDialog(url)) return 'active_dialog';
    if (pathname === '/app' || pathname === '/app/') return 'new_chat';
    return 'not_gemini';
  } catch { return 'not_gemini'; }
}

// --- Tab Management ---

const PAGE_LOAD_TIMEOUT_MS = 15000;

async function findGeminiTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { tab: null, classification: 'not_gemini' };
  return { tab, classification: classifyUrl(tab.url) };
}

function openGeminiTab() {
  return new Promise((resolve, reject) => {
    let timeoutId, createdTabId;
    function onUpdated(tabId, changeInfo) {
      if (tabId === createdTabId && changeInfo.status === 'complete') {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.get(tabId).then(resolve).catch(reject);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: 'https://gemini.google.com/app' }).then((tab) => {
      createdTabId = tab.id;
      timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('Таймаут ожидания загрузки страницы Gemini'));
      }, PAGE_LOAD_TIMEOUT_MS);
    }).catch((err) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(err);
    });
  });
}

async function sendToContentScript(tabId, base64Data, mimeType) {
  console.log('[BG] sendToContentScript: tabId=', tabId, 'dataLen=', base64Data?.length);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  console.log('[BG] content.js injected, waiting 500ms...');

  // Small delay to let Gemini's SPA fully render after page load
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('[BG] Sending PASTE_AUDIO to tab', tabId);
  const result = await chrome.tabs.sendMessage(tabId, { type: 'PASTE_AUDIO', data: base64Data, mimeType });
  console.log('[BG] PASTE_AUDIO result:', JSON.stringify(result));
  return result;
}

async function handleSendVoice(base64Data, mimeType) {
  const { tab, classification } = await findGeminiTab();
  console.log('[BG] handleSendVoice: tab=', tab?.id, 'url=', tab?.url, 'classification=', classification);
  let targetTabId;
  let isNewTab = false;
  if (classification === 'active_dialog' || classification === 'new_chat') {
    targetTabId = tab.id;
  } else {
    console.log('[BG] Opening new Gemini tab...');
    targetTabId = (await openGeminiTab()).id;
    isNewTab = true;
    console.log('[BG] New Gemini tab opened: id=', targetTabId);
  }

  // Extra delay for newly opened tabs — Gemini SPA needs time to initialize
  if (isNewTab) {
    console.log('[BG] Waiting 1s for new tab to initialize...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const result = await sendToContentScript(targetTabId, base64Data, mimeType);

  // Always activate the Gemini tab and bring its window to front
  try {
    await chrome.tabs.update(targetTabId, { active: true });
    const tabInfo = await chrome.tabs.get(targetTabId);
    if (tabInfo.windowId) {
      await chrome.windows.update(tabInfo.windowId, { focused: true });
    }
    console.log('[BG] Activated Gemini tab', targetTabId);
  } catch (e) {
    console.warn('[BG] Could not activate tab:', e.message);
  }

  return result;
}


// --- Offscreen Document + Port Communication ---

let offscreenPort = null;
let pendingStartCallback = null;
let pendingStopCallback = null;
let offscreenCreating = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  console.log('[BG] ensureOffscreen: contexts:', existingContexts.length, 'port:', !!offscreenPort);

  // If document exists but port is dead, close and recreate
  if (existingContexts.length > 0 && !offscreenPort) {
    console.log('[BG] Document exists but port dead — closing and recreating');
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) { /* ignore */ }
    // Fall through to create a new one
  } else if (existingContexts.length > 0 && offscreenPort) {
    console.log('[BG] Document and port alive — reusing');
    return;
  }

  if (offscreenCreating) { await offscreenCreating; return; }
  console.log('[BG] Creating new offscreen document');
  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Recording audio from microphone for voice messages'
  });
  await offscreenCreating;
  offscreenCreating = null;
  console.log('[BG] Offscreen document created');
}

function waitForPort(timeoutMs) {
  return new Promise((resolve) => {
    if (offscreenPort) { resolve(true); return; }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 50;
      if (offscreenPort) { clearInterval(interval); resolve(true); return; }
      if (elapsed >= timeoutMs) { clearInterval(interval); resolve(false); }
    }, 50);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  console.log('[BG] onConnect:', port.name);
  if (port.name === 'offscreen') {
    offscreenPort = port;

    port.onMessage.addListener((msg) => {
      console.log('[BG] Port message received:', msg.type, 'success:', msg.success);
      if (msg.type === 'RECORDING_STARTED' && pendingStartCallback) {
        const cb = pendingStartCallback;
        pendingStartCallback = null;
        cb(msg);
      }
      if (msg.type === 'RECORDING_DATA' && pendingStopCallback) {
        const cb = pendingStopCallback;
        pendingStopCallback = null;
        cb(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[BG] Offscreen port disconnected');
      offscreenPort = null;
    });
  }
});

// --- Message Listener ---

function onMessageHandler(message, sender, sendResponse) {
  if (message.type === 'SEND_VOICE') {
    handleSendVoice(message.data, message.mimeType)
      .then((result) => sendResponse(result || { success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'START_REC') {
    (async () => {
      try {
        console.log('[BG] START_REC received');
        // Reset any stale callbacks from previous sessions
        pendingStartCallback = null;
        pendingStopCallback = null;

        console.log('[BG] offscreenPort before ensure:', !!offscreenPort);
        await ensureOffscreenDocument();
        console.log('[BG] offscreenPort after ensure:', !!offscreenPort);
        const connected = await waitForPort(3000);
        console.log('[BG] waitForPort result:', connected, 'port alive:', !!offscreenPort);
        if (!connected || !offscreenPort) {
          sendResponse({ success: false, error: 'Не удалось подключиться к модулю записи' });
          return;
        }

        // Wait for RECORDING_STARTED confirmation from offscreen
        const startResult = await new Promise((resolve) => {
          pendingStartCallback = resolve;
          try {
            console.log('[BG] Sending START_RECORDING to offscreen port');
            offscreenPort.postMessage({ type: 'START_RECORDING' });
          } catch (portErr) {
            console.error('[BG] postMessage failed:', portErr.message);
            pendingStartCallback = null;
            offscreenPort = null;
            resolve({ success: false, error: 'Порт записи отключён, попробуйте ещё раз' });
          }
          setTimeout(() => {
            if (pendingStartCallback) {
              console.warn('[BG] START_RECORDING timeout — no response from offscreen');
              pendingStartCallback = null;
              resolve({ success: false, error: 'Таймаут запуска записи' });
            }
          }, 5000);
        });

        console.log('[BG] startResult:', JSON.stringify(startResult));
        sendResponse(startResult);
      } catch (err) {
        console.error('[BG] START_REC error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'STOP_REC') {
    console.log('[BG] STOP_REC received, port alive:', !!offscreenPort);
    if (!offscreenPort) {
      sendResponse({ success: false, error: 'Модуль записи не подключён' });
      return true;
    }

    (async () => {
      try {
        // Wait for RECORDING_DATA from offscreen
        const stopResult = await new Promise((resolve) => {
          pendingStopCallback = resolve;
          console.log('[BG] Sending STOP_RECORDING to offscreen port');
          offscreenPort.postMessage({ type: 'STOP_RECORDING' });
          setTimeout(() => {
            if (pendingStopCallback) {
              console.warn('[BG] STOP_RECORDING timeout — no data from offscreen');
              pendingStopCallback = null;
              resolve({ success: false, error: 'Таймаут ожидания аудиоданных' });
            }
          }, 10000);
        });

        console.log('[BG] stopResult success:', stopResult.success, 'hasData:', !!stopResult.data);

        if (stopResult.success && stopResult.data) {
          const sendResult = await handleSendVoice(stopResult.data, 'audio/ogg; codecs=opus');
          sendResponse(sendResult || { success: true });
        } else {
          sendResponse({ success: false, error: stopResult.error || 'Ошибка записи' });
        }
      } catch (err) {
        console.error('[BG] STOP_REC error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(onMessageHandler);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isGeminiUrl, hasActiveDialog, classifyUrl,
    findGeminiTab, openGeminiTab, sendToContentScript, handleSendVoice,
    onMessageHandler, PAGE_LOAD_TIMEOUT_MS
  };
}
