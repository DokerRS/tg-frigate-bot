const { loadConfig } = require('./config');
const { subscribeToFrigateEvents } = require('./mqttClient');
const { shouldNotify, formatNotification, extractEventPayload } = require('./events');
const { createBot } = require('./bot');
const {
  isMuted,
  setMqttConnected,
  setFrigateHealthy,
  getMqttStatus,
  getFrigateStatus,
} = require('./state');
const { getEventSnapshotImage, checkFrigateHealth } = require('./frigateApi');
const { wasSent, markSent } = require('./sentEvents');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('[MAIN] Failed to load config:', err.message);
    process.exit(1);
  }

  console.log('[MAIN] Loaded config:', {
    mqtt: {
      host: config.mqtt.host,
      port: config.mqtt.port,
      topicPrefix: config.mqtt.topicPrefix,
      username: config.mqtt.username ? '***' : undefined,
    },
    frigateApi: {
      baseUrl: (config.frigateApi && config.frigateApi.baseUrl) || 'undefined',
    },
    filters: {
      allowedLabels: config.filters.allowedLabels,
      allowedZones: config.filters.allowedZones,
    },
    telegram: {
      chatId: config.telegram.chatId,
    },
  });

  const { bot, sendNotification, sendStatusMessage } = createBot(config);

  // Запускаем бота НЕ блокируя дальнейший код
  bot
    .launch()
    .then(() => {
      console.log('[MAIN] Telegram bot launched');
    })
    .catch((err) => {
      console.error('[MAIN] Failed to launch Telegram bot:', err);
      process.exit(1);
    });

  console.log('[MAIN] Starting MQTT subscription...');

  subscribeToFrigateEvents(
    config,
    async (rawEvent) => {
      try {
        const payload = extractEventPayload(rawEvent);
        console.log('[MQTT] Raw event summary:', {
          type: rawEvent.type,
          id: payload && payload.id,
          label: payload && payload.label,
          camera: payload && payload.camera,
          zones: payload && payload.zones,
        });

        const notify = shouldNotify(rawEvent, config);
        console.log('[MQTT] shouldNotify:', notify, 'isMuted:', isMuted());
        if (!notify) {
          return;
        }

        if (isMuted()) {
          console.log('[MQTT] Skip: global mute enabled');
          return;
        }

        if (payload && wasSent(payload.id)) {
          console.log('[MQTT] Skip: event already sent', { id: payload.id });
          return;
        }
        if (payload && payload.id) {
          markSent(payload.id);
        }

        const text = formatNotification(rawEvent);
        let photo = null;

        if (payload && payload.id) {
          try {
            photo = await getEventSnapshotImage(config, payload.id);
          } catch (err) {
            console.error('[EVENT] Failed to fetch snapshot image:', err.message || err);
          }
        }

        const keyboard = {
          inline_keyboard: [
            [
              { text: '▶️ Видео события', callback_data: `event_clip:${payload && payload.id}` },
              { text: 'Меню', callback_data: 'send_menu' },
            ],
          ],
        };

        console.log('[EVENT] Sending notification:', text, 'hasPhoto:', !!photo);
        await sendNotification(text, photo || undefined, keyboard);
      } catch (err) {
        console.error('[EVENT] Failed to handle event:', err);
      }
    },
    {
      onConnected: () => {
        setMqttConnected(true);
        console.log('[MAIN] MQTT connected. Status:', getMqttStatus());
      },
      onDisconnected: () => {
        setMqttConnected(false);
        console.warn('[MAIN] MQTT disconnected. Status:', getMqttStatus());
        sendStatusMessage('⚠️ MQTT отключился.\n' + getMqttStatus()).catch((err) => {
          console.error('[MAIN] Failed to send MQTT disconnect message:', err.message || err);
        });
      },
      onReconnected: () => {
        setMqttConnected(true);
        console.log('[MAIN] MQTT reconnected. Status:', getMqttStatus());
        sendStatusMessage('✅ MQTT восстановился.\n' + getMqttStatus()).catch((err) => {
          console.error('[MAIN] Failed to send MQTT reconnect message:', err.message || err);
        });
      },
    },
  );

  // Периодическая проверка Frigate HTTP API
  setInterval(async () => {
    try {
      const result = await checkFrigateHealth(config);
      const prevStatus = getFrigateStatus();
      setFrigateHealthy(result.ok);
      const newStatus = getFrigateStatus();
      if (prevStatus !== newStatus) {
        const prefix = result.ok ? '✅ Frigate восстановился.\n' : '⚠️ Frigate HTTP API недоступен.\n';
        await sendStatusMessage(prefix + newStatus).catch((err) => {
          console.error('[MAIN] Failed to send Frigate health message:', err.message || err);
        });
      }
    } catch (err) {
      console.error('[MAIN] checkFrigateHealth error:', err.message || err);
    }
  }, 60000);

  // Корректное завершение по сигналам
  process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[MAIN] Unexpected error:', err);
  process.exit(1);
});

