require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const BotManagerModule = require('./bot-manager');

const BotManager =
  BotManagerModule.BotManager ||
  BotManagerModule;

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 9000);
const HOST = '0.0.0.0';

const PANEL_USERNAME =
  process.env.PANEL_USERNAME || 'vmallu';

const PANEL_PASSWORD =
  process.env.PANEL_PASSWORD || 'vmallu';

const PUBLIC_DIR = path.join(__dirname, 'public');

/* =========================================================
   APP SETUP
========================================================= */

app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* =========================================================
   BOT MANAGER
========================================================= */

let manager;

try {
  manager = new BotManager();

  console.log('[SERVER] Bot manager initialized.');
} catch (error) {
  console.error('[SERVER] Failed to initialize BotManager:');
  console.error(error);

  process.exit(1);
}

/* =========================================================
   AUTH SESSIONS
========================================================= */

const sessions = new Map();

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidLogin(username, password) {
  return (
    username === PANEL_USERNAME &&
    password === PANEL_PASSWORD
  );
}

function getTokenFromRequest(req) {
  const header = req.headers.authorization;

  if (!header) {
    return null;
  }

  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return header.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  next();
}

/* =========================================================
   HELPERS
========================================================= */

function getStoredBots() {
  try {
    if (
      manager &&
      typeof manager.getStoredBots === 'function'
    ) {
      const bots = manager.getStoredBots();

      return Array.isArray(bots) ? bots : [];
    }

    if (
      manager &&
      manager.state &&
      Array.isArray(manager.state.bots)
    ) {
      return manager.state.bots;
    }

    return [];
  } catch (error) {
    console.error(
      '[SERVER] getStoredBots error:',
      error.message
    );

    return [];
  }
}

function getRunningBots() {
  try {
    if (
      manager &&
      typeof manager.getAll === 'function'
    ) {
      const bots = manager.getAll();

      return Array.isArray(bots) ? bots : [];
    }

    return [];
  } catch (error) {
    console.error(
      '[SERVER] getRunningBots error:',
      error.message
    );

    return [];
  }
}

function findStoredBot(id) {
  const bots = getStoredBots();

  return (
    bots.find(
      bot => String(bot.id) === String(id)
    ) || null
  );
}

function findBot(id) {
  if (!manager) {
    return null;
  }

  try {
    if (typeof manager.get === 'function') {
      return manager.get(id);
    }
  } catch (_) {}

  return null;
}

function publicBotData(config, instance) {
  const source = config || {};

  let info = {};

  try {
    if (
      instance &&
      typeof instance.getPublicInfo === 'function'
    ) {
      info = instance.getPublicInfo() || {};
    } else if (
      instance &&
      typeof instance.getInfo === 'function'
    ) {
      info = instance.getInfo() || {};
    }
  } catch (_) {}

  return {
    id:
      source.id ??
      info.id ??
      instance?.id ??
      null,

    username:
      source.username ??
      info.username ??
      instance?.username ??
      '',

    target:
      source.target ??
      info.target ??
      instance?.target ??
      '',

    passwordSet:
      Boolean(source.password || instance?.password),

    durationHours:
      Number(
        source.durationHours ??
        info.durationHours ??
        instance?.durationHours ??
        0
      ),

    moveInterval:
      Number(
        source.moveInterval ??
        info.moveInterval ??
        instance?.moveInterval ??
        10000
      ),

    jumpInterval:
      Number(
        source.jumpInterval ??
        info.jumpInterval ??
        instance?.jumpInterval ??
        2500
      ),

    moveDistance:
      Number(
        source.moveDistance ??
        info.moveDistance ??
        instance?.moveDistance ??
        4
      ),

    reconnectDelay:
      Number(
        source.reconnectDelay ??
        info.reconnectDelay ??
        instance?.reconnectDelay ??
        5000
      ),

    autoReconnect:
      source.autoReconnect ??
      info.autoReconnect ??
      instance?.autoReconnect ??
      true,

    enabled:
      source.enabled !== false,

    createdAt:
      source.createdAt ??
      info.createdAt ??
      null,

    status:
      info.status ??
      instance?.status ??
      instance?.state ??
      (instance ? 'unknown' : 'stopped'),

    state:
      info.state ??
      instance?.state ??
      null,

    connected:
      Boolean(
        info.connected ??
        instance?.bot?.player ??
        instance?.connected ??
        false
      ),

    uptime:
      info.uptime ??
      instance?.uptime ??
      0,

    position:
      info.position ??
      instance?.bot?.entity?.position ??
      instance?.position ??
      null,

    logs:
      undefined
  };
}

function getAllBotData() {
  const stored = getStoredBots();

  return stored.map(config => {
    const instance = findBot(config.id);

    return publicBotData(config, instance);
  });
}

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

function sendSuccess(res, data = {}) {
  return res.json({
    success: true,
    ...data
  });
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return (
    String(value).toLowerCase() === 'true' ||
    String(value) === '1' ||
    String(value).toLowerCase() === 'yes'
  );
}

function cleanBotConfig(body = {}) {
  const config = {};

  if (body.id) {
    config.id = String(body.id);
  }

  if (body.username !== undefined) {
    config.username = String(body.username).trim();
  }

  if (body.password !== undefined) {
    config.password = String(body.password);
  }

  if (body.target !== undefined) {
    config.target = String(body.target).trim();
  }

  if (body.durationHours !== undefined) {
    config.durationHours =
      Number(body.durationHours);
  }

  if (body.moveInterval !== undefined) {
    config.moveInterval =
      Number(body.moveInterval);
  }

  if (body.jumpInterval !== undefined) {
    config.jumpInterval =
      Number(body.jumpInterval);
  }

  if (body.moveDistance !== undefined) {
    config.moveDistance =
      Number(body.moveDistance);
  }

  if (body.reconnectDelay !== undefined) {
    config.reconnectDelay =
      Number(body.reconnectDelay);
  }

  if (body.autoReconnect !== undefined) {
    config.autoReconnect =
      parseBoolean(body.autoReconnect);
  }

  if (body.enabled !== undefined) {
    config.enabled =
      parseBoolean(body.enabled, true);
  }

  return config;
}

/* =========================================================
   HEALTH
========================================================= */

app.get('/health', (req, res) => {
  const stored = getStoredBots();
  const running = getRunningBots();

  res.json({
    status: 'ok',
    service: 'fakepixel-multi-bot-manager',
    node: process.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    bots: {
      stored: stored.length,
      running: running.length
    }
  });
});

app.get('/api/health', (req, res) => {
  const stored = getStoredBots();
  const running = getRunningBots();

  res.json({
    success: true,
    status: 'ok',
    node: process.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    bots: {
      stored: stored.length,
      running: running.length
    }
  });
});

/* =========================================================
   LOGIN
========================================================= */

app.post('/api/login', (req, res) => {
  try {
    const {
      username,
      password
    } = req.body || {};

    if (!isValidLogin(username, password)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password.'
      });
    }

    const token = createToken();

    sessions.set(token, {
      username,
      createdAt: Date.now()
    });

    return res.json({
      success: true,
      token,
      username
    });
  } catch (error) {
    return sendError(res, 500, error);
  }
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = getTokenFromRequest(req);

  if (token) {
    sessions.delete(token);
  }

  return res.json({
    success: true
  });
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get('/api/dashboard', requireAuth, (req, res) => {
  try {
    const bots = getAllBotData();

    return res.json({
      success: true,

      bots,

      stats: {
        total: bots.length,

        running: bots.filter(
          bot =>
            bot.connected ||
            bot.status === 'online' ||
            bot.status === 'afk' ||
            bot.state === 'afk'
        ).length,

        stopped: bots.filter(
          bot =>
            bot.status === 'stopped' ||
            bot.status === 'idle'
        ).length
      },

      settings:
        typeof manager.getSettings === 'function'
          ? manager.getSettings()
          : {}
    });
  } catch (error) {
    return sendError(res, 500, error);
  }
});

/* =========================================================
   BOTS - LIST
========================================================= */

app.get('/api/bots', requireAuth, (req, res) => {
  try {
    return res.json({
      success: true,
      bots: getAllBotData()
    });
  } catch (error) {
    return sendError(res, 500, error);
  }
});

/* =========================================================
   BOTS - GET
========================================================= */

app.get('/api/bots/:id', requireAuth, (req, res) => {
  try {
    const config = findStoredBot(req.params.id);

    if (!config) {
      return sendError(
        res,
        404,
        'Bot not found.'
      );
    }

    const instance = findBot(req.params.id);

    return res.json({
      success: true,
      bot: publicBotData(config, instance)
    });
  } catch (error) {
    return sendError(res, 500, error);
  }
});

/* =========================================================
   BOTS - CREATE
========================================================= */

app.post('/api/bots', requireAuth, (req, res) => {
  try {
    const config = cleanBotConfig(req.body);

    if (!config.username) {
      return sendError(
        res,
        400,
        'Minecraft username is required.'
      );
    }

    if (
      config.durationHours !== undefined &&
      (
        !Number.isFinite(config.durationHours) ||
        config.durationHours <= 0
      )
    ) {
      return sendError(
        res,
        400,
        'Duration must be greater than 0.'
      );
    }

    const bot = manager.create(config);

    const id = bot?.id || config.id;

    const stored = findStoredBot(id);

    return res.status(201).json({
      success: true,
      bot: publicBotData(
        stored || config,
        bot
      )
    });
  } catch (error) {
    return sendError(res, 400, error);
  }
});

/* =========================================================
   BOTS - UPDATE
========================================================= */

app.put('/api/bots/:id', requireAuth, (req, res) => {
  try {
    const updates = cleanBotConfig(req.body);

    delete updates.id;

    const updated = manager.update(
      req.params.id,
      updates
    );

    return res.json({
      success: true,
      bot: publicBotData(
        updated,
        findBot(req.params.id)
      )
    });
  } catch (error) {
    return sendError(res, 400, error);
  }
});

app.patch('/api/bots/:id', requireAuth, (req, res) => {
  try {
    const updates = cleanBotConfig(req.body);

    delete updates.id;

    const updated = manager.update(
      req.params.id,
      updates
    );

    return res.json({
      success: true,
      bot: publicBotData(
        updated,
        findBot(req.params.id)
      )
    });
  } catch (error) {
    return sendError(res, 400, error);
  }
});

/* =========================================================
   BOTS - DELETE
========================================================= */

app.delete('/api/bots/:id', requireAuth, (req, res) => {
  try {
    const existing = findStoredBot(req.params.id);

    if (!existing) {
      return sendError(
        res,
        404,
        'Bot not found.'
      );
    }

    manager.remove(req.params.id);

    return res.json({
      success: true,
      message: 'Bot deleted.'
    });
  } catch (error) {
    return sendError(res, 400, error);
  }
});

/* =========================================================
   BOT ACTIONS
========================================================= */

app.post(
  '/api/bots/:id/start',
  requireAuth,
  (req, res) => {
    try {
      manager.start(req.params.id);

      return res.json({
        success: true,
        message: 'Bot started.'
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.post(
  '/api/bots/:id/stop',
  requireAuth,
  (req, res) => {
    try {
      manager.stop(req.params.id);

      return res.json({
        success: true,
        message: 'Bot stopped.'
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.post(
  '/api/bots/:id/restart',
  requireAuth,
  (req, res) => {
    try {
      manager.restart(req.params.id);

      return res.json({
        success: true,
        message: 'Bot restarted.'
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.post(
  '/api/bots/:id/rejoin',
  requireAuth,
  (req, res) => {
    try {
      manager.rejoin(req.params.id);

      return res.json({
        success: true,
        message: 'Bot rejoining FakePixel.'
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   ALL BOT ACTIONS
========================================================= */

app.post(
  '/api/bots/start-all',
  requireAuth,
  (req, res) => {
    try {
      const result = manager.startAll();

      return res.json({
        success: true,
        results: result
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.post(
  '/api/bots/stop-all',
  requireAuth,
  (req, res) => {
    try {
      const result = manager.stopAll();

      return res.json({
        success: true,
        results: result
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.post(
  '/api/bots/rejoin-all',
  requireAuth,
  (req, res) => {
    try {
      const result = manager.rejoinAll();

      return res.json({
        success: true,
        results: result
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   BOT LOGS
========================================================= */

app.get(
  '/api/bots/:id/logs',
  requireAuth,
  (req, res) => {
    try {
      const limit = Math.min(
        Math.max(
          Number(req.query.limit || 200),
          1
        ),
        1000
      );

      const logs = manager.logs(
        req.params.id,
        limit
      );

      return res.json({
        success: true,
        logs: Array.isArray(logs)
          ? logs
          : []
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   BOT CHAT
========================================================= */

app.post(
  '/api/bots/:id/chat',
  requireAuth,
  (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ''
        ).trim();

      if (!message) {
        return sendError(
          res,
          400,
          'Message is required.'
        );
      }

      manager.chat(
        req.params.id,
        message
      );

      return res.json({
        success: true,
        message: 'Message sent.'
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   BOT SAVE
========================================================= */

app.post(
  '/api/bots/:id/save',
  requireAuth,
  (req, res) => {
    try {
      const result =
        manager.saveBot(
          req.params.id
        );

      return res.json({
        success: true,
        config: result
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   SETTINGS
========================================================= */

app.get(
  '/api/settings',
  requireAuth,
  (req, res) => {
    try {
      const settings =
        typeof manager.getSettings === 'function'
          ? manager.getSettings()
          : {};

      return res.json({
        success: true,
        settings
      });
    } catch (error) {
      return sendError(res, 500, error);
    }
  }
);

app.put(
  '/api/settings',
  requireAuth,
  (req, res) => {
    try {
      if (
        !manager ||
        typeof manager.updateSettings !== 'function'
      ) {
        return sendError(
          res,
          500,
          'Settings manager is unavailable.'
        );
      }

      const body = req.body || {};

      const updates = {};

      if (body.defaultPassword !== undefined) {
        updates.defaultPassword =
          String(body.defaultPassword);
      }

      if (body.defaultTarget !== undefined) {
        updates.defaultTarget =
          String(body.defaultTarget).trim();
      }

      if (body.maxBots !== undefined) {
        updates.maxBots =
          Math.max(
            1,
            Number(body.maxBots)
          );
      }

      if (body.autoReconnect !== undefined) {
        updates.autoReconnect =
          parseBoolean(
            body.autoReconnect
          );
      }

      if (body.reconnectDelay !== undefined) {
        updates.reconnectDelay =
          Math.max(
            1000,
            Number(body.reconnectDelay)
          );
      }

      if (body.moveInterval !== undefined) {
        updates.moveInterval =
          Math.max(
            1000,
            Number(body.moveInterval)
          );
      }

      if (body.jumpInterval !== undefined) {
        updates.jumpInterval =
          Math.max(
            1000,
            Number(body.jumpInterval)
          );
      }

      if (body.moveDistance !== undefined) {
        updates.moveDistance =
          Math.max(
            1,
            Number(body.moveDistance)
          );
      }

      const settings =
        manager.updateSettings(
          updates
        );

      return res.json({
        success: true,
        settings
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

app.patch(
  '/api/settings',
  requireAuth,
  (req, res) => {
    try {
      const settings =
        manager.updateSettings(
          req.body || {}
        );

      return res.json({
        success: true,
        settings
      });
    } catch (error) {
      return sendError(res, 400, error);
    }
  }
);

/* =========================================================
   PANEL INFO
========================================================= */

app.get(
  '/api/info',
  requireAuth,
  (req, res) => {
    try {
      const settings =
        typeof manager.getSettings === 'function'
          ? manager.getSettings()
          : {};

      const bots =
        getAllBotData();

      return res.json({
        success: true,

        panel: {
          name: 'FakePixel Multi-Bot Manager',
          version: '1.0.0'
        },

        minecraft: {
          host:
            process.env.MC_HOST ||
            'mc.fakepixel.me',

          port:
            Number(
              process.env.MC_PORT ||
              25565
            ),

          version:
            process.env.MC_VERSION ||
            '1.8.9'
        },

        bots: {
          stored: bots.length,

          running:
            getRunningBots().length,

          max:
            Number(
              settings.maxBots ||
              process.env.MAX_BOTS ||
              20
            )
        }
      });
    } catch (error) {
      return sendError(res, 500, error);
    }
  }
);

/* =========================================================
   STATIC WEB PANEL
========================================================= */

app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html'
  })
);

/*
 * Express 5:
 *
 * Do NOT use:
 *
 * app.get('*', ...)
 *
 * because Express 5 / path-to-regexp
 * rejects the old wildcard syntax.
 *
 * This route serves the SPA for non-API GET
 * requests.
 */
app.get(
  '/*splat',
  (req, res, next) => {
    if (
      req.path.startsWith('/api/')
    ) {
      return next();
    }

    return res.sendFile(
      path.join(
        PUBLIC_DIR,
        'index.html'
      )
    );
  }
);

/* =========================================================
   404 API
========================================================= */

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      success: false,
      error: 'API endpoint not found.'
    });
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      '[SERVER ERROR]',
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        'Internal server error.'
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

const server = app.listen(
  PORT,
  HOST,
  () => {
    let storedBots = [];

    try {
      storedBots =
        getStoredBots();
    } catch (error) {
      console.error(
        '[SERVER] Could not read stored bots:',
        error.message
      );
    }

    console.log('');
    console.log(
      '========================================'
    );
    console.log(
      '   FakePixel Multi-Bot Manager'
    );
    console.log(
      '========================================'
    );
    console.log('');
    console.log(
      `Web panel: http://${HOST}:${PORT}`
    );
    console.log(
      `Stored bots: ${storedBots.length}`
    );
    console.log(
      `Running bots: ${getRunningBots().length}`
    );
    console.log(
      `Node.js: ${process.version}`
    );
    console.log('');
  }
);

/* =========================================================
   OPTIONAL AUTO START
========================================================= */

const AUTO_START_BOTS =
  String(
    process.env.AUTO_START_BOTS || 'false'
  ).toLowerCase() === 'true';

if (AUTO_START_BOTS) {
  setTimeout(() => {
    try {
      console.log(
        '[SERVER] AUTO_START_BOTS enabled.'
      );

      manager.startAll();
    } catch (error) {
      console.error(
        '[SERVER] Auto-start failed:',
        error.message
      );
    }
  }, 3000);
}

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[SERVER] Received ${signal}. Shutting down...`
  );

  try {
    if (
      manager &&
      typeof manager.shutdown === 'function'
    ) {
      manager.shutdown();
    }
  } catch (error) {
    console.error(
      '[SERVER] Manager shutdown error:',
      error.message
    );
  }

  server.close(() => {
    console.log(
      '[SERVER] HTTP server closed.'
    );

    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 10000).unref();
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '[SERVER] Uncaught exception:',
      error
    );
  }
);

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '[SERVER] Unhandled rejection:',
      error
    );
  }
);

module.exports = {
  app,
  server,
  manager
};
