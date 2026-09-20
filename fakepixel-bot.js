'use strict';

const EventEmitter = require('events');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');

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
| FakePixel configuration
|--------------------------------------------------------------------------
*/

const MC_HOST =
  process.env.MC_HOST || 'mc.fakepixel.me';

const MC_PORT =
  Number(process.env.MC_PORT || 25565);

const MC_VERSION =
  process.env.MC_VERSION || '1.8.9';

const DEFAULT_PASSWORD =
  process.env.DEFAULT_MC_PASSWORD || 'vmallu';

const DEFAULT_DURATION_HOURS =
  Number(
    process.env.DEFAULT_DURATION_HOURS || 2
  );

const DEFAULT_MOVE_INTERVAL =
  Number(
    process.env.DEFAULT_MOVE_INTERVAL || 8000
  );

const DEFAULT_JUMP_INTERVAL =
  Number(
    process.env.DEFAULT_JUMP_INTERVAL || 15000
  );

const DEFAULT_MOVE_DISTANCE =
  Number(
    process.env.AFK_MOVE_DISTANCE || 3
  );

const DEFAULT_RECONNECT_DELAY =
  Number(
    process.env.RECONNECT_DELAY || 5000
  );

const CHECK_TIMEOUT_INTERVAL =
  Number(
    process.env.CHECK_TIMEOUT_INTERVAL || 120000
  );

const LOCATION_TOLERANCE =
  Number(
    process.env.LOCATION_TOLERANCE || 5
  );

/*
|--------------------------------------------------------------------------
| Known FakePixel locations
|--------------------------------------------------------------------------
*/

const MAIN_SPAWN = new Vec3(
  Number(
    process.env.MAIN_SPAWN_X || -52.500
  ),
  Number(
    process.env.MAIN_SPAWN_Y || 95.74244
  ),
  Number(
    process.env.MAIN_SPAWN_Z || 0.500
  )
);

const SKYBLOCK_HUB = new Vec3(
  Number(
    process.env.SKYBLOCK_HUB_X || -2.500
  ),
  Number(
    process.env.SKYBLOCK_HUB_Y || 70.06250
  ),
  Number(
    process.env.SKYBLOCK_HUB_Z || -68.000
  )
);

/*
|--------------------------------------------------------------------------
| FakePixel GUI slots
|--------------------------------------------------------------------------
|
| Visible slot 21 -> Mineflayer index 20
| Visible slot 12 -> Mineflayer index 11
|
*/

const GAME_MENU_SKYBLOCK_SLOT = 20;
const VISIT_TARGET_SLOT = 11;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function distance(a, b) {
  if (!a || !b) {
    return Infinity;
  }

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;

  return Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );
}

function isNear(
  a,
  b,
  tolerance = LOCATION_TOLERANCE
) {
  return distance(a, b) <= tolerance;
}

/*
|--------------------------------------------------------------------------
| FakePixelBot
|--------------------------------------------------------------------------
*/

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      id:
        config.id ||
        null,

      username:
        String(config.username || '').trim(),

      password:
        config.password ||
        DEFAULT_PASSWORD,

      target:
        String(config.target || '').trim(),

      durationHours:
        Number(
          config.durationHours ||
          DEFAULT_DURATION_HOURS
        ),

      moveInterval:
        Number(
          config.moveInterval ||
          DEFAULT_MOVE_INTERVAL
        ),

      jumpInterval:
        Number(
          config.jumpInterval ||
          DEFAULT_JUMP_INTERVAL
        ),

      moveDistance:
        Number(
          config.moveDistance ||
          DEFAULT_MOVE_DISTANCE
        ),

      reconnectDelay:
        Number(
          config.reconnectDelay ||
          DEFAULT_RECONNECT_DELAY
        ),

      autoReconnect:
        config.autoReconnect !== false
    };

    this.bot = null;
    this.auth = null;
    this.afk = null;

    this.running = false;
    this.connected = false;
    this.authenticated = false;

    this.flow = 'idle';

    this.createdAt = Date.now();
    this.startedAt = null;
    this.connectedAt = null;
    this.afkStartedAt = null;
    this.expireAt = null;

    this.reconnectTimer = null;
    this.durationTimer = null;
    this.gameMenuTimer = null;
    this.visitTimer = null;

    this.menuBusy = false;
    this.visitBusy = false;

    this.gameMenuOpened = false;
    this.gameMenuClicked = false;

    this.hubDetected = false;

    this.visitCommandSent = false;
    this.visitGuiClicked = false;

    this.targetReached = false;

    this.hubPositionBeforeVisit = null;
    this.visitStartedAt = null;

    this.lastPosition = null;
    this.lastLog = null;

    this.logs = [];
    this.maxLogs = 500;

    this.reconnectCount = 0;

    this.manualStop = false;

    this.lastActionBar = '';

    this.authStartTimer = null;

    this.targetConfirmationMessages = [
      'visiting',
      'visited',
      'teleported',
      'teleporting',
      'sending you',
      'warping',
      'warp complete'
    ];
  }

  /*
  |--------------------------------------------------------------------------
  | Logging
  |--------------------------------------------------------------------------
  */

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message: String(message)
    };

    this.lastLog = entry;

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.splice(
        0,
        this.logs.length - this.maxLogs
      );
    }

    console.log(
      `[${this.config.username || 'BOT'}] ${message}`
    );

    this.emit('log', entry);
  }

  getLogs(limit = 200) {
    const count =
      Number(limit) || 200;

    return this.logs.slice(-count);
  }

  /*
  |--------------------------------------------------------------------------
  | State
  |--------------------------------------------------------------------------
  */

  setFlow(flow) {
    if (this.flow === flow) {
      return;
    }

    const oldFlow = this.flow;

    this.flow = flow;

    this.log(
      `State: ${oldFlow} -> ${flow}`
    );

    this.emit(
      'state',
      flow
    );
  }

  resetFlowState() {
    this.menuBusy = false;
    this.visitBusy = false;

    this.gameMenuOpened = false;
    this.gameMenuClicked = false;

    this.hubDetected = false;

    this.visitCommandSent = false;
    this.visitGuiClicked = false;

    this.targetReached = false;

    this.hubPositionBeforeVisit = null;
    this.visitStartedAt = null;

    if (this.gameMenuTimer) {
      clearTimeout(
        this.gameMenuTimer
      );

      this.gameMenuTimer = null;
    }

    if (this.visitTimer) {
      clearTimeout(
        this.visitTimer
      );

      this.visitTimer = null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Position
  |--------------------------------------------------------------------------
  */

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

  checkLocation() {
    if (
      !this.bot ||
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return;
    }

    const position =
      this.bot.entity.position;

    this.lastPosition = {
      x: position.x,
      y: position.y,
      z: position.z
    };

    /*
     * Only use location detection for the
     * state that is currently expecting it.
     */

    if (
      this.flow === 'waiting-hub'
    ) {
      const hubDistance =
        distance(
          position,
          SKYBLOCK_HUB
        );

      if (
        hubDistance <=
        LOCATION_TOLERANCE
      ) {
        this.confirmSkyblockHub();
      }
    }

    if (
      this.flow === 'target-island'
    ) {
      this.checkTargetArrival();
    }

    /*
     * IMPORTANT:
     *
     * There is intentionally NO code here that
     * starts AFK simply because the bot is moving.
     *
     * AFK requires targetReached === true.
     */
  }

  /*
  |--------------------------------------------------------------------------
  | Create Minecraft connection
  |--------------------------------------------------------------------------
  */

  createBot() {
    if (!this.config.username) {
      throw new Error(
        'Minecraft username is required.'
      );
    }

    this.log(
      `Connecting to ${MC_HOST}:${MC_PORT} as ${this.config.username}...`
    );

    this.bot =
      mineflayer.createBot({
        host: MC_HOST,

        port: MC_PORT,

        username:
          this.config.username,

        version:
          MC_VERSION,

        auth: 'offline',

        keepAlive: true,

        checkTimeoutInterval:
          CHECK_TIMEOUT_INTERVAL,

        hideErrors: false
      });

    this.registerBotEvents();

    try {
      this.auth =
        new MinecraftAuth(
          this.bot,
          this.config.password ||
            DEFAULT_PASSWORD
        );

      this.registerAuthEvents();
    } catch (error) {
      this.log(
        `MinecraftAuth initialization failed: ${error.message || error}`,
        'error'
      );

      throw error;
    }

    return this.bot;
  }

  /*
  |--------------------------------------------------------------------------
  | Minecraft events
  |--------------------------------------------------------------------------
  */

  registerBotEvents() {
    if (!this.bot) {
      return;
    }

    this.bot.on(
      'login',
      () => {
        this.connected = true;
        this.connectedAt =
          Date.now();

        this.log(
          'Minecraft connection established.'
        );

        this.emit(
          'connected'
        );
      }
    );

    this.bot.on(
      'spawn',
      async () => {
        this.connected = true;

        this.log(
          'Minecraft spawn event received.'
        );

        /*
         * DO NOT require MAIN_SPAWN coordinates.
         *
         * FakePixel can spawn the player somewhere
         * different from the configured coordinate.
         *
         * Authentication decides when we proceed.
         */

        if (
          this.authenticated &&
          this.running &&
          !this.targetReached
        ) {
          await sleep(1800);

          if (
            this.running &&
            this.connected
          ) {
            this.beginGameMenuFlow();
          }
        }
      }
    );

    this.bot.on(
      'message',
      message => {
        this.handleMinecraftMessage(
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
      window => {
        this.handleWindowClose(
          window
        );
      }
    );

    this.bot.on(
      'kicked',
      reason => {
        this.log(
          `Kicked from server: ${this.safeText(reason)}`,
          'warn'
        );
      }
    );

    this.bot.on(
      'error',
      error => {
        this.log(
          `Minecraft error: ${error.message || error}`,
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
      reason => {
        this.handleDisconnect(
          reason
        );
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  registerAuthEvents() {
    if (!this.auth) {
      return;
    }

    this.auth.on(
      'authenticated',
      async () => {
        this.authenticated = true;

        this.log(
          'Authentication successful.'
        );

        this.emit(
          'authenticated'
        );

        if (
          !this.running ||
          !this.connected
        ) {
          return;
        }

        await sleep(1800);

        if (
          this.running &&
          this.connected &&
          !this.targetReached
        ) {
          this.beginGameMenuFlow();
        }
      }
    );

    this.auth.on(
      'authTimeout',
      () => {
        this.log(
          'Authentication timeout.',
          'warn'
        );
      }
    );

    this.auth.on(
      'authLog',
      message => {
        this.log(
          message
        );
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Begin Game Menu
  |--------------------------------------------------------------------------
  */

  beginGameMenuFlow() {
    if (
      !this.running ||
      !this.connected ||
      !this.authenticated ||
      this.targetReached
    ) {
      return;
    }

    /*
     * Never start AFK here.
     */

    this.gameMenuClicked = false;
    this.menuBusy = false;

    this.setFlow(
      'game-menu'
    );

    this.openGameMenu();
  }

  openGameMenu() {
    if (
      !this.running ||
      !this.connected ||
      !this.bot ||
      this.targetReached
    ) {
      return;
    }

    if (
      this.menuBusy ||
      this.gameMenuClicked
    ) {
      return;
    }

    if (this.gameMenuTimer) {
      clearTimeout(
        this.gameMenuTimer
      );
    }

    this.gameMenuTimer =
      setTimeout(
        async () => {
          this.gameMenuTimer = null;

          if (
            !this.running ||
            !this.connected ||
            !this.bot ||
            this.targetReached
          ) {
            return;
          }

          try {
            this.menuBusy = true;

            this.log(
              'Opening FakePixel Game Menu using hotbar slot 1...'
            );

            /*
             * Hotbar slot 1 = Mineflayer slot 0.
             */

            await this.bot.setQuickBarSlot(
              0
            );

            await sleep(400);

            this.bot.activateItem();

            this.gameMenuOpened = true;

            this.log(
              'Game Menu activated.'
            );

            /*
             * windowOpen should fire.
             *
             * If it doesn't, retry.
             */

            await sleep(1800);

            this.menuBusy = false;

            if (
              this.running &&
              this.connected &&
              this.flow === 'game-menu' &&
              !this.bot.currentWindow
            ) {
              this.log(
                'Game Menu did not open. Retrying...',
                'warn'
              );

              this.openGameMenu();
            }
          } catch (error) {
            this.menuBusy = false;

            this.log(
              `Game Menu activation failed: ${error.message || error}`,
              'error'
            );

            await sleep(1500);

            if (
              this.running &&
              this.connected &&
              this.flow === 'game-menu'
            ) {
              this.openGameMenu();
            }
          }
        },
        700
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Game Menu window
  |--------------------------------------------------------------------------
  */

  async handleGameMenuWindow(window) {
    if (
      this.flow !== 'game-menu'
    ) {
      return;
    }

    if (
      this.menuBusy &&
      !this.gameMenuOpened
    ) {
      return;
    }

    if (
      this.gameMenuClicked
    ) {
      return;
    }

    this.menuBusy = true;

    try {
      const title =
        this.safeText(
          window.title || ''
        );

      this.log(
        `Game Menu opened: ${title || 'Game Menu'}`
      );

      /*
       * Visible slot 21
       * = Mineflayer index 20
       */

      const slot =
        GAME_MENU_SKYBLOCK_SLOT;

      if (
        !window.slots ||
        !window.slots[slot]
      ) {
        this.log(
          'SkyBlock Hub was not found at visible slot 21.',
          'warn'
        );

        this.menuBusy = false;

        if (
          this.bot.currentWindow
        ) {
          try {
            this.bot.closeWindow(
              this.bot.currentWindow
            );
          } catch (_) {}
        }

        await sleep(1200);

        if (
          this.running &&
          this.flow === 'game-menu'
        ) {
          this.openGameMenu();
        }

        return;
      }

      const item =
        window.slots[slot];

      this.log(
        `SkyBlock Hub slot 21 found: ${this.itemName(item)}`
      );

      await sleep(500);

      if (
        !this.running ||
        !this.connected ||
        !this.bot
      ) {
        this.menuBusy = false;
        return;
      }

      this.log(
        'Clicking SkyBlock Hub visible slot 21 (index 20)...'
      );

      await this.clickWindow(
        slot,
        0,
        0
      );

      this.gameMenuClicked = true;
      this.menuBusy = false;

      /*
       * VERY IMPORTANT:
       *
       * Do not /visit yet.
       *
       * First confirm physical SkyBlock Hub.
       */

      this.setFlow(
        'waiting-hub'
      );

      this.waitForSkyblockHub();
    } catch (error) {
      this.menuBusy = false;

      this.log(
        `SkyBlock Hub click failed: ${error.message || error}`,
        'error'
      );

      await sleep(1800);

      if (
        this.running &&
        this.connected
      ) {
        this.gameMenuClicked = false;

        this.setFlow(
          'game-menu'
        );

        this.openGameMenu();
      }
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Wait for SkyBlock Hub
  |--------------------------------------------------------------------------
  */

  async waitForSkyblockHub() {
    const timeout = 35000;
    const started =
      Date.now();

    this.log(
      'Waiting for actual SkyBlock Hub...'
    );

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      this.checkLocation();

      if (
        this.hubDetected
      ) {
        return;
      }

      if (
        this.bot.entity &&
        this.bot.entity.position
      ) {
        const d =
          distance(
            this.bot.entity.position,
            SKYBLOCK_HUB
          );

        if (
          d <= LOCATION_TOLERANCE
        ) {
          this.confirmSkyblockHub();
          return;
        }
      }

      await sleep(500);
    }

    if (
      !this.running ||
      !this.connected
    ) {
      return;
    }

    this.log(
      `SkyBlock Hub was not detected within ${timeout / 1000}s.`,
      'warn'
    );

    /*
     * Do NOT visit from the main FakePixel hub.
     *
     * Retry the Game Menu flow.
     */

    this.gameMenuClicked = false;
    this.menuBusy = false;

    this.hubDetected = false;

    this.setFlow(
      'game-menu'
    );

    await sleep(1500);

    if (
      this.running &&
      this.connected
    ) {
      this.openGameMenu();
    }
  }

  confirmSkyblockHub() {
    if (
      this.hubDetected
    ) {
      return;
    }

    this.hubDetected = true;

    const position =
      this.bot &&
      this.bot.entity &&
      this.bot.entity.position
        ? this.bot.entity.position
        : null;

    if (position) {
      this.log(
        `SkyBlock Hub confirmed at ${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)}.`
      );
    } else {
      this.log(
        'SkyBlock Hub confirmed.'
      );
    }

    this.setFlow(
      'skyblock-hub'
    );

    setTimeout(
      () => {
        if (
          this.running &&
          this.connected &&
          this.hubDetected &&
          !this.visitCommandSent
        ) {
          this.startVisit();
        }
      },
      1200
    );
  }

  /*
  |--------------------------------------------------------------------------
  | /visit
  |--------------------------------------------------------------------------
  */

  async startVisit() {
    if (
      this.visitCommandSent ||
      this.visitBusy ||
      !this.running ||
      !this.connected ||
      !this.bot
    ) {
      return;
    }

    const target =
      String(
        this.config.target || ''
      ).trim();

    if (!target) {
      this.log(
        'Target username is empty. Cannot use /visit.',
        'error'
      );

      return;
    }

    this.visitCommandSent = true;

    this.visitGuiClicked = false;
    this.targetReached = false;

    this.visitStartedAt =
      Date.now();

    if (
      this.bot.entity &&
      this.bot.entity.position
    ) {
      this.hubPositionBeforeVisit =
        this.bot.entity.position.clone();
    }

    this.setFlow(
      'visiting'
    );

    this.log(
      `Sending /visit ${target}...`
    );

    try {
      this.bot.chat(
        `/visit ${target}`
      );
    } catch (error) {
      this.log(
        `Failed to send /visit: ${error.message || error}`,
        'error'
      );

      this.visitCommandSent = false;

      this.setFlow(
        'skyblock-hub'
      );

      return;
    }

    this.waitForVisitGui();
  }

  async waitForVisitGui() {
    const timeout = 15000;
    const started =
      Date.now();

    this.log(
      'Waiting for Visit GUI...'
    );

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      if (
        this.bot.currentWindow
      ) {
        await this.handleVisitWindow(
          this.bot.currentWindow
        );

        return;
      }

      await sleep(300);
    }

    if (
      !this.running ||
      !this.connected
    ) {
      return;
    }

    /*
     * Sometimes the GUI event can arrive slightly
     * later than expected.
     */

    if (
      this.bot.currentWindow
    ) {
      await this.handleVisitWindow(
        this.bot.currentWindow
      );

      return;
    }

    this.log(
      'Visit GUI did not appear.',
      'warn'
    );

    /*
     * Retry /visit rather than starting AFK.
     */

    this.visitCommandSent = false;

    await sleep(1200);

    if (
      this.running &&
      this.connected &&
      this.flow === 'visiting'
    ) {
      this.startVisit();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Visit GUI
  |--------------------------------------------------------------------------
  */

  async handleVisitWindow(window) {
    if (
      this.visitBusy ||
      this.visitGuiClicked
    ) {
      return;
    }

    this.visitBusy = true;

    try {
      const title =
        this.safeText(
          window.title || ''
        );

      this.log(
        `Visit GUI opened: ${title || 'Visit Menu'}`
      );

      /*
       * Visible slot 12
       * = Mineflayer index 11
       */

      const slot =
        VISIT_TARGET_SLOT;

      if (
        !window.slots ||
        !window.slots[slot]
      ) {
        this.log(
          'Target Visit entry was not found at visible slot 12.',
          'warn'
        );

        this.visitBusy = false;

        return;
      }

      const item =
        window.slots[slot];

      this.log(
        `Visit slot 12 found: ${this.itemName(item)}`
      );

      await sleep(700);

      if (
        !this.running ||
        !this.connected ||
        !this.bot
      ) {
        this.visitBusy = false;
        return;
      }

      /*
       * User requested RIGHT CLICK.
       *
       * Mineflayer:
       * 0 = left click
       * 1 = right click
       */

      this.log(
        'Right-clicking Visit visible slot 12 (index 11)...'
      );

      try {
        await this.clickWindow(
          slot,
          1,
          0
        );
      } catch (rightError) {
        this.log(
          `Right-click failed: ${rightError.message || rightError}`,
          'warn'
        );

        /*
         * Fallback for FakePixel menu versions
         * that accept left click.
         */

        if (
          this.bot.currentWindow
        ) {
          this.log(
            'Trying left-click fallback on Visit slot 12...'
          );

          await this.clickWindow(
            slot,
            0,
            0
          );
        }
      }

      this.visitGuiClicked = true;
      this.visitBusy = false;

      /*
       * GUI interaction is complete, but target
       * arrival is NOT confirmed yet.
       */

      this.setFlow(
        'target-island'
      );

      this.waitForTargetIsland();
    } catch (error) {
      this.visitBusy = false;

      this.log(
        `Visit GUI click failed: ${error.message || error}`,
        'error'
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Target island detection
  |--------------------------------------------------------------------------
  */

  async waitForTargetIsland() {
    const timeout = 30000;
    const started =
      Date.now();

    this.log(
      'Waiting for actual target island arrival...'
    );

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      this.checkTargetArrival();

      if (
        this.targetReached
      ) {
        return;
      }

      await sleep(500);
    }

    if (
      !this.running ||
      !this.connected
    ) {
      return;
    }

    if (
      this.targetReached
    ) {
      return;
    }

    this.log(
      'Target island was not confirmed after Visit.',
      'warn'
    );

    /*
     * Never start AFK here.
     *
     * Go back to SkyBlock Hub visit flow.
     */

    this.visitCommandSent = false;
    this.visitGuiClicked = false;
    this.visitBusy = false;

    this.hubDetected = false;

    this.setFlow(
      'skyblock-hub'
    );

    await sleep(1500);

    if (
      this.running &&
      this.connected
    ) {
      this.startVisit();
    }
  }

  checkTargetArrival() {
    if (
      this.targetReached ||
      !this.bot ||
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return;
    }

    const position =
      this.bot.entity.position;

    /*
     * Method 1:
     *
     * The player should move significantly away
     * from the SkyBlock Hub after visiting.
     */

    const hubDistance =
      distance(
        position,
        SKYBLOCK_HUB
      );

    if (
      hubDistance <
      Math.max(
        LOCATION_TOLERANCE + 3,
        8
      )
    ) {
      return;
    }

    /*
     * Method 2:
     *
     * Compare against the exact position recorded
     * immediately before /visit.
     */

    if (
      this.hubPositionBeforeVisit
    ) {
      const movedDistance =
        distance(
          position,
          this.hubPositionBeforeVisit
        );

      if (
        movedDistance >= 10
      ) {
        this.confirmTargetIsland(
          `player moved ${movedDistance.toFixed(1)} blocks from the SkyBlock Hub`
        );

        return;
      }
    }

    /*
     * If no previous position exists but the bot
     * is clearly far from the Hub, accept it.
     */

    if (
      !this.hubPositionBeforeVisit &&
      hubDistance >= 15
    ) {
      this.confirmTargetIsland(
        'player moved away from SkyBlock Hub'
      );
    }
  }

  confirmTargetIsland(reason) {
    if (
      this.targetReached
    ) {
      return;
    }

    this.targetReached = true;

    const position =
      this.bot &&
      this.bot.entity &&
      this.bot.entity.position
        ? this.bot.entity.position
        : null;

    if (position) {
      this.log(
        `Target island confirmed: ${reason}. Position ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}.`
      );
    } else {
      this.log(
        `Target island confirmed: ${reason}.`
      );
    }

    this.setFlow(
      'afk'
    );

    this.startAfk();
  }

  /*
  |--------------------------------------------------------------------------
  | Minecraft chat messages
  |--------------------------------------------------------------------------
  */

  handleMinecraftMessage(message) {
    const text =
      this.safeText(message);

    if (!text) {
      return;
    }

    this.emit(
      'chat',
      text
    );

    const lower =
      text.toLowerCase();

    /*
     * Useful visit messages.
     */

    if (
      this.flow === 'visiting' ||
      this.flow === 'target-island'
    ) {
      for (
        const phrase of
        this.targetConfirmationMessages
      ) {
        if (
          lower.includes(phrase)
        ) {
          this.log(
            `Visit/server message: ${text}`
          );

          break;
        }
      }
    }

    /*
     * If server explicitly indicates that
     * visiting/teleporting happened, check position
     * shortly afterwards.
     */

    if (
      this.flow === 'target-island' &&
      (
        lower.includes('teleport') ||
        lower.includes('visiting') ||
        lower.includes('visited') ||
        lower.includes('sending you')
      )
    ) {
      setTimeout(
        () => {
          if (
            this.running &&
            this.connected &&
            this.flow === 'target-island'
          ) {
            this.checkTargetArrival();
          }
        },
        1000
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Action bar
  |--------------------------------------------------------------------------
  */

  handleActionBar(message) {
    const text =
      this.safeText(message);

    if (!text) {
      return;
    }

    const lower =
      text.toLowerCase();

    /*
     * FakePixel repeatedly sends things like:
     *
     * 100/100♥
     * 100/100 Mana
     *
     * Ignore those to prevent console spam.
     */

    if (
      (
        lower.includes('mana') &&
        lower.includes('100/100')
      ) ||
      (
        lower.includes('100/100') &&
        (
          lower.includes('♥') ||
          lower.includes('❤')
        )
      )
    ) {
      return;
    }

    this.lastActionBar = text;

    this.emit(
      'actionBar',
      text
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Window events
  |--------------------------------------------------------------------------
  */

  handleWindowOpen(window) {
    if (!window) {
      return;
    }

    const title =
      this.safeText(
        window.title || ''
      );

    this.log(
      `GUI opened: ${title || 'Unknown GUI'}`
    );

    this.emit(
      'windowOpen',
      {
        title,
        type: window.type,
        slots: window.slots
          ? window.slots.length
          : 0
      }
    );

    if (
      this.flow === 'game-menu'
    ) {
      this.handleGameMenuWindow(
        window
      );

      return;
    }

    if (
      this.flow === 'visiting'
    ) {
      this.handleVisitWindow(
        window
      );

      return;
    }
  }

  handleWindowClose(window) {
    const title =
      window
        ? this.safeText(
            window.title || ''
          )
        : '';

    this.log(
      `GUI closed: ${title || 'Unknown GUI'}`
    );

    this.emit(
      'windowClose',
      {
        title
      }
    );

    /*
     * IMPORTANT:
     *
     * Closing Visit GUI does NOT automatically
     * mean target island was reached.
     *
     * We remain in target-island detection.
     */

    if (
      this.flow === 'visiting' &&
      this.visitGuiClicked
    ) {
      this.setFlow(
        'target-island'
      );

      this.log(
        'Visit GUI closed. Waiting for actual island teleport...'
      );

      this.waitForTargetIsland();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Click GUI
  |--------------------------------------------------------------------------
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
              'Minecraft bot is not connected.'
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
  |--------------------------------------------------------------------------
  | Item name
  |--------------------------------------------------------------------------
  */

  itemName(item) {
    if (!item) {
      return 'empty';
    }

    try {
      if (
        item.displayName
      ) {
        return item.displayName;
      }

      if (
        item.name
      ) {
        return item.name;
      }

      if (
        item.type !== undefined
      ) {
        return `item-${item.type}`;
      }

      return 'unknown item';
    } catch (_) {
      return 'unknown item';
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Safe text
  |--------------------------------------------------------------------------
  */

  safeText(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    try {
      if (
        typeof value === 'string'
      ) {
        return value;
      }

      if (
        value.text !== undefined
      ) {
        return String(
          value.text
        );
      }

      if (
        typeof value.toString ===
        'function'
      ) {
        return value.toString();
      }

      return String(value);
    } catch (_) {
      return '';
    }
  }

  /*
  |--------------------------------------------------------------------------
  | AFK
  |--------------------------------------------------------------------------
  */

  startAfk() {
    /*
     * Final safety gate.
     */

    if (
      !this.running ||
      !this.connected ||
      !this.bot ||
      !this.targetReached
    ) {
      this.log(
        'AFK start blocked because target island has not been confirmed.',
        'warn'
      );

      return;
    }

    if (
      this.flow !== 'afk'
    ) {
      return;
    }

    if (
      this.afk
    ) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    this.afkStartedAt =
      Date.now();

    this.log(
      'Target island confirmed. Starting AFK movement.'
    );

    this.log(
      `AFK settings: move=${this.config.moveDistance}, moveInterval=${this.config.moveInterval}ms, jumpInterval=${this.config.jumpInterval}ms`
    );

    if (
      typeof AFKController !==
      'function'
    ) {
      this.log(
        'AFKController could not be loaded from ./afk.',
        'error'
      );

      return;
    }

    try {
      this.afk =
        new AFKController(
          this.bot,
          {
            moveInterval:
              this.config.moveInterval,

            jumpInterval:
              this.config.jumpInterval,

            moveDistance:
              this.config.moveDistance
          }
        );

      if (
        this.afk &&
        typeof this.afk.on ===
        'function'
      ) {
        this.afk.on(
          'log',
          message => {
            this.log(
              message
            );
          }
        );
      }

      if (
        this.afk &&
        typeof this.afk.start ===
        'function'
      ) {
        this.afk.start();
      } else {
        throw new Error(
          'AFKController.start() is not available.'
        );
      }

      this.startDurationTimer();
    } catch (error) {
      this.log(
        `AFK start failed: ${error.message || error}`,
        'error'
      );
    }
  }

  startDurationTimer() {
    if (
      this.durationTimer
    ) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer = null;
    }

    const hours =
      Number(
        this.config.durationHours
      );

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      return;
    }

    const duration =
      hours *
      60 *
      60 *
      1000;

    this.expireAt =
      Date.now() + duration;

    this.log(
      `AFK duration started: ${hours} hour(s).`
    );

    this.durationTimer =
      setTimeout(
        () => {
          this.log(
            'Configured duration expired.'
          );

          this.stop(
            'duration-expired'
          );
        },
        duration
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Start
  |--------------------------------------------------------------------------
  */

  start() {
    if (
      this.running
    ) {
      this.log(
        'Bot is already running.'
      );

      return;
    }

    if (
      !this.config.username
    ) {
      throw new Error(
        'Minecraft username is required.'
      );
    }

    this.running = true;
    this.manualStop = false;

    this.startedAt =
      Date.now();

    this.connected = false;
    this.authenticated = false;

    this.resetFlowState();

    this.setFlow(
      'connecting'
    );

    this.log(
      'Starting FakePixel bot...'
    );

    try {
      this.createBot();
    } catch (error) {
      this.log(
        `Bot creation failed: ${error.message || error}`,
        'error'
      );

      this.running = false;

      this.setFlow(
        'stopped'
      );

      throw error;
    }

    this.emit(
      'started'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Stop
  |--------------------------------------------------------------------------
  */

  stop(reason = 'manual') {
    this.manualStop = true;
    this.running = false;

    this.log(
      `Stopping bot. Reason: ${reason}`
    );

    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    if (
      this.gameMenuTimer
    ) {
      clearTimeout(
        this.gameMenuTimer
      );

      this.gameMenuTimer = null;
    }

    if (
      this.visitTimer
    ) {
      clearTimeout(
        this.visitTimer
      );

      this.visitTimer = null;
    }

    if (
      this.durationTimer
    ) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer = null;
    }

    if (
      this.afk
    ) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    if (
      this.auth
    ) {
      try {
        if (
          typeof this.auth.stop ===
          'function'
        ) {
          this.auth.stop();
        }
      } catch (_) {}
    }

    if (
      this.bot
    ) {
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

    this.auth = null;

    this.connected = false;
    this.authenticated = false;

    this.targetReached = false;

    this.setFlow(
      'stopped'
    );

    this.emit(
      'stopped',
      reason
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Restart
  |--------------------------------------------------------------------------
  */

  restart() {
    this.log(
      'Restarting bot...'
    );

    this.stop(
      'restart'
    );

    setTimeout(
      () => {
        this.manualStop = false;

        try {
          this.start();
        } catch (error) {
          this.log(
            `Restart failed: ${error.message || error}`,
            'error'
          );
        }
      },
      1000
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Rejoin
  |--------------------------------------------------------------------------
  */

  rejoin() {
    this.log(
      'Rejoining FakePixel...'
    );

    this.stop(
      'rejoin'
    );

    setTimeout(
      () => {
        this.manualStop = false;

        try {
          this.start();
        } catch (error) {
          this.log(
            `Rejoin failed: ${error.message || error}`,
            'error'
          );
        }
      },
      1000
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Disconnect / reconnect
  |--------------------------------------------------------------------------
  */

  handleDisconnect(reason) {
    this.connected = false;
    this.authenticated = false;

    this.log(
      `Disconnected from FakePixel: ${this.safeText(reason) || 'connection closed'}`,
      'warn'
    );

    if (
      this.afk
    ) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    this.bot = null;
    this.auth = null;

    this.resetFlowState();

    this.setFlow(
      'disconnected'
    );

    this.emit(
      'disconnected',
      reason
    );

    if (
      this.running &&
      this.config.autoReconnect &&
      !this.manualStop
    ) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (
      this.reconnectTimer
    ) {
      return;
    }

    const delay =
      Number(
        this.config.reconnectDelay
      ) ||
      DEFAULT_RECONNECT_DELAY;

    this.reconnectCount++;

    this.log(
      `Auto-reconnect scheduled in ${delay}ms (attempt ${this.reconnectCount}).`
    );

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer = null;

          if (
            !this.running ||
            this.manualStop
          ) {
            return;
          }

          this.log(
            'Reconnecting to FakePixel...'
          );

          this.connected = false;
          this.authenticated = false;

          this.resetFlowState();

          this.setFlow(
            'connecting'
          );

          try {
            this.createBot();
          } catch (error) {
            this.log(
              `Reconnect failed: ${error.message || error}`,
              'error'
            );

            this.scheduleReconnect();
          }
        },
        delay
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Chat
  |--------------------------------------------------------------------------
  */

  sendChat(message) {
    if (
      !this.bot ||
      !this.connected
    ) {
      throw new Error(
        'Bot is not connected.'
      );
    }

    this.bot.chat(
      String(message)
    );

    this.log(
      `Chat sent: ${message}`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Update configuration
  |--------------------------------------------------------------------------
  */

  updateConfig(newConfig = {}) {
    if (
      newConfig.password !==
      undefined
    ) {
      this.config.password =
        String(
          newConfig.password
        );
    }

    if (
      newConfig.target !==
      undefined
    ) {
      this.config.target =
        String(
          newConfig.target
        ).trim();
    }

    if (
      newConfig.durationHours !==
      undefined
    ) {
      this.config.durationHours =
        Number(
          newConfig.durationHours
        );
    }

    if (
      newConfig.moveInterval !==
      undefined
    ) {
      this.config.moveInterval =
        Number(
          newConfig.moveInterval
        );
    }

    if (
      newConfig.jumpInterval !==
      undefined
    ) {
      this.config.jumpInterval =
        Number(
          newConfig.jumpInterval
        );
    }

    if (
      newConfig.moveDistance !==
      undefined
    ) {
      this.config.moveDistance =
        Number(
          newConfig.moveDistance
        );
    }

    if (
      newConfig.reconnectDelay !==
      undefined
    ) {
      this.config.reconnectDelay =
        Number(
          newConfig.reconnectDelay
        );
    }

    if (
      newConfig.autoReconnect !==
      undefined
    ) {
      this.config.autoReconnect =
        Boolean(
          newConfig.autoReconnect
        );
    }

    this.log(
      'Bot configuration updated.'
    );

    this.emit(
      'config',
      this.getPublicInfo()
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Public information
  |--------------------------------------------------------------------------
  */

  getStatus() {
    if (
      !this.running
    ) {
      return 'stopped';
    }

    if (
      !this.connected
    ) {
      return 'connecting';
    }

    if (
      !this.authenticated
    ) {
      return 'authenticating';
    }

    switch (this.flow) {
      case 'game-menu':
        return 'opening-game-menu';

      case 'waiting-hub':
        return 'waiting-skyblock-hub';

      case 'skyblock-hub':
        return 'skyblock-hub';

      case 'visiting':
        return 'visiting';

      case 'target-island':
        return 'waiting-target-island';

      case 'afk':
        return 'afk';

      default:
        return this.flow;
    }
  }

  getPublicInfo() {
    const now =
      Date.now();

    let uptime = 0;
    let afkUptime = 0;

    if (
      this.startedAt &&
      this.running
    ) {
      uptime =
        now - this.startedAt;
    }

    if (
      this.afkStartedAt &&
      this.targetReached
    ) {
      afkUptime =
        now - this.afkStartedAt;
    }

    return {
      id:
        this.config.id,

      username:
        this.config.username,

      target:
        this.config.target,

      durationHours:
        this.config.durationHours,

      moveInterval:
        this.config.moveInterval,

      jumpInterval:
        this.config.jumpInterval,

      moveDistance:
        this.config.moveDistance,

      reconnectDelay:
        this.config.reconnectDelay,

      autoReconnect:
        this.config.autoReconnect,

      running:
        this.running,

      connected:
        this.connected,

      authenticated:
        this.authenticated,

      flow:
        this.flow,

      status:
        this.getStatus(),

      position:
        this.getPosition(),

      uptime,

      afkUptime,

      targetReached:
        this.targetReached,

      hubDetected:
        this.hubDetected,

      visitCommandSent:
        this.visitCommandSent,

      visitGuiClicked:
        this.visitGuiClicked,

      reconnectCount:
        this.reconnectCount,

      expireAt:
        this.expireAt,

      lastLog:
        this.lastLog
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Destroy
  |--------------------------------------------------------------------------
  */

  destroy() {
    this.stop(
      'destroy'
    );

    this.removeAllListeners();
  }
}

/*
|--------------------------------------------------------------------------
| IMPORTANT EXPORT
|--------------------------------------------------------------------------
|
| Supports BOTH:
|
| const FakePixelBot = require('./fakepixel-bot');
|
| AND:
|
| const { FakePixelBot } = require('./fakepixel-bot');
|
|--------------------------------------------------------------------------
*/

module.exports = FakePixelBot;
module.exports.FakePixelBot = FakePixelBot;
