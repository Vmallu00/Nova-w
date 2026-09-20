'use strict';

const mineflayer = require('mineflayer');
const Vec3 = require('vec3');
const EventEmitter = require('events');

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

/*
|--------------------------------------------------------------------------
| Environment
|--------------------------------------------------------------------------
*/

const MC_HOST = process.env.MC_HOST || 'mc.fakepixel.me';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.8.9';

const DEFAULT_PASSWORD =
  process.env.DEFAULT_MC_PASSWORD || 'vmallu';

const DEFAULT_TARGET =
  process.env.DEFAULT_TARGET || 'v_mallu_gamer';

const DEFAULT_DURATION =
  Number(process.env.DEFAULT_DURATION_HOURS || 12);

const DEFAULT_MOVE_INTERVAL =
  Number(process.env.DEFAULT_MOVE_INTERVAL || 10000);

const DEFAULT_JUMP_INTERVAL =
  Number(process.env.DEFAULT_JUMP_INTERVAL || 2500);

const DEFAULT_MOVE_DISTANCE =
  Number(process.env.AFK_MOVE_DISTANCE || 4);

const DEFAULT_RECONNECT_DELAY =
  Number(process.env.RECONNECT_DELAY || 5000);

const CHECK_TIMEOUT_INTERVAL =
  Number(process.env.CHECK_TIMEOUT_INTERVAL || 120000);

const LOCATION_TOLERANCE =
  Number(process.env.LOCATION_TOLERANCE || 5);

/*
|--------------------------------------------------------------------------
| Known FakePixel locations
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Inventory slots
|--------------------------------------------------------------------------
|
| Visible slot 21 = Mineflayer slot 20
| Visible slot 12 = Mineflayer slot 11
|
*/

const GAME_MENU_SKYBLOCK_SLOT = 20;
const VISIT_SLOT = 11;

/*
|--------------------------------------------------------------------------
| Timing
|--------------------------------------------------------------------------
*/

const AUTH_TIMEOUT = 30000;
const LOBBY_WAIT_TIMEOUT = 45000;
const GAME_MENU_TIMEOUT = 20000;
const SKYBLOCK_HUB_TIMEOUT = 45000;
const VISIT_GUI_TIMEOUT = 20000;
const TARGET_TIMEOUT = 60000;

const MENU_RETRY_DELAY = 3000;
const VISIT_RETRY_DELAY = 3000;

/*
|--------------------------------------------------------------------------
| FakePixelBot
|--------------------------------------------------------------------------
*/

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.id = config.id || null;

    this.username =
      config.username ||
      config.name ||
      '';

    this.password =
      config.password ||
      DEFAULT_PASSWORD;

    this.target =
      config.target ||
      config.targetUsername ||
      DEFAULT_TARGET;

    this.duration =
      Number(config.duration || DEFAULT_DURATION);

    this.moveInterval =
      Number(config.moveInterval || DEFAULT_MOVE_INTERVAL);

    this.jumpInterval =
      Number(config.jumpInterval || DEFAULT_JUMP_INTERVAL);

    this.moveDistance =
      Number(config.moveDistance || DEFAULT_MOVE_DISTANCE);

    this.autoReconnect =
      config.autoReconnect !== false;

    this.reconnectDelay =
      Number(config.reconnectDelay || DEFAULT_RECONNECT_DELAY);

    this.bot = null;
    this.auth = null;
    this.afk = null;

    this.state = 'idle';

    this.startedAt = null;
    this.connectedAt = null;

    this.targetReached = false;
    this.authenticated = false;
    this.lobbyReached = false;
    this.skyblockHubReached = false;

    this.gameMenuOpened = false;
    this.visitGuiOpened = false;

    this.connecting = false;
    this.stopping = false;

    this.reconnectTimer = null;
    this.durationTimer = null;

    this.authTimer = null;
    this.lobbyTimer = null;
    this.menuTimer = null;
    this.hubTimer = null;
    this.visitTimer = null;
    this.targetTimer = null;

    this.menuRetryTimer = null;
    this.visitRetryTimer = null;

    this.internalMoveTimer = null;
    this.internalJumpTimer = null;

    this.lastPosition = null;
    this.visitStartPosition = null;

    this.logs = [];

    this.messageHandlerAttached = false;

    this.addLog(
      `[INIT] ${this.username || 'Bot'} initialized`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Logging
  |--------------------------------------------------------------------------
  */

  addLog(message, type = 'info') {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;

    this.logs.push({
      time: new Date().toISOString(),
      type,
      message: line
    });

    if (this.logs.length > 500) {
      this.logs.shift();
    }

    console.log(`[${this.username || 'BOT'}] ${message}`);

    this.emit('log', {
      type,
      message: line
    });
  }

  /*
  |--------------------------------------------------------------------------
  | State
  |--------------------------------------------------------------------------
  */

  setState(state) {
    this.state = state;

    this.addLog(`[STATE] ${state}`);

    this.emit('state', state);
    this.emit('status', this.getInfo());
  }

  /*
  |--------------------------------------------------------------------------
  | Start
  |--------------------------------------------------------------------------
  */

  async start() {
    if (this.stopping) {
      this.stopping = false;
    }

    if (
      this.bot &&
      this.state !== 'disconnected' &&
      this.state !== 'stopped' &&
      this.state !== 'error'
    ) {
      this.addLog('Bot is already running.');
      return;
    }

    this.clearReconnect();

    this.startedAt = Date.now();

    this.resetFlow();

    await this.connect();
  }

  /*
  |--------------------------------------------------------------------------
  | Reset flow
  |--------------------------------------------------------------------------
  */

  resetFlow() {
    this.authenticated = false;
    this.lobbyReached = false;
    this.skyblockHubReached = false;
    this.targetReached = false;

    this.gameMenuOpened = false;
    this.visitGuiOpened = false;

    this.visitStartPosition = null;

    this.clearFlowTimers();
  }

  /*
  |--------------------------------------------------------------------------
  | Connect
  |--------------------------------------------------------------------------
  */

  async connect() {
    if (this.connecting) {
      return;
    }

    this.connecting = true;
    this.stopping = false;

    this.setState('connecting');

    this.addLog(
      `Connecting to ${MC_HOST}:${MC_PORT} as ${this.username}`
    );

    try {
      this.bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: this.username,
        version: MC_VERSION,

        /*
         * Important for FakePixel.
         */
        auth: 'offline',

        keepAlive: true,

        checkTimeoutInterval:
          CHECK_TIMEOUT_INTERVAL,

        hideErrors: false
      });

      this.setupBotEvents();

    } catch (error) {
      this.connecting = false;

      this.addLog(
        `Connection creation error: ${error.message}`,
        'error'
      );

      this.setState('error');

      this.scheduleReconnect();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Bot events
  |--------------------------------------------------------------------------
  */

  setupBotEvents() {
    if (!this.bot) {
      return;
    }

    this.bot.once('login', () => {
      this.connectedAt = Date.now();
      this.connecting = false;

      this.addLog('[LOGIN] Minecraft connection established');

      this.emit('status', this.getInfo());
    });

    this.bot.once('spawn', () => {
      this.addLog(
        `[SPAWN] Spawn event received at ${this.positionString()}`
      );

      /*
       * Do NOT immediately open the Game Menu.
       *
       * FakePixel can fire spawn before the lobby is completely
       * ready. We first authenticate and then wait for the actual
       * lobby position.
       */
      this.startAuthentication();
    });

    this.bot.on('message', (message) => {
      this.handleChatMessage(message);
    });

    this.bot.on('actionBar', (message) => {
      if (!message) {
        return;
      }

      const text = this.toPlainText(message);

      /*
       * Do not spam the panel with action-bar messages.
       */
      if (
        text &&
        !/mana|health|defense|speed/i.test(text)
      ) {
        this.emit('actionBar', text);
      }
    });

    this.bot.on('move', () => {
      this.updatePosition();

      /*
       * Once authenticated, movement is one of the strongest
       * indicators that the server has actually loaded the lobby.
       */
      if (
        !this.lobbyReached &&
        this.isNear(MAIN_SPAWN, LOCATION_TOLERANCE + 5)
      ) {
        this.confirmLobby();
      }

      if (
        this.state === 'waiting-hub' &&
        this.isNear(SKYBLOCK_HUB, LOCATION_TOLERANCE)
      ) {
        this.confirmSkyblockHub();
      }

      if (
        this.state === 'visiting' ||
        this.state === 'target-island'
      ) {
        this.checkTargetIsland();
      }
    });

    this.bot.on('windowOpen', (window) => {
      this.handleWindowOpen(window);
    });

    this.bot.on('windowClose', (window) => {
      if (!window) {
        return;
      }

      const title = this.getWindowTitle(window);

      this.addLog(
        `Window closed: "${title || 'unknown'}"`
      );

      if (this.state === 'game-menu') {
        this.gameMenuOpened = false;
      }

      if (this.state === 'visiting') {
        this.visitGuiOpened = false;
      }
    });

    this.bot.on('kicked', (reason) => {
      const text = this.toPlainText(reason);

      this.addLog(
        `[KICKED] ${text || 'Unknown reason'}`,
        'error'
      );
    });

    this.bot.on('error', (error) => {
      this.addLog(
        `[ERROR] ${error.message}`,
        'error'
      );

      this.emit('error', error);
    });

    this.bot.on('end', (reason) => {
      this.handleDisconnect(reason);
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Chat / authentication detection
  |--------------------------------------------------------------------------
  */

  handleChatMessage(message) {
    const text = this.toPlainText(message);

    if (!text) {
      return;
    }

    this.addLog(`[CHAT] ${text}`);

    this.emit('chat', text);

    /*
     * FakePixel lobby indication.
     */
    if (
      /spooked into the lobby/i.test(text) ||
      /into the lobby/i.test(text) ||
      /lobby/i.test(text) &&
      (
        this.state === 'authenticating' ||
        this.state === 'connecting'
      )
    ) {
      this.addLog(
        '[AUTH] Server indicates that the player is in the lobby.'
      );

      this.markLobbyReached();
    }

    /*
     * Registration/login prompts.
     */
    const lower = text.toLowerCase();

    if (
      lower.includes('register') &&
      (
        lower.includes('/register') ||
        lower.includes('please register') ||
        lower.includes('register your')
      )
    ) {
      this.sendRegister();
      return;
    }

    if (
      lower.includes('login') &&
      (
        lower.includes('/login') ||
        lower.includes('please login') ||
        lower.includes('log in')
      )
    ) {
      this.sendLogin();
      return;
    }

    /*
     * Authentication success messages.
     */
    if (
      /logged in successfully/i.test(text) ||
      /login successful/i.test(text) ||
      /successfully logged/i.test(text) ||
      /registration successful/i.test(text) ||
      /registered successfully/i.test(text)
    ) {
      this.markAuthenticated();
    }

    /*
     * Some servers don't provide a useful success message.
     * If the bot is already physically in the main lobby, that
     * is enough to continue.
     */
    if (
      this.state === 'authenticating' &&
      this.isNear(MAIN_SPAWN, LOCATION_TOLERANCE + 5)
    ) {
      this.addLog(
        '[AUTH] Lobby position detected; treating authentication as complete.'
      );

      this.markAuthenticated();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  startAuthentication() {
    if (!this.bot) {
      return;
    }

    if (this.authenticated) {
      this.waitForLobby();
      return;
    }

    this.setState('authenticating');

    this.addLog(
      '[AUTH] Waiting for FakePixel authentication.'
    );

    /*
     * Create auth helper if available.
     */
    try {
      if (MinecraftAuth) {
        this.auth = new MinecraftAuth(this.bot, {
          password: this.password,

          /*
           * Give the helper enough time, but DO NOT let its timeout
           * kill the whole bot. FakePixel can authenticate while
           * not sending a standard authentication message.
           */
          timeout: AUTH_TIMEOUT
        });

        if (this.auth && typeof this.auth.on === 'function') {
          this.auth.on('authLog', (message) => {
            this.addLog(`[AUTH] ${message}`);
          });

          this.auth.on('authenticated', () => {
            this.markAuthenticated();
          });

          this.auth.on('authTimeout', () => {
            this.addLog(
              '[AUTH] Auth helper timed out. Continuing to watch the lobby instead of disconnecting.',
              'info'
            );

            /*
             * IMPORTANT:
             * Do NOT set error here.
             * FakePixel may already have logged us in.
             */
            this.waitForLobby();
          });

          this.auth.on('authError', (error) => {
            this.addLog(
              `[AUTH] ${error.message || error}`,
              'error'
            );
          });
        }

        if (
          this.auth &&
          typeof this.auth.start === 'function'
        ) {
          this.auth.start();
        }
      }
    } catch (error) {
      this.addLog(
        `[AUTH] Auth helper error: ${error.message}`,
        'error'
      );
    }

    /*
     * Independent safety timer.
     *
     * This timer NEVER disconnects the bot.
     * It only moves the flow forward if the lobby has already
     * been reached.
     */
    this.clearTimer('authTimer');

    this.authTimer = setTimeout(() => {
      this.authTimer = null;

      if (
        this.state === 'authenticating' ||
        this.state === 'connecting'
      ) {
        this.addLog(
          '[AUTH] Authentication wait expired; checking lobby position.'
        );

        if (
          this.isNear(
            MAIN_SPAWN,
            LOCATION_TOLERANCE + 8
          )
        ) {
          this.addLog(
            '[AUTH] Main lobby detected. Authentication considered complete.'
          );

          this.markAuthenticated();
        } else {
          /*
           * Do not immediately fail.
           * Continue waiting for FakePixel.
           */
          this.addLog(
            '[AUTH] Lobby not detected yet. Continuing to wait.'
          );

          this.waitForLobby();
        }
      }
    }, AUTH_TIMEOUT);
  }

  sendRegister() {
    if (!this.bot) {
      return;
    }

    this.addLog(
      '[AUTH] Sending /register command.'
    );

    try {
      this.bot.chat(
        `/register ${this.password} ${this.password}`
      );
    } catch (error) {
      this.addLog(
        `[AUTH] Register error: ${error.message}`,
        'error'
      );
    }
  }

  sendLogin() {
    if (!this.bot) {
      return;
    }

    this.addLog(
      '[AUTH] Sending /login command.'
    );

    try {
      this.bot.chat(
        `/login ${this.password}`
      );
    } catch (error) {
      this.addLog(
        `[AUTH] Login error: ${error.message}`,
        'error'
      );
    }
  }

  markAuthenticated() {
    if (this.authenticated) {
      this.waitForLobby();
      return;
    }

    this.authenticated = true;

    this.clearTimer('authTimer');

    this.addLog(
      '[AUTH] Authentication accepted.'
    );

    this.waitForLobby();
  }

  /*
  |--------------------------------------------------------------------------
  | Lobby detection
  |--------------------------------------------------------------------------
  */

  waitForLobby() {
    if (!this.bot) {
      return;
    }

    if (this.lobbyReached) {
      this.beginGameMenuFlow();
      return;
    }

    this.setState('waiting-lobby');

    this.addLog(
      '[LOBBY] Waiting until the bot is actually in the main FakePixel lobby.'
    );

    this.clearTimer('lobbyTimer');

    /*
     * Check immediately.
     */
    this.checkLobby();

    /*
     * Keep checking because FakePixel can take several seconds.
     */
    this.lobbyTimer = setInterval(() => {
      this.checkLobby();
    }, 1000);
  }

  checkLobby() {
    if (!this.bot) {
      return;
    }

    const position = this.bot.entity
      ? this.bot.entity.position
      : null;

    if (!position) {
      return;
    }

    if (
      this.isNear(
        MAIN_SPAWN,
        LOCATION_TOLERANCE + 8
      )
    ) {
      this.confirmLobby();
      return;
    }

    /*
     * Chat detection can also confirm lobby.
     */
    if (
      this.authenticated &&
      (
        this.state === 'waiting-lobby' ||
        this.state === 'authenticating'
      )
    ) {
      /*
       * We don't blindly assume every position is lobby.
       * Wait for a real movement/spawn signal.
       */
    }
  }

  confirmLobby() {
    if (this.lobbyReached) {
      return;
    }

    this.lobbyReached = true;

    this.clearTimer('lobbyTimer');
    this.clearTimer('authTimer');

    this.addLog(
      `[LOBBY] Main FakePixel lobby confirmed at ${this.positionString()}.`
    );

    this.emit('lobby', true);

    /*
     * Give the inventory/server a moment to fully load.
     */
    this.setState('waiting-game-menu');

    setTimeout(() => {
      if (
        this.bot &&
        !this.stopping &&
        this.lobbyReached
      ) {
        this.beginGameMenuFlow();
      }
    }, 2000);
  }

  markLobbyReached() {
    if (this.lobbyReached) {
      return;
    }

    this.markAuthenticated();

    this.confirmLobby();
  }

  /*
  |--------------------------------------------------------------------------
  | Game Menu
  |--------------------------------------------------------------------------
  */

  beginGameMenuFlow() {
    if (!this.bot || this.stopping) {
      return;
    }

    if (!this.lobbyReached) {
      this.waitForLobby();
      return;
    }

    if (this.skyblockHubReached) {
      this.startVisit();
      return;
    }

    this.setState('game-menu');

    this.gameMenuOpened = false;

    this.addLog(
      '[MENU] Preparing to open FakePixel Game Menu.'
    );

    /*
     * Close an old window if one exists.
     */
    try {
      if (
        this.bot.currentWindow &&
        typeof this.bot.closeWindow === 'function'
      ) {
        this.bot.closeWindow(
          this.bot.currentWindow
        );
      }
    } catch (_) {
      // Ignore old window close errors.
    }

    /*
     * Game Menu compass is normally hotbar slot 1.
     */
    try {
      if (
        typeof this.bot.setQuickBarSlot === 'function'
      ) {
        this.bot.setQuickBarSlot(0);
      }
    } catch (error) {
      this.addLog(
        `[MENU] Could not select Game Menu slot: ${error.message}`,
        'error'
      );
    }

    /*
     * Wait before activating.
     */
    setTimeout(() => {
      this.tryOpenGameMenu();
    }, 1200);
  }

  tryOpenGameMenu() {
    if (!this.bot || this.stopping) {
      return;
    }

    if (this.skyblockHubReached) {
      this.startVisit();
      return;
    }

    this.addLog(
      '[MENU] Using Game Menu compass.'
    );

    try {
      /*
       * Mineflayer's activateItem uses the currently held item.
       */
      this.bot.activateItem();
    } catch (error) {
      this.addLog(
        `[MENU] activateItem error: ${error.message}`,
        'error'
      );
    }

    /*
     * IMPORTANT:
     * We wait for windowOpen rather than assuming that activateItem
     * immediately produced a window.
     */
    this.clearTimer('menuTimer');

    this.menuTimer = setTimeout(() => {
      this.menuTimer = null;

      if (this.gameMenuOpened) {
        return;
      }

      /*
       * Sometimes FakePixel opens the window slightly later.
       * Retry rather than declaring failure.
       */
      this.addLog(
        '[MENU] Game Menu window not detected yet. Retrying.'
      );

      this.scheduleGameMenuRetry();

    }, GAME_MENU_TIMEOUT);
  }

  scheduleGameMenuRetry() {
    this.clearTimer('menuRetryTimer');

    this.menuRetryTimer = setTimeout(() => {
      this.menuRetryTimer = null;

      if (
        this.bot &&
        !this.stopping &&
        this.state === 'game-menu'
      ) {
        this.tryOpenGameMenu();
      }
    }, MENU_RETRY_DELAY);
  }

  handleGameMenuWindow(window) {
    if (!window || !this.bot) {
      return;
    }

    const title = this.getWindowTitle(window);

    this.addLog(
      `[MENU] Window opened: "${title}"`
    );

    /*
     * FakePixel may report different title formatting.
     */
    const looksLikeGameMenu =
      /game\s*menu/i.test(title) ||
      /skyblock/i.test(title) ||
      /menu/i.test(title);

    if (!looksLikeGameMenu) {
      return;
    }

    this.gameMenuOpened = true;

    this.clearTimer('menuTimer');
    this.clearTimer('menuRetryTimer');

    this.addLog(
      '[MENU] Game Menu successfully detected.'
    );

    /*
     * Give the inventory a tiny moment to populate.
     */
    setTimeout(() => {
      this.clickSkyblockMenuItem(window);
    }, 500);
  }

  clickSkyblockMenuItem(window) {
    if (!this.bot || !window) {
      return;
    }

    const slot = GAME_MENU_SKYBLOCK_SLOT;

    this.addLog(
      `[MENU] Clicking SkyBlock Hub visible slot 21 (Mineflayer index ${slot}).`
    );

    /*
     * Make sure the slot exists.
     */
    if (
      !window.slots ||
      !window.slots[slot]
    ) {
      this.addLog(
        '[MENU] SkyBlock Hub slot 21 is not populated yet. Waiting and retrying.'
      );

      setTimeout(() => {
        if (
          this.bot &&
          this.bot.currentWindow === window
        ) {
          this.clickSkyblockMenuItem(window);
        }
      }, 1000);

      return;
    }

    /*
     * Left-click is normally used for the Game Menu.
     */
    try {
      this.bot.clickWindow(
        slot,
        0,
        0,
        (error) => {
          if (error) {
            this.addLog(
              `[MENU] SkyBlock click failed: ${error.message}`,
              'error'
            );

            /*
             * Try right-click as fallback.
             */
            this.clickSkyblockRight(window);
            return;
          }

          this.addLog(
            '[MENU] SkyBlock Hub selection sent.'
          );

          this.waitForSkyblockHub();
        }
      );
    } catch (error) {
      this.addLog(
        `[MENU] SkyBlock click exception: ${error.message}`,
        'error'
      );

      this.clickSkyblockRight(window);
    }
  }

  clickSkyblockRight(window) {
    if (!this.bot || !window) {
      return;
    }

    const slot = GAME_MENU_SKYBLOCK_SLOT;

    try {
      this.bot.clickWindow(
        slot,
        0,
        1,
        (error) => {
          if (error) {
            this.addLog(
              `[MENU] Right-click fallback failed: ${error.message}`,
              'error'
            );
            return;
          }

          this.addLog(
            '[MENU] SkyBlock Hub right-click fallback sent.'
          );

          this.waitForSkyblockHub();
        }
      );
    } catch (error) {
      this.addLog(
        `[MENU] Right-click exception: ${error.message}`,
        'error'
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Window handler
  |--------------------------------------------------------------------------
  */

  handleWindowOpen(window) {
    if (!window) {
      return;
    }

    const title = this.getWindowTitle(window);

    this.addLog(
      `Window opened: "${title}"`
    );

    if (
      this.state === 'game-menu' ||
      this.state === 'waiting-game-menu'
    ) {
      this.handleGameMenuWindow(window);
      return;
    }

    if (this.state === 'visiting') {
      this.handleVisitWindow(window);
      return;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | SkyBlock Hub
  |--------------------------------------------------------------------------
  */

  waitForSkyblockHub() {
    if (!this.bot) {
      return;
    }

    this.setState('waiting-hub');

    this.addLog(
      '[HUB] Waiting for SkyBlock Hub to load.'
    );

    this.clearTimer('hubTimer');

    const started = Date.now();

    const checker = setInterval(() => {
      if (!this.bot || this.stopping) {
        clearInterval(checker);
        return;
      }

      if (
        this.isNear(
          SKYBLOCK_HUB,
          LOCATION_TOLERANCE
        )
      ) {
        clearInterval(checker);

        this.confirmSkyblockHub();
        return;
      }

      if (
        Date.now() - started >=
        SKYBLOCK_HUB_TIMEOUT
      ) {
        clearInterval(checker);

        this.addLog(
          '[HUB] SkyBlock Hub was not detected yet. Continuing to wait.'
        );

        /*
         * Retry Game Menu flow rather than falsely starting Visit.
         */
        this.setState('game-menu');

        setTimeout(() => {
          if (this.bot && !this.stopping) {
            this.beginGameMenuFlow();
          }
        }, 2000);
      }
    }, 1000);

    this.hubTimer = checker;
  }

  confirmSkyblockHub() {
    if (this.skyblockHubReached) {
      return;
    }

    this.skyblockHubReached = true;

    this.clearTimer('hubTimer');

    this.addLog(
      `[HUB] SkyBlock Hub confirmed at ${this.positionString()}.`
    );

    this.emit('skyblockHub', true);

    /*
     * Wait briefly for the hub to finish loading.
     */
    setTimeout(() => {
      if (
        this.bot &&
        !this.stopping
      ) {
        this.startVisit();
      }
    }, 1500);
  }

  /*
  |--------------------------------------------------------------------------
  | Visit target
  |--------------------------------------------------------------------------
  */

  startVisit() {
    if (!this.bot || this.stopping) {
      return;
    }

    if (!this.skyblockHubReached) {
      this.waitForSkyblockHub();
      return;
    }

    this.setState('visiting');

    this.targetReached = false;
    this.visitGuiOpened = false;

    this.visitStartPosition =
      this.getPosition();

    this.addLog(
      `[VISIT] Visiting target: ${this.target}`
    );

    try {
      this.bot.chat(
        `/visit ${this.target}`
      );
    } catch (error) {
      this.addLog(
        `[VISIT] Command error: ${error.message}`,
        'error'
      );
    }

    /*
     * Give FakePixel time to open the Visit GUI.
     */
    this.clearTimer('visitTimer');

    this.visitTimer = setTimeout(() => {
      if (
        this.state === 'visiting' &&
        !this.visitGuiOpened
      ) {
        this.addLog(
          '[VISIT] Visit GUI not detected yet. Retrying /visit.'
        );

        this.retryVisit();
      }
    }, VISIT_GUI_TIMEOUT);

    /*
     * Also watch for target movement.
     */
    this.startTargetChecker();
  }

  retryVisit() {
    if (!this.bot || this.stopping) {
      return;
    }

    this.clearTimer('visitRetryTimer');

    this.visitRetryTimer = setTimeout(() => {
      if (
        this.bot &&
        !this.stopping &&
        this.state === 'visiting' &&
        !this.targetReached
      ) {
        this.addLog(
          `[VISIT] Retrying /visit ${this.target}`
        );

        try {
          this.bot.chat(
            `/visit ${this.target}`
          );
        } catch (error) {
          this.addLog(
            `[VISIT] Retry error: ${error.message}`,
            'error'
          );
        }
      }
    }, VISIT_RETRY_DELAY);
  }

  handleVisitWindow(window) {
    if (!window || !this.bot) {
      return;
    }

    const title = this.getWindowTitle(window);

    this.addLog(
      `[VISIT] Window opened: "${title}"`
    );

    /*
     * Don't accept random inventory windows.
     */
    if (
      !/visit|player|island|warp|menu/i.test(title)
    ) {
      return;
    }

    this.visitGuiOpened = true;

    this.clearTimer('visitTimer');
    this.clearTimer('visitRetryTimer');

    /*
     * Visible slot 12 = Mineflayer index 11.
     */
    const slot = VISIT_SLOT;

    this.addLog(
      `[VISIT] Clicking Visit slot 12 (Mineflayer index ${slot}).`
    );

    if (
      !window.slots ||
      !window.slots[slot]
    ) {
      this.addLog(
        '[VISIT] Slot 12 is not populated yet. Waiting.'
      );

      setTimeout(() => {
        if (
          this.bot &&
          this.bot.currentWindow === window
        ) {
          this.handleVisitWindow(window);
        }
      }, 1000);

      return;
    }

    /*
     * User requested right-click for Visit slot 12.
     * Right-click first.
     */
    try {
      this.bot.clickWindow(
        slot,
        0,
        1,
        (error) => {
          if (error) {
            this.addLog(
              `[VISIT] Right-click failed: ${error.message}`,
              'error'
            );

            this.clickVisitLeft(window);
            return;
          }

          this.addLog(
            '[VISIT] Visit selection sent.'
          );

          this.waitForTargetIsland();
        }
      );
    } catch (error) {
      this.addLog(
        `[VISIT] Right-click exception: ${error.message}`,
        'error'
      );

      this.clickVisitLeft(window);
    }
  }

  clickVisitLeft(window) {
    if (!this.bot || !window) {
      return;
    }

    try {
      this.bot.clickWindow(
        VISIT_SLOT,
        0,
        0,
        (error) => {
          if (error) {
            this.addLog(
              `[VISIT] Left-click fallback failed: ${error.message}`,
              'error'
            );
            return;
          }

          this.addLog(
            '[VISIT] Left-click fallback sent.'
          );

          this.waitForTargetIsland();
        }
      );
    } catch (error) {
      this.addLog(
        `[VISIT] Left-click exception: ${error.message}`,
        'error'
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Target island detection
  |--------------------------------------------------------------------------
  */

  waitForTargetIsland() {
    if (!this.bot) {
      return;
    }

    this.setState('target-island');

    this.addLog(
      '[TARGET] Waiting until the target island is actually reached.'
    );

    this.visitStartPosition =
      this.getPosition();

    this.clearTimer('targetTimer');

    const started = Date.now();

    const checker = setInterval(() => {
      if (!this.bot || this.stopping) {
        clearInterval(checker);
        return;
      }

      if (this.checkTargetIsland()) {
        clearInterval(checker);
        return;
      }

      if (
        Date.now() - started >=
        TARGET_TIMEOUT
      ) {
        clearInterval(checker);

        this.addLog(
          '[TARGET] Target island was not confirmed yet. Checking again.'
        );

        /*
         * Never start AFK here.
         *
         * Instead retry the visit command.
         */
        this.setState('visiting');

        this.retryVisit();
      }
    }, 1000);

    this.targetTimer = checker;
  }

  startTargetChecker() {
    /*
     * The main interval is started by waitForTargetIsland().
     * This function is intentionally small.
     */
  }

  checkTargetIsland() {
    if (!this.bot || this.targetReached) {
      return this.targetReached;
    }

    const current =
      this.getPosition();

    if (!current) {
      return false;
    }

    /*
     * Distance from SkyBlock Hub.
     */
    const hubDistance =
      this.distance(current, SKYBLOCK_HUB);

    /*
     * Distance from the position where /visit was clicked.
     */
    let visitDistance = 0;

    if (this.visitStartPosition) {
      visitDistance =
        this.distance(
          current,
          this.visitStartPosition
        );
    }

    /*
     * We require meaningful movement.
     *
     * This prevents AFK from starting while the bot is
     * still sitting inside the SkyBlock Hub.
     */
    const movedFromHub =
      hubDistance >= 10;

    const movedFromVisitStart =
      visitDistance >= 8;

    /*
     * Strong confirmation:
     *
     * 1. Bot moved substantially away from SkyBlock Hub
     * AND
     * 2. Bot moved from the /visit starting position.
     */
    if (
      movedFromHub &&
      movedFromVisitStart
    ) {
      this.confirmTargetIsland();

      return true;
    }

    return false;
  }

  confirmTargetIsland() {
    if (this.targetReached) {
      return;
    }

    this.targetReached = true;

    this.clearTimer('targetTimer');

    this.addLog(
      `[TARGET] Target island confirmed at ${this.positionString()}.`
    );

    this.emit('targetReached', true);

    /*
     * Only now can AFK begin.
     */
    this.startAFK();
  }

  /*
  |--------------------------------------------------------------------------
  | AFK
  |--------------------------------------------------------------------------
  */

  startAFK() {
    if (!this.bot || this.stopping) {
      return;
    }

    /*
     * Absolute safety gate.
     */
    if (!this.targetReached) {
      this.addLog(
        '[AFK] BLOCKED: target island has not been confirmed.',
        'error'
      );
      return;
    }

    if (this.state === 'afk') {
      return;
    }

    this.setState('afk');

    this.addLog(
      `[AFK] Starting AFK movement. Move=${this.moveInterval}ms Jump=${this.jumpInterval}ms Distance=${this.moveDistance}`
    );

    /*
     * Prefer the user's afk.js controller.
     */
    try {
      if (AFKController) {
        this.afk = new AFKController(
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

        if (
          this.afk &&
          typeof this.afk.on === 'function'
        ) {
          this.afk.on('log', (message) => {
            this.addLog(
              `[AFK] ${message}`
            );
          });
        }

        if (
          this.afk &&
          typeof this.afk.start === 'function'
        ) {
          this.afk.start();

          this.startDurationTimer();

          return;
        }
      }
    } catch (error) {
      this.addLog(
        `[AFK] AFK controller error: ${error.message}`,
        'error'
      );
    }

    /*
     * Built-in fallback.
     */
    this.startInternalAFK();

    this.startDurationTimer();
  }

  startInternalAFK() {
    this.stopInternalAFK();

    let movingForward = true;

    const doMove = () => {
      if (
        !this.bot ||
        this.stopping ||
        !this.targetReached
      ) {
        return;
      }

      try {
        if (movingForward) {
          this.bot.setControlState(
            'forward',
            true
          );

          this.addLog(
            `[AFK] Moving forward ${this.moveDistance} blocks approximately.`
          );
        } else {
          this.bot.setControlState(
            'back',
            true
          );

          this.addLog(
            `[AFK] Moving backward ${this.moveDistance} blocks approximately.`
          );
        }

        setTimeout(() => {
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
          } catch (_) {}

          movingForward = !movingForward;
        }, 1200);

      } catch (error) {
        this.addLog(
          `[AFK] Movement error: ${error.message}`,
          'error'
        );
      }
    };

    const doJump = () => {
      if (
        !this.bot ||
        this.stopping ||
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
        }, 400);

      } catch (error) {
        this.addLog(
          `[AFK] Jump error: ${error.message}`,
          'error'
        );
      }
    };

    doMove();
    doJump();

    this.internalMoveTimer =
      setInterval(
        doMove,
        Math.max(
          5000,
          this.moveInterval
        )
      );

    this.internalJumpTimer =
      setInterval(
        doJump,
        Math.max(
          1500,
          this.jumpInterval
        )
      );
  }

  stopInternalAFK() {
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

    if (this.bot) {
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
          'jump',
          false
        );
      } catch (_) {}
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Duration
  |--------------------------------------------------------------------------
  */

  startDurationTimer() {
    this.clearTimer('durationTimer');

    if (
      !this.duration ||
      this.duration <= 0
    ) {
      return;
    }

    const milliseconds =
      this.duration *
      60 *
      60 *
      1000;

    this.addLog(
      `[DURATION] Bot will run for ${this.duration} hour(s).`
    );

    this.durationTimer =
      setTimeout(() => {
        this.durationTimer = null;

        this.addLog(
          '[DURATION] Configured duration reached. Stopping bot.'
        );

        this.stop();
      }, milliseconds);
  }

  /*
  |--------------------------------------------------------------------------
  | Disconnect
  |--------------------------------------------------------------------------
  */

  handleDisconnect(reason) {
    this.connecting = false;

    const reasonText =
      this.toPlainText(reason) ||
      'connection ended';

    this.addLog(
      `[DISCONNECT] ${reasonText}`,
      'error'
    );

    this.stopInternalAFK();

    if (this.afk) {
      try {
        if (
          typeof this.afk.stop === 'function'
        ) {
          this.afk.stop();
        }
      } catch (_) {}

      this.afk = null;
    }

    this.clearFlowTimers();

    this.bot = null;
    this.auth = null;

    this.targetReached = false;
    this.lobbyReached = false;
    this.skyblockHubReached = false;
    this.gameMenuOpened = false;
    this.visitGuiOpened = false;

    if (
      this.stopping ||
      !this.autoReconnect
    ) {
      this.setState('disconnected');
      return;
    }

    this.setState('disconnected');

    this.scheduleReconnect();
  }

  /*
  |--------------------------------------------------------------------------
  | Reconnect
  |--------------------------------------------------------------------------
  */

  scheduleReconnect() {
    if (
      this.stopping ||
      !this.autoReconnect
    ) {
      return;
    }

    this.clearReconnect();

    this.addLog(
      `[RECONNECT] Reconnecting in ${this.reconnectDelay}ms.`
    );

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;

        if (
          !this.stopping
        ) {
          this.resetFlow();
          this.start().catch((error) => {
            this.addLog(
              `[RECONNECT] ${error.message}`,
              'error'
            );
          });
        }
      }, this.reconnectDelay);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Stop
  |--------------------------------------------------------------------------
  */

  stop() {
    this.stopping = true;

    this.clearReconnect();
    this.clearFlowTimers();

    this.stopInternalAFK();

    if (this.afk) {
      try {
        if (
          typeof this.afk.stop === 'function'
        ) {
          this.afk.stop();
        }
      } catch (_) {}

      this.afk = null;
    }

    if (this.auth) {
      try {
        if (
          typeof this.auth.stop === 'function'
        ) {
          this.auth.stop();
        }
      } catch (_) {}

      this.auth = null;
    }

    if (this.bot) {
      try {
        this.bot.quit(
          'Bot stopped'
        );
      } catch (_) {}

      this.bot = null;
    }

    this.connecting = false;

    this.setState('stopped');

    this.addLog(
      '[STOP] Bot stopped.'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Restart
  |--------------------------------------------------------------------------
  */

  async restart() {
    this.addLog(
      '[RESTART] Restarting bot.'
    );

    this.stop();

    await new Promise((resolve) => {
      setTimeout(
        resolve,
        1000
      );
    });

    this.stopping = false;

    await this.start();
  }

  /*
  |--------------------------------------------------------------------------
  | Rejoin
  |--------------------------------------------------------------------------
  */

  async rejoin() {
    this.addLog(
      '[REJOIN] Rejoining FakePixel.'
    );

    this.stopping = true;

    this.clearReconnect();
    this.clearFlowTimers();

    this.stopInternalAFK();

    if (this.afk) {
      try {
        if (
          typeof this.afk.stop === 'function'
        ) {
          this.afk.stop();
        }
      } catch (_) {}

      this.afk = null;
    }

    if (this.auth) {
      try {
        if (
          typeof this.auth.stop === 'function'
        ) {
          this.auth.stop();
        }
      } catch (_) {}

      this.auth = null;
    }

    if (this.bot) {
      try {
        this.bot.quit(
          'Rejoining'
        );
      } catch (_) {}

      this.bot = null;
    }

    await new Promise((resolve) => {
      setTimeout(
        resolve,
        1000
      );
    });

    this.stopping = false;

    this.resetFlow();

    await this.start();
  }

  /*
  |--------------------------------------------------------------------------
  | Chat
  |--------------------------------------------------------------------------
  */

  chat(message) {
    if (!this.bot) {
      throw new Error(
        'Bot is not connected.'
      );
    }

    this.bot.chat(
      String(message)
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Position
  |--------------------------------------------------------------------------
  */

  updatePosition() {
    if (!this.bot || !this.bot.entity) {
      return;
    }

    this.lastPosition = {
      x: Number(
        this.bot.entity.position.x.toFixed(2)
      ),
      y: Number(
        this.bot.entity.position.y.toFixed(2)
      ),
      z: Number(
        this.bot.entity.position.z.toFixed(2)
      )
    };

    this.emit(
      'position',
      this.lastPosition
    );
  }

  getPosition() {
    if (
      !this.bot ||
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return null;
    }

    return new Vec3(
      this.bot.entity.position.x,
      this.bot.entity.position.y,
      this.bot.entity.position.z
    );
  }

  positionString() {
    const position =
      this.getPosition();

    if (!position) {
      return 'unknown';
    }

    return [
      Number(position.x.toFixed(2)),
      Number(position.y.toFixed(2)),
      Number(position.z.toFixed(2))
    ].join(', ');
  }

  distance(a, b) {
    if (!a || !b) {
      return Infinity;
    }

    return Math.sqrt(
      Math.pow(a.x - b.x, 2) +
      Math.pow(a.y - b.y, 2) +
      Math.pow(a.z - b.z, 2)
    );
  }

  isNear(position, tolerance) {
    const current =
      this.getPosition();

    if (!current || !position) {
      return false;
    }

    return (
      this.distance(
        current,
        position
      ) <= tolerance
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Utility
  |--------------------------------------------------------------------------
  */

  toPlainText(value) {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      if (
        typeof value.toString === 'function'
      ) {
        return value.toString();
      }
    } catch (_) {}

    return String(value);
  }

  getWindowTitle(window) {
    if (!window) {
      return '';
    }

    try {
      if (window.title) {
        return this.toPlainText(
          window.title
        );
      }
    } catch (_) {}

    try {
      if (window.type) {
        return this.toPlainText(
          window.type
        );
      }
    } catch (_) {}

    return '';
  }

  clearTimer(name) {
    const timer = this[name];

    if (!timer) {
      return;
    }

    try {
      clearTimeout(timer);
    } catch (_) {}

    try {
      clearInterval(timer);
    } catch (_) {}

    this[name] = null;
  }

  clearFlowTimers() {
    const timers = [
      'authTimer',
      'lobbyTimer',
      'menuTimer',
      'hubTimer',
      'visitTimer',
      'targetTimer',
      'menuRetryTimer',
      'visitRetryTimer'
    ];

    for (const timer of timers) {
      this.clearTimer(timer);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Logs
  |--------------------------------------------------------------------------
  */

  getLogs(limit = 200) {
    const count =
      Math.max(
        1,
        Number(limit || 200)
      );

    return this.logs.slice(
      -count
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Info for web panel
  |--------------------------------------------------------------------------
  */

  getInfo() {
    let uptime = 0;

    if (this.startedAt) {
      uptime =
        Math.floor(
          (Date.now() - this.startedAt) /
          1000
        );
    }

    return {
      id: this.id,

      username: this.username,

      target: this.target,

      state: this.state,

      status: this.state,

      connected:
        !!this.bot,

      authenticated:
        this.authenticated,

      lobbyReached:
        this.lobbyReached,

      skyblockHubReached:
        this.skyblockHubReached,

      targetReached:
        this.targetReached,

      gameMenuOpened:
        this.gameMenuOpened,

      visitGuiOpened:
        this.visitGuiOpened,

      uptime,

      startedAt:
        this.startedAt,

      connectedAt:
        this.connectedAt,

      position:
        this.lastPosition ||
        (
          this.bot &&
          this.bot.entity
            ? {
                x: Number(
                  this.bot.entity.position.x.toFixed(2)
                ),
                y: Number(
                  this.bot.entity.position.y.toFixed(2)
                ),
                z: Number(
                  this.bot.entity.position.z.toFixed(2)
                )
              }
            : null
        ),

      duration:
        this.duration,

      moveInterval:
        this.moveInterval,

      jumpInterval:
        this.jumpInterval,

      moveDistance:
        this.moveDistance,

      autoReconnect:
        this.autoReconnect,

      reconnectDelay:
        this.reconnectDelay
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Config
  |--------------------------------------------------------------------------
  */

  getConfig() {
    return {
      id: this.id,
      username: this.username,
      password: this.password,
      target: this.target,
      duration: this.duration,
      moveInterval: this.moveInterval,
      jumpInterval: this.jumpInterval,
      moveDistance: this.moveDistance,
      autoReconnect: this.autoReconnect,
      reconnectDelay: this.reconnectDelay
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
      config.duration !== undefined
    ) {
      this.duration =
        Number(config.duration);
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
      config.autoReconnect !== undefined
    ) {
      this.autoReconnect =
        Boolean(config.autoReconnect);
    }

    if (
      config.reconnectDelay !== undefined
    ) {
      this.reconnectDelay =
        Number(config.reconnectDelay);
    }

    this.emit(
      'config',
      this.getConfig()
    );

    return this.getConfig();
  }

  /*
  |--------------------------------------------------------------------------
  | Cleanup
  |--------------------------------------------------------------------------
  */

  destroy() {
    this.stopping = true;

    this.clearReconnect();
    this.clearFlowTimers();
    this.stopInternalAFK();

    if (this.afk) {
      try {
        if (
          typeof this.afk.stop === 'function'
        ) {
          this.afk.stop();
        }
      } catch (_) {}
    }

    if (this.auth) {
      try {
        if (
          typeof this.auth.stop === 'function'
        ) {
          this.auth.stop();
        }
      } catch (_) {}
    }

    if (this.bot) {
      try {
        this.bot.quit(
          'Bot destroyed'
        );
      } catch (_) {}
    }

    this.bot = null;
    this.afk = null;
    this.auth = null;

    this.setState('stopped');
  }
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = FakePixelBot;
module.exports.FakePixelBot = FakePixelBot;
