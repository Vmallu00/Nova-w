'use strict';

const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const EventEmitter = require('events');

const MinecraftAuth = require('./minecraft-auth');
const AFKController = require('./afk');

const MC_HOST = process.env.MC_HOST || 'mc.fakepixel.me';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.8.9';

const MAIN_SPAWN = new Vec3(
  Number(process.env.MAIN_SPAWN_X || -52.500),
  Number(process.env.MAIN_SPAWN_Y || 95.74244),
  Number(process.env.MAIN_SPAWN_Z || 0.500)
);

const SKYBLOCK_HUB = new Vec3(
  Number(process.env.SKYBLOCK_HUB_X || -2.500),
  Number(process.env.SKYBLOCK_HUB_Y || 70.06250),
  Number(process.env.SKYBLOCK_HUB_Z || -68.000)
);

const LOCATION_TOLERANCE = Number(
  process.env.LOCATION_TOLERANCE || 5
);

const CHECK_TIMEOUT_INTERVAL = Number(
  process.env.CHECK_TIMEOUT_INTERVAL || 120000
);

const DEFAULT_PASSWORD =
  process.env.DEFAULT_MC_PASSWORD || 'vmallu';

const DEFAULT_DURATION_HOURS =
  Number(process.env.DEFAULT_DURATION_HOURS || 2);

const DEFAULT_MOVE_INTERVAL =
  Number(process.env.DEFAULT_MOVE_INTERVAL || 8000);

const DEFAULT_JUMP_INTERVAL =
  Number(process.env.DEFAULT_JUMP_INTERVAL || 15000);

const DEFAULT_MOVE_DISTANCE =
  Number(process.env.AFK_MOVE_DISTANCE || 3);

const DEFAULT_RECONNECT_DELAY =
  Number(process.env.RECONNECT_DELAY || 5000);

const ACTION_BAR_SPAM = [
  '100/100',
  'Mana',
  '♥',
  '❤'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function distance(a, b) {
  if (!a || !b) return Infinity;

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;

  return Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );
}

function isNear(a, b, tolerance = LOCATION_TOLERANCE) {
  return distance(a, b) <= tolerance;
}

class FakePixelBot extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      id: config.id || null,

      username: config.username || '',
      password: config.password || DEFAULT_PASSWORD,

      target: config.target || '',

      durationHours:
        Number(config.durationHours || DEFAULT_DURATION_HOURS),

      moveInterval:
        Number(config.moveInterval || DEFAULT_MOVE_INTERVAL),

      jumpInterval:
        Number(config.jumpInterval || DEFAULT_JUMP_INTERVAL),

      moveDistance:
        Number(config.moveDistance || DEFAULT_MOVE_DISTANCE),

      reconnectDelay:
        Number(config.reconnectDelay || DEFAULT_RECONNECT_DELAY),

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

    this.authTimeoutHandler = null;
  }

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
    return this.logs.slice(-limit);
  }

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

  setFlow(flow) {
    if (this.flow === flow) {
      return;
    }

    this.log(
      `State: ${this.flow} -> ${flow}`
    );

    this.flow = flow;

    this.emit('state', flow);
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
      clearTimeout(this.gameMenuTimer);
      this.gameMenuTimer = null;
    }

    if (this.visitTimer) {
      clearTimeout(this.visitTimer);
      this.visitTimer = null;
    }
  }

  createBot() {
    if (!this.config.username) {
      throw new Error('Minecraft username is required.');
    }

    this.log(
      `Connecting to ${MC_HOST}:${MC_PORT} as ${this.config.username}...`
    );

    this.bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: this.config.username,
      version: MC_VERSION,

      auth: 'offline',

      keepAlive: true,

      checkTimeoutInterval:
        CHECK_TIMEOUT_INTERVAL,

      hideErrors: false
    });

    this.registerBotEvents();

    this.auth = new MinecraftAuth(
      this.bot,
      this.config.password || DEFAULT_PASSWORD
    );

    this.registerAuthEvents();

    return this.bot;
  }

  registerBotEvents() {
    if (!this.bot) return;

    this.bot.on('login', () => {
      this.connected = true;
      this.connectedAt = Date.now();

      this.log(
        `Minecraft connection established.`
      );

      this.emit('connected');
    });

    this.bot.on('spawn', async () => {
      this.connected = true;

      this.log(
        `Minecraft spawn event received.`
      );

      /*
       * IMPORTANT:
       *
       * Do NOT check MAIN_SPAWN here.
       *
       * FakePixel's actual main hub position can be
       * different from the configured MAIN_SPAWN coordinate.
       *
       * We are already authenticated/spawned, so the next
       * step is always opening Game Menu.
       */

      if (
        this.authenticated &&
        this.running
      ) {
        await sleep(2500);

        if (
          this.running &&
          this.connected &&
          !this.targetReached
        ) {
          this.setFlow('game-menu');

          this.openGameMenu();
        }
      }
    });

    this.bot.on('message', message => {
      this.handleMinecraftMessage(message);
    });

    this.bot.on('actionBar', message => {
      this.handleActionBar(message);
    });

    this.bot.on('windowOpen', window => {
      this.handleWindowOpen(window);
    });

    this.bot.on('windowClose', window => {
      this.handleWindowClose(window);
    });

    this.bot.on('kicked', reason => {
      this.log(
        `Kicked from server: ${this.safeText(reason)}`,
        'warn'
      );
    });

    this.bot.on('error', error => {
      this.log(
        `Minecraft error: ${error.message || error}`,
        'error'
      );

      this.emit('error', error);
    });

    this.bot.on('end', reason => {
      this.handleDisconnect(reason);
    });
  }

  registerAuthEvents() {
    if (!this.auth) return;

    this.auth.on('authenticated', async () => {
      this.authenticated = true;

      this.log(
        `Authentication successful.`
      );

      if (!this.running) {
        return;
      }

      /*
       * Correct flow:
       *
       * AUTH
       * ↓
       * MAIN FAKEPIXEL HUB
       * ↓
       * GAME MENU
       * ↓
       * SKYBLOCK HUB
       * ↓
       * /visit TARGET
       * ↓
       * VISIT GUI
       * ↓
       * TARGET ISLAND
       * ↓
       * AFK
       */

      this.setFlow('game-menu');

      await sleep(2000);

      if (
        this.running &&
        this.connected &&
        this.bot
      ) {
        this.openGameMenu();
      }
    });

    this.auth.on('authTimeout', () => {
      this.log(
        `Authentication timeout.`,
        'warn'
      );
    });

    this.auth.on('authLog', message => {
      this.log(message);
    });
  }

  handleMinecraftMessage(message) {
    const text = this.safeText(message);

    if (!text) {
      return;
    }

    this.emit('chat', text);

    /*
     * Authentication system handles actual
     * register/login prompts.
     */

    if (
      this.flow === 'waiting-hub' ||
      this.flow === 'skyblock-hub'
    ) {
      const lower = text.toLowerCase();

      if (
        lower.includes('skyblock') &&
        (
          lower.includes('hub') ||
          lower.includes('teleport') ||
          lower.includes('joining')
        )
      ) {
        this.log(
          `Server indicates SkyBlock Hub transition: ${text}`
        );
      }
    }

    if (
      this.flow === 'visiting' ||
      this.flow === 'target-island'
    ) {
      const lower = text.toLowerCase();

      if (
        lower.includes('visiting') ||
        lower.includes('visited') ||
        lower.includes('teleported') ||
        lower.includes('teleporting') ||
        lower.includes('sending you') ||
        lower.includes('joining')
      ) {
        this.log(
          `Visit/server message: ${text}`
        );
      }
    }
  }

  handleActionBar(message) {
    const text = this.safeText(message);

    if (!text) {
      return;
    }

    /*
     * FakePixel frequently sends messages such as:
     *
     * 100/100♥
     * 100/100 Mana
     *
     * Do not spam the console with those.
     */

    const lower = text.toLowerCase();

    const isSpam = ACTION_BAR_SPAM.every(
      part => lower.includes(part.toLowerCase())
    );

    if (isSpam) {
      return;
    }

    this.lastActionBar = text;

    this.emit('actionBar', text);
  }

  handleWindowOpen(window) {
    if (!window) {
      return;
    }

    const title = this.safeText(
      window.title || ''
    );

    this.log(
      `GUI opened: ${title || 'Unknown GUI'}`
    );

    this.emit('windowOpen', {
      title,
      type: window.type,
      slots: window.slots
    });

    if (
      this.flow === 'game-menu'
    ) {
      this.handleGameMenuWindow(window);
      return;
    }

    if (
      this.flow === 'visiting'
    ) {
      this.handleVisitWindow(window);
      return;
    }
  }

  handleWindowClose(window) {
    const title = window
      ? this.safeText(window.title || '')
      : '';

    this.log(
      `GUI closed: ${title || 'Unknown GUI'}`
    );

    this.emit('windowClose', {
      title
    });

    /*
     * Do not automatically start AFK just because
     * the Visit GUI closed.
     *
     * We still require actual target-island arrival.
     */

    if (
      this.flow === 'visiting' &&
      this.visitGuiClicked
    ) {
      this.log(
        `Visit GUI closed. Waiting for target island arrival...`
      );

      this.setFlow('target-island');

      this.waitForTargetIsland();
    }
  }

  async handleGameMenuWindow(window) {
    if (
      this.menuBusy ||
      this.gameMenuClicked
    ) {
      return;
    }

    this.menuBusy = true;

    try {
      this.gameMenuOpened = true;

      this.log(
        `Game Menu opened.`
      );

      /*
       * Visible slot 21
       *
       * Mineflayer uses zero-based indexes.
       *
       * Visible slot 21 => index 20.
       */

      const SKYBLOCK_MENU_SLOT = 20;

      if (
        !window.slots ||
        !window.slots[SKYBLOCK_MENU_SLOT]
      ) {
        this.log(
          `SkyBlock Hub slot 21 was not found in Game Menu.`,
          'warn'
        );

        this.menuBusy = false;

        await sleep(1500);

        if (
          this.running &&
          this.flow === 'game-menu'
        ) {
          this.openGameMenu();
        }

        return;
      }

      const item =
        window.slots[SKYBLOCK_MENU_SLOT];

      this.log(
        `SkyBlock Hub found at visible slot 21: ${this.itemName(item)}`
      );

      await sleep(500);

      if (
        !this.bot ||
        !this.connected ||
        !this.running
      ) {
        return;
      }

      this.log(
        `Clicking SkyBlock Hub slot 21 (Mineflayer index 20)...`
      );

      await this.clickWindow(
        SKYBLOCK_MENU_SLOT,
        0,
        0
      );

      this.gameMenuClicked = true;

      this.menuBusy = false;

      /*
       * We have clicked SkyBlock Hub.
       *
       * Do NOT start AFK.
       *
       * Do NOT send /visit yet.
       *
       * Wait until physical SkyBlock Hub location
       * is detected.
       */

      this.setFlow('waiting-hub');

      this.waitForSkyblockHub();

    } catch (error) {
      this.menuBusy = false;

      this.log(
        `SkyBlock Hub menu click failed: ${error.message || error}`,
        'error'
      );

      await sleep(2000);

      if (
        this.running &&
        this.flow === 'game-menu'
      ) {
        this.openGameMenu();
      }
    }
  }

  async handleVisitWindow(window) {
    if (
      this.visitBusy ||
      this.visitGuiClicked
    ) {
      return;
    }

    this.visitBusy = true;

    try {
      /*
       * Visible slot 12
       * Mineflayer index = 11
       */

      const VISIT_SLOT = 11;

      if (
        !window.slots ||
        !window.slots[VISIT_SLOT]
      ) {
        this.log(
          `Visit target slot 12 was not found.`,
          'warn'
        );

        this.visitBusy = false;

        return;
      }

      const item =
        window.slots[VISIT_SLOT];

      this.log(
        `Visit target found at visible slot 12: ${this.itemName(item)}`
      );

      await sleep(700);

      if (
        !this.bot ||
        !this.connected ||
        !this.running
      ) {
        this.visitBusy = false;
        return;
      }

      /*
       * User requested right-click for Visit slot 12.
       *
       * mouseButton = 1
       */

      this.log(
        `Right-clicking Visit slot 12 (Mineflayer index 11)...`
      );

      try {
        await this.clickWindow(
          VISIT_SLOT,
          1,
          0
        );
      } catch (rightClickError) {
        this.log(
          `Right-click failed: ${rightClickError.message || rightClickError}`,
          'warn'
        );

        /*
         * Some FakePixel menu versions accept left-click
         * instead. Only use it as a fallback.
         */

        if (
          this.bot.currentWindow
        ) {
          this.log(
            `Trying left-click fallback on Visit slot 12...`
          );

          await this.clickWindow(
            VISIT_SLOT,
            0,
            0
          );
        }
      }

      this.visitGuiClicked = true;

      this.visitBusy = false;

      this.setFlow('target-island');

      this.waitForTargetIsland();

    } catch (error) {
      this.visitBusy = false;

      this.log(
        `Visit GUI click failed: ${error.message || error}`,
        'error'
      );
    }
  }

  openGameMenu() {
    if (
      !this.bot ||
      !this.connected ||
      !this.running
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
      clearTimeout(this.gameMenuTimer);
      this.gameMenuTimer = null;
    }

    this.gameMenuTimer = setTimeout(
      async () => {
        this.gameMenuTimer = null;

        if (
          !this.bot ||
          !this.connected ||
          !this.running
        ) {
          return;
        }

        try {
          this.log(
            `Opening FakePixel Game Menu...`
          );

          /*
           * Hotbar slot 1 = Mineflayer index 0.
           */

          await this.bot.setQuickBarSlot(0);

          await sleep(400);

          this.bot.activateItem();

          this.log(
            `Game Menu activated using hotbar slot 1.`
          );

          /*
           * If the GUI does not open, retry.
           */

          await sleep(1500);

          if (
            this.running &&
            this.flow === 'game-menu' &&
            !this.bot.currentWindow
          ) {
            this.log(
              `Game Menu did not open. Retrying...`,
              'warn'
            );

            this.openGameMenu();
          }

        } catch (error) {
          this.log(
            `Could not open Game Menu: ${error.message || error}`,
            'error'
          );

          await sleep(1500);

          if (
            this.running &&
            this.flow === 'game-menu'
          ) {
            this.openGameMenu();
          }
        }
      },
      800
    );
  }

  async waitForSkyblockHub() {
    const timeout = 30000;
    const started = Date.now();

    this.log(
      `Waiting for actual SkyBlock Hub location...`
    );

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      if (
        this.bot.entity &&
        this.bot.entity.position
      ) {
        const pos =
          this.bot.entity.position;

        const d =
          distance(pos, SKYBLOCK_HUB);

        if (
          d <= LOCATION_TOLERANCE
        ) {
          this.hubDetected = true;

          this.log(
            `SkyBlock Hub confirmed at ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} (distance ${d.toFixed(2)}).`
          );

          this.setFlow('skyblock-hub');

          await sleep(1500);

          if (
            this.running &&
            this.connected
          ) {
            this.startVisit();
          }

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

    /*
     * If the coordinate was not reached, do NOT visit
     * and do NOT start AFK.
     *
     * Retry Game Menu from the beginning.
     */

    this.log(
      `SkyBlock Hub was not detected within ${timeout / 1000}s.`,
      'warn'
    );

    this.log(
      `Returning to Game Menu flow instead of starting AFK.`,
      'warn'
    );

    this.gameMenuClicked = false;
    this.menuBusy = false;

    this.setFlow('game-menu');

    await sleep(2000);

    if (
      this.running &&
      this.connected
    ) {
      this.openGameMenu();
    }
  }

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

    if (!this.config.target) {
      this.log(
        `No target username configured.`,
        'error'
      );

      return;
    }

    this.visitCommandSent = true;

    this.hubPositionBeforeVisit =
      this.bot.entity &&
      this.bot.entity.position
        ? this.bot.entity.position.clone()
        : null;

    this.visitStartedAt = Date.now();

    this.setFlow('visiting');

    this.log(
      `Sending /visit ${this.config.target}...`
    );

    try {
      this.bot.chat(
        `/visit ${this.config.target}`
      );
    } catch (error) {
      this.log(
        `Could not send /visit: ${error.message || error}`,
        'error'
      );

      this.visitCommandSent = false;

      this.setFlow('skyblock-hub');

      return;
    }

    /*
     * Wait for Visit GUI.
     */

    this.waitForVisitGui();
  }

  async waitForVisitGui() {
    const timeout = 15000;
    const started = Date.now();

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      if (
        this.bot.currentWindow
      ) {
        this.log(
          `Visit GUI detected.`
        );

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

    this.log(
      `Visit GUI did not appear after /visit.`,
      'warn'
    );

    /*
     * Retry /visit once after a short delay.
     */

    this.visitCommandSent = false;

    await sleep(1500);

    if (
      this.running &&
      this.connected &&
      this.flow === 'visiting'
    ) {
      this.startVisit();
    }
  }

  async waitForTargetIsland() {
    const timeout = 25000;
    const started = Date.now();

    this.log(
      `Waiting for actual target island arrival...`
    );

    while (
      this.running &&
      this.connected &&
      this.bot &&
      Date.now() - started < timeout
    ) {
      if (
        !this.bot.entity ||
        !this.bot.entity.position
      ) {
        await sleep(500);
        continue;
      }

      const pos =
        this.bot.entity.position;

      /*
       * First detection method:
       *
       * Significant movement away from SkyBlock Hub.
       */

      const hubDistance =
        distance(pos, SKYBLOCK_HUB);

      if (
        hubDistance > Math.max(
          LOCATION_TOLERANCE + 5,
          10
        )
      ) {
        /*
         * Also make sure this isn't simply
         * a tiny movement/teleport animation.
         */

        if (
          this.hubPositionBeforeVisit
        ) {
          const moved =
            distance(
              pos,
              this.hubPositionBeforeVisit
            );

          if (moved >= 10) {
            this.confirmTargetIsland(
              'position changed after visit'
            );

            return;
          }
        } else {
          this.confirmTargetIsland(
            'moved away from SkyBlock Hub'
          );

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

    /*
     * Do NOT start AFK if target arrival
     * wasn't confirmed.
     */

    this.log(
      `Target island was not confirmed within ${timeout / 1000}s.`,
      'warn'
    );

    this.log(
      `Returning to SkyBlock Hub visit flow.`,
      'warn'
    );

    this.visitCommandSent = false;
    this.visitGuiClicked = false;
    this.visitBusy = false;

    this.setFlow('skyblock-hub');

    await sleep(1500);

    if (
      this.running &&
      this.connected
    ) {
      this.startVisit();
    }
  }

  confirmTargetIsland(reason) {
    if (
      this.targetReached
    ) {
      return;
    }

    this.targetReached = true;

    const pos =
      this.bot &&
      this.bot.entity &&
      this.bot.entity.position
        ? this.bot.entity.position
        : null;

    if (pos) {
      this.log(
        `Target island confirmed (${reason}) at ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}.`
      );
    } else {
      this.log(
        `Target island confirmed (${reason}).`
      );
    }

    this.setFlow('afk');

    this.startAfk();
  }

  startAfk() {
    if (
      !this.running ||
      !this.connected ||
      !this.bot ||
      !this.targetReached
    ) {
      return;
    }

    if (this.afk) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    this.afkStartedAt = Date.now();

    this.log(
      `Starting AFK movement on target island.`
    );

    this.log(
      `AFK settings: move=${this.config.moveDistance} blocks, moveInterval=${this.config.moveInterval}ms, jumpInterval=${this.config.jumpInterval}ms`
    );

    this.afk = new AFKController(
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

    this.afk.on(
      'log',
      message => {
        this.log(message);
      }
    );

    try {
      this.afk.start();
    } catch (error) {
      this.log(
        `AFK start failed: ${error.message || error}`,
        'error'
      );
    }

    this.startDurationTimer();
  }

  startDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    const hours =
      Number(this.config.durationHours);

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      return;
    }

    const milliseconds =
      hours * 60 * 60 * 1000;

    this.expireAt =
      Date.now() + milliseconds;

    this.log(
      `AFK duration started: ${hours} hour(s).`
    );

    this.durationTimer =
      setTimeout(
        () => {
          this.log(
            `Configured duration expired.`
          );

          this.stop(
            'duration-expired'
          );
        },
        milliseconds
      );
  }

  checkLocation() {
    if (
      !this.bot ||
      !this.bot.entity ||
      !this.bot.entity.position
    ) {
      return;
    }

    const pos =
      this.bot.entity.position;

    this.lastPosition = {
      x: pos.x,
      y: pos.y,
      z: pos.z
    };

    /*
     * Only use location detection for the
     * current expected flow.
     */

    if (
      this.flow === 'waiting-hub'
    ) {
      const d =
        distance(pos, SKYBLOCK_HUB);

      if (
        d <= LOCATION_TOLERANCE
      ) {
        this.hubDetected = true;

        this.log(
          `SkyBlock Hub detected.`
        );

        this.setFlow('skyblock-hub');

        if (
          !this.visitCommandSent
        ) {
          this.startVisit();
        }
      }
    }

    /*
     * IMPORTANT:
     *
     * Never start AFK from main hub.
     *
     * AFK is only started by confirmTargetIsland().
     */
  }

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

  itemName(item) {
    if (!item) {
      return 'empty';
    }

    try {
      if (item.displayName) {
        return item.displayName;
      }

      if (item.name) {
        return item.name;
      }

      return `item ${item.type || ''}`;
    } catch (_) {
      return 'unknown item';
    }
  }

  safeText(value) {
    if (value === null || value === undefined) {
      return '';
    }

    try {
      if (
        typeof value === 'string'
      ) {
        return value;
      }

      if (
        typeof value.toString === 'function'
      ) {
        return value.toString();
      }

      return String(value);
    } catch (_) {
      return '';
    }
  }

  start() {
    if (this.running) {
      this.log(
        `Bot is already running.`
      );

      return;
    }

    this.running = true;
    this.manualStop = false;

    this.startedAt = Date.now();

    this.authenticated = false;
    this.connected = false;

    this.resetFlowState();

    this.setFlow('connecting');

    this.log(
      `Starting bot...`
    );

    this.createBot();

    this.emit('started');
  }

  stop(reason = 'manual') {
    this.manualStop = true;
    this.running = false;

    this.log(
      `Stopping bot. Reason: ${reason}`
    );

    if (this.reconnectTimer) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

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

    if (this.durationTimer) {
      clearTimeout(
        this.durationTimer
      );

      this.durationTimer = null;
    }

    if (this.afk) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    if (this.auth) {
      try {
        this.auth.stop();
      } catch (_) {}
    }

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

    this.connected = false;
    this.authenticated = false;

    this.targetReached = false;

    this.setFlow('stopped');

    this.emit('stopped', reason);
  }

  restart() {
    this.log(
      `Restarting bot...`
    );

    this.stop('restart');

    setTimeout(
      () => {
        this.manualStop = false;
        this.start();
      },
      1000
    );
  }

  rejoin() {
    this.log(
      `Rejoining FakePixel...`
    );

    this.stop('rejoin');

    setTimeout(
      () => {
        this.manualStop = false;
        this.start();
      },
      1000
    );
  }

  handleDisconnect(reason) {
    this.connected = false;
    this.authenticated = false;

    this.log(
      `Disconnected from FakePixel: ${this.safeText(reason) || 'connection closed'}`,
      'warn'
    );

    if (this.afk) {
      try {
        this.afk.stop();
      } catch (_) {}

      this.afk = null;
    }

    this.bot = null;
    this.auth = null;

    this.resetFlowState();

    this.setFlow('disconnected');

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

    this.reconnectCount++;

    const delay =
      Number(this.config.reconnectDelay) ||
      DEFAULT_RECONNECT_DELAY;

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
            `Reconnecting...`
          );

          this.authenticated = false;
          this.connected = false;

          this.resetFlowState();

          this.setFlow('connecting');

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

  updateConfig(newConfig = {}) {
    const allowed = [
      'password',
      'target',
      'durationHours',
      'moveInterval',
      'jumpInterval',
      'moveDistance',
      'reconnectDelay',
      'autoReconnect'
    ];

    for (
      const key of allowed
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          newConfig,
          key
        )
      ) {
        this.config[key] =
          newConfig[key];
      }
    }

    if (
      newConfig.durationHours !== undefined
    ) {
      this.config.durationHours =
        Number(
          newConfig.durationHours
        );
    }

    if (
      newConfig.moveInterval !== undefined
    ) {
      this.config.moveInterval =
        Number(
          newConfig.moveInterval
        );
    }

    if (
      newConfig.jumpInterval !== undefined
    ) {
      this.config.jumpInterval =
        Number(
          newConfig.jumpInterval
        );
    }

    if (
      newConfig.moveDistance !== undefined
    ) {
      this.config.moveDistance =
        Number(
          newConfig.moveDistance
        );
    }

    if (
      newConfig.reconnectDelay !== undefined
    ) {
      this.config.reconnectDelay =
        Number(
          newConfig.reconnectDelay
        );
    }

    if (
      newConfig.autoReconnect !== undefined
    ) {
      this.config.autoReconnect =
        Boolean(
          newConfig.autoReconnect
        );
    }

    this.log(
      `Bot configuration updated.`
    );

    this.emit(
      'config',
      this.getPublicInfo()
    );
  }

  getPublicInfo() {
    const now = Date.now();

    let uptime = 0;

    if (
      this.startedAt &&
      this.running
    ) {
      uptime =
        now - this.startedAt;
    }

    let afkUptime = 0;

    if (
      this.afkStartedAt &&
      this.targetReached
    ) {
      afkUptime =
        now - this.afkStartedAt;
    }

    const position =
      this.getPosition();

    return {
      id: this.config.id,

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

      position,

      uptime,

      afkUptime,

      targetReached:
        this.targetReached,

      hubDetected:
        this.hubDetected,

      visitCommandSent:
        this.visitCommandSent,

      reconnectCount:
        this.reconnectCount,

      expireAt:
        this.expireAt,

      lastLog:
        this.lastLog
    };
  }

  getStatus() {
    if (!this.running) {
      return 'stopped';
    }

    if (!this.connected) {
      return 'connecting';
    }

    if (!this.authenticated) {
      return 'authenticating';
    }

    if (
      this.flow === 'game-menu'
    ) {
      return 'opening-game-menu';
    }

    if (
      this.flow === 'waiting-hub'
    ) {
      return 'waiting-skyblock-hub';
    }

    if (
      this.flow === 'skyblock-hub'
    ) {
      return 'skyblock-hub';
    }

    if (
      this.flow === 'visiting'
    ) {
      return 'visiting';
    }

    if (
      this.flow === 'target-island'
    ) {
      return 'waiting-target-island';
    }

    if (
      this.flow === 'afk'
    ) {
      return 'afk';
    }

    return this.flow;
  }

  destroy() {
    this.stop('destroy');
    this.removeAllListeners();
  }
}

module.exports = FakePixelBot;
