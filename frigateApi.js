const axios = require('axios');

function getBaseUrl(config) {
  const raw =
    (config.frigateApi && config.frigateApi.baseUrl) || 'http://10.10.10.177:5000';
  const trimmed = raw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

async function fetchBinary(url, timeout = 10000) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout,
  });
  const contentType = response.headers['content-type'] || '';
  return {
    buffer: Buffer.from(response.data),
    contentType,
  };
}

async function getCameraNames(config) {
  const baseUrl = getBaseUrl(config);
  const url = `${baseUrl}/api/stats`;

  const { data } = await axios.get(url, { timeout: 5000 });

  let cameras = [];

  if (data && typeof data === 'object') {
    if (data.cameras && typeof data.cameras === 'object') {
      cameras = Object.keys(data.cameras);
    } else if (data.camera_stats && typeof data.camera_stats === 'object') {
      cameras = Object.keys(data.camera_stats);
    }
  }

  return cameras.filter((c) => typeof c === 'string').sort();
}

async function checkFrigateHealth(config) {
  const baseUrl = getBaseUrl(config);
  const url = `${baseUrl}/api/stats`;
  try {
    await axios.get(url, { timeout: 5000 });
    return { ok: true, message: 'Frigate HTTP API доступен' };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, message: `Ошибка запроса к Frigate HTTP API: ${msg}` };
  }
}

function buildLatestFrameUrl(config, cameraName, opts = {}) {
  const baseUrl = getBaseUrl(config);
  const name = encodeURIComponent(cameraName);
  const params = new URLSearchParams();

  if (opts.bbox !== undefined) params.set('bbox', String(opts.bbox ? 1 : 0));
  if (opts.timestamp !== undefined) params.set('timestamp', String(opts.timestamp ? 1 : 0));
  if (opts.h !== undefined) params.set('h', String(opts.h));

  const qs = params.toString();
  const path = `/api/${name}/latest.jpg`;

  return qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;
}

function buildEventSnapshotUrl(config, eventId) {
  const baseUrl = getBaseUrl(config);
  const id = encodeURIComponent(eventId);
  // bbox=1 и timestamp=1 для отрисовки рамок и времени
  return `${baseUrl}/api/events/${id}/snapshot.jpg?bbox=1&timestamp=1`;
}

function buildEventClipUrl(config, eventId) {
  const baseUrl = getBaseUrl(config);
  const id = encodeURIComponent(eventId);
  return `${baseUrl}/api/events/${id}/clip.mp4`;
}

async function getLatestReview(config, cameraName) {
  const baseUrl = getBaseUrl(config);
  const url = `${baseUrl}/api/review`;

  const { data } = await axios.get(url, { timeout: 5000 });

  if (!data) return null;

  let list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : null;
  if (!list || list.length === 0) return null;

  if (cameraName) {
    list = list.filter((item) => item.camera === cameraName);
    if (!list.length) return null;
  }

  const sorted = [...list].sort((a, b) => {
    const sa = (a.start_time ?? a.start ?? 0);
    const sb = (b.start_time ?? b.start ?? 0);
    if (sa === sb) {
      const ia = String(a.id || '');
      const ib = String(b.id || '');
      return ia.localeCompare(ib);
    }
    return sa - sb;
  });

  const latest = sorted[sorted.length - 1];
  if (!latest) return null;

  const detections =
    latest.data && Array.isArray(latest.data.detections)
      ? latest.data.detections
      : [];

  return {
    id: latest.id,
    camera: latest.camera,
    start_time: latest.start_time ?? latest.start ?? null,
    severity: latest.severity ?? null,
    detections,
  };
}

async function getLatestFrameImage(config, cameraName, opts = {}) {
  const url = buildLatestFrameUrl(config, cameraName, opts);
  const { buffer, contentType } = await fetchBinary(url);
  const ext = contentType.includes('webp') ? 'webp' : 'jpg';
  const filename = `${cameraName}-latest.${ext}`;
  return { buffer, filename, contentType };
}

async function getEventSnapshotImage(config, eventId) {
  const url = buildEventSnapshotUrl(config, eventId);
  const { buffer, contentType } = await fetchBinary(url);
  const ext = contentType.includes('webp') ? 'webp' : 'jpg';
  const filename = `${eventId}-snapshot.${ext}`;
  return { buffer, filename, contentType };
}

async function getEventClipVideo(config, eventId) {
  const url = buildEventClipUrl(config, eventId);
  const { buffer, contentType } = await fetchBinary(url);
  const filename = `${eventId}-clip.mp4`;
  return { buffer, filename, contentType };
}

async function getLatestReviewForCamera(config, cameraName) {
  return getLatestReview(config, cameraName);
}

module.exports = {
  getCameraNames,
  buildLatestFrameUrl,
  buildEventSnapshotUrl,
  buildEventClipUrl,
  getLatestReview,
  getLatestFrameImage,
  getEventSnapshotImage,
  getEventClipVideo,
  getLatestReviewForCamera,
  checkFrigateHealth,
};

