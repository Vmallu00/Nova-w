const database = require('./database');

const FakePixelBotModule = require('./fakepixel-bot');

const FakePixelBot =
  FakePixelBotModule.FakePixelBot ||
  FakePixelBotModule;

class BotManager {
  constructor() {
    this.instances = new Map();

    // IMPORTANT:
    // server.js expects manager.state.bots
    this.state = database.readState();

    if (!this.state || typeof this.state !== 'object') {
      this.state = database.defaultState();
      database.writeState(this.state);
    }

    if (!Array.isArray(this.state.bots)) {
      this.state.bots = [];
    }

    if (!this.state.settings || typeof this.state.settings !== 'object') {
      this.state.settings = database.defaultState().settings;
    }

    this.refreshState();

    this.restore();
  }

  refreshState() {
    const latest = database.readState();

    if (latest && typeof latest === 'object') {
      this.state = latest;
    }

    if (!this.state) {
      this.state = database.defaultState();
    }

    if (!Array.isArray(this.state.bots)) {
      this.state.bots = [];
    }

    if (!this.state.settings) {
      this.state.settings = database.defaultState().settings;
    }

    return this.state;
  }

  saveState() {
    database.writeState(this.state);
    this.refreshState();
    return this.state;
  }

  restore() {
    this.refreshState();

    console.log(
      `[MANAGER] Restoring ${this.state.bots.length} stored bot(s)`
    );

    for (const config of this.state.bots) {
      if (!config || !config.id) {
        continue;
      }

      try {
        const instance = new FakePixelBot(config);

        this.instances.set(String(config.id), instance);

        console.log(
          `[MANAGER] Restored bot: ${config.username || config.id}`
        );
      } catch (error) {
        console.error(
          `[MANAGER] Failed to restore bot ${config.id}:`,
          error.message
        );
      }
    }
  }

  get(id) {
    return this.instances.get(String(id)) || null;
  }

  getAll() {
    return Array.from(this.instances.values());
  }

  getStoredBots() {
    this.refreshState();
    return Array.isArray(this.state.bots)
      ? this.state.bots
      : [];
  }

  create(config) {
    this.refreshState();

    const settings = this.state.settings || {};

    const maxBots = Number(
      settings.maxBots ||
      process.env.MAX_BOTS ||
      20
    );

    if (this.state.bots.length >= maxBots) {
      throw new Error(
        `Maximum bot limit reached (${maxBots}).`
      );
    }

    if (!config || !config.username) {
      throw new Error('Minecraft username is required.');
    }

    const id =
      config.id ||
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    if (
      this.state.bots.some(
        bot => String(bot.id) === String(id)
      )
    ) {
      throw new Error('A bot with this ID already exists.');
    }

    const botConfig = {
      id,

      username: config.username,

      password:
        config.password ||
        settings.defaultPassword ||
        process.env.DEFAULT_MC_PASSWORD ||
        'vmallu',

      target:
        config.target ||
        settings.defaultTarget ||
        process.env.DEFAULT_TARGET ||
        '',

      durationHours:
        Number(
          config.durationHours ||
          process.env.DEFAULT_DURATION_HOURS ||
          2
        ),

      moveInterval:
        Number(
          config.moveInterval ||
          settings.moveInterval ||
          process.env.DEFAULT_MOVE_INTERVAL ||
          10000
        ),

      jumpInterval:
        Number(
          config.jumpInterval ||
          settings.jumpInterval ||
          process.env.DEFAULT_JUMP_INTERVAL ||
          2500
        ),

      moveDistance:
        Number(
          config.moveDistance ||
          settings.moveDistance ||
          process.env.AFK_MOVE_DISTANCE ||
          4
        ),

      reconnectDelay:
        Number(
          config.reconnectDelay ||
          settings.reconnectDelay ||
          process.env.RECONNECT_DELAY ||
          5000
        ),

      autoReconnect:
        config.autoReconnect !== undefined
          ? Boolean(config.autoReconnect)
          : settings.autoReconnect !== false,

      createdAt:
        config.createdAt ||
        new Date().toISOString(),

      enabled:
        config.enabled !== false
    };

    const instance = new FakePixelBot(botConfig);

    this.instances.set(String(id), instance);

    this.state.bots.push(botConfig);

    this.saveState();

    return instance;
  }

  start(id) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    return bot.start();
  }

  stop(id) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    return bot.stop();
  }

  restart(id) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    return bot.restart();
  }

  rejoin(id) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    if (typeof bot.rejoin === 'function') {
      return bot.rejoin();
    }

    if (typeof bot.restart === 'function') {
      return bot.restart();
    }

    return bot.start();
  }

  startAll() {
    const results = [];

    for (const bot of this.instances.values()) {
      try {
        if (typeof bot.start === 'function') {
          bot.start();
        }

        results.push({
          id: bot.id,
          success: true
        });
      } catch (error) {
        results.push({
          id: bot.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  stopAll() {
    const results = [];

    for (const bot of this.instances.values()) {
      try {
        if (typeof bot.stop === 'function') {
          bot.stop();
        }

        results.push({
          id: bot.id,
          success: true
        });
      } catch (error) {
        results.push({
          id: bot.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  rejoinAll() {
    const results = [];

    for (const bot of this.instances.values()) {
      try {
        if (typeof bot.rejoin === 'function') {
          bot.rejoin();
        } else if (typeof bot.restart === 'function') {
          bot.restart();
        } else {
          bot.start();
        }

        results.push({
          id: bot.id,
          success: true
        });
      } catch (error) {
        results.push({
          id: bot.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  remove(id) {
    const key = String(id);
    const bot = this.instances.get(key);

    if (bot) {
      try {
        if (typeof bot.stop === 'function') {
          bot.stop();
        }
      } catch (_) {}

      this.instances.delete(key);
    }

    this.refreshState();

    const oldLength = this.state.bots.length;

    this.state.bots = this.state.bots.filter(
      item => String(item.id) !== key
    );

    if (this.state.bots.length !== oldLength) {
      this.saveState();
    }

    return true;
  }

  update(id, updates) {
    this.refreshState();

    const key = String(id);

    const index = this.state.bots.findIndex(
      bot => String(bot.id) === key
    );

    if (index === -1) {
      throw new Error('Bot not found.');
    }

    const oldConfig = this.state.bots[index];

    const newConfig = {
      ...oldConfig,
      ...updates,
      id: oldConfig.id
    };

    this.state.bots[index] = newConfig;

    this.saveState();

    const instance = this.instances.get(key);

    if (
      instance &&
      typeof instance.updateConfig === 'function'
    ) {
      instance.updateConfig(updates);
    }

    return newConfig;
  }

  chat(id, message) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    if (!message) {
      throw new Error('Message is required.');
    }

    if (typeof bot.chat !== 'function') {
      throw new Error('Chat is not available.');
    }

    return bot.chat(message);
  }

  logs(id, limit = 200) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    if (typeof bot.getLogs === 'function') {
      return bot.getLogs(limit);
    }

    if (Array.isArray(bot.logs)) {
      return bot.logs.slice(-limit);
    }

    return [];
  }

  saveBot(id) {
    const bot = this.get(id);

    if (!bot) {
      throw new Error('Bot not found.');
    }

    if (typeof bot.getConfig === 'function') {
      const config = bot.getConfig();

      this.refreshState();

      const index = this.state.bots.findIndex(
        item => String(item.id) === String(id)
      );

      if (index !== -1) {
        this.state.bots[index] = {
          ...this.state.bots[index],
          ...config,
          id: this.state.bots[index].id
        };

        this.saveState();
      }

      return config;
    }

    return null;
  }

  getSettings() {
    this.refreshState();

    return {
      ...database.defaultState().settings,
      ...(this.state.settings || {})
    };
  }

  updateSettings(updates) {
    this.refreshState();

    this.state.settings = {
      ...database.defaultState().settings,
      ...(this.state.settings || {}),
      ...(updates || {})
    };

    this.saveState();

    return this.state.settings;
  }

  shutdown() {
    console.log('[MANAGER] Shutting down bots...');

    for (const bot of this.instances.values()) {
      try {
        if (typeof bot.stop === 'function') {
          bot.stop();
        }
      } catch (error) {
        console.error(
          '[MANAGER] Shutdown error:',
          error.message
        );
      }
    }

    this.instances.clear();

    this.refreshState();
  }
}

module.exports = BotManager;
module.exports.BotManager = BotManager;
