"use strict";

const EventEmitter = require("events");
const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");

const { MinecraftAuth } = require("./minecraft-auth");
const { AFKController } = require("./afk");

const MC_HOST =
  process.env.MC_HOST || "mc.fakepixel.me";

const MC_PORT =
  Number(process.env.MC_PORT || 25565);

const MC_VERSION =
  process.env.MC_VERSION || "1.8.9";

const MAIN_SPAWN = new Vec3(
  Number(process.env.MAIN_SPAWN_X || -52.5),
  Number(process.env.MAIN_SPAWN_Y || 95.74244),
  Number(process.env.MAIN_SPAWN_Z || 0.5)
);

const SKYBLOCK_HUB = new Vec3(
  Number(process.env.SKYBLOCK_HUB_X || -2.5),
  Number(process.env.SKYBLOCK_HUB_Y || 70.0625),
  Number(process.env.SKYBLOCK_HUB_Z || -68)
);

const LOCATION_TOLERANCE =
  Number(process.env.LOCATION_TOLERANCE || 5);

const CHECK_TIMEOUT_INTERVAL =
  Number(
    process.env.CHECK_TIMEOUT_INTERVAL || 120000
  );

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.id =
      String(config.id || "");

    this.username =
      String(config.username || "").trim();

    this.password =
      config.password ||
      process.env.DEFAULT_MC_PASSWORD ||
      "vmallu";

    this.target =
      String(config.target || "").trim();

    this.durationHours =
      Number(
        config.durationHours ||
        process.env.DEFAULT_DURATION_HOURS ||
        2
      );

    this.moveInterval =
      Number(
        config.moveInterval ||
        process.env.DEFAULT_MOVE_INTERVAL ||
        8000
      );

    this.jumpInterval =
      Number(
        config.jumpInterval ||
        process.env.DEFAULT_JUMP_INTERVAL ||
        15000
      );

    this.moveDistance =
      Number(
        config.moveDistance ||
        process.env.AFK_MOVE_DISTANCE ||
        3
      );

    this.autoReconnect =
      typeof config.autoReconnect === "boolean"
        ? config.autoReconnect
        : String(
            process.env.AUTO_RECONNECT || "true"
          ).toLowerCase() === "true";

    this.reconnectDelay =
      Number(
        config.reconnectDelay ||
        process.env.RECONNECT_DELAY ||
        5000
      );

    this.bot = null;

    this.auth = null;

    this.afk = null;

    this.status = "offline";

    this.flow = "idle";

    this.authenticated = false;

    this.started = false;

    this.stopping = false;

    this.connecting = false;

    this.reconnectTimer = null;

    this.durationTimer = null;

    this.flowTimer = null;

    this.menuBusy = false;

    this.visitBusy = false;

    this.visitSentAt = null;

    this.startedAt = null;

    this.sessionStartedAt = null;

    this.lastPosition = null;

    this.lastServerMessage = "";

    this.targetVisitAttempted = false;

    this.afkStarted = false;

    this.logs = [];

    this.maxLogs = 500;

    this.config = {
      ...config
    };

    this.afk =
      new AFKController(
        this,
        {
          moveInterval:
            this.moveInterval,

          jumpInterval:
            this.jumpInterval,

          moveDistance:
            this.moveDistance
        }
      );

    this.auth =
      new MinecraftAuth(
        this,
        {
          password:
            this.password
        }
      );

    this.attachInternalListeners();
  }

  /*
   * ------------------------------------------------
   * LOGGING
   * ------------------------------------------------
   */

  log(message) {
    const line = {
      time:
        new Date().toISOString(),

      message:
        String(message)
    };

    this.logs.push(line);

    if (
      this.logs.length >
      this.maxLogs
    ) {
      this.logs =
        this.logs.slice(
          -this.maxLogs
        );
    }

    console.log(
      `[BOT ${this.username || this.id}] ${line.message}`
    );

    this.emit(
      "log",
      line
    );
  }

  getLogs() {
    return this.logs;
  }

  /*
   * ------------------------------------------------
   * INTERNAL EVENTS
   * ------------------------------------------------
   */

  attachInternalListeners() {
    this.on(
      "authLog",
      message => {
        this.log(
          `[AUTH] ${message}`
        );
      }
    );

    this.on(
      "authTimeout",
      () => {
        this.log(
          "Authentication timeout. Continuing."
        );

        this.authenticated =
          true;

        this.flow =
          "main-spawn";

        this.scheduleFlow(
          1000
        );
      }
    );

    this.on(
      "authenticated",
      () => {
        this.authenticated =
          true;

        this.log(
          "Minecraft authentication completed."
        );

        this.flow =
          "main-spawn";

        this.scheduleFlow(
          1000
        );
      }
    );

    this.on(
      "afkLog",
      message => {
        this.log(
          `[AFK] ${message}`
        );
      }
    );

    this.on(
      "configChanged",
      changes => {
        this.emit(
          "configChanged",
          changes
        );
      }
    );
  }

  /*
   * ------------------------------------------------
   * START
   * ------------------------------------------------
   */

  async start() {
    if (
      this.started &&
      this.bot
    ) {
      this.log(
        "Bot is already running."
      );

      return this.getPublicInfo();
    }

    this.clearReconnectTimer();

    this.clearDurationTimer();

    this.stopping =
      false;

    this.started =
      true;

    this.connecting =
      true;

    this.status =
      "connecting";

    this.flow =
      "connecting";

    this.authenticated =
      false;

    this.menuBusy =
      false;

    this.visitBusy =
      false;

    this.targetVisitAttempted =
      false;

    this.visitSentAt =
      null;

    this.afkStarted =
      false;

    this.sessionStartedAt =
      Date.now();

    this.startedAt =
      Date.now();

    this.createMinecraftBot();

    return this.getPublicInfo();
  }

  /*
   * ------------------------------------------------
   * CREATE MINECRAFT BOT
   * ------------------------------------------------
   */

  createMinecraftBot() {
    if (this.bot) {
      try {
        this.bot.quit(
          "Reconnecting"
        );
      } catch (_) {}

      this.bot =
        null;
    }

    this.log(
      `Connecting to ${MC_HOST}:${MC_PORT} as ${this.username}.`
    );

    const bot =
      mineflayer.createBot({
        host:
          MC_HOST,

        port:
          MC_PORT,

        username:
          this.username,

        version:
          MC_VERSION,

        auth:
          "offline",

        keepAlive:
          true,

        checkTimeoutInterval:
          CHECK_TIMEOUT_INTERVAL,

        hideErrors:
          false
      });

    this.bot =
      bot;

    this.attachMinecraftListeners(
      bot
    );
  }

  /*
   * ------------------------------------------------
   * MINECRAFT EVENTS
   * ------------------------------------------------
   */

  attachMinecraftListeners(bot) {
    bot.once(
      "spawn",
      () => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        this.connecting =
          false;

        this.status =
          "online";

        this.flow =
          "auth";

        this.sessionStartedAt =
          Date.now();

        this.startedAt =
          Date.now();

        this.log(
          "Minecraft spawned."
        );

        try {
          this.auth.start();
        } catch (error) {
          this.log(
            `Auth start error: ${error.message}`
          );
        }

        this.scheduleFlow(
          1500
        );
      }
    );

    bot.on(
      "message",
      message => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        const text =
          this.messageToText(
            message
          );

        if (!text) {
          return;
        }

        this.lastServerMessage =
          text;

        this.log(
          `[SERVER] ${text}`
        );

        try {
          this.auth.handleMessage(
            text
          );
        } catch (error) {
          this.log(
            `Auth message error: ${error.message}`
          );
        }

        this.handleServerMessage(
          text
        );
      }
    );

    bot.on(
      "chat",
      (username, message) => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        this.log(
          `[CHAT] ${username}: ${message}`
        );
      }
    );

    bot.on(
      "physicTick",
      () => {
        if (
          bot !== this.bot ||
          !bot.entity
        ) {
          return;
        }

        this.lastPosition = {
          x:
            bot.entity.position.x,

          y:
            bot.entity.position.y,

          z:
            bot.entity.position.z
        };

        this.checkLocation();
      }
    );

    bot.on(
      "windowOpen",
      window => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        this.log(
          `Window opened: ${
            window.title ||
            window.type ||
            "unknown"
          }`
        );

        if (
          this.flow ===
          "game-menu"
        ) {
          this.scheduleFlow(
            500
          );
        }

        if (
          this.flow ===
          "visiting"
        ) {
          this.scheduleFlow(
            500
          );
        }
      }
    );

    bot.on(
      "windowClose",
      () => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        this.log(
          "Window closed."
        );
      }
    );

    bot.on(
      "kicked",
      reason => {
        this.log(
          `Kicked: ${this.reasonToText(reason)}`
        );
      }
    );

    bot.on(
      "error",
      error => {
        this.log(
          `Mineflayer error: ${error.message}`
        );

        if (
          this.status !==
          "reconnecting"
        ) {
          this.status =
            "error";
        }
      }
    );

    bot.on(
      "end",
      reason => {
        if (
          bot !== this.bot
        ) {
          return;
        }

        this.handleDisconnect(
          reason
        );
      }
    );
  }

  /*
   * ------------------------------------------------
   * SERVER MESSAGE
   * ------------------------------------------------
   */

  handleServerMessage(text) {
    const lower =
      String(text)
        .toLowerCase();

    if (
      lower.includes(
        "welcome to fakepixel"
      )
    ) {
      this.log(
        "FakePixel welcome detected."
      );

      this.authenticated =
        true;

      this.flow =
        "main-spawn";

      this.scheduleFlow(
        1000
      );
    }

    if (
      lower.includes(
        "successfully registered"
      ) ||
      lower.includes(
        "registration successful"
      )
    ) {
      this.authenticated =
        true;

      this.flow =
        "main-spawn";

      this.scheduleFlow(
        1000
      );
    }

    if (
      lower.includes(
        "successfully logged"
      ) ||
      lower.includes(
        "login successful"
      ) ||
      lower.includes(
        "logged in"
      )
    ) {
      this.authenticated =
        true;

      this.flow =
        "main-spawn";

      this.scheduleFlow(
        1000
      );
    }

    if (
      this.flow ===
      "visiting"
    ) {
      if (
        lower.includes(
          "you are now visiting"
        ) ||
        lower.includes(
          "visiting "
        )
      ) {
        this.log(
          "Visit confirmation detected."
        );

        this.flow =
          "target-island";

        this.scheduleFlow(
          1500
        );
      }
    }
  }

  /*
   * ------------------------------------------------
   * FLOW
   * ------------------------------------------------
   */

  scheduleFlow(
    delay = 500
  ) {
    if (
      this.flowTimer
    ) {
      clearTimeout(
        this.flowTimer
      );
    }

    this.flowTimer =
      setTimeout(
        () => {
          this.flowTimer =
            null;

          this.processFlow()
            .catch(error => {
              this.log(
                `Flow error: ${error.message}`
              );
            });
        },
        delay
      );
  }

  async processFlow() {
    if (
      !this.started ||
      this.stopping ||
      !this.bot
    ) {
      return;
    }

    switch (
      this.flow
    ) {
      case "connecting":
        return;

      case "auth":
        if (
          this.authenticated
        ) {
          this.flow =
            "main-spawn";

          return this.processFlow();
        }

        return;

      case "main-spawn":
        return this.handleMainSpawn();

      case "game-menu":
        return this.handleGameMenu();

      case "visiting":
        return this.handleVisiting();

      case "target-island":
        return this.handleTargetIsland();

      case "afk":
        return this.startAfk();

      default:
        return;
    }
  }

  /*
   * ------------------------------------------------
   * MAIN SPAWN
   * ------------------------------------------------
   */

  async handleMainSpawn() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      this.scheduleFlow(
        1000
      );

      return;
    }

    const distance =
      this.distanceFrom(
        this.bot.entity.position,
        MAIN_SPAWN
      );

    if (
      distance <=
      LOCATION_TOLERANCE
    ) {
      this.log(
        `Main FakePixel spawn detected. Distance ${distance.toFixed(2)}.`
      );

      this.flow =
        "game-menu";

      this.scheduleFlow(
        700
      );

      return;
    }

    this.log(
      `Waiting for main spawn. Distance: ${distance.toFixed(2)}`
    );

    this.scheduleFlow(
      2500
    );
  }

  /*
   * ------------------------------------------------
   * GAME MENU
   * ------------------------------------------------
   */

  async handleGameMenu() {
    if (
      !this.bot ||
      this.menuBusy
    ) {
      return;
    }

    this.menuBusy =
      true;

    try {
      const success =
        await this.openGameMenuAndClickHub();

      if (
        success
      ) {
        this.flow =
          "visiting";

        this.targetVisitAttempted =
          false;

        this.visitBusy =
          false;

        this.scheduleFlow(
          1200
        );
      } else {
        this.log(
          "Game Menu interaction failed. Retrying."
        );

        this.scheduleFlow(
          2000
        );
      }
    } finally {
      this.menuBusy =
        false;
    }
  }

  async openGameMenuAndClickHub() {
    if (
      !this.bot
    ) {
      return false;
    }

    this.log(
      "Opening Game Menu."
    );

    try {
      /*
       * Visible hotbar slot 1
       * = Mineflayer quickBarSlot 0.
       */
      this.bot.setQuickBarSlot(
        0
      );

      await this.sleep(
        600
      );

      /*
       * Open Game Menu.
       */
      this.bot.activateItem();

      const opened =
        await this.waitForWindow(
          5000
        );

      if (
        !opened ||
        !this.bot.currentWindow
      ) {
        this.log(
          "Game Menu did not open."
        );

        return false;
      }

      this.log(
        "Game Menu opened."
      );

      await this.sleep(
        400
      );

      /*
       * FakePixel:
       *
       * Visible slot 21
       * Mineflayer index 20.
       */
      const hubSlot =
        20;

      const item =
        this.bot.currentWindow
          .slots[hubSlot];

      if (item) {
        this.log(
          `Game Menu slot 21 contains: ${
            item.displayName ||
            item.name ||
            "unknown"
          }`
        );
      } else {
        this.log(
          "Game Menu slot 21 is empty."
        );
      }

      this.log(
        "Clicking SkyBlock Hub visible slot 21."
      );

      await this.clickWindow(
        hubSlot,
        0,
        0
      );

      this.log(
        "SkyBlock Hub slot 21 clicked."
      );

      await this.sleep(
        1200
      );

      return true;

    } catch (error) {
      this.log(
        `Game Menu click failed: ${error.message}`
      );

      return false;
    }
  }

  /*
   * ------------------------------------------------
   * VISIT GUI
   * ------------------------------------------------
   */

  async handleVisiting() {
    if (
      !this.bot
    ) {
      return;
    }

    if (
      !this.target
    ) {
      this.log(
        "No target username configured."
      );

      this.status =
        "error";

      this.flow =
        "error";

      return;
    }

    if (
      this.visitBusy
    ) {
      return;
    }

    this.visitBusy =
      true;

    try {
      /*
       * If a Visit GUI is already open,
       * don't send /visit again.
       */
      if (
        !this.bot.currentWindow
      ) {
        this.log(
          `Sending /visit ${this.target}`
        );

        this.bot.chat(
          `/visit ${this.target}`
        );

        const opened =
          await this.waitForWindow(
            6000
          );

        if (
          !opened ||
          !this.bot.currentWindow
        ) {
          this.log(
            "Visit GUI did not open."
          );

          this.visitBusy =
            false;

          this.scheduleFlow(
            2500
          );

          return;
        }
      } else {
        this.log(
          "Visit GUI is already open."
        );
      }

      await this.sleep(
        500
      );

      const window =
        this.bot.currentWindow;

      if (!window) {
        throw new Error(
          "Visit GUI disappeared."
        );
      }

      /*
       * Screenshot shows:
       *
       * Visible slot 12 =
       * Mineflayer slot 11.
       */
      const visitSlot =
        11;

      const item =
        window.slots[visitSlot];

      if (item) {
        this.log(
          `Visit GUI slot 12: ${
            item.displayName ||
            item.name ||
            "unknown item"
          }`
        );
      } else {
        this.log(
          "Visit GUI slot 12 is empty."
        );
      }

      this.log(
        `Clicking Visit target at visible slot 12 (Mineflayer slot ${visitSlot}).`
      );

      /*
       * LEFT CLICK.
       */
      await this.clickWindow(
        visitSlot,
        0,
        0
      );

      this.log(
        "Visit target button clicked."
      );

      this.targetVisitAttempted =
        true;

      this.visitSentAt =
        Date.now();

      /*
       * Wait for GUI close /
       * teleport.
       */
      await this.sleep(
        1800
      );

      this.flow =
        "target-island";

      this.visitBusy =
        false;

      this.scheduleFlow(
        1000
      );

    } catch (error) {
      this.log(
        `Visit GUI error: ${error.message}`
      );

      this.visitBusy =
        false;

      this.scheduleFlow(
        2500
      );
    }
  }

  /*
   * ------------------------------------------------
   * TARGET ISLAND
   * ------------------------------------------------
   */

  async handleTargetIsland() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      this.scheduleFlow(
        1000
      );

      return;
    }

    const elapsed =
      this.visitSentAt
        ? Date.now() -
          this.visitSentAt
        : 0;

    /*
     * Give FakePixel enough time
     * to complete the teleport.
     */
    if (
      elapsed <
      3000
    ) {
      this.scheduleFlow(
        1000
      );

      return;
    }

    this.log(
      `Target island reached. Position: ${this.positionText()}`
    );

    this.flow =
      "afk";

    this.startDurationTimer();

    this.scheduleFlow(
      500
    );
  }

  /*
   * ------------------------------------------------
   * AFK
   * ------------------------------------------------
   */

  startAfk() {
    if (
      !this.bot
    ) {
      return;
    }

    if (
      this.afkStarted
    ) {
      return;
    }

    this.afkStarted =
      true;

    this.status =
      "afk";

    this.flow =
      "afk";

    this.log(
      "Starting random AFK movement and jumping."
    );

    try {
      this.afk.start();
    } catch (error) {
      this.log(
        `AFK start error: ${error.message}`
      );
    }
  }

  /*
   * ------------------------------------------------
   * DURATION
   * ------------------------------------------------
   */

  startDurationTimer() {
    this.clearDurationTimer();

    const hours =
      Number(
        this.durationHours
      );

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      this.log(
        "No valid duration configured. Staying online."
      );

      return;
    }

    const milliseconds =
      hours *
      60 *
      60 *
      1000;

    this.log(
      `AFK duration: ${hours} hour(s).`
    );

    this.durationTimer =
      setTimeout(
        () => {
          this.log(
            "Configured duration reached. Stopping bot."
          );

          this.stop()
            .catch(error => {
              this.log(
                `Stop error: ${error.message}`
              );
            });
        },
        milliseconds
      );
  }

  /*
   * ------------------------------------------------
   * LOCATION
   * ------------------------------------------------
   */

  checkLocation() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      return;
    }

    if (
      this.flow ===
      "main-spawn"
    ) {
      const distance =
        this.distanceFrom(
          this.bot.entity.position,
          MAIN_SPAWN
        );

      if (
        distance <=
        LOCATION_TOLERANCE
      ) {
        this.log(
          "Main spawn detected."
        );

        this.flow =
          "game-menu";

        this.scheduleFlow(
          500
        );
      }
    }

    if (
      this.flow ===
      "target-island"
    ) {
      const elapsed =
        this.visitSentAt
          ? Date.now() -
            this.visitSentAt
          : 0;

      if (
        elapsed >
        4000
      ) {
        this.flow =
          "afk";

        this.startDurationTimer();

        this.scheduleFlow(
          300
        );
      }
    }
  }

  /*
   * ------------------------------------------------
   * CLICK WINDOW
   *
   * IMPORTANT:
   * Mineflayer's clickWindow uses a
   * callback in this version.
   *
   * DO NOT use window.click().
   * ------------------------------------------------
   */

  clickWindow(
    slot,
    mouseButton = 0,
    mode = 0
  ) {
    return new Promise(
      (resolve, reject) => {
        if (
          !this.bot
        ) {
          reject(
            new Error(
              "Minecraft bot is not connected."
            )
          );

          return;
        }

        try {
          this.bot.clickWindow(
            slot,
            mouseButton,
            mode,
            error => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            }
          );
        } catch (error) {
          reject(error);
        }
      }
    );
  }

  /*
   * ------------------------------------------------
   * WAIT FOR GUI
   * ------------------------------------------------
   */

  waitForWindow(
    timeout = 5000
  ) {
    return new Promise(
      resolve => {
        if (
          this.bot &&
          this.bot.currentWindow
        ) {
          resolve(true);

          return;
        }

        const started =
          Date.now();

        const check =
          () => {
            if (
              !this.bot
            ) {
              resolve(false);

              return;
            }

            if (
              this.bot.currentWindow
            ) {
              resolve(true);

              return;
            }

            if (
              Date.now() -
                started >=
              timeout
            ) {
              resolve(false);

              return;
            }

            setTimeout(
              check,
              100
            );
          };

        check();
      }
    );
  }

  /*
   * ------------------------------------------------
   * DISCONNECT
   * ------------------------------------------------
   */

  handleDisconnect(reason) {
    if (
      this.bot
    ) {
      this.bot =
        null;
    }

    this.connecting =
      false;

    this.authenticated =
      false;

    this.menuBusy =
      false;

    this.visitBusy =
      false;

    this.afkStarted =
      false;

    try {
      this.afk.stop();
    } catch (_) {}

    try {
      this.auth.reset();
    } catch (_) {}

    this.clearDurationTimer();

    this.log(
      `Disconnected${
        reason
          ? `: ${this.reasonToText(reason)}`
          : "."
      }`
    );

    if (
      this.stopping ||
      !this.started
    ) {
      this.status =
        "offline";

      this.flow =
        "idle";

      return;
    }

    if (
      this.autoReconnect
    ) {
      this.status =
        "reconnecting";

      this.flow =
        "reconnecting";

      this.clearReconnectTimer();

      this.log(
        `Reconnecting in ${this.reconnectDelay}ms.`
      );

      this.reconnectTimer =
        setTimeout(
          () => {
            this.reconnectTimer =
              null;

            if (
              !this.started ||
              this.stopping
            ) {
              return;
            }

            this.log(
              "Starting reconnect."
            );

            this.startConnection();
          },
          this.reconnectDelay
        );

      return;
    }

    this.status =
      "offline";

    this.flow =
      "idle";
  }

  /*
   * ------------------------------------------------
   * RECONNECT
   * ------------------------------------------------
   */

  startConnection() {
    if (
      !this.started ||
      this.stopping
    ) {
      return;
    }

    this.status =
      "connecting";

    this.flow =
      "connecting";

    this.authenticated =
      false;

    this.menuBusy =
      false;

    this.visitBusy =
      false;

    this.targetVisitAttempted =
      false;

    this.visitSentAt =
      null;

    this.afkStarted =
      false;

    this.createMinecraftBot();
  }

  clearReconnectTimer() {
    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;
    }
  }

  /*
   * ------------------------------------------------
   * STOP
   * ------------------------------------------------
   */

  async stop() {
    this.stopping =
      true;

    this.started =
      false;

    this.connecting =
      false;

    this.clearReconnectTimer();

    this.clearDurationTimer();

    if (
      this.flowTimer
    ) {
      clearTimeout(
        this.flowTimer
      );

      this.flowTimer =
        null;
    }

    try {
      this.afk.stop();
    } catch (_) {}

    this.afkStarted =
      false;

    this.authenticated =
      false;

    this.flow =
      "idle";

    this.status =
      "offline";

    if (
      this.bot
    ) {
      const bot =
        this.bot;

      this.bot =
        null;

      try {
        bot.clearControlStates();
      } catch (_) {}

      try {
        bot.quit(
          "Stopped from manager"
        );
      } catch (_) {}

      try {
        bot.end();
      } catch (_) {}
    }

    this.log(
      "Bot stopped."
    );

    return this.getPublicInfo();
  }

  /*
   * ------------------------------------------------
   * RESTART
   * ------------------------------------------------
   */

  async restart() {
    await this.stop();

    await this.sleep(
      1000
    );

    this.stopping =
      false;

    return this.start();
  }

  /*
   * ------------------------------------------------
   * REJOIN
   * ------------------------------------------------
   */

  async rejoin() {
    this.log(
      "Manual rejoin requested."
    );

    await this.stop();

    await this.sleep(
      1000
    );

    this.stopping =
      false;

    return this.start();
  }

  /*
   * ------------------------------------------------
   * CHAT
   * ------------------------------------------------
   */

  chat(message) {
    if (
      !this.bot
    ) {
      throw new Error(
        "Minecraft bot is not connected."
      );
    }

    const text =
      String(
        message || ""
      ).trim();

    if (!text) {
      throw new Error(
        "Message cannot be empty."
      );
    }

    this.bot.chat(
      text
    );

    this.log(
      `[YOU] ${text}`
    );
  }

  /*
   * ------------------------------------------------
   * CONFIG
   * ------------------------------------------------
   */

  updateConfig(
    changes = {}
  ) {
    if (
      changes.password !==
      undefined
    ) {
      this.password =
        String(
          changes.password
        );
    }

    if (
      changes.target !==
      undefined
    ) {
      this.target =
        String(
          changes.target
        ).trim();
    }

    if (
      changes.durationHours !==
      undefined
    ) {
      this.durationHours =
        Number(
          changes.durationHours
        );
    }

    if (
      changes.moveInterval !==
      undefined
    ) {
      this.moveInterval =
        Number(
          changes.moveInterval
        );
    }

    if (
      changes.jumpInterval !==
      undefined
    ) {
      this.jumpInterval =
        Number(
          changes.jumpInterval
        );
    }

    if (
      changes.moveDistance !==
      undefined
    ) {
      this.moveDistance =
        Number(
          changes.moveDistance
        );
    }

    if (
      changes.autoReconnect !==
      undefined
    ) {
      this.autoReconnect =
        Boolean(
          changes.autoReconnect
        );
    }

    if (
      changes.reconnectDelay !==
      undefined
    ) {
      this.reconnectDelay =
        Number(
          changes.reconnectDelay
        );
    }

    this.afk.update({
      moveInterval:
        this.moveInterval,

      jumpInterval:
        this.jumpInterval,

      moveDistance:
        this.moveDistance
    });

    this.emit(
      "configChanged",
      changes
    );
  }

  /*
   * ------------------------------------------------
   * PUBLIC INFO
   * ------------------------------------------------
   */

  getPublicInfo() {
    const uptime =
      this.sessionStartedAt
        ? Math.floor(
            (
              Date.now() -
              this.sessionStartedAt
            ) / 1000
          )
        : 0;

    return {
      id:
        this.id,

      username:
        this.username,

      target:
        this.target,

      status:
        this.status,

      flow:
        this.flow,

      uptime,

      position:
        this.lastPosition,

      durationHours:
        this.durationHours,

      moveInterval:
        this.moveInterval,

      jumpInterval:
        this.jumpInterval,

      moveDistance:
        this.moveDistance,

      autoReconnect:
        this.autoReconnect,

      reconnectDelay:
        this.reconnectDelay,

      authenticated:
        this.authenticated,

      started:
        this.started,

      createdAt:
        this.config.createdAt ||
        null
    };
  }

  /*
   * ------------------------------------------------
   * UTILITIES
   * ------------------------------------------------
   */

  distanceFrom(
    position,
    target
  ) {
    if (
      !position ||
      !target
    ) {
      return Infinity;
    }

    const a =
      position instanceof Vec3
        ? position
        : new Vec3(
            Number(position.x),
            Number(position.y),
            Number(position.z)
          );

    const b =
      target instanceof Vec3
        ? target
        : new Vec3(
            Number(target.x),
            Number(target.y),
            Number(target.z)
          );

    return a.distanceTo(
      b
    );
  }

  positionText() {
    if (
      !this.lastPosition
    ) {
      return "unknown";
    }

    return [
      Number(
        this.lastPosition.x
      ).toFixed(2),

      Number(
        this.lastPosition.y
      ).toFixed(2),

      Number(
        this.lastPosition.z
      ).toFixed(2)
    ].join(", ");
  }

  messageToText(message) {
    try {
      if (
        message &&
        typeof message.toString ===
          "function"
      ) {
        return String(
          message.toString()
        )
          .replace(
            /§[0-9a-fk-or]/gi,
            ""
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();
      }
    } catch (_) {}

    return String(
      message || ""
    ).trim();
  }

  reasonToText(reason) {
    try {
      if (
        typeof reason ===
        "string"
      ) {
        return reason;
      }

      if (
        reason &&
        typeof reason.toString ===
          "function"
      ) {
        return reason.toString();
      }

      return JSON.stringify(
        reason
      );
    } catch (_) {
      return String(
        reason || ""
      );
    }
  }

  sleep(milliseconds) {
    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );
  }

  clearDurationTimer() {
    if (
      this.durationTimer
    ) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer =
        null;
    }
  }

  destroy() {
    this.stop()
      .catch(() => {});

    try {
      this.auth.destroy();
    } catch (_) {}

    try {
      this.afk.destroy();
    } catch (_) {}

    this.removeAllListeners();
  }
}

module.exports = {
  FakePixelBot
};
