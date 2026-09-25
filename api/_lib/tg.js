const disabled = () => Promise.reject(new Error('Legacy Telegram integration is disabled'));

export function sendTelegram() { return disabled(); }
export function handleTelegramUpdate() { return disabled(); }
