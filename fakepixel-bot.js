const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const EventEmitter = require('events');

/* =========================================================
   COMPATIBLE IMPORTS
========================================================= */

let MinecraftAuth = require('./minecraft-auth');

if (
  MinecraftAuth &&
  typeof MinecraftAuth !== 'function' &&
  MinecraftAuth.MinecraftAuth
) {
  MinecraftAuth = MinecraftAuth.MinecraftAuth;
}

let AFKController = require('./afk');

if (
  AFKController &&
  typeof AFKController !== 'function' &&
  AFKController.AFKController
) {
  AFKController = AFKController.AFKController;
}

/* =========================================================
   CONFIG
========================================================= */

const MC_HOST =
  process.env.MC_HOST ||
  'mc.fakepixel.me';

const MC_PORT =
  Number(process.env.MC_PORT || 25565);

const MC_VERSION =
  process.env.MC_VERSION ||
  '1.8.9';

const DEFAULT_PASSWORD =
  process.env.DEFAULT_MC_PASSWORD ||
  'vmallu';

const DEFAULT_TARGET =
  process.env.DEFAULT_TARGET ||
  '';

const DEFAULT_DURATION_HOURS =
  Number(
    process.env.DEFAULT_DURATION_HOURS || 12
  );

const DEFAULT_MOVE_INTERVAL =
  Number(
    process.env.DEFAULT_MOVE_INTERVAL || 10000
  );

const DEFAULT_JUMP_INTERVAL =
  Number(
    process.env.DEFAULT_JUMP_INTERVAL || 2500
  );

const DEFAULT_MOVE_DISTANCE =
  Number(
    process.env.AFK_MOVE_DISTANCE || 4
  );

const DEFAULT_RECONNECT_DELAY =
  Number(
    process.env.RECONNECT_DELAY || 5000
  );

const DEFAULT_AUTO_RECONNECT =
  String(
    process.env.AUTO_RECONNECT || 'true'
  ).toLowerCase() !== 'false';

const CHECK_TIMEOUT_INTERVAL =
  Number(
    process.env.CHECK_TIMEOUT_INTERVAL || 120000
  );

const LOCATION_TOLERANCE =
  Number(
    process.env.LOCATION_TOLERANCE || 5
  );

/* =========================================================
   KNOWN FAKEPIXEL LOCATIONS
========================================================= */

const MAIN_SPAWN = new Vec3(
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

const SKYBLOCK_HUB = new Vec3(
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
 * Visible Game Menu slot 21
 *
 * Mineflayer inventory slots are zero-based.
 *
 * 21 visible -> 20 Mineflayer
 */
const GAME_MENU_SKYBLOCK_SLOT = 20;

/*
 * Visible Visit GUI slot 12
 *
 * 12 visible -> 11 Mineflayer
 */
const VISIT_SLOT = 11;

/* =========================================================
   STATES
========================================================= */

const STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  GAME_MENU: 'game-menu',
  WAITING_HUB: 'waiting-hub',
  SKYBLOCK_HUB: 'skyblock-hub',
  VISITING: 'visiting',
  TARGET_ISLAND: 'target-island',
  AFK: 'afk',
  DISCONNECTED: 'disconnected',
  STOPPED: 'stopped',
  ERROR: 'error'
};

/* =========================================================
   CLASS
========================================================= */

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.id =
      config.id ||
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    this.username =
      config.username ||
      '';

    this.password =
      config.password ||
      DEFAULT_PASSWORD;

    this.target =
      config.target ||
      DEFAULT_TARGET;

    this.durationHours =
      Number(
        config.durationHours ||
        DEFAULT_DURATION_HOURS
      );

    this.moveInterval =
      Number(
        config.moveInterval ||
        DEFAULT_MOVE_INTERVAL
      );

    this.jumpInterval =
      Number(
        config.jumpInterval ||
        DEFAULT_JUMP_INTERVAL
      );

    this.moveDistance =
      Number(
        config.moveDistance ||
        DEFAULT_MOVE_DISTANCE
      );

    this.reconnectDelay =
      Number(
        config.reconnectDelay ||
        DEFAULT_RECONNECT_DELAY
      );

    this.autoReconnect =
      config.autoReconnect !== undefined
        ? Boolean(config.autoReconnect)
        : DEFAULT_AUTO_RECONNECT;

    this.enabled =
      config.enabled !== false;

    this.createdAt =
      config.createdAt ||
      new Date().toISOString();

    this.bot = null;

    this.auth = null;
    this.afk = null;

    this.state = STATES.IDLE;
    this.status = 'stopped';

    this.logs = [];

    this.startedAt = null;
    this.connectedAt = null;
    this.afkStartedAt = null;

    this.durationTimer = null;
    this.reconnectTimer = null;

    this.gameMenuTimer = null;
    this.visitTimer = null;
    this.hubTimer = null;
    this.targetTimer = null;

    this.windowOpen = false;
    this.gameMenuOpened = false;
    this.visitOpened = false;

    this.authenticated = false;
    this.skyblockHubReached = false;
    this.targetReached = false;

    this.manualStop = false;
    this.reconnecting = false;

    this.lastPosition = null;
    this.targetStartPosition = null;

    this.lastActionBar = '';
    this.lastActionBarTime = 0;

    this.visitCommandSent = false;

    this.connectAttempts = 0;

    this.log(
      `Created bot ${this.username || this.id}`
    );
  }

  /* =======================================================
     LOGGING
  ======================================================= */

  log(message, level = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: String(message)
    };

    this.logs.push(entry);

    if (this.logs.length > 1000) {
      this.logs.splice(
        0,
        this.logs.length - 1000
      );
    }

    const prefix =
      `[${this.username || this.id}]`;

    if (level === 'error') {
      console.error(
        `${prefix} ${message}`
      );
    } else if (level === 'warn') {
      console.warn(
        `${prefix} ${message}`
      );
    } else {
      console.log(
        `${prefix} ${message}`
      );
    }

    this.emit(
      'log',
      entry
    );
  }

  getLogs(limit = 200) {
    return this.logs.slice(
      -Math.max(
        1,
        Number(limit) || 200
      )
    );
  }

  /* =======================================================
     STATE
  ======================================================= */

  setState(state) {
    this.state = state;

    this.status =
      state === STATES.STOPPED ||
      state === STATES.IDLE
        ? 'stopped'
        : state === STATES.AFK
          ? 'afk'
          : state;

    this.emit(
      'state',
      state
    );
  }

  /* =======================================================
     START
  ======================================================= */

  start() {
    if (!this.username) {
      throw new Error(
        'Minecraft username is required.'
      );
    }

    if (!this.enabled) {
      this.log(
        'Bot is disabled.',
        'warn'
      );

      return;
    }

    this.manualStop = false;
    this.reconnecting = false;

    this.clearReconnectTimer();

    this.clearAllFlowTimers();

    if (this.bot) {
      try {
        this.bot.quit(
          'Restarting bot'
        );
      } catch (_) {}

      this.bot = null;
    }

    this.authenticated = false;
    this.skyblockHubReached = false;
    this.targetReached = false;
    this.gameMenuOpened = false;
    this.visitOpened = false;
    this.visitCommandSent = false;

    this.startedAt =
      Date.now();

    this.connect();
  }

  /* =======================================================
     CONNECT
  ======================================================= */

  connect() {
    if (this.manualStop) {
      return;
    }

    this.clearReconnectTimer();

    this.connectAttempts++;

    this.setState(
      STATES.CONNECTING
    );

    this.log(
      `Connecting to ${MC_HOST}:${MC_PORT} using Minecraft ${MC_VERSION}...`
    );

    try {
      this.bot =
        mineflayer.createBot({
          host: MC_HOST,
          port: MC_PORT,
          username: this.username,
          version: MC_VERSION,

          /*
           * Important for FakePixel timeout issues.
           */
          keepAlive: true,
          checkTimeoutInterval:
            CHECK_TIMEOUT_INTERVAL,

          /*
           * Do not use Microsoft auth.
           * FakePixel account uses server
           * /register and /login.
           */
          auth: 'offline',

          hideErrors: false
        });
    } catch (error) {
      this.log(
        `Failed to create Mineflayer bot: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();

      return;
    }

    this.setupBotEvents();
  }

  /* =======================================================
     BOT EVENTS
  ======================================================= */

  setupBotEvents() {
    if (!this.bot) {
      return;
    }

    this.bot.on(
      'login',
      () => {
        this.log(
          'Minecraft login connection established.'
        );
      }
    );

    this.bot.on(
      'spawn',
      () => {
        this.handleSpawn();
      }
    );

    this.bot.on(
      'kicked',
      reason => {
        this.log(
          `Kicked: ${this.stringifyReason(reason)}`,
          'warn'
        );
      }
    );

    this.bot.on(
      'end',
      reason => {
        this.handleDisconnect(
          reason || 'Connection ended'
        );
      }
    );

    this.bot.on(
      'error',
      error => {
        this.log(
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
      'message',
      message => {
        this.handleChatMessage(
          message
        );
      }
    );

    this.bot.on(
      'actionBar',
      message => {
        this.handleActionBar(
          message
        );
      }
    );

    this.bot.on(
      'windowOpen',
      window => {
        this.handleWindowOpen(
          window
        );
      }
    );

    this.bot.on(
      'windowClose',
      () => {
        this.windowOpen = false;
      }
    );

    this.bot.on(
      'move',
      () => {
        this.updatePosition();
        this.checkTargetArrival();
      }
    );
  }

  /* =======================================================
     SPAWN
  ======================================================= */

  handleSpawn() {
    if (this.manualStop) {
      return;
    }

    this.connectedAt =
      Date.now();

    this.log(
      'FakePixel spawn detected.'
    );

    this.setState(
      STATES.AUTHENTICATING
    );

    this.startAuthentication();
  }

  /* =======================================================
     AUTH
  ======================================================= */

  startAuthentication() {
    if (!this.bot) {
      return;
    }

    /*
     * Clean previous auth handler.
     */
    try {
      if (
        this.auth &&
        typeof this.auth.stop === 'function'
      ) {
        this.auth.stop();
      }
    } catch (_) {}

    try {
      this.auth =
        new MinecraftAuth(
          this.bot,
          {
            password: this.password,
            timeout: 20000
          }
        );
    } catch (error) {
      this.log(
        `Failed to create authentication handler: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();

      return;
    }

    /*
     * This is important:
     * MinecraftAuth extends EventEmitter.
     */
    if (
      !this.auth ||
      typeof this.auth.on !== 'function'
    ) {
      this.log(
        'MinecraftAuth is not an EventEmitter-compatible object.',
        'error'
      );

      this.scheduleReconnect();

      return;
    }

    this.auth.on(
      'authLog',
      message => {
        this.log(
          `[AUTH] ${message}`
        );
      }
    );

    this.auth.on(
      'authenticated',
      () => {
        this.handleAuthenticated();
      }
    );

    this.auth.on(
      'authTimeout',
      error => {
        this.log(
          `Authentication timeout: ${
            error?.message ||
            'unknown error'
          }`,
          'warn'
        );

        /*
         * Some FakePixel connections don't
         * send a useful authentication message.
         *
         * Give the server a little time and
         * continue if still connected.
         */
        setTimeout(() => {
          if (
            !this.manualStop &&
            this.bot &&
            !this.authenticated
          ) {
            this.log(
              'Authentication timeout fallback: continuing to Game Menu.',
              'warn'
            );

            this.handleAuthenticated();
          }
        }, 2500);
      }
    );

    this.auth.on(
      'authError',
      error => {
        this.log(
          `Authentication error: ${
            error?.message ||
            error
          }`,
          'error'
        );
      }
    );

    try {
      if (
        typeof this.auth.start === 'function'
      ) {
        this.auth.start();
      } else {
        this.log(
          'Authentication handler has no start() method.',
          'error'
        );

        this.scheduleReconnect();
      }
    } catch (error) {
      this.log(
        `Authentication start failed: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();
    }
  }

  handleAuthenticated() {
    if (
      this.authenticated ||
      this.manualStop
    ) {
      return;
    }

    this.authenticated = true;

    this.log(
      'Authentication completed.'
    );

    /*
     * Do not start AFK here.
     *
     * We must:
     *
     * Main Hub
     * -> Game Menu
     * -> SkyBlock Hub
     * -> /visit target
     * -> target island
     * -> AFK
     */

    this.beginGameMenuFlow();
  }

  /* =======================================================
     GAME MENU
  ======================================================= */

  beginGameMenuFlow() {
    if (
      this.manualStop ||
      !this.bot
    ) {
      return;
    }

    this.setState(
      STATES.GAME_MENU
    );

    this.gameMenuOpened = false;
    this.skyblockHubReached = false;
    this.targetReached = false;

    this.log(
      'Opening FakePixel Game Menu.'
    );

    this.openGameMenu();
  }

  openGameMenu() {
    if (
      !this.bot ||
      this.manualStop
    ) {
      return;
    }

    try {
      /*
       * Hotbar slot 1 is Mineflayer
       * inventory slot 0.
       */
      this.bot.setQuickBarSlot(0);

      this.log(
        'Selected hotbar slot 1 (Game Menu).'
      );
    } catch (error) {
      this.log(
        `Could not select Game Menu slot: ${error.message}`,
        'warn'
      );
    }

    setTimeout(() => {
      if (
        !this.bot ||
        this.manualStop
      ) {
        return;
      }

      try {
        this.bot.activateItem();

        this.log(
          'Activated Game Menu compass.'
        );
      } catch (error) {
        this.log(
          `Could not activate Game Menu: ${error.message}`,
          'error'
        );
      }
    }, 700);

    /*
     * If FakePixel does not emit windowOpen,
     * try again after a short delay.
     */
    this.gameMenuTimer =
      setTimeout(() => {
        if (
          !this.manualStop &&
          !this.gameMenuOpened &&
          this.bot
        ) {
          this.log(
            'Game Menu window was not detected. Retrying... ',
            'warn'
          );

          try {
            this.bot.activateItem();
          } catch (_) {}

          this.gameMenuTimer =
            setTimeout(() => {
              if (
                !this.gameMenuOpened
              ) {
                this.log(
                  'Game Menu did not open.',
                  'warn'
                );
              }
            }, 3000);
        }
      }, 3500);
  }

  /* =======================================================
     WINDOWS
  ======================================================= */

  handleWindowOpen(window) {
    if (
      !window ||
      this.manualStop
    ) {
      return;
    }

    this.windowOpen = true;

    const title =
      this.getWindowTitle(window);

    this.log(
      `Window opened: ${title || 'unknown'}`
    );

    if (
      this.state === STATES.GAME_MENU
    ) {
      this.handleGameMenuWindow(
        window
      );

      return;
    }

    if (
      this.state === STATES.VISITING
    ) {
      this.handleVisitWindow(
        window
      );

      return;
    }
  }

  getWindowTitle(window) {
    try {
      if (
        window.title &&
        typeof window.title === 'object'
      ) {
        return window.title.text ||
          window.title.translate ||
          JSON.stringify(window.title);
      }

      return String(
        window.title || ''
      );
    } catch (_) {
      return '';
    }
  }

  handleGameMenuWindow(window) {
    if (
      this.gameMenuOpened ||
      this.manualStop
    ) {
      return;
    }

    this.gameMenuOpened = true;

    this.clearTimer(
      'gameMenuTimer'
    );

    this.log(
      'FakePixel Game Menu opened.'
    );

    /*
     * Visible slot 21
     * = Mineflayer slot index 20.
     */
    this.log(
      'Selecting SkyBlock Hub menu slot 21 (index 20).'
    );

    setTimeout(() => {
      this.clickWindow(
        GAME_MENU_SKYBLOCK_SLOT,
        0,
        0
      )
        .then(() => {
          this.log(
            'SkyBlock Hub menu item clicked.'
          );

          this.closeWindowSafe();

          this.waitForSkyblockHub();
        })
        .catch(error => {
          this.log(
            `SkyBlock Hub click failed: ${error.message}`,
            'error'
          );

          /*
           * Retry once using right-click.
           */
          this.clickWindow(
            GAME_MENU_SKYBLOCK_SLOT,
            1,
            0
          )
            .then(() => {
              this.log(
                'SkyBlock Hub clicked with right-click fallback.'
              );

              this.closeWindowSafe();

              this.waitForSkyblockHub();
            })
            .catch(secondError => {
              this.log(
                `SkyBlock Hub fallback failed: ${secondError.message}`,
                'error'
              );

              this.scheduleReconnect();
            });
        });
    }, 500);
  }

  /* =======================================================
     CLICK WINDOW
  ======================================================= */

  clickWindow(
    slot,
    mouseButton = 0,
    mode = 0
  ) {
    return new Promise(
      (resolve, reject) => {
        if (!this.bot) {
          reject(
            new Error(
              'Minecraft bot is not connected.'
            )
          );

          return;
        }

        if (
          typeof this.bot.clickWindow !==
          'function'
        ) {
          reject(
            new Error(
              'Mineflayer clickWindow() is unavailable.'
            )
          );

          return;
        }

        try {
          this.bot.clickWindow(
            Number(slot),
            Number(mouseButton),
            Number(mode),
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

  closeWindowSafe() {
    try {
      if (
        this.bot &&
        typeof this.bot.closeWindow ===
          'function'
      ) {
        this.bot.closeWindow(
          this.bot.currentWindow
        );
      }
    } catch (_) {}

    this.windowOpen = false;
  }

  /* =======================================================
     SKYBLOCK HUB
  ======================================================= */

  waitForSkyblockHub() {
    if (
      this.manualStop ||
      !this.bot
    ) {
      return;
    }

    this.setState(
      STATES.WAITING_HUB
    );

    this.skyblockHubReached = false;

    this.log(
      'Waiting for actual SkyBlock Hub arrival...'
    );

    this.clearTimer(
      'hubTimer'
    );

    let lastLog = 0;

    this.hubTimer =
      setInterval(() => {
        if (
          this.manualStop ||
          !this.bot
        ) {
          return;
        }

        const position =
          this.getPosition();

        if (!position) {
          return;
        }

        const distance =
          this.distance(
            position,
            SKYBLOCK_HUB
          );

        if (
          distance <=
          LOCATION_TOLERANCE
        ) {
          clearInterval(
            this.hubTimer
          );

          this.hubTimer = null;

          this.skyblockHubReached = true;

          this.log(
            `SkyBlock Hub confirmed. Distance: ${distance.toFixed(2)}`
          );

          this.startVisit();

          return;
        }

        const now =
          Date.now();

        if (
          now - lastLog >= 5000
        ) {
          lastLog = now;

          this.log(
            `Waiting for SkyBlock Hub. Distance: ${distance.toFixed(2)}`
          );
        }
      }, 1000);

    /*
     * Safety timeout.
     */
    setTimeout(() => {
      if (
        this.state === STATES.WAITING_HUB &&
        !this.skyblockHubReached &&
        !this.manualStop
      ) {
        this.log(
          'SkyBlock Hub arrival timeout. Rejoining.',
          'warn'
        );

        this.scheduleReconnect();
      }
    }, 30000);
  }

  /* =======================================================
     VISIT
  ======================================================= */

  startVisit() {
    if (
      this.manualStop ||
      !this.bot ||
      !this.skyblockHubReached
    ) {
      return;
    }

    if (!this.target) {
      this.log(
        'No target username configured.',
        'error'
      );

      return;
    }

    this.setState(
      STATES.VISITING
    );

    this.visitOpened = false;
    this.visitCommandSent = true;

    this.log(
      `Sending /visit ${this.target}`
    );

    try {
      this.bot.chat(
        `/visit ${this.target}`
      );
    } catch (error) {
      this.log(
        `Could not send /visit: ${error.message}`,
        'error'
      );

      this.scheduleReconnect();

      return;
    }

    /*
     * Give the server time to open
     * the Visit GUI.
     */
    this.visitTimer =
      setTimeout(() => {
        if (
          !this.visitOpened &&
          this.state === STATES.VISITING &&
          !this.manualStop
        ) {
          this.log(
            'Visit GUI was not detected. Sending /visit again.',
            'warn'
          );

          try {
            this.bot.chat(
              `/visit ${this.target}`
            );
          } catch (_) {}
        }
      }, 4000);

    /*
     * Final visit timeout.
     */
    setTimeout(() => {
      if (
        this.state === STATES.VISITING &&
        !this.targetReached &&
        !this.manualStop
      ) {
        this.log(
          'Visit process timed out. Rejoining.',
          'warn'
        );

        this.scheduleReconnect();
      }
    }, 25000);
  }

  handleVisitWindow(window) {
    if (
      this.visitOpened ||
      this.manualStop
    ) {
      return;
    }

    this.visitOpened = true;

    this.clearTimer(
      'visitTimer'
    );

    this.log(
      'Visit GUI opened.'
    );

    /*
     * Visible slot 12
     * = Mineflayer slot index 11.
     *
     * User specifically wants slot 12.
     */
    this.log(
      'Selecting Visit GUI slot 12 (index 11).'
    );

    setTimeout(() => {
      /*
       * Right-click first as requested.
       */
      this.clickWindow(
        VISIT_SLOT,
        1,
        0
      )
        .then(() => {
          this.log(
            'Visit target clicked with right-click.'
          );

          this.closeWindowSafe();

          this.waitForTargetIsland();
        })
        .catch(error => {
          this.log(
            `Visit right-click failed: ${error.message}`,
            'warn'
          );

          /*
           * Some inventories require left-click.
           */
          this.clickWindow(
            VISIT_SLOT,
            0,
            0
          )
            .then(() => {
              this.log(
                'Visit target clicked with left-click fallback.'
              );

              this.closeWindowSafe();

              this.waitForTargetIsland();
            })
            .catch(secondError => {
              this.log(
                `Visit click failed: ${secondError.message}`,
                'error'
              );

              this.scheduleReconnect();
            });
        });
    }, 500);
  }

  /* =======================================================
     TARGET ISLAND
  ======================================================= */

  waitForTargetIsland() {
    if (
      this.manualStop ||
      !this.bot
    ) {
      return;
    }

    this.setState(
      STATES.TARGET_ISLAND
    );

    this.targetReached = false;

    this.targetStartPosition =
      this.getPosition();

    this.log(
      `Waiting for target island: ${this.target}`
    );

    let lastLog = 0;

    this.clearTimer(
      'targetTimer'
    );

    this.targetTimer =
      setInterval(() => {
        if (
          this.manualStop ||
          !this.bot
        ) {
          return;
        }

        this.checkTargetArrival();

        if (this.targetReached) {
          clearInterval(
            this.targetTimer
          );

          this.targetTimer = null;

          return;
        }

        const position =
          this.getPosition();

        if (!position) {
          return;
        }

        const distanceFromHub =
          this.distance(
            position,
            SKYBLOCK_HUB
          );

        const movedFromStart =
          this.targetStartPosition
            ? this.distance(
                position,
                this.targetStartPosition
              )
            : 0;

        const now =
          Date.now();

        if (
          now - lastLog >= 5000
        ) {
          lastLog = now;

          this.log(
            `Waiting for island. Hub distance: ${distanceFromHub.toFixed(2)}, moved: ${movedFromStart.toFixed(2)}`
          );
        }
      }, 1000);

    /*
     * Target island should normally happen
     * shortly after the Visit click.
     */
    setTimeout(() => {
      if (
        this.state === STATES.TARGET_ISLAND &&
        !this.targetReached &&
        !this.manualStop
      ) {
        this.log(
          'Target island arrival timeout. Rejoining.',
          'warn'
        );

        this.scheduleReconnect();
      }
    }, 30000);
  }

  checkTargetArrival() {
    if (
      this.targetReached ||
      this.manualStop ||
      !this.bot
    ) {
      return;
    }

    if (
      this.state !== STATES.TARGET_ISLAND &&
      this.state !== STATES.VISITING
    ) {
      return;
    }

    const position =
      this.getPosition();

    if (!position) {
      return;
    }

    const distanceFromHub =
      this.distance(
        position,
        SKYBLOCK_HUB
      );

    const movedFromVisitStart =
      this.targetStartPosition
        ? this.distance(
            position,
            this.targetStartPosition
          )
        : 0;

    /*
     * Critical safety rule:
     *
     * Never consider the bot on the target
     * island while it is still at the hub.
     *
     * Need meaningful movement away from
     * SkyBlock Hub.
     */
    const farEnoughFromHub =
      distanceFromHub >= 10;

    const movedEnough =
      movedFromVisitStart >= 8;

    if (
      farEnoughFromHub &&
      (movedEnough || distanceFromHub >= 15)
    ) {
      this.confirmTargetIsland();
    }
  }

  confirmTargetIsland() {
    if (
      this.targetReached ||
      this.manualStop
    ) {
      return;
    }

    this.targetReached = true;

    this.clearTimer(
      'targetTimer'
    );

    this.log(
      `Target island confirmed: ${this.target}`
    );

    this.emit(
      'targetReached',
      {
        target: this.target,
        position: this.getPosition()
      }
    );

    /*
     * Only NOW can AFK begin.
     */
    this.startAfk();
  }

  /* =======================================================
     AFK
  ======================================================= */

  startAfk() {
    if (
      this.manualStop ||
      !this.bot
    ) {
      return;
    }

    /*
     * Absolute safety gate.
     */
    if (!this.targetReached) {
      this.log(
        'AFK blocked: target island has not been confirmed.',
        'warn'
      );

      return;
    }

    this.setState(
      STATES.AFK
    );

    this.afkStartedAt =
      Date.now();

    this.log(
      `Starting AFK on ${this.target}.`
    );

    this.log(
      `Movement: ${this.moveDistance} blocks every ${this.moveInterval}ms.`
    );

    this.log(
      `Jump interval: ${this.jumpInterval}ms.`
    );

    /*
     * Stop previous controller.
     */
    try {
      if (
        this.afk &&
        typeof this.afk.stop === 'function'
      ) {
        this.afk.stop();
      }
    } catch (_) {}

    this.afk = null;

    try {
      this.afk =
        new AFKController(
          this.bot,
          {
            moveInterval:
              this.moveInterval,

            jumpInterval:
              this.jumpInterval,

            moveDistance:
              this.moveDistance
          }
        );
    } catch (error) {
      this.log(
        `Could not create AFK controller: ${error.message}`,
        'error'
      );

      /*
       * Fallback built-in AFK.
       */
      this.startInternalAfk();

      return;
    }

    if (
      this.afk &&
      typeof this.afk.on === 'function'
    ) {
      this.afk.on(
        'log',
        message => {
          this.log(
            `[AFK] ${message}`
          );
        }
      );
    }

    try {
      if (
        this.afk &&
        typeof this.afk.start === 'function'
      ) {
        this.afk.start();
      } else {
        this.startInternalAfk();
      }
    } catch (error) {
      this.log(
        `AFK controller failed: ${error.message}`,
        'error'
      );

      this.startInternalAfk();
    }

    this.startDurationTimer();
  }

  startInternalAfk() {
    /*
     * This fallback is intentionally simple.
     */
    this.stopInternalAfk();

    this.internalMoveTimer =
      setInterval(() => {
        if (
          this.manualStop ||
          !this.bot ||
          !this.targetReached
        ) {
          return;
        }

        this.moveForwardBackward();
      }, Math.max(
        5000,
        this.moveInterval
      ));

    this.internalJumpTimer =
      setInterval(() => {
        if (
          this.manualStop ||
          !this.bot ||
          !this.targetReached
        ) {
          return;
        }

        this.jump();
      }, Math.max(
        1500,
        this.jumpInterval
      ));

    this.log(
      'Using built-in AFK controller.'
    );

    this.moveForwardBackward();
    this.jump();
  }

  stopInternalAfk() {
    if (this.internalMoveTimer) {
      clearInterval(
        this.internalMoveTimer
      );

      this.internalMoveTimer = null;
    }

    if (this.internalJumpTimer) {
      clearInterval(
        this.internalJumpTimer
      );

      this.internalJumpTimer = null;
    }
  }

  moveForwardBackward() {
    if (
      !this.bot ||
      !this.targetReached
    ) {
      return;
    }

    try {
      this.bot.setControlState(
        'forward',
        true
      );

      setTimeout(() => {
        if (!this.bot) {
          return;
        }

        try {
          this.bot.setControlState(
            'forward',
            false
          );
        } catch (_) {}

        setTimeout(() => {
          if (!this.bot) {
            return;
          }

          try {
            this.bot.setControlState(
              'back',
              true
            );
          } catch (_) {}

          setTimeout(() => {
            if (!this.bot) {
              return;
            }

            try {
              this.bot.setControlState(
                'back',
                false
              );
            } catch (_) {}
          }, 1200);
        }, 700);
      }, 1200);
    } catch (error) {
      this.log(
        `AFK movement error: ${error.message}`,
        'warn'
      );
    }
  }

  jump() {
    if (
      !this.bot ||
      !this.targetReached
    ) {
      return;
    }

    try {
      this.bot.setControlState(
        'jump',
        true
      );

      setTimeout(() => {
        if (!this.bot) {
          return;
        }

        try {
          this.bot.setControlState(
            'jump',
            false
          );
        } catch (_) {}
      }, 350);
    } catch (_) {}
  }

  /* =======================================================
     DURATION
  ======================================================= */

  startDurationTimer() {
    this.clearTimer(
      'durationTimer'
    );

    const hours =
      Number(this.durationHours);

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      return;
    }

    const milliseconds =
      hours * 60 * 60 * 1000;

    this.log(
      `Session duration: ${hours} hour(s).`
    );

    this.durationTimer =
      setTimeout(() => {
        if (this.manualStop) {
          return;
        }

        this.log(
          'Configured session duration reached.'
        );

        this.stop();

        this.emit(
          'durationComplete'
        );
      }, milliseconds);
  }

  /* =======================================================
     DISCONNECT
  ======================================================= */

  handleDisconnect(reason) {
    this.connectedAt = null;

    this.stopAfkOnly();

    this.clearAllFlowTimers();

    this.bot = null;

    this.authenticated = false;
    this.skyblockHubReached = false;
    this.targetReached = false;
    this.gameMenuOpened = false;
    this.visitOpened = false;
    this.visitCommandSent = false;

    if (this.manualStop) {
      this.setState(
        STATES.STOPPED
      );

      this.log(
        `Disconnected: ${this.stringifyReason(reason)}`
      );

      return;
    }

    this.setState(
      STATES.DISCONNECTED
    );

    this.log(
      `Disconnected: ${this.stringifyReason(reason)}`,
      'warn'
    );

    if (this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (
      this.manualStop ||
      !this.autoReconnect
    ) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.setState(
      STATES.DISCONNECTED
    );

    this.reconnecting = true;

    this.log(
      `Reconnecting in ${this.reconnectDelay}ms...`
    );

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnecting = false;

        if (
          !this.manualStop
        ) {
          /*
           * Full flow starts again:
           *
           * connect
           * auth
           * Game Menu
           * SkyBlock Hub
           * visit
           * target
           * AFK
           */
          this.connect();
        }
      }, Math.max(
        1000,
        this.reconnectDelay
      ));
  }

  rejoin() {
    this.log(
      'Manual rejoin requested.'
    );

    this.manualStop = false;

    this.clearReconnectTimer();
    this.clearAllFlowTimers();

    this.stopAfkOnly();

    if (this.bot) {
      try {
        this.bot.quit(
          'Manual rejoin'
        );
      } catch (_) {}
    }

    this.bot = null;

    this.authenticated = false;
    this.skyblockHubReached = false;
    this.targetReached = false;

    setTimeout(() => {
      if (!this.manualStop) {
        this.connect();
      }
    }, 500);
  }

  /* =======================================================
     STOP
  ======================================================= */

  stop() {
    this.manualStop = true;

    this.clearReconnectTimer();
    this.clearAllFlowTimers();

    this.stopAfkOnly();

    try {
      if (
        this.auth &&
        typeof this.auth.stop === 'function'
      ) {
        this.auth.stop();
      }
    } catch (_) {}

    this.auth = null;

    if (this.bot) {
      try {
        this.bot.clearControlStates();
      } catch (_) {}

      try {
        this.bot.quit(
          'Bot stopped'
        );
      } catch (_) {}
    }

    this.bot = null;

    this.authenticated = false;
    this.skyblockHubReached = false;
    this.targetReached = false;

    this.setState(
      STATES.STOPPED
    );

    this.log(
      'Bot stopped.'
    );
  }

  restart() {
    this.log(
      'Restart requested.'
    );

    this.stop();

    setTimeout(() => {
      this.start();
    }, 500);
  }

  /* =======================================================
     AFK STOP
  ======================================================= */

  stopAfkOnly() {
    this.stopInternalAfk();

    if (
      this.afk &&
      typeof this.afk.stop === 'function'
    ) {
      try {
        this.afk.stop();
      } catch (_) {}
    }

    this.afk = null;
  }

  /* =======================================================
     CHAT
  ======================================================= */

  chat(message) {
    if (
      !this.bot ||
      typeof this.bot.chat !== 'function'
    ) {
      throw new Error(
        'Minecraft bot is not connected.'
      );
    }

    this.bot.chat(
      String(message)
    );
  }

  /* =======================================================
     MESSAGE HANDLING
  ======================================================= */

  handleChatMessage(message) {
    let text = '';

    try {
      if (
        typeof message === 'string'
      ) {
        text = message;
      } else if (
        message &&
        typeof message.toString ===
          'function'
      ) {
        text = message.toString();
      }
    } catch (_) {}

    if (!text) {
      return;
    }

    const clean =
      text
        .replace(
          /§[0-9a-fk-or]/gi,
          ''
        )
        .trim();

    /*
     * Avoid logging huge repeated
     * action-bar-like messages as chat.
     */
    if (
      clean.includes('100/100') &&
      clean.toLowerCase().includes('mana')
    ) {
      return;
    }

    this.log(
      `[CHAT] ${clean}`
    );

    const lower =
      clean.toLowerCase();

    /*
     * Useful indication that the server
     * accepted the visit.
     */
    if (
      lower.includes(
        `visiting ${this.target.toLowerCase()}`
      ) ||
      lower.includes(
        `${this.target.toLowerCase()}'s island`
      )
    ) {
      this.log(
        `Server confirmed visit to ${this.target}.`
      );
    }
  }

  handleActionBar(message) {
    let text = '';

    try {
      if (
        typeof message === 'string'
      ) {
        text = message;
      } else if (
        message &&
        typeof message.toString ===
          'function'
      ) {
        text = message.toString();
      }
    } catch (_) {}

    if (!text) {
      return;
    }

    const now =
      Date.now();

    /*
     * Filter repeated FakePixel
     * health/mana action-bar spam.
     */
    if (
      text === this.lastActionBar &&
      now - this.lastActionBarTime <
        3000
    ) {
      return;
    }

    this.lastActionBar = text;
    this.lastActionBarTime = now;

    if (
      !(
        text.includes('100/100') &&
        text.toLowerCase().includes('mana')
      )
    ) {
      this.log(
        `[ACTION] ${text}`
      );
    }
  }

  /* =======================================================
     POSITION
  ======================================================= */

  getPosition() {
    if (
      !this.bot ||
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return null;
    }

    const p =
      this.bot.entity.position;

    try {
      return new Vec3(
        Number(p.x),
        Number(p.y),
        Number(p.z)
      );
    } catch (_) {
      return null;
    }
  }

  updatePosition() {
    const position =
      this.getPosition();

    if (!position) {
      return;
    }

    this.lastPosition = {
      x: position.x,
      y: position.y,
      z: position.z
    };
  }

  distance(a, b) {
    if (!a || !b) {
      return Infinity;
    }

    try {
      const av =
        a instanceof Vec3
          ? a
          : new Vec3(
              Number(a.x),
              Number(a.y),
              Number(a.z)
            );

      const bv =
        b instanceof Vec3
          ? b
          : new Vec3(
              Number(b.x),
              Number(b.y),
              Number(b.z)
            );

      return av.distanceTo(bv);
    } catch (_) {
      return Infinity;
    }
  }

  /* =======================================================
     PUBLIC INFO
  ======================================================= */

  getPublicInfo() {
    const position =
      this.getPosition();

    return {
      id: this.id,

      username:
        this.username,

      target:
        this.target,

      status:
        this.status,

      state:
        this.state,

      connected:
        Boolean(this.bot),

      authenticated:
        this.authenticated,

      skyblockHubReached:
        this.skyblockHubReached,

      targetReached:
        this.targetReached,

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

      enabled:
        this.enabled,

      createdAt:
        this.createdAt,

      startedAt:
        this.startedAt,

      connectedAt:
        this.connectedAt,

      uptime:
        this.startedAt
          ? Date.now() -
            this.startedAt
          : 0,

      position:
        position
          ? {
              x: Number(
                position.x.toFixed(3)
              ),
              y: Number(
                position.y.toFixed(3)
              ),
              z: Number(
                position.z.toFixed(3)
              )
            }
          : null
    };
  }

  getInfo() {
    return this.getPublicInfo();
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
      autoReconnect: this.autoReconnect,
      enabled: this.enabled,
      createdAt: this.createdAt
    };
  }

  updateConfig(updates = {}) {
    if (
      updates.username !== undefined
    ) {
      this.username =
        String(updates.username).trim();
    }

    if (
      updates.password !== undefined
    ) {
      this.password =
        String(updates.password);
    }

    if (
      updates.target !== undefined
    ) {
      this.target =
        String(updates.target).trim();
    }

    if (
      updates.durationHours !== undefined
    ) {
      this.durationHours =
        Number(
          updates.durationHours
        );
    }

    if (
      updates.moveInterval !== undefined
    ) {
      this.moveInterval =
        Number(
          updates.moveInterval
        );
    }

    if (
      updates.jumpInterval !== undefined
    ) {
      this.jumpInterval =
        Number(
          updates.jumpInterval
        );
    }

    if (
      updates.moveDistance !== undefined
    ) {
      this.moveDistance =
        Number(
          updates.moveDistance
        );
    }

    if (
      updates.reconnectDelay !== undefined
    ) {
      this.reconnectDelay =
        Number(
          updates.reconnectDelay
        );
    }

    if (
      updates.autoReconnect !== undefined
    ) {
      this.autoReconnect =
        Boolean(
          updates.autoReconnect
        );
    }

    if (
      updates.enabled !== undefined
    ) {
      this.enabled =
        Boolean(
          updates.enabled
        );
    }

    this.log(
      'Bot configuration updated.'
    );

    this.emit(
      'config',
      this.getConfig()
    );

    return this.getConfig();
  }

  /* =======================================================
     TIMER HELPERS
  ======================================================= */

  clearTimer(name) {
    if (
      this[name]
    ) {
      clearTimeout(
        this[name]
      );

      clearInterval(
        this[name]
      );

      this[name] = null;
    }
  }

  clearAllFlowTimers() {
    this.clearTimer(
      'durationTimer'
    );

    this.clearTimer(
      'reconnectTimer'
    );

    this.clearTimer(
      'gameMenuTimer'
    );

    this.clearTimer(
      'visitTimer'
    );

    this.clearTimer(
      'hubTimer'
    );

    this.clearTimer(
      'targetTimer'
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

    this.reconnecting = false;
  }

  /* =======================================================
     UTILITIES
  ======================================================= */

  stringifyReason(reason) {
    try {
      if (
        typeof reason === 'string'
      ) {
        return reason;
      }

      if (
        reason &&
        typeof reason.toString ===
          'function'
      ) {
        return reason.toString();
      }

      return JSON.stringify(
        reason
      );
    } catch (_) {
      return 'Unknown reason';
    }
  }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = FakePixelBot;
module.exports.FakePixelBot =
  FakePixelBot;
