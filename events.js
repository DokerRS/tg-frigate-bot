const path = require('path');

const LABELS_RU = {
  person: '🧍 Человек',
  car: '🚗 Машина',
  truck: '🚚 Грузовик',
};

/**
 * Возвращает объект с удобными полями из «сырого» события Frigate.
 */
function extractEventPayload(raw) {
  if (!raw) return null;
  const body = raw.after || raw.before || raw;
  if (!body) return null;

  return {
    id: body.id,
    type: raw.type,
    camera: body.camera,
    label: body.label,
    zones: Array.isArray(body.current_zones)
      ? body.current_zones
      : Array.isArray(body.entered_zones)
      ? body.entered_zones
      : [],
  };
}

/**
 * Решает, нужно ли отправлять уведомление по событию.
 */
function shouldNotify(rawEvent, config) {
  const payload = extractEventPayload(rawEvent);
  if (!payload) {
    console.log('[FILTER] Skip: no payload');
    return false;
  }

  // Игнорируем только окончание события, всё остальное (new/update) пропускаем.
  if (payload.type === 'end') {
    console.log('[FILTER] Skip: event type=end', { id: payload.id });
    return false;
  }

  const allowedLabels = config.filters.allowedLabels || [];
  if (!allowedLabels.includes(payload.label)) {
    console.log('[FILTER] Skip: label not allowed', {
      id: payload.id,
      label: payload.label,
      allowedLabels,
    });
    return false;
  }

  const allowedZones = config.filters.allowedZones || [];
  if (!Array.isArray(payload.zones) || payload.zones.length === 0) {
    console.log('[FILTER] Skip: no zones', { id: payload.id });
    return false;
  }

  const hasAllowedZone = payload.zones.some((z) => allowedZones.includes(z));
  if (!hasAllowedZone) {
    console.log('[FILTER] Skip: zone not allowed', {
      id: payload.id,
      zones: payload.zones,
      allowedZones,
    });
    return false;
  }

  return true;
}

/**
 * Текст уведомления (caption к фото).
 */
function formatNotification(rawEvent) {
  const body = rawEvent.after || rawEvent.before || rawEvent;
  const payload = extractEventPayload(rawEvent);
  if (!payload) return 'Событие без данных.';

  const { label, camera, zones } = payload;
  const humanLabel = LABELS_RU[label] || label || 'объект';
  const zonesText = zones && zones.length ? zones.join(', ') : 'неизвестная зона';

  const startTs = body.start_time || body.frame_time || null;
  const dateText = startTs
    ? new Date(startTs * 1000).toLocaleString()
    : 'неизвестно';

  const parts = [];
  parts.push(`${humanLabel} в зоне ${zonesText} (камера ${camera}).`);
  parts.push(`Время: ${dateText}`);

  if (body.sub_label) {
    const sub =
      Array.isArray(body.sub_label) && body.sub_label.length
        ? body.sub_label[0]
        : body.sub_label;
    parts.push(`Подпись: ${sub}`);
  }

  if (body.recognized_license_plate) {
    parts.push(`Номер: ${body.recognized_license_plate}`);
  }

  return parts.join('\n');
}

module.exports = {
  extractEventPayload,
  shouldNotify,
  formatNotification,
};

