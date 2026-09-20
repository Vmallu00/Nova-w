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

    this.id = config.id || `bot-${Date.now()}`;
    this.username = config.username || '';
    this.password =
      config.password ||
      process.env.DEFAULT_MC_PASSWORD ||
      'vmallu';

    this.target =
      config.target ||
      process.env.DEFAULT_TARGET ||
      'v_mallu_gamer';

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
        : String(process.env.AUTO_RECONNECT || 'true') !== 'false';

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

    this.mainSpawn = new Vec3(
      Number(process.env.MAIN_SPAWN_X || -52.5),
      Number(process.env.MAIN_SPAWN_Y || 95.74244),
      Number(process.env.MAIN_SPAWN_Z || 0.5)
    );

    this.skyblockHub = new Vec3(
      Number(process.env.SKYBLOCK_HUB_X || -2.5),
      Number(process.env.SKYBLOCK_HUB_Y || 70.0625),
      Number(process.env.SKYBLOCK_HUB_Z || -68)
    );

    /*
     * FakePixel GUI slots are displayed as human slots.
     *
     * Visible slot 21 -> Mineflayer slot 20
     * Visible slot 12 -> Mineflayer slot 11
     */
    this.GAME_MENU_SLOT = 20;
    this.VISIT_SLOT = 11;

    this.bot = null;

    this.state = 'idle';

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;

    this.startedAt = null;
    this.afkStartedAt = null;
    this.lastReconnectAt = null;
    this.lastPosition = null;

    this.visitStartPosition = null;

    this.durationTimer = null;
    this.reconnectTimer = null;

    this.movementTimer = null;
    this.jumpTimer = null;
    this.movementActionTimer = null;

    this.auth = null;

    this.stopping = false;
    this.connecting = false;
    this.manualStop = false;

    this.logs = [];

    this.addLog(
      `Created bot ${this.username || '(no username)'}`
    );
  }

  /* --------------------------------------------------------- */
  /* LOGGING                                                   */
  /* --------------------------------------------------------- */

  addLog(message, level = 'info') {
    const line = {
      time: new Date().toISOString(),
      level,
      message: String(message)
    };

    this.logs.push(line);

    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }

    const prefix = `[${this.id}]`;

    if (level === 'error') {
      console.error(prefix, message);
    } else if (level === 'warn') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }

    this.emit('log', line);
  }

  getLogs(limit = 200) {
    return this.logs.slice(-Number(limit || 200));
  }

  /* --------------------------------------------------------- */
  /* STATE                                                     */
  /* --------------------------------------------------------- */

  setState(state) {
    this.state = state;

    this.addLog(`State -> ${state}`);

    this.emit('state', state);
  }

  /* --------------------------------------------------------- */
  /* POSITION                                                  */
  /* --------------------------------------------------------- */

  getPosition() {
    if (!this.bot || !this.bot.entity) {
      return null;
    }

    const p = this.bot.entity.position;

    return {
      x: Number(p.x.toFixed(3)),
      y: Number(p.y.toFixed(3)),
      z: Number(p.z.toFixed(3))
    };
  }

  distanceTo(position) {
    if (!this.bot || !this.bot.entity || !position) {
      return Infinity;
    }

    return this.bot.entity.position.distanceTo(position);
  }

  isNear(position, tolerance = this.locationTolerance) {
    return this.distanceTo(position) <= tolerance;
  }

  updatePosition() {
    this.lastPosition = this.getPosition();
  }

  /* --------------------------------------------------------- */
  /* START                                                      */
  /* --------------------------------------------------------- */

  async start() {
    if (this.state !== 'idle' &&
        this.state !== 'stopped' &&
        this.state !== 'disconnected' &&
        this.state !== 'error') {
      this.addLog(
        `Start ignored because current state is ${this.state}`,
        'warn'
      );
      return;
    }

    this.manualStop = false;
    this.stopping = false;

    this.clearReconnectTimer();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;

    this.startedAt = Date.now();

    await this.connect();
  }

  /* --------------------------------------------------------- */
  /* CONNECT                                                    */
  /* --------------------------------------------------------- */

  async connect() {
    if (this.connecting) {
      return;
    }

    this.connecting = true;
    this.stopping = false;

    this.clearReconnectTimer();
    this.clearAllMovement();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;

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
         * FakePixel account setup used by this project.
         */
        auth: 'offline',

        /*
         * Important for the previous timeout/keepAlive issue.
         */
        keepAlive: true,
        checkTimeoutInterval: this.checkTimeoutInterval,

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

  /* --------------------------------------------------------- */
  /* BOT EVENTS                                                  */
  /* --------------------------------------------------------- */

  setupBotEvents() {
    if (!this.bot) {
      return;
    }

    this.bot.once('login', () => {
      this.connecting = false;

      this.addLog(
        `Minecraft login packet received`
      );
    });

    this.bot.once('spawn', () => {
      this.connecting = false;

      this.addLog(
        `Spawn received at ${this.formatPosition()}`
      );

      this.setState('authenticating');

      this.startAuthentication();
    });

    this.bot.on('message', (jsonMsg) => {
      this.handleMessage(jsonMsg);
    });

    this.bot.on('chat', (username, message) => {
      if (username === this.username) {
        return;
      }

      this.addLog(
        `[CHAT] ${username}: ${message}`
      );

      this.handleServerText(String(message));
    });

    this.bot.on('actionBar', (message) => {
      const text = this.safeMessageToString(message);

      if (!text) {
        return;
      }

      /*
       * Do not send every action-bar message to the auth
       * system. FakePixel frequently displays mana/status
       * information here.
       */
      if (
        /mana/i.test(text) ||
        /health/i.test(text) ||
        /saturation/i.test(text)
      ) {
        return;
      }

      this.handleServerText(text);
    });

    this.bot.on('windowOpen', async (window) => {
      await this.handleWindowOpen(window);
    });

    this.bot.on('windowClose', (window) => {
      if (!window) {
        return;
      }

      const title = this.cleanText(
        window.title || ''
      );

      this.addLog(
        `Window closed: ${title || '(untitled)'}`
      );
    });

    this.bot.on('forcedMove', () => {
      this.updatePosition();

      this.addLog(
        `Server teleport/spawn detected at ${this.formatPosition()}`
      );

      this.checkTeleportState();
    });

    this.bot.on('move', () => {
      this.updatePosition();

      if (
        this.state === 'visiting' ||
        this.state === 'target-island'
      ) {
        this.checkTargetArrival();
      }
    });

    this.bot.on('kicked', (reason) => {
      const text = this.safeMessageToString(reason);

      this.addLog(
        `Kicked: ${text || 'unknown reason'}`,
        'warn'
      );
    });

    this.bot.on('error', (error) => {
      this.addLog(
        `Minecraft error: ${error.message}`,
        'error'
      );

      this.emit('error', error);
    });

    this.bot.on('end', (reason) => {
      this.connecting = false;

      this.clearAllMovement();

      this.addLog(
        `Connection ended: ${reason || 'unknown'}`
      );

      if (this.manualStop || this.stopping) {
        this.setState('stopped');
        return;
      }

      this.setState('disconnected');

      this.scheduleReconnect();
    });
  }

  /* --------------------------------------------------------- */
  /* AUTHENTICATION                                             */
  /* --------------------------------------------------------- */

  startAuthentication() {
    if (!this.bot) {
      return;
    }

    this.clearAuth();

    try {
      this.auth = new MinecraftAuth({
        bot: this.bot,
        username: this.username,
        password: this.password
      });

      this.auth.on('log', (message) => {
        this.addLog(`[AUTH] ${message}`);
      });

      this.auth.on('authenticated', () => {
        this.addLog(
          `Authentication completed`
        );

        /*
         * Do not immediately open Game Menu.
         *
         * FakePixel may need a few seconds to finish
         * sending the player to the main hub.
         */
        this.setState('waiting-hub');

        setTimeout(() => {
          this.waitForMainHub();
        }, 2500);
      });

      this.auth.on('authTimeout', () => {
        this.addLog(
          `Authentication timeout; checking lobby position`,
          'warn'
        );

        this.waitForMainHub();
      });

      this.auth.on('error', (error) => {
        this.addLog(
          `Authentication error: ${error.message}`,
          'error'
        );
      });

      this.auth.start();

    } catch (error) {
      /*
       * If minecraft-auth.js from an older deployment
       * fails to initialize, don't permanently kill the bot.
       */
      this.addLog(
        `Auth initialization error: ${error.message}`,
        'error'
      );

      this.waitForMainHub();
    }
  }

  clearAuth() {
    if (!this.auth) {
      return;
    }

    try {
      if (typeof this.auth.stop === 'function') {
        this.auth.stop();
      }
    } catch (_) {}

    this.auth.removeAllListeners();

    this.auth = null;
  }

  /* --------------------------------------------------------- */
  /* MAIN HUB                                                   */
  /* --------------------------------------------------------- */

  waitForMainHub() {
    if (!this.bot || this.manualStop) {
      return;
    }

    this.setState('waiting-hub');

    let attempts = 0;

    const check = () => {
      if (!this.bot || this.manualStop) {
        return;
      }

      attempts++;

      const distance = this.distanceTo(
        this.mainSpawn
      );

      this.addLog(
        `Checking main hub position: distance=${distance.toFixed(2)}`
      );

      /*
       * FakePixel's main spawn is around:
       * -52.5, 95.74244, 0.5
       *
       * We only need to know that we are back in the
       * main FakePixel lobby.
       */
      if (distance <= this.locationTolerance) {
        this.addLog(
          `Main FakePixel hub detected`
        );

        this.beginGameMenuFlow();
        return;
      }

      /*
       * Some servers move the bot slightly after spawn.
       * Give the server more time before forcing the menu.
       */
      if (attempts < 12) {
        setTimeout(check, 1500);
        return;
      }

      /*
       * If the exact coordinate isn't reached but the bot
       * has clearly spawned and authentication succeeded,
       * try the Game Menu once rather than hanging forever.
       */
      this.addLog(
        `Main hub coordinate not exact; attempting Game Menu`,
        'warn'
      );

      this.beginGameMenuFlow();
    };

    check();
  }

  /* --------------------------------------------------------- */
  /* GAME MENU                                                   */
  /* --------------------------------------------------------- */

  beginGameMenuFlow() {
    if (!this.bot || this.manualStop) {
      return;
    }

    if (this.gameMenuOpened) {
      return;
    }

    this.setState('game-menu');

    this.addLog(
      `Selecting Game Menu compass`
    );

    try {
      /*
       * Slot 1 = Mineflayer hotbar index 0.
       */
      this.bot.setQuickBarSlot(0);

      /*
       * activateItem() is synchronous in Mineflayer.
       */
      this.bot.activateItem();

      this.addLog(
        `Game Menu item activated`
      );

      /*
       * If windowOpen does not fire, retry once.
       */
      setTimeout(() => {
        if (
          this.bot &&
          !this.gameMenuOpened &&
          !this.manualStop
        ) {
          this.addLog(
            `Game Menu did not open yet; retrying`,
            'warn'
          );

          try {
            this.bot.activateItem();
          } catch (error) {
            this.addLog(
              `Game Menu retry failed: ${error.message}`,
              'error'
            );
          }
        }
      }, 2500);

    } catch (error) {
      this.addLog(
        `Game Menu activation failed: ${error.message}`,
        'error'
      );

      setTimeout(() => {
        if (this.bot && !this.manualStop) {
          this.beginGameMenuFlow();
        }
      }, 2000);
    }
  }

  async handleGameMenuWindow(window) {
    if (!window || !this.bot || this.manualStop) {
      return;
    }

    const title = this.cleanText(
      window.title || ''
    );

    this.addLog(
      `Opened window: "${title || '(untitled)'}"`
    );

    if (!/game\s*menu/i.test(title)) {
      /*
       * Don't click arbitrary inventories.
       */
      return;
    }

    if (this.gameMenuOpened) {
      return;
    }

    this.gameMenuOpened = true;

    this.addLog(
      `Game Menu detected`
    );

    const item = window.slots
      ? window.slots[this.GAME_MENU_SLOT]
      : null;

    if (item) {
      this.addLog(
        `SkyBlock item at visible slot 21 / index 20: ${this.itemDescription(item)}`
      );
    } else {
      this.addLog(
        `No item detected at slot index 20`,
        'warn'
      );
    }

    /*
     * User confirmed:
     *
     * visible slot 21
     * Mineflayer index 20
     *
     * Left click first.
     */
    const clicked = await this.clickWindowSafe(
      this.GAME_MENU_SLOT,
      0,
      'Game Menu SkyBlock slot'
    );

    if (!clicked) {
      /*
       * Right-click fallback.
       */
      await this.clickWindowSafe(
        this.GAME_MENU_SLOT,
        1,
        'Game Menu SkyBlock right-click fallback'
      );
    }

    try {
      if (this.bot.currentWindow === window) {
        await this.bot.closeWindow(window);
      }
    } catch (_) {}

    this.setState('skyblock-hub');

    this.addLog(
      `SkyBlock Hub selected; waiting for teleport`
    );

    this.waitForSkyblockHub();
  }

  /* --------------------------------------------------------- */
  /* SKYBLOCK HUB                                                */
  /* --------------------------------------------------------- */

  waitForSkyblockHub() {
    if (!this.bot || this.manualStop) {
      return;
    }

    let attempts = 0;

    const check = () => {
      if (!this.bot || this.manualStop) {
        return;
      }

      attempts++;

      const distance = this.distanceTo(
        this.skyblockHub
      );

      this.addLog(
        `Checking SkyBlock Hub: distance=${distance.toFixed(2)}`
      );

      if (distance <= this.locationTolerance) {
        this.inSkyblockHub = true;

        this.addLog(
          `SkyBlock Hub confirmed at ${this.formatPosition()}`
        );

        /*
         * Small delay so the server finishes loading the hub.
         */
        setTimeout(() => {
          this.startVisitFlow();
        }, 1500);

        return;
      }

      if (attempts < 15) {
        setTimeout(check, 1000);
        return;
      }

      /*
       * If the server has changed the exact hub coordinate,
       * don't blindly /visit yet unless we have received a
       * teleport/spawn and are no longer in the main lobby.
       */
      if (
        this.bot.entity &&
        this.distanceTo(this.mainSpawn) > 20
      ) {
        this.inSkyblockHub = true;

        this.addLog(
          `Player appears to be in SkyBlock despite coordinate mismatch`,
          'warn'
        );

        this.startVisitFlow();
        return;
      }

      this.addLog(
        `SkyBlock Hub was not detected`,
        'warn'
      );

      /*
       * Retry the Game Menu flow once.
       */
      this.gameMenuOpened = false;

      this.setState('game-menu');

      setTimeout(() => {
        this.beginGameMenuFlow();
      }, 1500);
    };

    check();
  }

  /* --------------------------------------------------------- */
  /* VISIT TARGET                                                */
  /* --------------------------------------------------------- */

  startVisitFlow() {
    if (!this.bot || this.manualStop) {
      return;
    }

    if (!this.inSkyblockHub) {
      this.addLog(
        `Visit blocked because SkyBlock Hub is not confirmed`,
        'warn'
      );
      return;
    }

    if (!this.target) {
      this.addLog(
        `No target username configured`,
        'error'
      );
      return;
    }

    this.setState('visiting');

    this.targetReached = false;

    this.visitStartPosition =
      this.bot.entity
        ? this.bot.entity.position.clone()
        : null;

    this.addLog(
      `Visiting target: ${this.target}`
    );

    try {
      this.bot.chat(
        `/visit ${this.target}`
      );

      this.addLog(
        `/visit ${this.target} sent`
      );

    } catch (error) {
      this.addLog(
        `Could not send visit command: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();
      return;
    }

    /*
     * FakePixel normally opens the Visit GUI after
     * processing the command.
     *
     * Give it time.
     */
    setTimeout(() => {
      if (
        this.bot &&
        !this.targetReached &&
        !this.manualStop
      ) {
        this.addLog(
          `Still waiting for Visit GUI/teleport`
        );

        this.checkTargetArrival();
      }
    }, 2500);

    setTimeout(() => {
      if (
        this.bot &&
        !this.targetReached &&
        !this.manualStop &&
        this.state === 'visiting'
      ) {
        this.addLog(
          `Visit flow still waiting after 10 seconds`,
          'warn'
        );

        this.checkTargetArrival();
      }
    }, 10000);
  }

  async handleVisitWindow(window) {
    if (!window || !this.bot || this.manualStop) {
      return;
    }

    const title = this.cleanText(
      window.title || ''
    );

    this.addLog(
      `Visit-related window opened: "${title || '(untitled)'}"`
    );

    /*
     * We only want the GUI opened after /visit.
     *
     * Avoid clicking unrelated windows.
     */
    const looksLikeVisit =
      /visit/i.test(title) ||
      this.state === 'visiting';

    if (!looksLikeVisit) {
      return;
    }

    if (this.visitMenuOpened) {
      return;
    }

    this.visitMenuOpened = true;

    const item = window.slots
      ? window.slots[this.VISIT_SLOT]
      : null;

    if (item) {
      this.addLog(
        `Target Visit item at visible slot 12 / index 11: ${this.itemDescription(item)}`
      );
    } else {
      this.addLog(
        `No item detected at Visit slot index 11`,
        'warn'
      );
    }

    /*
     * IMPORTANT:
     *
     * User confirmed visible slot 12.
     * Mineflayer index = 11.
     *
     * Right-click first.
     */
    let clicked = await this.clickWindowSafe(
      this.VISIT_SLOT,
      1,
      'Visit slot 12 right-click'
    );

    /*
     * If right-click fails, use left-click.
     */
    if (!clicked) {
      clicked = await this.clickWindowSafe(
        this.VISIT_SLOT,
        0,
        'Visit slot 12 left-click fallback'
      );
    }

    try {
      if (this.bot.currentWindow === window) {
        await this.bot.closeWindow(window);
      }
    } catch (_) {}

    this.addLog(
      `Visit selection clicked; waiting for target island`
    );

    this.setState('target-island');

    /*
     * Start checking immediately and then periodically.
     */
    this.checkTargetArrival();

    setTimeout(() => {
      this.checkTargetArrival();
    }, 2000);

    setTimeout(() => {
      this.checkTargetArrival();
    }, 5000);

    setTimeout(() => {
      this.checkTargetArrival();
    }, 10000);
  }

  /* --------------------------------------------------------- */
  /* WINDOW DISPATCH                                             */
  /* --------------------------------------------------------- */

  async handleWindowOpen(window) {
    if (!window || !this.bot || this.manualStop) {
      return;
    }

    const title = this.cleanText(
      window.title || ''
    );

    this.addLog(
      `Window opened: "${title || '(untitled)'}"`
    );

    if (/game\s*menu/i.test(title)) {
      await this.handleGameMenuWindow(window);
      return;
    }

    if (
      this.state === 'visiting' ||
      this.state === 'target-island' ||
      /visit/i.test(title)
    ) {
      await this.handleVisitWindow(window);
    }
  }

  /* --------------------------------------------------------- */
  /* TARGET ARRIVAL                                             */
  /* --------------------------------------------------------- */

  checkTargetArrival() {
    if (
      !this.bot ||
      !this.bot.entity ||
      this.manualStop
    ) {
      return false;
    }

    if (this.targetReached) {
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
      current.distanceTo(this.skyblockHub);

    const fromVisitStart =
      this.visitStartPosition
        ? current.distanceTo(this.visitStartPosition)
        : 0;

    /*
     * We need a meaningful teleport/movement away from
     * the SkyBlock Hub.
     *
     * This prevents AFK movement from starting while the
     * bot is still in the hub.
     */
    const movedAway =
      fromHub > 25 &&
      fromVisitStart > 15;

    if (!movedAway) {
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

    this.setState('afk');

    this.addLog(
      `TARGET ISLAND CONFIRMED for ${this.target}`
    );

    this.addLog(
      `Starting AFK movement`
    );

    this.startAFK();

    this.startDurationTimer();

    this.emit('targetReached');
  }

  /* --------------------------------------------------------- */
  /* AFK MOVEMENT                                                */
  /* --------------------------------------------------------- */

  startAFK() {
    if (
      !this.bot ||
      !this.targetReached ||
      this.manualStop
    ) {
      return;
    }

    this.clearAllMovement();

    this.afkStartedAt = Date.now();

    this.addLog(
      `AFK enabled: forward ${this.moveDistance} blocks, back ${this.moveDistance} blocks, jump every ${this.jumpInterval}ms`
    );

    /*
     * Movement cycle:
     *
     * forward
     * stop
     * backward
     * stop
     * repeat
     *
     * setControlState() is the supported Mineflayer
     * movement API.
     */

    const cycle = async () => {
      if (
        !this.bot ||
        !this.targetReached ||
        this.manualStop ||
        this.state !== 'afk'
      ) {
        return;
      }

      try {
        /*
         * Face approximately forward.
         *
         * We preserve the current yaw instead of constantly
         * turning the player around.
         */
        const yaw =
          this.bot.entity && this.bot.entity.yaw !== undefined
            ? this.bot.entity.yaw
            : 0;

        await this.bot.look(
          yaw,
          0,
          false
        ).catch(() => {});

        /*
         * FORWARD
         */
        this.addLog(
          `AFK movement: forward`
        );

        this.setMovement(
          'forward',
          true
        );

        /*
         * Approximately 4 blocks.
         *
         * Minecraft walking speed is roughly 4.3 blocks/sec,
         * so 4 blocks takes close to 900-1100ms.
         *
         * Scale slightly with requested distance.
         */
        const forwardTime =
          Math.max(
            500,
            Math.min(
              2500,
              this.moveDistance * 260
            )
          );

        await this.sleep(forwardTime);

        this.setMovement(
          'forward',
          false
        );

        await this.sleep(500);

        /*
         * BACKWARD
         */
        this.addLog(
          `AFK movement: backward`
        );

        this.setMovement(
          'back',
          true
        );

        const backwardTime =
          Math.max(
            500,
            Math.min(
              2500,
              this.moveDistance * 260
            )
          );

        await this.sleep(backwardTime);

        this.setMovement(
          'back',
          false
        );

        await this.sleep(500);

      } catch (error) {
        this.addLog(
          `AFK movement error: ${error.message}`,
          'warn'
        );

        this.clearMovement();
      }
    };

    /*
     * Run the first movement immediately.
     */
    cycle();

    /*
     * Repeat using the configured movement interval.
     *
     * We intentionally use setInterval only for scheduling;
     * the actual movement sequence checks targetReached and
     * state before doing anything.
     */
    this.movementTimer = setInterval(() => {
      if (
        !this.bot ||
        !this.targetReached ||
        this.manualStop ||
        this.state !== 'afk'
      ) {
        return;
      }

      /*
       * Avoid stacking multiple movement actions.
       */
      if (this.movementActionTimer) {
        return;
      }

      this.movementActionTimer = true;

      cycle()
        .catch(() => {})
        .finally(() => {
          this.movementActionTimer = false;
        });

    }, Math.max(5000, this.moveInterval));

    /*
     * Jump timer.
     */
    this.jumpTimer = setInterval(() => {
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

        setTimeout(() => {
          if (this.bot) {
            try {
              this.bot.setControlState(
                'jump',
                false
              );
            } catch (_) {}
          }
        }, 250);

        this.addLog(
          `AFK jump`
        );

      } catch (error) {
        this.addLog(
          `Jump error: ${error.message}`,
          'warn'
        );
      }

    }, Math.max(1500, this.jumpInterval));
  }

  setMovement(control, enabled) {
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
        `Movement control ${control} failed: ${error.message}`,
        'warn'
      );
    }
  }

  clearMovement() {
    if (!this.bot) {
      return;
    }

    try {
      this.bot.setControlState(
        'forward',
        false
      );

      this.bot.setControlState(
        'back',
        false
      );

      this.bot.setControlState(
        'left',
        false
      );

      this.bot.setControlState(
        'right',
        false
      );

      this.bot.setControlState(
        'jump',
        false
      );

      this.bot.setControlState(
        'sprint',
        false
      );

    } catch (_) {}
  }

  clearAllMovement() {
    if (this.movementTimer) {
      clearInterval(this.movementTimer);
      this.movementTimer = null;
    }

    if (this.jumpTimer) {
      clearInterval(this.jumpTimer);
      this.jumpTimer = null;
    }

    if (this.movementActionTimer) {
      this.movementActionTimer = null;
    }

    if (this.movementActionTimeout) {
      clearTimeout(this.movementActionTimeout);
      this.movementActionTimeout = null;
    }

    this.clearMovement();
  }

  /* --------------------------------------------------------- */
  /* DURATION                                                    */
  /* --------------------------------------------------------- */

  startDurationTimer() {
    this.clearDurationTimer();

    const hours = Math.max(
      0.01,
      Number(this.durationHours || 12)
    );

    const durationMs =
      hours * 60 * 60 * 1000;

    this.addLog(
      `AFK duration timer: ${hours} hour(s)`
    );

    this.durationTimer = setTimeout(() => {
      if (this.manualStop) {
        return;
      }

      this.addLog(
        `Configured duration completed`
      );

      this.stop();

    }, durationMs);
  }

  clearDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  /* --------------------------------------------------------- */
  /* RECONNECT                                                   */
  /* --------------------------------------------------------- */

  scheduleReconnect() {
    if (
      !this.autoReconnect ||
      this.manualStop ||
      this.stopping
    ) {
      return;
    }

    this.clearReconnectTimer();

    this.lastReconnectAt = Date.now();

    this.addLog(
      `Auto reconnect in ${this.reconnectDelay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (
        this.manualStop ||
        this.stopping
      ) {
        return;
      }

      this.rejoin();

    }, Math.max(1000, this.reconnectDelay));
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /* --------------------------------------------------------- */
  /* REJOIN                                                      */
  /* --------------------------------------------------------- */

  async rejoin() {
    this.manualStop = false;
    this.stopping = false;

    this.clearReconnectTimer();
    this.clearDurationTimer();
    this.clearAllMovement();
    this.clearAuth();

    this.targetReached = false;
    this.inSkyblockHub = false;
    this.gameMenuOpened = false;
    this.visitMenuOpened = false;
    this.visitStartPosition = null;
    this.afkStartedAt = null;

    this.addLog(
      `Rejoining FakePixel`
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

    this.setState('disconnected');

    await this.sleep(
      Math.max(1000, this.reconnectDelay)
    );

    if (!this.manualStop) {
      await this.connect();
    }
  }

  /* --------------------------------------------------------- */
  /* STOP                                                        */
  /* --------------------------------------------------------- */

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

    this.setState('stopped');

    this.addLog(
      `Bot stopped`
    );

    this.stopping = false;
    this.connecting = false;
  }

  /* --------------------------------------------------------- */
  /* RESTART                                                     */
  /* --------------------------------------------------------- */

  async restart() {
    this.addLog(
      `Restart requested`
    );

    await this.stop();

    await this.sleep(1000);

    await this.start();
  }

  /* --------------------------------------------------------- */
  /* CHAT                                                        */
  /* --------------------------------------------------------- */

  chat(message) {
    if (!this.bot) {
      throw new Error(
        'Bot is not connected'
      );
    }

    this.bot.chat(
      String(message)
    );

    this.addLog(
      `[BOT CHAT] ${message}`
    );
  }

  /* --------------------------------------------------------- */
  /* SAFE WINDOW CLICK                                           */
  /* --------------------------------------------------------- */

  async clickWindowSafe(
    slot,
    mouseButton,
    description
  ) {
    if (!this.bot) {
      return false;
    }

    try {
      this.addLog(
        `Clicking ${description}: slot=${slot}, mouse=${mouseButton}`
      );

      /*
       * IMPORTANT:
       *
       * Current Mineflayer:
       *
       * clickWindow(slot, mouseButton, mode)
       *
       * returns Promise<void>.
       *
       * No callback is passed.
       */
      await this.bot.clickWindow(
        Number(slot),
        Number(mouseButton),
        0
      );

      this.addLog(
        `${description} clicked successfully`
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

  /* --------------------------------------------------------- */
  /* TELEPORT CHECK                                             */
  /* --------------------------------------------------------- */

  checkTeleportState() {
    if (!this.bot || !this.bot.entity) {
      return;
    }

    if (
      this.state === 'visiting' ||
      this.state === 'target-island'
    ) {
      this.checkTargetArrival();
    }
  }

  /* --------------------------------------------------------- */
  /* MESSAGE HANDLING                                           */
  /* --------------------------------------------------------- */

  handleMessage(jsonMsg) {
    const text =
      this.safeMessageToString(jsonMsg);

    if (!text) {
      return;
    }

    /*
     * Keep normal chat logging.
     *
     * Do NOT send every message into MinecraftAuth.
     * This prevents messages such as:
     *
     * 100/100 100/100 Mana
     *
     * from being interpreted as authentication.
     */
    this.addLog(
      `[CHAT] ${text}`
    );

    this.handleServerText(text);
  }

  handleServerText(text) {
    const message =
      this.cleanText(text);

    if (!message) {
      return;
    }

    /*
     * Useful lobby indicators.
     */
    if (
      /welcome to fakepixel skyblock/i.test(message) ||
      /profile:/i.test(message)
    ) {
      if (
        this.state === 'authenticating' ||
        this.state === 'waiting-hub'
      ) {
        this.addLog(
          `FakePixel lobby message detected`
        );

        this.waitForMainHub();
      }
    }

    /*
     * Visit GUI may sometimes be announced by chat.
     */
    if (
      this.state === 'visiting' &&
      /visit|island|sending/i.test(message)
    ) {
      this.addLog(
        `Visit-related server message: ${message}`
      );
    }
  }

  /* --------------------------------------------------------- */
  /* STATUS                                                       */
  /* --------------------------------------------------------- */

  getStatus() {
    const position =
      this.getPosition();

    let uptime = 0;

    if (this.startedAt) {
      uptime =
        Date.now() - this.startedAt;
    }

    return {
      id: this.id,
      username: this.username,
      target: this.target,
      state: this.state,

      connected: Boolean(
        this.bot &&
        this.bot.entity
      ),

      targetReached:
        this.targetReached,

      inSkyblockHub:
        this.inSkyblockHub,

      position,

      uptime,

      afkStartedAt:
        this.afkStartedAt,

      startedAt:
        this.startedAt,

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

      lastReconnectAt:
        this.lastReconnectAt,

      lastPosition:
        this.lastPosition
    };
  }

  getConfig() {
    return {
      id: this.id,
      username: this.username,
      password: this.password,
      target: this.target,
      durationHours: this.durationHours,
      moveInterval: this.moveInterval,
      jumpInterval: this.jumpInterval,
      moveDistance: this.moveDistance,
      reconnectDelay: this.reconnectDelay,
      autoReconnect: this.autoReconnect
    };
  }

  updateConfig(config = {}) {
    if (
      config.username !== undefined
    ) {
      this.username =
        String(config.username);
    }

    if (
      config.password !== undefined
    ) {
      this.password =
        String(config.password);
    }

    if (
      config.target !== undefined
    ) {
      this.target =
        String(config.target);
    }

    if (
      config.durationHours !== undefined
    ) {
      this.durationHours =
        Number(config.durationHours);
    }

    if (
      config.moveInterval !== undefined
    ) {
      this.moveInterval =
        Number(config.moveInterval);
    }

    if (
      config.jumpInterval !== undefined
    ) {
      this.jumpInterval =
        Number(config.jumpInterval);
    }

    if (
      config.moveDistance !== undefined
    ) {
      this.moveDistance =
        Number(config.moveDistance);
    }

    if (
      config.reconnectDelay !== undefined
    ) {
      this.reconnectDelay =
        Number(config.reconnectDelay);
    }

    if (
      config.autoReconnect !== undefined
    ) {
      this.autoReconnect =
        Boolean(config.autoReconnect);
    }

    this.addLog(
      `Bot configuration updated`
    );

    return this.getConfig();
  }

  /* --------------------------------------------------------- */
  /* HELPERS                                                     */
  /* --------------------------------------------------------- */

  formatPosition() {
    const position =
      this.getPosition();

    if (!position) {
      return 'unknown';
    }

    return `${position.x}, ${position.y}, ${position.z}`;
  }

  itemDescription(item) {
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

  cleanText(value) {
    return String(value || '')
      .replace(/§[0-9a-fk-or]/gi, '')
      .replace(/\u00a7[0-9a-fk-or]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  safeMessageToString(message) {
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
        return this.cleanText(message);
      }

      if (
        typeof message.toString === 'function'
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

  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(
        resolve,
        Math.max(0, Number(ms) || 0)
      );
    });
  }

  /* --------------------------------------------------------- */
  /* SHUTDOWN                                                    */
  /* --------------------------------------------------------- */

  async shutdown() {
    await this.stop();
  }
}

/*
 * Both export styles are supported.
 */
module.exports = FakePixelBot;
module.exports.FakePixelBot = FakePixelBot;
