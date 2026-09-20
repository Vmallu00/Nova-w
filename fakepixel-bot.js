"use strict";

const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");

const { MinecraftAuth } =
  require("./minecraft-auth");

const { AFKController } =
  require("./afk");

const MAIN_SPAWN = new Vec3(
  Number(
    process.env.MAIN_SPAWN_X ||
    -52.5
  ),
  Number(
    process.env.MAIN_SPAWN_Y ||
    95.74244
  ),
  Number(
    process.env.MAIN_SPAWN_Z ||
    0.5
  )
);

const SKYBLOCK_HUB = new Vec3(
  Number(
    process.env.SKYBLOCK_HUB_X ||
    -2.5
  ),
  Number(
    process.env.SKYBLOCK_HUB_Y ||
    70.0625
  ),
  Number(
    process.env.SKYBLOCK_HUB_Z ||
    -68
  )
);

const TOLERANCE = Number(
  process.env.LOCATION_TOLERANCE || 5
);

const HUB_MENU_SLOT = 20;

class FakePixelBot {
  constructor(config) {
    this.id = config.id;
    this.username = config.username;

    this.config = {
      ...config
    };

    this.bot = null;

    this.auth = null;
    this.afk = null;

    this.status = "stopped";
    this.state = "Stopped";

    this.startedAt = null;
    this.afkStartedAt = null;

    this.durationTimer = null;
    this.reconnectTimer = null;
    this.flowTimer = null;

    this.reconnectCount = 0;

    this.logs = [];
    this.maxLogs = 500;

    this.startRequested = false;
    this.intentionalStop = false;

    this.flow = "idle";
    this.authenticated = false;
    this.hubOpened = false;
    this.visitSent = false;
    this.targetReached = false;

    this.lastPosition = null;
  }

  async start() {
    if (
      this.status === "online" ||
      this.status === "connecting" ||
      this.status === "reconnecting"
    ) {
      return;
    }

    this.startRequested = true;
    this.intentionalStop = false;

    this.clearReconnectTimer();

    await this.connect();
  }

  async connect() {
    this.cleanupBot();

    this.resetFlow();

    this.status =
      this.reconnectCount > 0
        ? "reconnecting"
        : "connecting";

    this.state =
      "Connecting to FakePixel";

    this.startedAt =
      Date.now();

    this.log(
      `Connecting as ${this.username}...`
    );

    const host =
      process.env.MC_HOST ||
      "mc.fakepixel.me";

    const port =
      Number(
        process.env.MC_PORT || 25565
      );

    const version =
      process.env.MC_VERSION ||
      "1.8.9";

    try {
      this.bot =
        mineflayer.createBot({
          host,
          port,
          username: this.username,
          version,

          auth: "offline",

          hideErrors: false,

          keepAlive: true,

          checkTimeoutInterval:
            Number(
              process.env.CHECK_TIMEOUT_INTERVAL ||
              120000
            )
        });

      this.setupEvents();

    } catch (error) {
      this.handleConnectionFailure(
        error
      );
    }
  }

  setupEvents() {
    if (!this.bot) {
      return;
    }

    this.auth =
      new MinecraftAuth(
        this.bot,
        {
          password:
            this.config.password ||
            process.env.DEFAULT_MC_PASSWORD ||
            "vmallu"
        }
      );

    this.afk =
      new AFKController(
        this.bot,
        {
          moveInterval:
            this.config.moveInterval ||
            8000,

          jumpInterval:
            this.config.jumpInterval ||
            15000,

          moveDistance:
            this.config.moveDistance ||
            3
        }
      );

    this.bot.on(
      "login",
      () => {
        this.status = "online";
        this.state =
          "Connected";

        this.log(
          "Connected to FakePixel."
        );

        this.auth.start();

        /*
         * FakePixel can sometimes not emit
         * a clean authentication message.
         *
         * Give the server a short period,
         * then attempt login if required.
         */
        setTimeout(() => {
          if (
            this.bot &&
            !this.authenticated
          ) {
            this.auth.forceLogin();
          }
        }, 5000);
      }
    );

    this.bot.on(
      "spawn",
      () => {
        this.log(
          "Minecraft spawn event received."
        );

        this.state =
          "Waiting for authentication";

        this.beginAuthenticationWatch();

        this.beginFlowWatcher();
      }
    );

    this.bot.on(
      "message",
      message => {
        const text =
          this.cleanMessage(
            message
          );

        if (!text) {
          return;
        }

        this.log(
          `[CHAT] ${text}`
        );

        if (this.auth) {
          this.auth.handleMessage(
            text
          );
        }

        this.handleServerMessage(
          text
        );
      }
    );

    this.bot.on(
      "authLog",
      message => {
        this.log(
          `[AUTH] ${message}`
        );
      }
    );

    this.bot.on(
      "authenticated",
      () => {
        this.authenticated = true;

        this.log(
          "Authentication completed."
        );

        this.state =
          "Authenticated";

        this.flow =
          "main-spawn";
      }
    );

    this.bot.on(
      "authTimeout",
      () => {
        this.log(
          "Authentication timeout; continuing flow detection."
        );

        this.authenticated = true;
        this.flow =
          "main-spawn";
      }
    );

    this.bot.on(
      "kicked",
      reason => {
        this.log(
          `Kicked: ${this.cleanMessage(reason)}`
        );
      }
    );

    this.bot.on(
      "end",
      reason => {
        this.log(
          `Connection ended: ${reason || "unknown"}`
        );

        this.handleDisconnect();
      }
    );

    this.bot.on(
      "error",
      error => {
        this.log(
          `Minecraft error: ${error.message}`
        );
      }
    );

    this.bot.on(
      "physicTick",
      () => {
        this.updatePosition();
      }
    );

    this.bot.on(
      "windowOpen",
      window => {
        this.handleWindow(
          window
        );
      }
    );
  }

  beginAuthenticationWatch() {
    setTimeout(() => {
      if (
        !this.bot ||
        this.intentionalStop ||
        this.authenticated
      ) {
        return;
      }

      /*
       * If the server did not send a detectable
       * prompt, attempt /login.
       *
       * MinecraftAuth prevents duplicate commands.
       */
      this.auth.forceLogin();
    }, 8000);
  }

  beginFlowWatcher() {
    if (this.flowTimer) {
      clearInterval(
        this.flowTimer
      );
    }

    this.flowTimer =
      setInterval(() => {
        this.processFlow();
      }, 1000);
  }

  processFlow() {
    if (
      !this.bot ||
      this.intentionalStop
    ) {
      return;
    }

    if (
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return;
    }

    this.updatePosition();

    if (
      !this.authenticated &&
      this.flow !== "main-spawn"
    ) {
      return;
    }

    const position =
      this.bot.entity.position;

    if (
      this.flow === "main-spawn" ||
      this.flow === "authenticated"
    ) {
      if (
        this.isNear(
          position,
          MAIN_SPAWN,
          TOLERANCE
        )
      ) {
        this.openGameMenu();
        return;
      }

      /*
       * Some FakePixel connections can spawn
       * slightly outside the configured point.
       * Once authenticated, allow the menu after
       * a short delay even if exact coordinates
       * are not available.
       */
      if (
        this.authenticated &&
        this.startedAt &&
        Date.now() -
          this.startedAt >
          12000
      ) {
        this.openGameMenu();
      }

      return;
    }

    if (
      this.flow === "hub"
    ) {
      if (
        this.isNear(
          position,
          SKYBLOCK_HUB,
          TOLERANCE
        )
      ) {
        this.visitTarget();
      }

      return;
    }

    if (
      this.flow === "visiting"
    ) {
      this.detectTargetIsland();
    }
  }

  openGameMenu() {
    if (
      this.hubOpened ||
      !this.bot
    ) {
      return;
    }

    this.hubOpened = true;
    this.flow = "menu";

    this.state =
      "Opening Game Menu";

    this.log(
      "Opening Game Menu."
    );

    try {
      this.bot.setQuickBarSlot(0);

      setTimeout(() => {
        if (
          !this.bot ||
          this.intentionalStop
        ) {
          return;
        }

        try {
          this.bot.activateItem();

          this.log(
            "Game Menu opened."
          );

          setTimeout(() => {
            this.clickSkyblockHub();
          }, 1200);

        } catch (error) {
          this.log(
            `Game Menu error: ${error.message}`
          );

          this.hubOpened = false;
          this.flow =
            "main-spawn";
        }
      }, 500);

    } catch (error) {
      this.log(
        `Hotbar error: ${error.message}`
      );

      this.hubOpened = false;
      this.flow =
        "main-spawn";
    }
  }

  clickSkyblockHub() {
    if (
      !this.bot ||
      this.intentionalStop
    ) {
      return;
    }

    this.state =
      "Selecting SkyBlock Hub";

    this.log(
      "Selecting SkyBlock Hub menu slot 21."
    );

    const window =
      this.bot.currentWindow;

    if (!window) {
      this.log(
        "Game Menu window not detected."
      );

      /*
       * Try opening it again.
       */
      this.hubOpened = false;
      this.flow =
        "main-spawn";

      return;
    }

    try {
      window.click(
        HUB_MENU_SLOT,
        0,
        0
      );

      this.flow = "hub";

      this.state =
        "Waiting for SkyBlock Hub";

      this.log(
        "SkyBlock Hub selected."
      );

    } catch (error) {
      this.log(
        `Hub menu click failed: ${error.message}`
      );

      this.hubOpened = false;
      this.flow =
        "main-spawn";
    }
  }

  handleWindow(window) {
    if (!window) {
      return;
    }

    this.log(
      `Window opened: ${window.title || "unknown"}`
    );

    if (
      this.flow === "menu"
    ) {
      setTimeout(() => {
        this.clickSkyblockHub();
      }, 500);
    }
  }

  visitTarget() {
    if (
      this.visitSent ||
      !this.bot
    ) {
      return;
    }

    const target =
      String(
        this.config.target || ""
      ).trim();

    if (!target) {
      this.log(
        "No target username configured."
      );

      return;
    }

    this.visitSent = true;
    this.flow = "visiting";

    this.state =
      `Visiting ${target}`;

    this.log(
      `Sending /visit ${target}`
    );

    try {
      this.bot.chat(
        `/visit ${target}`
      );
    } catch (error) {
      this.log(
        `Visit command failed: ${error.message}`
      );

      this.visitSent = false;
    }
  }

  detectTargetIsland() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      return;
    }

    /*
     * A successful /visit can place the bot
     * at a different coordinate every time.
     *
     * We therefore use server messages first,
     * then fall back to a movement-stability
     * detector.
     */
    if (
      this.targetReached
    ) {
      this.startAFK();
      return;
    }

    if (
      this.lastPosition &&
      this.positionChangedSmall()
    ) {
      /*
       * After visiting, FakePixel normally
       * settles the player into the island.
       */
      if (
        this.visitSent &&
        this.getSecondsSinceVisit() >
          4
      ) {
        this.markTargetReached();
      }
    }

    /*
     * Safety fallback:
     * if /visit was sent and the bot has remained
     * connected for a while, assume the island
     * transition has completed.
     */
    if (
      this.visitSent &&
      this.getSecondsSinceVisit() >
        10
    ) {
      this.markTargetReached();
    }
  }

  markTargetReached() {
    if (this.targetReached) {
      return;
    }

    this.targetReached = true;

    this.state =
      "Target Island";

    this.flow =
      "afk";

    this.afkStartedAt =
      Date.now();

    this.log(
      `Arrived at target island: ${this.config.target}`
    );

    this.startAFK();
  }

  startAFK() {
    if (
      !this.afk ||
      this.intentionalStop
    ) {
      return;
    }

    if (
      this.afkStartedAt === null
    ) {
      this.afkStartedAt =
        Date.now();
    }

    this.status = "afk";
    this.state =
      "AFK on target island";

    this.afk.start();

    this.startDurationTimer();
  }

  startDurationTimer() {
    if (this.durationTimer) {
      return;
    }

    const hours =
      Number(
        this.config.durationHours || 2
      );

    const milliseconds =
      Math.max(
        1,
        hours * 60 * 60 * 1000
      );

    this.durationTimer =
      setTimeout(() => {
        this.log(
          "Configured duration completed."
        );

        this.stop();

      }, milliseconds);

    this.log(
      `AFK duration: ${hours} hour(s).`
    );
  }

  handleServerMessage(text) {
    if (!text) {
      return;
    }

    const lower =
      text.toLowerCase();

    if (
      this.visitSent &&
      (
        lower.includes(
          "teleported"
        ) ||
        lower.includes(
          "teleporting"
        ) ||
        lower.includes(
          "visiting"
        ) ||
        lower.includes(
          "you are now visiting"
        )
      )
    ) {
      setTimeout(() => {
        this.markTargetReached();
      }, 3000);
    }

    if (
      lower.includes(
        "you have been sent to"
      ) ||
      lower.includes(
        "welcome to skyblock"
      )
    ) {
      if (
        !this.visitSent
      ) {
        this.flow =
          "hub";
      }
    }
  }

  updatePosition() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      return;
    }

    const p =
      this.bot.entity.position;

    this.lastPosition = {
      x: Number(
        p.x.toFixed(3)
      ),
      y: Number(
        p.y.toFixed(3)
      ),
      z: Number(
        p.z.toFixed(3)
      ),
      time: Date.now()
    };
  }

  positionChangedSmall() {
    if (
      !this.bot ||
      !this.bot.entity ||
      !this.lastPosition
    ) {
      return false;
    }

    const p =
      this.bot.entity.position;

    const dx =
      p.x - this.lastPosition.x;

    const dy =
      p.y - this.lastPosition.y;

    const dz =
      p.z - this.lastPosition.z;

    return (
      Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
      ) < 20
    );
  }

  getSecondsSinceVisit() {
    if (!this.visitSentAt) {
      this.visitSentAt =
        Date.now();

      return 0;
    }

    return (
      Date.now() -
      this.visitSentAt
    ) / 1000;
  }

  handleDisconnect() {
    this.cleanupTimers();

    if (
      this.intentionalStop ||
      !this.startRequested
    ) {
      this.status =
        "stopped";

      this.state =
        "Stopped";

      return;
    }

    const autoReconnect =
      this.config.autoReconnect !==
      undefined
        ? this.config.autoReconnect
        : String(
            process.env.AUTO_RECONNECT ||
            "true"
          ).toLowerCase() ===
          "true";

    if (!autoReconnect) {
      this.status =
        "offline";

      this.state =
        "Disconnected";

      return;
    }

    this.scheduleReconnect();
  }

  handleConnectionFailure(error) {
    this.log(
      `Connection failed: ${error.message}`
    );

    this.handleDisconnect();
  }

  scheduleReconnect() {
    if (
      this.reconnectTimer ||
      this.intentionalStop
    ) {
      return;
    }

    const delay =
      Number(
        this.config.reconnectDelay ||
        process.env.RECONNECT_DELAY ||
        5000
      );

    this.status =
      "reconnecting";

    this.state =
      `Reconnecting in ${Math.ceil(
        delay / 1000
      )}s`;

    this.reconnectCount += 1;

    this.log(
      `Reconnecting in ${delay}ms.`
    );

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;

        if (
          this.intentionalStop ||
          !this.startRequested
        ) {
          return;
        }

        this.connect();

      }, delay);
  }

  async rejoin() {
    this.startRequested = true;
    this.intentionalStop = false;

    this.clearReconnectTimer();

    this.log(
      "Manual rejoin requested."
    );

    this.cleanupBot();

    await this.connect();
  }

  async restart() {
    await this.stop();

    this.startRequested = true;
    this.intentionalStop = false;

    await this.connect();
  }

  async stop() {
    this.startRequested = false;
    this.intentionalStop = true;

    this.cleanupTimers();
    this.clearReconnectTimer();

    if (this.afk) {
      this.afk.stop();
    }

    if (this.auth) {
      this.auth.destroy();
    }

    if (this.bot) {
      try {
        this.bot.quit(
          "AFK manager stopping"
        );
      } catch (_) {}

      try {
        this.bot.end();
      } catch (_) {}
    }

    this.cleanupBot();

    this.status =
      "stopped";

    this.state =
      "Stopped";

    this.log(
      "Bot stopped."
    );
  }

  chat(message) {
    if (
      !this.bot
    ) {
      throw new Error(
        "Bot is not connected."
      );
    }

    const text =
      String(message || "")
        .trim();

    if (!text) {
      throw new Error(
        "Message is empty."
      );
    }

    this.bot.chat(text);

    this.log(
      `[YOU] ${text}`
    );
  }

  updateConfig(changes) {
    this.config = {
      ...this.config,
      ...changes
    };

    if (this.afk) {
      this.afk.update({
        moveInterval:
          this.config.moveInterval,

        jumpInterval:
          this.config.jumpInterval,

        moveDistance:
          this.config.moveDistance
      });
    }

    this.emit(
      "configChanged",
      changes
    );
  }

  getPublicInfo() {
    return {
      id: this.id,
      username: this.username,

      target:
        this.config.target,

      status:
        this.status,

      state:
        this.state,

      uptime:
        this.getUptime(),

      position:
        this.lastPosition
          ? {
              x: this.lastPosition.x,
              y: this.lastPosition.y,
              z: this.lastPosition.z
            }
          : null,

      durationHours:
        this.config.durationHours,

      reconnectCount:
        this.reconnectCount,

      connected:
        Boolean(
          this.bot &&
          this.bot.player
        ),

      afk:
        Boolean(
          this.afk &&
          this.afk.running
        ),

      createdAt:
        this.config.createdAt
    };
  }

  getUptime() {
    if (
      !this.startedAt
    ) {
      return "0s";
    }

    const seconds =
      Math.floor(
        (Date.now() -
          this.startedAt) /
          1000
      );

    const hours =
      Math.floor(
        seconds / 3600
      );

    const minutes =
      Math.floor(
        (seconds % 3600) / 60
      );

    const secs =
      seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }

    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }

    return `${secs}s`;
  }

  cleanMessage(message) {
    return String(message || "")
      .replace(
        /§[0-9a-fk-or]/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  isNear(
    position,
    target,
    tolerance
  ) {
    if (
      !position ||
      !target
    ) {
      return false;
    }

    const dx =
      position.x - target.x;

    const dy =
      position.y - target.y;

    const dz =
      position.z - target.z;

    return (
      Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
      ) <= tolerance
    );
  }

  cleanupTimers() {
    if (this.durationTimer) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer = null;
    }

    if (this.flowTimer) {
      clearInterval(
        this.flowTimer
      );

      this.flowTimer = null;
    }
  }

  clearReconnectTimer() {
    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }
  }

  cleanupBot() {
    this.cleanupTimers();

    if (this.afk) {
      try {
        this.afk.stop();
      } catch (_) {}
    }

    if (this.auth) {
      try {
        this.auth.destroy();
      } catch (_) {}
    }

    this.bot = null;
    this.auth = null;
    this.afk = null;
  }

  resetFlow() {
    this.flow = "idle";

    this.authenticated = false;
    this.hubOpened = false;
    this.visitSent = false;
    this.targetReached = false;
    this.afkStartedAt = null;
    this.visitSentAt = null;
    this.lastPosition = null;
  }

  log(message) {
    const line =
      `[${new Date().toISOString()}] ${message}`;

    this.logs.push(line);

    if (
      this.logs.length >
      this.maxLogs
    ) {
      this.logs.splice(
        0,
        this.logs.length -
          this.maxLogs
      );
    }

    console.log(
      `[BOT ${this.id}] ${message}`
    );

    this.emit(
      "log",
      line
    );
  }

  getLogs() {
    return [...this.logs];
  }

  emit(event, data) {
    if (!this._listeners) {
      return;
    }

    const listeners =
      this._listeners[event] ||
      [];

    for (const listener of listeners) {
      try {
        listener(data);
      } catch (_) {}
    }
  }

  on(event, listener) {
    if (!this._listeners) {
      this._listeners = {};
    }

    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }

    this._listeners[event].push(
      listener
    );

    return this;
  }
}

module.exports = {
  FakePixelBot,
  MAIN_SPAWN,
  SKYBLOCK_HUB
};
