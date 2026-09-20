'use strict';

const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const EventEmitter = require('events');

const MinecraftAuthModule = require('./minecraft-auth');
const MinecraftAuth =
  MinecraftAuthModule.MinecraftAuth ||
  MinecraftAuthModule;

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.id =
      config.id ||
      `bot-${Date.now()}`;

    this.username =
      String(config.username || '').trim();

    this.password =
      String(
        config.password ||
        process.env.DEFAULT_MC_PASSWORD ||
        'vmallu'
      );

    this.target =
      String(
        config.target ||
        process.env.DEFAULT_TARGET ||
        'v_mallu_gamer'
      ).trim();

    this.durationHours = Number(
      config.durationHours ||
      process.env.DEFAULT_DURATION_HOURS ||
      12
    );

    this.moveInterval = Number(
      config.moveInterval ||
      process.env.DEFAULT_MOVE_INTERVAL ||
      10000
    );

    this.jumpInterval = Number(
      config.jumpInterval ||
      process.env.DEFAULT_JUMP_INTERVAL ||
      2500
    );

    this.moveDistance = Number(
      config.moveDistance ||
      process.env.AFK_MOVE_DISTANCE ||
      4
    );

    this.reconnectDelay = Number(
      config.reconnectDelay ||
      process.env.RECONNECT_DELAY ||
      5000
    );

    this.autoReconnect =
      config.autoReconnect !== undefined
        ? Boolean(config.autoReconnect)
        : String(
            process.env.AUTO_RECONNECT || 'true'
          ).toLowerCase() !== 'false';

    this.host =
      process.env.MC_HOST ||
      'mc.fakepixel.me';

    this.port = Number(
      process.env.MC_PORT ||
      25565
    );

    this.version =
      process.env.MC_VERSION ||
      '1.8.9';

    this.checkTimeoutInterval = Number(
      process.env.CHECK_TIMEOUT_INTERVAL ||
      120000
    );

    this.locationTolerance = Number(
      process.env.LOCATION_TOLERANCE ||
      5
    );

    /*
     * Main FakePixel lobby position.
     */
    this.mainSpawn = new Vec3(
      Number(
        process.env.MAIN_SPAWN_X ||
        -52.500
      ),
      Number(
        process.env.MAIN_SPAWN_Y ||
        95.74244
      ),
      Number(
        process.env.MAIN_SPAWN_Z ||
        0.500
      )
    );

    /*
     * SkyBlock Hub position.
     */
    this.skyblockHub = new Vec3(
      Number(
        process.env.SKYBLOCK_HUB_X ||
        -2.500
      ),
      Number(
        process.env.SKYBLOCK_HUB_Y ||
        70.06250
      ),
      Number(
        process.env.SKYBLOCK_HUB_Z ||
        -68.000
      )
    );

    /*
     * FakePixel GUI:
     *
     * Visible slot 21 = Mineflayer index 20
     * Visible slot 12 = Mineflayer index 11
     */
    this.GAME_MENU_SLOT = 20;
    this.VISIT_SLOT = 11;

    this.bot = null;
    this.auth = null;

    this.state = 'idle';

    this.targetReached = false;
    this.inSkyblockHub = false;

    this.gameMenuOpened = false;
    this.visitMenuOpened = false;

    this.visitCommandSent = false;

    this.startedAt = null;
    this.afkStartedAt = null;
    this.lastReconnectAt = null;
    this.lastPosition = null;

    this.visitStartPosition = null;

    this.durationTimer = null;
    this.reconnectTimer = null;

    this.movementTimer = null;
    this.jumpTimer = null;

    this.movementRunning = false;

    this.manualStop = false;
    this.stopping = false;
    this.connecting = false;

    this.logs = [];
  }

  /* =========================================================
     LOGGING
     ========================================================= */

  addLog(message, level = 'info') {
    const line = {
      time: new Date().toISOString(),
      level,
      message: String(message)
    };

    this.logs.push(line);

    if (this.logs.length > 500) {
      this.logs.splice(
        0,
        this.logs.length - 500
      );
    }

    const prefix = `[${this.id}]`;

    if (level === 'error') {
      console.error(
        prefix,
        message
      );
    } else if (level === 'warn') {
      console.warn(
        prefix,
        message
      );
    } else {
      console.log(
        prefix,
        message
      );
    }

    this.emit(
      'log',
      line
    );
  }

  getLogs(limit = 200) {
    return this.logs.slice(
      -Number(limit || 200)
    );
  }

  /* =========================================================
     STATE
     ========================================================= */

  setState(state) {
    if (this.state === state) {
      return;
    }

    this.state = state;

    this.addLog(
      `State -> ${state}`
    );

    this.emit(
      'state',
      state
    );
  }

  /* =========================================================
     START
     ========================================================= */

  async start() {
    if (
      this.state !== 'idle' &&
      this.state !== 'stopped' &&
      this.state !== 'disconnected' &&
      this.state !== 'error'
    ) {
      this.addLog(
        `Start ignored; current state is ${this.state}`,
        'warn'
      );

      return;
    }

    if (!this.username) {
      this.setState('error');

      this.addLog(
        'Minecraft username is missing',
        'error'
      );

      return;
    }

    this.manualStop = false;
    this.stopping = false;

    this.clearReconnectTimer();
    this.clearDurationTimer();
    this.clearAllMovement();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;
    this.visitCommandSent = false;

    this.visitStartPosition = null;

    this.startedAt = Date.now();

    await this.connect();
  }

  /* =========================================================
     CONNECT
     ========================================================= */

  async connect() {
    if (
      this.connecting ||
      this.manualStop
    ) {
      return;
    }

    this.connecting = true;

    this.clearReconnectTimer();
    this.clearAllMovement();
    this.clearAuth();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;
    this.visitCommandSent = false;

    this.setState('connecting');

    this.addLog(
      `Connecting to ${this.host}:${this.port} as ${this.username}`
    );

    try {
      this.bot = mineflayer.createBot({
        host: this.host,
        port: this.port,
        username: this.username,
        version: this.version,

        /*
         * FakePixel account authentication is handled
         * by minecraft-auth.js.
         */
        auth: 'offline',

        /*
         * Prevent the previous 30-second timeout problem.
         */
        keepAlive: true,
        checkTimeoutInterval:
          this.checkTimeoutInterval,

        hideErrors: false
      });

      this.setupBotEvents();

    } catch (error) {
      this.connecting = false;

      this.setState('error');

      this.addLog(
        `Create bot error: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();
    }
  }

  /* =========================================================
     BOT EVENTS
     ========================================================= */

  setupBotEvents() {
    if (!this.bot) {
      return;
    }

    this.bot.once(
      'login',
      () => {
        this.connecting = false;

        this.addLog(
          'Minecraft login packet received'
        );
      }
    );

    this.bot.once(
      'spawn',
      () => {
        this.connecting = false;

        this.addLog(
          `Spawn received at ${this.formatPosition()}`
        );

        this.setState(
          'authenticating'
        );

        this.startAuthentication();
      }
    );

    /*
     * Normal Minecraft chat/message packet.
     */
    this.bot.on(
      'message',
      (jsonMsg) => {
        this.handleMessage(
          jsonMsg
        );
      }
    );

    /*
     * Mineflayer chat event.
     */
    this.bot.on(
      'chat',
      (username, message) => {
        /*
         * Avoid echoing our own messages.
         */
        if (
          username === this.username
        ) {
          return;
        }

        const clean =
          this.cleanText(message);

        if (!clean) {
          return;
        }

        /*
         * IMPORTANT:
         *
         * Do not log FakePixel status spam.
         */
        if (
          this.isSpamStatusMessage(clean)
        ) {
          return;
        }

        this.addLog(
          `[CHAT] ${clean}`
        );

        this.handleServerText(
          clean
        );
      }
    );

    /*
     * Action bar is often where FakePixel sends
     * Mana / Health / status updates.
     *
     * We intentionally do NOT log those.
     */
    this.bot.on(
      'actionBar',
      (message) => {
        const clean =
          this.safeMessageToString(
            message
          );

        if (!clean) {
          return;
        }

        if (
          this.isSpamStatusMessage(
            clean
          )
        ) {
          return;
        }

        /*
         * Other action bar messages can still be
         * useful to the state handler.
         */
        this.handleServerText(
          clean
        );
      }
    );

    /*
     * Inventory/window opening.
     */
    this.bot.on(
      'windowOpen',
      async (window) => {
        await this.handleWindowOpen(
          window
        );
      }
    );

    this.bot.on(
      'windowClose',
      (window) => {
        if (!window) {
          return;
        }

        const title =
          this.cleanText(
            window.title || ''
          );

        if (title) {
          this.addLog(
            `Window closed: ${title}`
          );
        }
      }
    );

    /*
     * Server teleport / respawn movement.
     */
    this.bot.on(
      'forcedMove',
      () => {
        this.updatePosition();

        this.addLog(
          `Server teleport detected at ${this.formatPosition()}`
        );

        if (
          this.state === 'visiting' ||
          this.state === 'target-island'
        ) {
          this.checkTargetArrival();
        }
      }
    );

    /*
     * Player movement.
     */
    this.bot.on(
      'move',
      () => {
        this.updatePosition();

        if (
          this.state === 'visiting' ||
          this.state === 'target-island'
        ) {
          this.checkTargetArrival();
        }
      }
    );

    this.bot.on(
      'kicked',
      (reason) => {
        const text =
          this.safeMessageToString(
            reason
          );

        this.addLog(
          `Kicked: ${text || 'unknown reason'}`,
          'warn'
        );
      }
    );

    this.bot.on(
      'error',
      (error) => {
        this.addLog(
          `Minecraft error: ${error.message}`,
          'error'
        );

        this.emit(
          'error',
          error
        );
      }
    );

    this.bot.on(
      'end',
      (reason) => {
        this.connecting = false;

        this.clearAllMovement();
        this.clearAuth();

        this.addLog(
          `Connection ended: ${reason || 'unknown reason'}`
        );

        if (
          this.manualStop ||
          this.stopping
        ) {
          this.setState(
            'stopped'
          );

          return;
        }

        this.setState(
          'disconnected'
        );

        this.scheduleReconnect();
      }
    );
  }

  /* =========================================================
     AUTHENTICATION
     ========================================================= */

  startAuthentication() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    this.clearAuth();

    try {
      this.auth =
        new MinecraftAuth({
          bot: this.bot,
          username: this.username,
          password: this.password
        });

      this.auth.on(
        'log',
        (message) => {
          this.addLog(
            `[AUTH] ${message}`
          );
        }
      );

      this.auth.on(
        'authenticated',
        () => {
          this.addLog(
            'Authentication completed'
          );

          this.setState(
            'waiting-hub'
          );

          /*
           * Give FakePixel time to finish moving
           * the player into the main lobby.
           */
          setTimeout(
            () => {
              this.waitForMainHub();
            },
            2500
          );
        }
      );

      this.auth.on(
        'authTimeout',
        () => {
          /*
           * Do not disconnect immediately.
           *
           * FakePixel may have accepted the command
           * but not sent a recognizable success message.
           */
          this.addLog(
            'Auth response timeout; checking player position',
            'warn'
          );

          this.waitForMainHub();
        }
      );

      this.auth.on(
        'error',
        (error) => {
          this.addLog(
            `Authentication error: ${error.message}`,
            'error'
          );
        }
      );

      this.auth.start();

    } catch (error) {
      this.addLog(
        `Auth initialization error: ${error.message}`,
        'error'
      );

      /*
       * Still check whether FakePixel moved us
       * into the lobby.
       */
      this.waitForMainHub();
    }
  }

  clearAuth() {
    if (!this.auth) {
      return;
    }

    try {
      if (
        typeof this.auth.stop ===
        'function'
      ) {
        this.auth.stop();
      }
    } catch (_) {}

    try {
      this.auth.removeAllListeners();
    } catch (_) {}

    this.auth = null;
  }

  /* =========================================================
     MAIN HUB
     ========================================================= */

  waitForMainHub() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    this.setState(
      'waiting-hub'
    );

    let attempts = 0;

    const check = () => {
      if (
        !this.bot ||
        this.manualStop
      ) {
        return;
      }

      attempts++;

      const distance =
        this.distanceTo(
          this.mainSpawn
        );

      /*
       * Only log every few attempts to prevent
       * unnecessary console spam.
       */
      if (
        attempts === 1 ||
        attempts % 3 === 0
      ) {
        this.addLog(
          `Main hub check: ${distance.toFixed(2)} blocks`
        );
      }

      if (
        distance <=
        this.locationTolerance
      ) {
        this.addLog(
          'Main FakePixel hub confirmed'
        );

        this.beginGameMenuFlow();

        return;
      }

      if (
        attempts < 12
      ) {
        setTimeout(
          check,
          1500
        );

        return;
      }

      /*
       * If the exact configured coordinate isn't reached
       * but the bot has clearly spawned somewhere away
       * from the login location, try the Game Menu.
       */
      this.addLog(
        'Main hub coordinate not exact; attempting Game Menu',
        'warn'
      );

      this.beginGameMenuFlow();
    };

    check();
  }

  /* =========================================================
     GAME MENU
     ========================================================= */

  beginGameMenuFlow() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    if (
      this.gameMenuOpened
    ) {
      return;
    }

    this.setState(
      'game-menu'
    );

    this.addLog(
      'Selecting Game Menu compass'
    );

    try {
      /*
       * Hotbar slot 1 = Mineflayer index 0.
       */
      this.bot.setQuickBarSlot(
        0
      );

      /*
       * activateItem() is synchronous.
       */
      this.bot.activateItem();

      this.addLog(
        'Game Menu activated'
      );

    } catch (error) {
      this.addLog(
        `Game Menu activation failed: ${error.message}`,
        'error'
      );

      setTimeout(
        () => {
          if (
            this.bot &&
            !this.manualStop
          ) {
            this.beginGameMenuFlow();
          }
        },
        2000
      );

      return;
    }

    /*
     * If Game Menu doesn't appear, retry.
     */
    setTimeout(
      () => {
        if (
          this.bot &&
          !this.gameMenuOpened &&
          !this.manualStop
        ) {
          this.addLog(
            'Game Menu did not open yet; retrying',
            'warn'
          );

          try {
            this.bot.activateItem();
          } catch (_) {}
        }
      },
      2500
    );
  }

  async handleGameMenuWindow(
    window
  ) {
    if (
      !window ||
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    const title =
      this.cleanText(
        window.title || ''
      );

    if (
      !/game\s*menu/i.test(
        title
      )
    ) {
      return;
    }

    if (
      this.gameMenuOpened
    ) {
      return;
    }

    this.gameMenuOpened = true;

    this.addLog(
      `Game Menu detected: "${title}"`
    );

    const item =
      window.slots
        ? window.slots[
            this.GAME_MENU_SLOT
          ]
        : null;

    if (item) {
      this.addLog(
        `SkyBlock item: visible slot 21 / index 20 = ${this.itemDescription(item)}`
      );
    } else {
      this.addLog(
        'No item detected at Game Menu slot 21 / index 20',
        'warn'
      );
    }

    /*
     * Current Mineflayer API:
     *
     * clickWindow(
     *   slot,
     *   mouseButton,
     *   mode
     * )
     *
     * returns a Promise.
     *
     * No callback.
     */
    let clicked =
      await this.clickWindowSafe(
        this.GAME_MENU_SLOT,
        0,
        'SkyBlock Game Menu slot 21'
      );

    /*
     * Right-click fallback.
     */
    if (!clicked) {
      clicked =
        await this.clickWindowSafe(
          this.GAME_MENU_SLOT,
          1,
          'SkyBlock Game Menu right-click fallback'
        );
    }

    try {
      if (
        this.bot.currentWindow ===
        window
      ) {
        await this.bot.closeWindow(
          window
        );
      }
    } catch (_) {}

    this.inSkyblockHub = false;

    this.setState(
      'skyblock-hub'
    );

    this.addLog(
      'SkyBlock selected; waiting for SkyBlock Hub'
    );

    this.waitForSkyblockHub();
  }

  /* =========================================================
     SKYBLOCK HUB
     ========================================================= */

  waitForSkyblockHub() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    let attempts = 0;

    const check = () => {
      if (
        !this.bot ||
        this.manualStop
      ) {
        return;
      }

      attempts++;

      const distance =
        this.distanceTo(
          this.skyblockHub
        );

      if (
        attempts === 1 ||
        attempts % 3 === 0
      ) {
        this.addLog(
          `SkyBlock Hub check: ${distance.toFixed(2)} blocks`
        );
      }

      if (
        distance <=
        this.locationTolerance
      ) {
        this.inSkyblockHub = true;

        this.addLog(
          `SkyBlock Hub confirmed at ${this.formatPosition()}`
        );

        setTimeout(
          () => {
            this.startVisitFlow();
          },
          1500
        );

        return;
      }

      if (
        attempts < 15
      ) {
        setTimeout(
          check,
          1000
        );

        return;
      }

      /*
       * If the exact coordinate changed but we have
       * clearly moved away from the main lobby, allow
       * the flow to continue.
       */
      if (
        this.bot.entity &&
        this.distanceTo(
          this.mainSpawn
        ) > 20
      ) {
        this.inSkyblockHub = true;

        this.addLog(
          'SkyBlock Hub coordinate differs, but player appears to be in SkyBlock',
          'warn'
        );

        this.startVisitFlow();

        return;
      }

      this.addLog(
        'SkyBlock Hub was not detected; reopening Game Menu',
        'warn'
      );

      this.gameMenuOpened = false;

      this.setState(
        'game-menu'
      );

      setTimeout(
        () => {
          this.beginGameMenuFlow();
        },
        1500
      );
    };

    check();
  }

  /* =========================================================
     VISIT
     ========================================================= */

  startVisitFlow() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    if (!this.inSkyblockHub) {
      this.addLog(
        'Visit blocked: SkyBlock Hub is not confirmed',
        'warn'
      );

      return;
    }

    if (!this.target) {
      this.addLog(
        'Target username is missing',
        'error'
      );

      return;
    }

    if (
      this.visitCommandSent
    ) {
      return;
    }

    this.visitCommandSent = true;

    this.setState(
      'visiting'
    );

    this.targetReached = false;

    this.visitStartPosition =
      this.bot.entity
        ? this.bot.entity.position.clone()
        : null;

    this.addLog(
      `Visiting ${this.target}`
    );

    try {
      this.bot.chat(
        `/visit ${this.target}`
      );

      this.addLog(
        `/visit ${this.target} sent`
      );

    } catch (error) {
      this.visitCommandSent = false;

      this.addLog(
        `Failed to send /visit: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();

      return;
    }

    /*
     * Check in case the GUI opens very quickly.
     */
    setTimeout(
      () => {
        if (
          this.bot &&
          !this.targetReached &&
          !this.manualStop
        ) {
          this.checkTargetArrival();
        }
      },
      2500
    );

    setTimeout(
      () => {
        if (
          this.bot &&
          !this.targetReached &&
          !this.manualStop
        ) {
          this.checkTargetArrival();
        }
      },
      5000
    );

    setTimeout(
      () => {
        if (
          this.bot &&
          !this.targetReached &&
          !this.manualStop
        ) {
          this.addLog(
            'Still waiting for target island',
            'warn'
          );

          this.checkTargetArrival();
        }
      },
      10000
    );
  }

  async handleVisitWindow(
    window
  ) {
    if (
      !window ||
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    const title =
      this.cleanText(
        window.title || ''
      );

    /*
     * Only process this window while visiting.
     */
    if (
      this.state !== 'visiting' &&
      this.state !== 'target-island'
    ) {
      return;
    }

    if (
      this.visitMenuOpened
    ) {
      return;
    }

    this.visitMenuOpened = true;

    this.addLog(
      `Visit GUI detected: "${title || '(untitled)'}"`
    );

    const item =
      window.slots
        ? window.slots[
            this.VISIT_SLOT
          ]
        : null;

    if (item) {
      this.addLog(
        `Visit target item: visible slot 12 / index 11 = ${this.itemDescription(item)}`
      );
    } else {
      this.addLog(
        'No item detected at Visit slot 12 / index 11',
        'warn'
      );
    }

    /*
     * User confirmed:
     *
     * visible slot 12
     * Mineflayer index 11
     *
     * Right click first.
     */
    let clicked =
      await this.clickWindowSafe(
        this.VISIT_SLOT,
        1,
        'Visit slot 12 right-click'
      );

    /*
     * Left-click fallback.
     */
    if (!clicked) {
      clicked =
        await this.clickWindowSafe(
          this.VISIT_SLOT,
          0,
          'Visit slot 12 left-click fallback'
        );
    }

    try {
      if (
        this.bot.currentWindow ===
        window
      ) {
        await this.bot.closeWindow(
          window
        );
      }
    } catch (_) {}

    this.addLog(
      'Visit selection clicked; waiting for island teleport'
    );

    this.setState(
      'target-island'
    );

    this.checkTargetArrival();

    setTimeout(
      () => {
        this.checkTargetArrival();
      },
      2000
    );

    setTimeout(
      () => {
        this.checkTargetArrival();
      },
      5000
    );

    setTimeout(
      () => {
        this.checkTargetArrival();
      },
      10000
    );
  }

  /* =========================================================
     WINDOW DISPATCH
     ========================================================= */

  async handleWindowOpen(
    window
  ) {
    if (
      !window ||
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    const title =
      this.cleanText(
        window.title || ''
      );

    /*
     * Game Menu.
     */
    if (
      /game\s*menu/i.test(
        title
      )
    ) {
      await this.handleGameMenuWindow(
        window
      );

      return;
    }

    /*
     * Visit GUI.
     *
     * We intentionally also allow unnamed titles while
     * in the visiting state because some server versions
     * use formatted/empty inventory titles.
     */
    if (
      this.state === 'visiting' ||
      this.state === 'target-island'
    ) {
      await this.handleVisitWindow(
        window
      );
    }
  }

  /* =========================================================
     TARGET ARRIVAL
     ========================================================= */

  checkTargetArrival() {
    if (
      !this.bot ||
      !this.bot.entity ||
      this.manualStop
    ) {
      return false;
    }

    if (
      this.targetReached
    ) {
      return true;
    }

    if (
      this.state !== 'visiting' &&
      this.state !== 'target-island'
    ) {
      return false;
    }

    const current =
      this.bot.entity.position;

    const fromHub =
      current.distanceTo(
        this.skyblockHub
      );

    const fromVisitStart =
      this.visitStartPosition
        ? current.distanceTo(
            this.visitStartPosition
          )
        : 0;

    /*
     * Critical safety check:
     *
     * Do NOT start AFK while still near the hub.
     *
     * The player must have moved substantially from the
     * SkyBlock Hub AND from the location where /visit began.
     */
    const movedAwayFromHub =
      fromHub > 25;

    const movedAwayFromVisit =
      fromVisitStart > 15;

    if (
      !movedAwayFromHub ||
      !movedAwayFromVisit
    ) {
      return false;
    }

    this.confirmTargetIsland();

    return true;
  }

  confirmTargetIsland() {
    if (
      this.targetReached ||
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    this.targetReached = true;

    this.setState(
      'afk'
    );

    this.addLog(
      `TARGET ISLAND CONFIRMED: ${this.target}`
    );

    this.addLog(
      `Starting AFK movement`
    );

    this.startAFK();

    this.startDurationTimer();

    this.emit(
      'targetReached'
    );
  }

  /* =========================================================
     AFK MOVEMENT
     ========================================================= */

  startAFK() {
    if (
      !this.bot ||
      !this.targetReached ||
      this.manualStop
    ) {
      return;
    }

    this.clearAllMovement();

    this.afkStartedAt =
      Date.now();

    this.addLog(
      `AFK settings: move=${this.moveDistance} blocks, move interval=${this.moveInterval}ms, jump interval=${this.jumpInterval}ms`
    );

    /*
     * Run one movement cycle immediately.
     */
    this.runMovementCycle();

    /*
     * Continue movement every configured interval.
     */
    this.movementTimer =
      setInterval(
        () => {
          if (
            !this.bot ||
            !this.targetReached ||
            this.manualStop ||
            this.state !== 'afk'
          ) {
            return;
          }

          this.runMovementCycle();

        },
        Math.max(
          5000,
          this.moveInterval
        )
      );

    /*
     * Jump timer.
     */
    this.jumpTimer =
      setInterval(
        () => {
          if (
            !this.bot ||
            !this.targetReached ||
            this.manualStop ||
            this.state !== 'afk'
          ) {
            return;
          }

          this.jump();

        },
        Math.max(
          1500,
          this.jumpInterval
        )
      );
  }

  async runMovementCycle() {
    if (
      this.movementRunning ||
      !this.bot ||
      !this.targetReached ||
      this.manualStop ||
      this.state !== 'afk'
    ) {
      return;
    }

    this.movementRunning = true;

    try {
      /*
       * FORWARD
       */
      this.addLog(
        `AFK: moving forward ${this.moveDistance} blocks`
      );

      this.setMovement(
        'forward',
        true
      );

      const movementTime =
        Math.max(
          500,
          Math.min(
            2500,
            this.moveDistance * 260
          )
        );

      await this.sleep(
        movementTime
      );

      this.setMovement(
        'forward',
        false
      );

      await this.sleep(
        500
      );

      /*
       * BACKWARD
       */
      if (
        !this.bot ||
        !this.targetReached ||
        this.manualStop ||
        this.state !== 'afk'
      ) {
        return;
      }

      this.addLog(
        `AFK: moving backward ${this.moveDistance} blocks`
      );

      this.setMovement(
        'back',
        true
      );

      await this.sleep(
        movementTime
      );

      this.setMovement(
        'back',
        false
      );

    } catch (error) {
      this.addLog(
        `AFK movement error: ${error.message}`,
        'warn'
      );

      this.clearMovement();

    } finally {
      this.clearMovement();

      this.movementRunning = false;
    }
  }

  jump() {
    if (
      !this.bot ||
      !this.targetReached ||
      this.manualStop ||
      this.state !== 'afk'
    ) {
      return;
    }

    try {
      this.bot.setControlState(
        'jump',
        true
      );

      setTimeout(
        () => {
          if (!this.bot) {
            return;
          }

          try {
            this.bot.setControlState(
              'jump',
              false
            );
          } catch (_) {}
        },
        250
      );

      this.addLog(
        'AFK: jump'
      );

    } catch (error) {
      this.addLog(
        `Jump error: ${error.message}`,
        'warn'
      );
    }
  }

  setMovement(
    control,
    enabled
  ) {
    if (!this.bot) {
      return;
    }

    try {
      this.bot.setControlState(
        control,
        Boolean(enabled)
      );
    } catch (error) {
      this.addLog(
        `Movement control error (${control}): ${error.message}`,
        'warn'
      );
    }
  }

  clearMovement() {
    if (!this.bot) {
      return;
    }

    const controls = [
      'forward',
      'back',
      'left',
      'right',
      'jump',
      'sprint'
    ];

    for (
      const control of controls
    ) {
      try {
        this.bot.setControlState(
          control,
          false
        );
      } catch (_) {}
    }
  }

  clearAllMovement() {
    if (
      this.movementTimer
    ) {
      clearInterval(
        this.movementTimer
      );

      this.movementTimer = null;
    }

    if (
      this.jumpTimer
    ) {
      clearInterval(
        this.jumpTimer
      );

      this.jumpTimer = null;
    }

    this.movementRunning = false;

    this.clearMovement();
  }

  /* =========================================================
     DURATION
     ========================================================= */

  startDurationTimer() {
    this.clearDurationTimer();

    const hours =
      Math.max(
        0.01,
        Number(
          this.durationHours || 12
        )
      );

    const durationMs =
      hours *
      60 *
      60 *
      1000;

    this.addLog(
      `AFK duration: ${hours} hour(s)`
    );

    this.durationTimer =
      setTimeout(
        () => {
          if (
            this.manualStop
          ) {
            return;
          }

          this.addLog(
            'Configured duration completed'
          );

          this.stop();

        },
        durationMs
      );
  }

  clearDurationTimer() {
    if (
      this.durationTimer
    ) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer = null;
    }
  }

  /* =========================================================
     RECONNECT
     ========================================================= */

  scheduleReconnect() {
    if (
      !this.autoReconnect ||
      this.manualStop ||
      this.stopping
    ) {
      return;
    }

    this.clearReconnectTimer();

    this.lastReconnectAt =
      Date.now();

    this.addLog(
      `Auto reconnect scheduled in ${this.reconnectDelay}ms`
    );

    this.reconnectTimer =
      setTimeout(
        async () => {
          this.reconnectTimer = null;

          if (
            this.manualStop ||
            this.stopping
          ) {
            return;
          }

          await this.rejoin();

        },
        Math.max(
          1000,
          this.reconnectDelay
        )
      );
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

  /* =========================================================
     REJOIN
     ========================================================= */

  async rejoin() {
    if (
      this.stopping
    ) {
      return;
    }

    this.manualStop = false;

    this.clearReconnectTimer();
    this.clearDurationTimer();
    this.clearAllMovement();
    this.clearAuth();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;
    this.visitCommandSent = false;

    this.visitStartPosition = null;
    this.afkStartedAt = null;

    this.addLog(
      'Rejoining FakePixel'
    );

    if (this.bot) {
      try {
        this.bot.clearControlStates();
      } catch (_) {}

      try {
        this.bot.quit(
          'Rejoining'
        );
      } catch (_) {}

      this.bot = null;
    }

    this.connecting = false;

    this.setState(
      'disconnected'
    );

    await this.sleep(
      Math.max(
        1000,
        this.reconnectDelay
      )
    );

    if (
      !this.manualStop
    ) {
      await this.connect();
    }
  }

  /* =========================================================
     STOP
     ========================================================= */

  async stop() {
    this.manualStop = true;
    this.stopping = true;

    this.clearReconnectTimer();
    this.clearDurationTimer();
    this.clearAllMovement();
    this.clearAuth();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;
    this.visitCommandSent = false;

    this.visitStartPosition = null;

    if (this.bot) {
      try {
        this.bot.clearControlStates();
      } catch (_) {}

      try {
        this.bot.quit(
          'Bot stopped'
        );
      } catch (_) {}

      this.bot = null;
    }

    this.connecting = false;

    this.setState(
      'stopped'
    );

    this.addLog(
      'Bot stopped'
    );

    this.stopping = false;
  }

  /* =========================================================
     RESTART
     ========================================================= */

  async restart() {
    this.addLog(
      'Restart requested'
    );

    await this.stop();

    await this.sleep(
      1000
    );

    await this.start();
  }

  /* =========================================================
     CHAT
     ========================================================= */

  chat(message) {
    if (!this.bot) {
      throw new Error(
        'Bot is not connected'
      );
    }

    const text =
      String(message);

    this.bot.chat(
      text
    );

    this.addLog(
      `[BOT CHAT] ${text}`
    );
  }

  /* =========================================================
     CLICK WINDOW
     ========================================================= */

  async clickWindowSafe(
    slot,
    mouseButton,
    description
  ) {
    if (
      !this.bot
    ) {
      return false;
    }

    try {
      this.addLog(
        `Clicking ${description}: slot=${slot}, mouseButton=${mouseButton}`
      );

      /*
       * Mineflayer current API:
       *
       * clickWindow(
       *   slot,
       *   mouseButton,
       *   mode
       * )
       *
       * returns a Promise.
       */
      await this.bot.clickWindow(
        Number(slot),
        Number(mouseButton),
        0
      );

      this.addLog(
        `${description} clicked`
      );

      return true;

    } catch (error) {
      this.addLog(
        `${description} failed: ${error.message}`,
        'warn'
      );

      return false;
    }
  }

  /* =========================================================
     MESSAGE HANDLING
     ========================================================= */

  handleMessage(
    jsonMsg
  ) {
    const text =
      this.safeMessageToString(
        jsonMsg
      );

    if (!text) {
      return;
    }

    const clean =
      this.cleanText(
        text
      );

    if (!clean) {
      return;
    }

    /*
     * CRITICAL SPAM FIX.
     *
     * FakePixel can send:
     *
     * 100/100
     * 100/100 Mana
     *
     * multiple times every second.
     *
     * Do not even log those messages.
     */
    if (
      this.isSpamStatusMessage(
        clean
      )
    ) {
      return;
    }

    /*
     * Also ignore common duplicate blank/status packets.
     */
    if (
      this.isIgnoredStatusMessage(
        clean
      )
    ) {
      return;
    }

    /*
     * Only useful messages reach the console.
     */
    this.addLog(
      `[CHAT] ${clean}`
    );

    this.handleServerText(
      clean
    );
  }

  isSpamStatusMessage(
    text
  ) {
    const clean =
      this.cleanText(
        text
      );

    if (!clean) {
      return true;
    }

    /*
     * Exact examples:
     *
     * 100/100
     * 100/100 Mana
     * 100/100 100/100 Mana
     * 100/100
     * 100/100 Mana
     */
    if (
      /^\d+\/\d+$/.test(
        clean
      )
    ) {
      return true;
    }

    if (
      /^\d+\/\d+\s+Mana$/i.test(
        clean
      )
    ) {
      return true;
    }

    if (
      /^\d+\/\d+\s+\d+\/\d+\s+Mana$/i.test(
        clean
      )
    ) {
      return true;
    }

    /*
     * Multi-line status text after whitespace
     * normalization.
     */
    if (
      /^\d+\/\d+\s+\d+\/\d+\s+Mana$/i.test(
        clean
      )
    ) {
      return true;
    }

    /*
     * Health/status variants.
     */
    if (
      /^\d+\/\d+\s+(?:Health|Mana|Defense|Speed)$/i.test(
        clean
      )
    ) {
      return true;
    }

    /*
     * Generic mana/health status.
     */
    if (
      /^\d+\/\d+.*\bMana\b/i.test(
        clean
      )
    ) {
      return true;
    }

    if (
      /^\d+\/\d+.*\bHealth\b/i.test(
        clean
      )
    ) {
      return true;
    }

    return false;
  }

  isIgnoredStatusMessage(
    text
  ) {
    const clean =
      this.cleanText(
        text
      );

    if (!clean) {
      return true;
    }

    /*
     * Other frequently repeated HUD values.
     */
    if (
      /^\d+\/\d+\s+(?:❤|♥|❤❤|Health)$/i.test(
        clean
      )
    ) {
      return true;
    }

    return false;
  }

  handleServerText(
    text
  ) {
    const clean =
      this.cleanText(
        text
      );

    if (!clean) {
      return;
    }

    /*
     * Login/register prompts are handled by
     * minecraft-auth.js.
     *
     * We intentionally don't attempt authentication
     * here because that would create duplicate commands.
     */

    /*
     * FakePixel lobby detection.
     */
    if (
      /welcome to fakepixel skyblock/i.test(
        clean
      ) ||
      /^profile\s*:/i.test(
        clean
      )
    ) {
      if (
        this.state === 'authenticating' ||
        this.state === 'waiting-hub'
      ) {
        this.addLog(
          'FakePixel lobby detected'
        );

        this.waitForMainHub();
      }
    }

    /*
     * Visit-related messages are only informational.
     */
    if (
      this.state === 'visiting' &&
      /visit|island|sending/i.test(
        clean
      )
    ) {
      this.addLog(
        `Visit message: ${clean}`
      );
    }
  }

  /* =========================================================
     TARGET / TELEPORT CHECK
     ========================================================= */

  checkTeleportState() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      return;
    }

    if (
      this.state === 'visiting' ||
      this.state === 'target-island'
    ) {
      this.checkTargetArrival();
    }
  }

  /* =========================================================
     POSITION
     ========================================================= */

  getPosition() {
    if (
      !this.bot ||
      !this.bot.entity
    ) {
      return null;
    }

    const p =
      this.bot.entity.position;

    return {
      x: Number(
        p.x.toFixed(3)
      ),
      y: Number(
        p.y.toFixed(3)
      ),
      z: Number(
        p.z.toFixed(3)
      )
    };
  }

  updatePosition() {
    this.lastPosition =
      this.getPosition();
  }

  distanceTo(
    position
  ) {
    if (
      !this.bot ||
      !this.bot.entity ||
      !position
    ) {
      return Infinity;
    }

    return this.bot.entity.position.distanceTo(
      position
    );
  }

  formatPosition() {
    const position =
      this.getPosition();

    if (!position) {
      return 'unknown';
    }

    return `${position.x}, ${position.y}, ${position.z}`;
  }

  /* =========================================================
     STATUS
     ========================================================= */

  getStatus() {
    let uptime = 0;

    if (
      this.startedAt
    ) {
      uptime =
        Date.now() -
        this.startedAt;
    }

    return {
      id: this.id,

      username:
        this.username,

      target:
        this.target,

      state:
        this.state,

      connected:
        Boolean(
          this.bot &&
          this.bot.entity
        ),

      targetReached:
        this.targetReached,

      inSkyblockHub:
        this.inSkyblockHub,

      position:
        this.getPosition(),

      uptime,

      startedAt:
        this.startedAt,

      afkStartedAt:
        this.afkStartedAt,

      durationHours:
        this.durationHours,

      moveInterval:
        this.moveInterval,

      jumpInterval:
        this.jumpInterval,

      moveDistance:
        this.moveDistance,

      reconnectDelay:
        this.reconnectDelay,

      autoReconnect:
        this.autoReconnect,

      lastReconnectAt:
        this.lastReconnectAt,

      lastPosition:
        this.lastPosition
    };
  }

  getConfig() {
    return {
      id:
        this.id,

      username:
        this.username,

      password:
        this.password,

      target:
        this.target,

      durationHours:
        this.durationHours,

      moveInterval:
        this.moveInterval,

      jumpInterval:
        this.jumpInterval,

      moveDistance:
        this.moveDistance,

      reconnectDelay:
        this.reconnectDelay,

      autoReconnect:
        this.autoReconnect
    };
  }

  updateConfig(
    config = {}
  ) {
    if (
      config.username !== undefined
    ) {
      this.username =
        String(
          config.username
        ).trim();
    }

    if (
      config.password !== undefined
    ) {
      this.password =
        String(
          config.password
        );
    }

    if (
      config.target !== undefined
    ) {
      this.target =
        String(
          config.target
        ).trim();
    }

    if (
      config.durationHours !== undefined
    ) {
      this.durationHours =
        Number(
          config.durationHours
        );
    }

    if (
      config.moveInterval !== undefined
    ) {
      this.moveInterval =
        Number(
          config.moveInterval
        );
    }

    if (
      config.jumpInterval !== undefined
    ) {
      this.jumpInterval =
        Number(
          config.jumpInterval
        );
    }

    if (
      config.moveDistance !== undefined
    ) {
      this.moveDistance =
        Number(
          config.moveDistance
        );
    }

    if (
      config.reconnectDelay !== undefined
    ) {
      this.reconnectDelay =
        Number(
          config.reconnectDelay
        );
    }

    if (
      config.autoReconnect !== undefined
    ) {
      this.autoReconnect =
        Boolean(
          config.autoReconnect
        );
    }

    this.addLog(
      'Bot configuration updated'
    );

    return this.getConfig();
  }

  /* =========================================================
     HELPERS
     ========================================================= */

  cleanText(
    value
  ) {
    return String(
      value || ''
    )
      /*
       * Minecraft formatting codes.
       */
      .replace(
        /§[0-9a-fk-or]/gi,
        ''
      )
      .replace(
        /\u00a7[0-9a-fk-or]/gi,
        ''
      )

      /*
       * Normalize whitespace.
       */
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }

  safeMessageToString(
    message
  ) {
    try {
      if (
        message === null ||
        message === undefined
      ) {
        return '';
      }

      if (
        typeof message === 'string'
      ) {
        return this.cleanText(
          message
        );
      }

      if (
        typeof message.toString ===
        'function'
      ) {
        return this.cleanText(
          message.toString()
        );
      }

      return '';

    } catch (_) {
      return '';
    }
  }

  itemDescription(
    item
  ) {
    if (!item) {
      return 'empty';
    }

    const name =
      item.displayName ||
      item.name ||
      'unknown item';

    const count =
      item.count !== undefined
        ? ` x${item.count}`
        : '';

    return `${name}${count}`;
  }

  sleep(
    ms
  ) {
    return new Promise(
      resolve => {
        setTimeout(
          resolve,
          Math.max(
            0,
            Number(ms) || 0
          )
        );
      }
    );
  }

  /* =========================================================
     SHUTDOWN
     ========================================================= */

  async shutdown() {
    await this.stop();
  }
}

/*
 * Support both import styles:
 *
 * const FakePixelBot = require('./fakepixel-bot');
 *
 * and:
 *
 * const { FakePixelBot } = require('./fakepixel-bot');
 */
module.exports = FakePixelBot;
module.exports.FakePixelBot =
  FakePixelBot;
