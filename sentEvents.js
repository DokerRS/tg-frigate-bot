/**
 * Хранилище id событий, уже отправленных в Telegram.
 * Дедупликация без временных ограничений и кулдаунов.
 * Размер ограничен для предотвращения неограниченного роста памяти.
 */

const MAX_SIZE = 50000;
const sentIds = new Set();
const order = [];

function markSent(eventId) {
  if (!eventId || typeof eventId !== 'string') return;
  if (sentIds.has(eventId)) return;
  sentIds.add(eventId);
  order.push(eventId);
  while (order.length > MAX_SIZE) {
    const oldest = order.shift();
    sentIds.delete(oldest);
  }
}

function wasSent(eventId) {
  return eventId != null && sentIds.has(String(eventId));
}

module.exports = {
  markSent,
  wasSent,
};
