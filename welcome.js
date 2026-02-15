// Request microphone permission on extension's origin
const btn = document.getElementById('grant-btn');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — stop the stream immediately
    stream.getTracks().forEach(track => track.stop());
    status.textContent = '✅ Доступ к микрофону разрешён! Можете закрыть эту вкладку.';
    status.className = 'status success';
    btn.textContent = 'Готово';
    btn.disabled = true;
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      status.textContent = '❌ Вы отклонили запрос. Попробуйте ещё раз.';
    } else {
      status.textContent = '❌ Ошибка: ' + err.message;
    }
    status.className = 'status error';
  }
});
