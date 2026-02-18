let muteUntil = null;
let mqttConnected = false;
let mqttLastChange = null;
let frigateHealthy = false;
let frigateLastChange = null;

function setMuteForMinutes(minutes) {
  const ms = Number(minutes) * 60 * 1000;
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  muteUntil = Date.now() + ms;
  console.log(
    `[STATE] Notifications muted for ${minutes} minutes (until ${new Date(
      muteUntil,
    ).toISOString()})`,
  );
}

function clearMute() {
  muteUntil = null;
  console.log('[STATE] Notifications unmuted');
}

function isMuted() {
  if (!muteUntil) return false;
  if (Date.now() > muteUntil) {
    muteUntil = null;
    return false;
  }
  return true;
}

function getMuteStatusText() {
  if (!isMuted()) {
    return 'Уведомления включены.';
  }
  return `Уведомления заглушены до ${new Date(muteUntil).toLocaleString()}.`;
}

function setMqttConnected(connected) {
  if (mqttConnected === connected) return;
  mqttConnected = connected;
  mqttLastChange = new Date();
  console.log(
    `[STATE] MQTT status changed: ${connected ? 'connected' : 'disconnected'} at ${mqttLastChange.toISOString()}`,
  );
}

function getMqttStatus() {
  if (!mqttConnected) {
    return '❌ MQTT: отключен';
  }
  const ts = mqttLastChange
    ? ` (подключён с ${mqttLastChange.toLocaleString()})`
    : '';
  return `✅ MQTT: подключен${ts}`;
}

function setFrigateHealthy(healthy) {
  if (frigateHealthy === healthy) return;
  frigateHealthy = healthy;
  frigateLastChange = new Date();
  console.log(
    `[STATE] Frigate HTTP status changed: ${healthy ? 'healthy' : 'unreachable'} at ${frigateLastChange.toISOString()}`,
  );
}

function getFrigateStatus() {
  if (!frigateHealthy) {
    return '❌ Frigate HTTP API: недоступен';
  }
  const ts = frigateLastChange
    ? ` (доступен с ${frigateLastChange.toLocaleString()})`
    : '';
  return `✅ Frigate HTTP API: доступен${ts}`;
}

module.exports = {
  setMuteForMinutes,
  clearMute,
  isMuted,
  getMuteStatusText,
  setMqttConnected,
  getMqttStatus,
  setFrigateHealthy,
  getFrigateStatus,
};

