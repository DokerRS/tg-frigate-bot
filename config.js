const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. ` +
        'Create config.json based on config.example.json.'
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read config.json: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }

  const config = applyDefaults(parsed);
  validateConfig(config);
  return config;
}

function applyDefaults(cfg) {
  const config = { ...cfg };

  config.telegram = config.telegram || {};
  config.mqtt = config.mqtt || {};
  config.filters = config.filters || {};
  config.notifications = config.notifications || {};
   config.frigateApi = config.frigateApi || {};

  if (!Array.isArray(config.filters.allowedZones)) {
    config.filters.allowedZones = ['Zone'];
  }

  if (!Array.isArray(config.filters.allowedLabels)) {
    config.filters.allowedLabels = ['person', 'car', 'truck'];
  }

  if (typeof config.mqtt.topicPrefix !== 'string') {
    config.mqtt.topicPrefix = 'frigate';
  }

  if (
    typeof config.notifications.defaultMuteMinutes !== 'number' ||
    config.notifications.defaultMuteMinutes <= 0
  ) {
    config.notifications.defaultMuteMinutes = 60;
  }

  if (typeof config.frigateApi.baseUrl !== 'string' || !config.frigateApi.baseUrl) {
    config.frigateApi.baseUrl = 'http://10.10.10.177:5000';
  }

  // messageThreadId optional: for supergroup topics (e.g. t.me/c/2339884405/26177 -> -1002339884405, thread 26177)
  if (config.telegram.messageThreadId !== undefined) {
    const t = config.telegram.messageThreadId;
    config.telegram.messageThreadId = typeof t === 'number' && Number.isInteger(t) ? t : undefined;
  }

  return config;
}

function validateConfig(config) {
  if (!config.telegram || typeof config.telegram.botToken !== 'string' || !config.telegram.botToken) {
    throw new Error('config.telegram.botToken is required and must be a non-empty string');
  }

  if (
    !config.telegram ||
    (typeof config.telegram.chatId !== 'number' &&
      typeof config.telegram.chatId !== 'string')
  ) {
    throw new Error('config.telegram.chatId is required and must be a number or string');
  }

  if (!config.mqtt || typeof config.mqtt.host !== 'string' || !config.mqtt.host) {
    throw new Error('config.mqtt.host is required and must be a non-empty string');
  }

  if (
    typeof config.mqtt.port !== 'number' ||
    !Number.isInteger(config.mqtt.port) ||
    config.mqtt.port <= 0
  ) {
    config.mqtt.port = 1883;
  }
}

module.exports = {
  loadConfig,
};

