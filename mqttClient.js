const mqtt = require('mqtt');

/**
 * Подключается к MQTT и подписывается на топик событий Frigate.
 * @param {object} config - общий конфиг приложения
 * @param {(event: any) => void} onEvent - колбэк, вызывается с распарсенным JSON события
 * @param {object} [options] - доп. колбэки состояния
 * @param {() => void} [options.onConnected]
 * @param {() => void} [options.onDisconnected]
 * @param {() => void} [options.onReconnected]
 */
function subscribeToFrigateEvents(config, onEvent, options = {}) {
  const { host, port, username, password, topicPrefix } = config.mqtt;
  const url = `mqtt://${host}:${port || 1883}`;
  
  const mqttOptions = {};
  if (username) mqttOptions.username = username;
  if (password) mqttOptions.password = password;
  
  const client = mqtt.connect(url, mqttOptions);
  const eventsTopic = `${topicPrefix || 'frigate'}/events`;

  client.on('connect', () => {
    console.log('[MQTT] Connected to', url);
    if (typeof options.onConnected === 'function') {
      options.onConnected();
    }
    client.subscribe(eventsTopic, (err) => {
      if (err) {
        console.error('[MQTT] Failed to subscribe to', eventsTopic, err);
      } else {
        console.log('[MQTT] Subscribed to', eventsTopic);
      }
    });
  });

  client.on('error', (err) => {
    console.error('[MQTT] Connection error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
    if (typeof options.onReconnected === 'function') {
      options.onReconnected();
    }
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed');
    if (typeof options.onDisconnected === 'function') {
      options.onDisconnected();
    }
  });

  client.on('offline', () => {
    console.log('[MQTT] Client went offline');
    if (typeof options.onDisconnected === 'function') {
      options.onDisconnected();
    }
  });

  client.on('message', (topic, message) => {
    if (topic !== eventsTopic) return;
    let parsed;
    try {
      parsed = JSON.parse(message.toString());
    } catch (err) {
      console.error('[MQTT] Failed to parse event JSON:', err.message);
      return;
    }
    try {
      onEvent(parsed);
    } catch (err) {
      console.error('[MQTT] Error in onEvent handler:', err);
    }
  });

  return client;
}

module.exports = {
  subscribeToFrigateEvents,
};