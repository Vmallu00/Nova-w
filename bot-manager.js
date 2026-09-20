'use strict';

const EventEmitter = require('events');
const FakePixelBotModule = require('./fakepixel-bot');

const FakePixelBot =
  FakePixelBotModule.FakePixelBot ||
  FakePixelBotModule;

class BotManager extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.bots = new Map();

    this.restore();
  }

  restore() {
    const storedBots =
      this.database && typeof this.database.getBots === 'function'
        ? this.database.getBots()
        : [];

    for (const config of storedBots) {
      try {
        this.createInstance(config, false);
      } catch (error) {
        console.error(
          `[BotManager] Failed to restore ${config.username}:`,
          error
        );
      }
    }
  }

  createInstance(config, save = true) {
    if (!config || !config.username) {
      throw new Error(
        'Minecraft username is required.'
      );
    }

    if (this.bots.has(config.username)) {
      throw new Error(
        `Bot ${config.username} already exists.`
      );
    }

    const bot = new FakePixelBot({
      ...config,

      id:
        config.id ||
        this.makeId(),

      username:
        config.username,

      password:
        config.password ||
        this.getDefaultPassword(),

      target:
        config.target ||
        this.getDefaultTarget(),

      durationHours:
        Number(
          config.durationHours ||
          this.getSetting(
            'defaultDurationHours',
            2
          )
        ),

      moveInterval:
        Number(
          config.moveInterval ||
          this.getSetting(
            'moveInterval',
            8000
          )
        ),

      jumpInterval:
        Number(
          config.jumpInterval ||
          this.getSetting(
            'jumpInterval',
            15000
          )
        ),

      moveDistance:
        Number(
          config.moveDistance ||
          this.getSetting(
            'moveDistance',
            3
          )
        ),

      reconnectDelay:
        Number(
          config.reconnectDelay ||
          this.getSetting(
            'reconnectDelay',
            5000
          )
        ),

      autoReconnect:
        config.autoReconnect !== undefined
          ? Boolean(config.autoReconnect)
          : Boolean(
              this.getSetting(
                'autoReconnect',
                true
              )
            )
    });

    this.bots.set(
      config.username,
      bot
    );

    this.attachEvents(bot);

    if (save) {
      this.saveBot(bot);
    }

    return bot;
  }

  create(config = {}) {
    const username =
      String(
        config.username || ''
      ).trim();

    if (!username) {
      throw new Error(
        'Minecraft username is required.'
      );
    }

    if (
      this.bots.has(username)
    ) {
      throw new Error(
        `Bot ${username} already exists.`
      );
    }

    const maxBots =
      Number(
        this.getSetting(
          'maxBots',
          20
        )
      );

    if (
      this.bots.size >= maxBots
    ) {
      throw new Error(
        `Maximum bot limit reached (${maxBots}).`
      );
    }

    const target =
      String(
        config.target ||
        this.getDefaultTarget() ||
        ''
      ).trim();

    if (!target) {
      throw new Error(
        'Target username is required.'
      );
    }

    const bot =
      this.createInstance({
        id: this.makeId(),

        username,

        password:
          config.password ||
          this.getDefaultPassword(),

        target,

        durationHours:
          Number(
            config.durationHours ||
            this.getSetting(
              'defaultDurationHours',
              2
            )
          ),

        moveInterval:
          Number(
            config.moveInterval ||
            this.getSetting(
              'moveInterval',
              8000
            )
          ),

        jumpInterval:
          Number(
            config.jumpInterval ||
            this.getSetting(
              'jumpInterval',
              15000
            )
          ),

        moveDistance:
          Number(
            config.moveDistance ||
            this.getSetting(
              'moveDistance',
              3
            )
          ),

        reconnectDelay:
          Number(
            config.reconnectDelay ||
            this.getSetting(
              'reconnectDelay',
              5000
            )
          ),

        autoReconnect:
          config.autoReconnect !== undefined
            ? Boolean(config.autoReconnect)
            : Boolean(
                this.getSetting(
                  'autoReconnect',
                  true
                )
              )
      }, true);

    return this.publicInfo(bot);
  }

  attachEvents(bot) {
    bot.on(
      'log',
      entry => {
        this.emit(
          'log',
          bot.config.username,
          entry
        );
      }
    );

    bot.on(
      'state',
      state => {
        this.emit(
          'state',
          bot.config.username,
          state
        );
      }
    );

    bot.on(
      'connected',
      () => {
        this.emit(
          'connected',
          bot.config.username
        );
      }
    );

    bot.on(
      'disconnected',
      reason => {
        this.emit(
          'disconnected',
          bot.config.username,
          reason
        );
      }
    );

    bot.on(
      'started',
      () => {
        this.emit(
          'started',
          bot.config.username
        );
      }
    );

    bot.on(
      'stopped',
      reason => {
        this.emit(
          'stopped',
          bot.config.username,
          reason
        );
      }
    );

    bot.on(
      'error',
      error => {
        this.emit(
          'error',
          bot.config.username,
          error
        );
      }
    );

    bot.on(
      'chat',
      message => {
        this.emit(
          'chat',
          bot.config.username,
          message
        );
      }
    );

    bot.on(
      'actionBar',
      message => {
        this.emit(
          'actionBar',
          bot.config.username,
          message
        );
      }
    );

    bot.on(
      'config',
      () => {
        this.saveBot(bot);
      }
    );
  }

  get(username) {
    return this.bots.get(
      String(username)
    );
  }

  getAll() {
    return Array.from(
      this.bots.values()
    );
  }

  getPublicAll() {
    return this.getAll().map(
      bot => this.publicInfo(bot)
    );
  }

  publicInfo(bot) {
    if (!bot) {
      return null;
    }

    if (
      typeof bot.getPublicInfo ===
      'function'
    ) {
      return bot.getPublicInfo();
    }

    return {
      username:
        bot.config.username,

      target:
        bot.config.target,

      running:
        bot.running,

      connected:
        bot.connected,

      flow:
        bot.flow,

      status:
        typeof bot.getStatus ===
        'function'
          ? bot.getStatus()
          : 'unknown'
    };
  }

  start(username) {
    const bot =
      this.requireBot(username);

    bot.start();

    return this.publicInfo(bot);
  }

  stop(username) {
    const bot =
      this.requireBot(username);

    bot.stop('manual');

    this.saveBot(bot);

    return this.publicInfo(bot);
  }

  restart(username) {
    const bot =
      this.requireBot(username);

    bot.restart();

    return this.publicInfo(bot);
  }

  rejoin(username) {
    const bot =
      this.requireBot(username);

    bot.rejoin();

    return this.publicInfo(bot);
  }

  startAll() {
    const results = [];

    for (const bot of this.getAll()) {
      try {
        bot.start();

        results.push(
          this.publicInfo(bot)
        );
      } catch (error) {
        results.push({
          username:
            bot.config.username,

          error:
            error.message
        });
      }
    }

    return results;
  }

  stopAll() {
    const results = [];

    for (const bot of this.getAll()) {
      try {
        bot.stop('stop-all');

        results.push(
          this.publicInfo(bot)
        );
      } catch (error) {
        results.push({
          username:
            bot.config.username,

          error:
            error.message
        });
      }
    }

    return results;
  }

  rejoinAll() {
    const results = [];

    for (const bot of this.getAll()) {
      try {
        bot.rejoin();

        results.push(
          this.publicInfo(bot)
        );
      } catch (error) {
        results.push({
          username:
            bot.config.username,

          error:
            error.message
        });
      }
    }

    return results;
  }

  remove(username) {
    const key =
      String(username);

    const bot =
      this.bots.get(key);

    if (!bot) {
      throw new Error(
        `Bot ${key} not found.`
      );
    }

    try {
      bot.stop('deleted');
    } catch (_) {}

    try {
      bot.destroy();
    } catch (_) {}

    this.bots.delete(key);

    if (
      this.database &&
      typeof this.database.removeBot ===
      'function'
    ) {
      this.database.removeBot(key);
    }

    this.emit(
      'removed',
      key
    );

    return true;
  }

  update(username, changes = {}) {
    const bot =
      this.requireBot(username);

    if (
      changes.username &&
      changes.username !==
        bot.config.username
    ) {
      throw new Error(
        'Minecraft username cannot be changed while using this bot instance. Delete and create the bot again.'
      );
    }

    bot.updateConfig(
      changes
    );

    this.saveBot(bot);

    return this.publicInfo(bot);
  }

  chat(username, message) {
    const bot =
      this.requireBot(username);

    if (!message) {
      throw new Error(
        'Message is required.'
      );
    }

    bot.sendChat(message);

    return {
      success: true
    };
  }

  logs(username, limit = 200) {
    const bot =
      this.requireBot(username);

    return bot.getLogs(
      Number(limit) || 200
    );
  }

  saveBot(bot) {
    if (
      !this.database ||
      typeof this.database.updateBot !==
        'function'
    ) {
      return;
    }

    const config = {
      id:
        bot.config.id,

      username:
        bot.config.username,

      password:
        bot.config.password,

      target:
        bot.config.target,

      durationHours:
        bot.config.durationHours,

      moveInterval:
        bot.config.moveInterval,

      jumpInterval:
        bot.config.jumpInterval,

      moveDistance:
        bot.config.moveDistance,

      reconnectDelay:
        bot.config.reconnectDelay,

      autoReconnect:
        bot.config.autoReconnect
    };

    try {
      this.database.updateBot(
        bot.config.username,
        config
      );
    } catch (error) {
      console.error(
        '[BotManager] Database update failed:',
        error
      );
    }
  }

  requireBot(username) {
    const key =
      String(username || '');

    const bot =
      this.bots.get(key);

    if (!bot) {
      throw new Error(
        `Bot ${key} not found.`
      );
    }

    return bot;
  }

  getDefaultPassword() {
    return this.getSetting(
      'defaultPassword',
      process.env.DEFAULT_MC_PASSWORD ||
        'vmallu'
    );
  }

  getDefaultTarget() {
    return this.getSetting(
      'defaultTarget',
      process.env.DEFAULT_TARGET || ''
    );
  }

  getSetting(key, fallback) {
    if (
      !this.database ||
      typeof this.database.getSettings !==
        'function'
    ) {
      return fallback;
    }

    try {
      const settings =
        this.database.getSettings();

      if (
        settings &&
        settings[key] !== undefined
      ) {
        return settings[key];
      }
    } catch (_) {}

    return fallback;
  }

  updateSettings(changes = {}) {
    if (
      !this.database ||
      typeof this.database.updateSettings !==
        'function'
    ) {
      return {};
    }

    const current =
      this.database.getSettings
        ? this.database.getSettings()
        : {};

    const next = {
      ...current,
      ...changes
    };

    this.database.updateSettings(
      next
    );

    return next;
  }

  getSettings() {
    if (
      this.database &&
      typeof this.database.getSettings ===
        'function'
    ) {
      return this.database.getSettings();
    }

    return {
      defaultPassword:
        process.env.DEFAULT_MC_PASSWORD ||
        'vmallu',

      defaultTarget:
        process.env.DEFAULT_TARGET || '',

      maxBots:
        Number(
          process.env.MAX_BOTS || 20
        ),

      autoReconnect:
        process.env.AUTO_RECONNECT !== 'false',

      reconnectDelay:
        Number(
          process.env.RECONNECT_DELAY || 5000
        ),

      moveInterval:
        Number(
          process.env.DEFAULT_MOVE_INTERVAL ||
          8000
        ),

      jumpInterval:
        Number(
          process.env.DEFAULT_JUMP_INTERVAL ||
          15000
        ),

      moveDistance:
        Number(
          process.env.AFK_MOVE_DISTANCE || 3
        )
    };
  }

  makeId() {
    return (
      Date.now().toString(36) +
      Math.random()
        .toString(36)
        .slice(2, 8)
    );
  }

  shutdown() {
    for (const bot of this.getAll()) {
      try {
        bot.stop('shutdown');
      } catch (_) {}
    }
  }
}

module.exports = BotManager;
module.exports.BotManager = BotManager;
