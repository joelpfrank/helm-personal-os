// Push notifications via Telegram use explicit process environment variables.
// Missing credentials disable notifications; they never throw or block.

function loadCreds() {
  if (process.env.HELM_DISABLE_TELEGRAM_NOTIFICATIONS === '1') {
    return { token: undefined, chatId: undefined };
  }
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_ALLOWED_USER_ID,
  };
}

export function notifyEnabled() {
  const { token, chatId } = loadCreds();
  return !!(token && chatId);
}

export async function sendTelegram(text) {
  const { token, chatId } = loadCreds();
  if (!token || !chatId || !text) return false;
  const s = String(text);
  const chunks = [];
  for (let i = 0; i < s.length; i += 3800) chunks.push(s.slice(i, i + 3800));
  try {
    for (const chunk of chunks) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
      });
    }
    return true;
  } catch { return false; }
}
