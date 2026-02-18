const { Telegraf, Markup } = require('telegraf');
const {
  setMuteForMinutes,
  clearMute,
  isMuted,
  getMuteStatusText,
  getMqttStatus,
  getFrigateStatus,
} = require('./state');
const {
  getCameraNames,
  getLatestFrameImage,
  getEventSnapshotImage,
  getEventClipVideo,
  getLatestReview,
  getLatestReviewForCamera,
  checkFrigateHealth,
} = require('./frigateApi');

/**
 * Создаёт и настраивает Telegram-бота.
 * @param {object} config - общий конфиг
 */
function createBot(config) {
  const token = config.telegram.botToken;
  const chatId = `${config.telegram.chatId}`;
  const threadId = config.telegram.messageThreadId;
  const telegramExtra = threadId != null ? { message_thread_id: threadId } : {};

  const bot = new Telegraf(token);

  // Глобальный обработчик ошибок Telegraf, чтобы любые ошибки в middlewares
  // не приводили к падению процесса и рестарту контейнера.
  bot.catch((err, ctx) => {
    console.error(
      '[BOT] Global error handler:',
      err && err.message ? err.message : err,
      'update type:',
      ctx && ctx.update && Object.keys(ctx.update)
    );
  });

  // Безопасная обёртка для answerCbQuery — игнорируем «старые» callback-запросы.
  async function safeAnswerCbQuery(ctx, text) {
    try {
      if (text !== undefined) {
        await ctx.answerCbQuery(text);
      } else {
        await ctx.answerCbQuery();
      }
    } catch (err) {
      const desc = err && (err.description || err.message);
      if (desc && desc.includes('query is too old')) {
        console.warn('[BOT] Ignoring old callback query error:', desc);
        return;
      }
      console.error('[BOT] answerCbQuery error:', desc || err);
    }
  }

  const replyKeyboard = Markup.keyboard([['Меню']]).resize();

  // Глобальный фильтр: только указанный чат и, если задан тред — только этот тред (не подслушивать остальные)
  bot.use(async (ctx, next) => {
    if (!ctx.chat || `${ctx.chat.id}` !== chatId) {
      return;
    }
    if (threadId != null) {
      const msg = ctx.message || ctx.callbackQuery?.message;
      // Разрешаем только сообщения из нашего треда. В «Общем» топике message_thread_id бывает 1 или отсутствует.
      if (!msg || msg.message_thread_id !== threadId) {
        return;
      }
    }
    return next();
  });

  const mainMenuText =
    'Главное меню:\n\n' +
    'Уведомления — мут/размут, статус.\n' +
    'Система — MQTT и Frigate API.\n' +
    'Камеры — живой кадр по камере.\n' +
    'Обзоры и события — последний обзор с фото и видео.';

  const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Уведомления', 'menu_notifications')],
    [Markup.button.callback('Система', 'menu_system')],
    [Markup.button.callback('Камеры', 'menu_cameras')],
    [Markup.button.callback('Обзоры и события', 'menu_reviews')],
    [
      Markup.button.callback('Справка', 'help'),
      Markup.button.callback('Фильтры', 'filters'),
      Markup.button.callback('Пинг', 'ping'),
    ],
  ]);

  function sendMainMenu(ctxOrBot) {
    if (typeof ctxOrBot.reply === 'function') {
      return ctxOrBot.reply(mainMenuText, mainMenuKeyboard);
    }
    return bot.telegram.sendMessage(chatId, mainMenuText, { ...telegramExtra, ...mainMenuKeyboard });
  }

  bot.start(async (ctx) => {
    ctx.reply(
      'Привет! Я бот уведомлений Frigate.\n' +
        'Я буду присылать сработки (человек / машина / грузовик) из зоны Zone с фото и обводкой объекта.',
      replyKeyboard
    );
    sendMainMenu(ctx);
  });

  bot.hears('Меню', async (ctx) => {
    sendMainMenu(ctx);
  });

  bot.command('mute_30m', async (ctx) => {
    setMuteForMinutes(30);
    ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.command('mute_1h', async (ctx) => {
    setMuteForMinutes(60);
    ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.command('unmute', async (ctx) => {
    clearMute();
    ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.command('status', async (ctx) => {
    ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.command('health', async (ctx) => {
    const text = `${getMqttStatus()}\n${getFrigateStatus()}`;
    ctx.reply(text, replyKeyboard);
  });

  bot.command('cameras', async (ctx) => {
    try {
      const cameras = await getCameraNames(config);
      if (!cameras.length) {
        await ctx.reply('Камеры не найдены в Frigate.', replyKeyboard);
        return;
      }

      const rows = cameras.map((name) => [Markup.button.callback(name, `camera:${name}`)]);
      const keyboard = Markup.inlineKeyboard(rows);
      await ctx.reply('Выберите камеру:', keyboard);
    } catch (err) {
      console.error('[BOT] /cameras error:', err.message || err);
      await ctx.reply('Не удалось получить список камер из Frigate.', replyKeyboard);
    }
  });

  bot.command('last_review', async (ctx) => {
    try {
      const review = await getLatestReview(config);
      if (!review) {
        await ctx.reply('Нет доступных событий для обзора.', replyKeyboard);
        return;
      }

      const eventId = review.detections && review.detections.length ? review.detections[review.detections.length - 1] : null;
      if (!eventId) {
        await ctx.reply(
          `Последний обзор найден (камера ${review.camera}), но нет связанных событий для показа.`,
          replyKeyboard
        );
        return;
      }

      const snapshot = await getEventSnapshotImage(config, eventId);
      const clip = await getEventClipVideo(config, eventId);

      const caption =
        `Последний обзор на камере ${review.camera}.\n` +
        `ID обзора: ${review.id}\n` +
        `ID события: ${eventId}`;

      await ctx.replyWithPhoto(
        { source: snapshot.buffer, filename: snapshot.filename },
        { caption }
      );

      await ctx.replyWithVideo(
        { source: clip.buffer, filename: clip.filename },
        {
        caption: 'Видеофрагмент события (clip.mp4).',
        }
      );
    } catch (err) {
      console.error('[BOT] /last_review error:', err.message || err);
      await ctx.reply('Не удалось получить данные последнего обзора из Frigate.', replyKeyboard);
    }
  });

  bot.action('menu_back', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(mainMenuText, mainMenuKeyboard);
  });

  bot.action('menu_notifications', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const text = 'Уведомления: мут, размут, статус.';
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Включить уведомления', 'unmute')],
      [Markup.button.callback('Мут 30 мин', 'mute_30')],
      [Markup.button.callback('Статус уведомлений', 'status')],
      [Markup.button.callback('Назад', 'menu_back')],
    ]);
    await ctx.editMessageText(text, keyboard);
  });

  bot.action('menu_system', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const text = 'Состояние MQTT и Frigate API.';
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Состояние системы', 'health')],
      [Markup.button.callback('Назад', 'menu_back')],
    ]);
    await ctx.editMessageText(text, keyboard);
  });

  bot.action('menu_cameras', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx);
      const cameras = await getCameraNames(config);
      const rows = cameras.length
        ? cameras.map((name) => [Markup.button.callback(name, `camera:${name}`)])
        : [[Markup.button.callback('(нет камер)', 'menu_back')]];
      const keyboard = Markup.inlineKeyboard([...rows, [Markup.button.callback('Назад', 'menu_back')]]);
      await ctx.editMessageText(cameras.length ? 'Выберите камеру:' : 'Камеры не найдены в Frigate.', keyboard);
    } catch (err) {
      console.error('[BOT] menu_cameras error:', err.message || err);
      await safeAnswerCbQuery(ctx, 'Ошибка загрузки камер');
      await ctx.editMessageText('Не удалось загрузить список камер.', mainMenuKeyboard);
    }
  });

  bot.action('menu_reviews', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const text = 'Обзоры и события: последний обзор по камере (фото + видео).';
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Последний обзор', 'last_review')],
      [Markup.button.callback('Назад', 'menu_back')],
    ]);
    await ctx.editMessageText(text, keyboard);
  });

  bot.action('help', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const helpText =
      'Справка\n\n' +
      'Меню — кнопка «Меню» или команда /start.\n' +
      'Уведомления: /unmute, /mute_30m, /mute_1h, /status.\n' +
      'Система: /health.\n' +
      'Камеры: /cameras.\n' +
      'Последний обзор: /last_review.\n\n' +
      'В меню: Уведомления (мут/размут), Система (MQTT + Frigate), Камеры, Обзоры.';
    await ctx.reply(helpText, replyKeyboard);
  });

  bot.action('filters', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const labels = (config.filters.allowedLabels || []).join(', ') || '—';
    const zones = (config.filters.allowedZones || []).join(', ') || '—';
    const text = `Текущие фильтры:\n\nМетки: ${labels}\nЗоны: ${zones}`;
    await ctx.reply(text, replyKeyboard);
  });

  bot.action('ping', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const result = await checkFrigateHealth(config);
    const time = new Date().toLocaleTimeString();
    const frigate = result.ok ? 'Frigate: OK' : 'Frigate: недоступен';
    await ctx.reply(`Понг. ${time}\n${frigate}`, replyKeyboard);
  });

  bot.command('help', async (ctx) => {
    const helpText =
      'Справка\n\n' +
      'Меню — кнопка «Меню» или /start.\n' +
      'Уведомления: /unmute, /mute_30m, /mute_1h, /status.\n' +
      'Система: /health.\n' +
      'Камеры: /cameras.\n' +
      'Последний обзор: /last_review.';
    ctx.reply(helpText, replyKeyboard);
  });

  bot.action('unmute', async (ctx) => {
    clearMute();
    await safeAnswerCbQuery(ctx, 'Уведомления включены');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.action('mute_30', async (ctx) => {
    setMuteForMinutes(30);
    await safeAnswerCbQuery(ctx, 'Мут на 30 минут');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.action('status', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.reply(getMuteStatusText(), replyKeyboard);
  });

  bot.action('health', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const text = `${getMqttStatus()}\n${getFrigateStatus()}`;
    await ctx.reply(text, replyKeyboard);
  });

  bot.action('cameras', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx);
      const cameras = await getCameraNames(config);
      if (!cameras.length) {
        await ctx.reply('Камеры не найдены в Frigate.', replyKeyboard);
        return;
      }

      const rows = cameras.map((name) => [Markup.button.callback(name, `camera:${name}`)]);
      const keyboard = Markup.inlineKeyboard(rows);
      await ctx.reply('Выберите камеру:', keyboard);
    } catch (err) {
      console.error('[BOT] cameras action error:', err.message || err);
      await ctx.reply('Не удалось получить список камер из Frigate.', replyKeyboard);
    }
  });

  bot.action(/^camera:(.+)$/, async (ctx) => {
    const cameraName = ctx.match[1];
    try {
      await safeAnswerCbQuery(ctx);
      const frame = await getLatestFrameImage(config, cameraName, {
        bbox: 1,
        timestamp: 1,
      });
      const caption = `Текущее изображение камеры ${cameraName}.`;
      await ctx.replyWithPhoto(
        { source: frame.buffer, filename: frame.filename },
        { caption }
      );
    } catch (err) {
      console.error('[BOT] camera action error:', err.message || err);
      await ctx.reply(`Не удалось получить кадр камеры ${cameraName}.`, replyKeyboard);
    }
  });

  bot.action('last_review', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx);
      const cameras = await getCameraNames(config);
      if (!cameras.length) {
        await ctx.reply('Камеры не найдены в Frigate.', replyKeyboard);
        return;
      }

      const rows = cameras.map((name) => [Markup.button.callback(name, `review_cam:${name}`)]);
      const keyboard = Markup.inlineKeyboard(rows);
      await ctx.reply('Выберите камеру для последнего обзора:', keyboard);
    } catch (err) {
      console.error('[BOT] last_review action error:', err.message || err);
      await ctx.reply('Не удалось получить данные для обзора из Frigate.', replyKeyboard);
    }
  });

  bot.action(/^review_cam:(.+)$/, async (ctx) => {
    const cameraName = ctx.match[1];
    try {
      await safeAnswerCbQuery(ctx);
      const review = await getLatestReviewForCamera(config, cameraName);
      if (!review) {
        await ctx.reply(
          `Для камеры ${cameraName} нет доступных событий для обзора.`,
          replyKeyboard
        );
        return;
      }

      const eventId =
        review.detections && review.detections.length
          ? review.detections[review.detections.length - 1]
          : null;
      if (!eventId) {
        await ctx.reply(
          `Последний обзор найден (камера ${review.camera}), но нет связанных событий для показа.`,
          replyKeyboard
        );
        return;
      }

      const snapshot = await getEventSnapshotImage(config, eventId);
      const clip = await getEventClipVideo(config, eventId);

      const caption =
        `Последний обзор на камере ${review.camera}.\n` +
        `ID обзора: ${review.id}\n` +
        `ID события: ${eventId}`;

      await ctx.replyWithPhoto(
        { source: snapshot.buffer, filename: snapshot.filename },
        { caption }
      );

      await ctx.replyWithVideo(
        { source: clip.buffer, filename: clip.filename },
        {
          caption: 'Видеофрагмент события (clip.mp4).',
        }
      );
    } catch (err) {
      console.error('[BOT] review_cam action error:', err.message || err);
      await ctx.reply(
        `Не удалось получить данные последнего обзора для камеры ${cameraName}.`,
        replyKeyboard
      );
    }
  });

  bot.action('send_menu', async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.reply(mainMenuText, mainMenuKeyboard);
  });

  bot.action(/^event_clip:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    try {
      await safeAnswerCbQuery(ctx);
      const clip = await getEventClipVideo(config, eventId);
      await bot.telegram.sendVideo(
        chatId,
        { source: clip.buffer, filename: clip.filename },
        { ...telegramExtra, caption: 'Видеофрагмент события (clip.mp4).' }
      );
    } catch (err) {
      console.error('[BOT] event_clip action error:', err.message || err);
      await ctx.reply('Не удалось получить видео события.', replyKeyboard);
    }
  });

  async function sendNotification(text, photo, extraMarkup) {
    if (photo && photo.buffer) {
      const options = { ...telegramExtra, caption: text };
      if (extraMarkup) {
        options.reply_markup = extraMarkup.reply_markup || extraMarkup;
      }
      return bot.telegram.sendPhoto(
        chatId,
        { source: photo.buffer, filename: photo.filename || 'snapshot.jpg' },
        options
      );
    }

    return bot.telegram.sendMessage(chatId, text, { ...telegramExtra, reply_markup: extraMarkup || undefined });
  }

  function sendStatusMessage(text) {
    return bot.telegram.sendMessage(chatId, text, telegramExtra);
  }

  return {
    bot,
    sendNotification,
    sendStatusMessage,
    isMuted,
  };
}

module.exports = {
  createBot,
};

