"use strict";

const crypto = require("crypto");
const { FakePixelBot } = require('./fakepixel-bot');
class BotManager {
  constructor(database) {
    this.database = database;
    this.state = database.loadState();

    this.bots = new Map();
  }

  createId() {
    return crypto
      .randomBytes(6)
      .toString("hex");
  }

  getSettings() {
    return this.state.settings;
  }

  getBotConfig(id) {
    return this.database.getBot(
      this.state,
      id
    );
  }

  getAll() {
    return Array.from(
      this.bots.values()
    ).map(bot =>
      bot.getPublicInfo()
    );
  }

  get(id) {
    const bot =
      this.bots.get(id);

    if (!bot) {
      return null;
    }

    return bot.getPublicInfo();
  }

  create(config) {
    const settings =
      this.getSettings();

    const storedBots =
      this.state.bots;

    if (
      storedBots.length >=
      Number(settings.maxBots)
    ) {
      throw new Error(
        `Maximum bot limit reached (${settings.maxBots}).`
      );
    }

    const username =
      String(config.username || "")
        .trim();

    if (!username) {
      throw new Error(
        "Minecraft username is required."
      );
    }

    const target =
      String(
        config.target ||
        config.targetUsername ||
        settings.defaultTarget ||
        ""
      ).trim();

    if (!target) {
      throw new Error(
        "Target username is required."
      );
    }

    const id =
      this.createId();

    const storedConfig = {
      id,

      username,

      password:
        config.password ||
        settings.defaultPassword ||
        "vmallu",

      target,

      durationHours:
        Number(
          config.durationHours || 2
        ),

      moveInterval:
        Number(
          config.moveInterval ||
          settings.moveInterval ||
          8000
        ),

      jumpInterval:
        Number(
          config.jumpInterval ||
          settings.jumpInterval ||
          15000
        ),

      moveDistance:
        Number(
          config.moveDistance ||
          settings.moveDistance ||
          3
        ),

      autoReconnect:
        typeof config.autoReconnect ===
        "boolean"
          ? config.autoReconnect
          : settings.autoReconnect,

      reconnectDelay:
        Number(
          config.reconnectDelay ||
          settings.reconnectDelay ||
          5000
        ),

      createdAt:
        new Date().toISOString()
    };

    this.database.addBot(
      this.state,
      storedConfig
    );

    const bot =
      this.buildBot(storedConfig);

    this.bots.set(
      id,
      bot
    );

    return bot.getPublicInfo();
  }

  buildBot(config) {
    const bot =
      new FakePixelBot(
        config
      );

    bot.on(
      "configChanged",
      changes => {
        this.database.updateBot(
          this.state,
          config.id,
          changes
        );
      }
    );

    return bot;
  }

  async start(id) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    await bot.start();

    return bot.getPublicInfo();
  }

  async stop(id) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    await bot.stop();

    return bot.getPublicInfo();
  }

  async restart(id) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    await bot.restart();

    return bot.getPublicInfo();
  }

  async rejoin(id) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    await bot.rejoin();

    return bot.getPublicInfo();
  }

  async startAll() {
    const results = [];

    for (const config of this.state.bots) {
      try {
        const bot =
          this.getRuntimeBot(
            config.id
          );

        await bot.start();

        results.push({
          id: config.id,
          success: true
        });
      } catch (error) {
        results.push({
          id: config.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  async stopAll() {
    const results = [];

    for (const bot of this.bots.values()) {
      try {
        await bot.stop();

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

  async rejoinAll() {
    const results = [];

    for (const config of this.state.bots) {
      try {
        const bot =
          this.getRuntimeBot(
            config.id
          );

        await bot.rejoin();

        results.push({
          id: config.id,
          success: true
        });
      } catch (error) {
        results.push({
          id: config.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  getRuntimeBot(id) {
    if (this.bots.has(id)) {
      return this.bots.get(id);
    }

    const config =
      this.database.getBot(
        this.state,
        id
      );

    if (!config) {
      return null;
    }

    const bot =
      this.buildBot(config);

    this.bots.set(
      id,
      bot
    );

    return bot;
  }

  async delete(id) {
    const bot =
      this.bots.get(id);

    if (bot) {
      await bot.stop();
      this.bots.delete(id);
    }

    return this.database.removeBot(
      this.state,
      id
    );
  }

  async chat(id, message) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    return bot.chat(message);
  }

  getLogs(id) {
    const bot =
      this.getRuntimeBot(id);

    if (!bot) {
      throw new Error(
        "Bot not found."
      );
    }

    return bot.getLogs();
  }

  updateConfig(id, changes) {
    const config =
      this.database.getBot(
        this.state,
        id
      );

    if (!config) {
      throw new Error(
        "Bot not found."
      );
    }

    const allowed = [
      "password",
      "target",
      "durationHours",
      "moveInterval",
      "jumpInterval",
      "moveDistance",
      "autoReconnect",
      "reconnectDelay"
    ];

    const clean = {};

    for (const key of allowed) {
      if (
        Object.prototype.hasOwnProperty.call(
          changes,
          key
        )
      ) {
        clean[key] =
          changes[key];
      }
    }

    this.database.updateBot(
      this.state,
      id,
      clean
    );

    const bot =
      this.getRuntimeBot(id);

    if (bot) {
      bot.updateConfig(clean);
    }

    return bot
      ? bot.getPublicInfo()
      : config;
  }

  updateSettings(changes) {
    return this.database.updateSettings(
      this.state,
      changes
    );
  }

  async restore() {
    for (const config of this.state.bots) {
      const bot =
        this.buildBot(config);

      this.bots.set(
        config.id,
        bot
      );
    }
  }

  async shutdown() {
    const tasks = [];

    for (const bot of this.bots.values()) {
      tasks.push(
        bot.stop()
          .catch(error => {
            console.error(
              `[BOT ${bot.id}] shutdown error:`,
              error.message
            );
          })
      );
    }

    await Promise.all(tasks);

    this.database.saveState(
      this.state
    );
  }
}

module.exports = {
  BotManager
};
