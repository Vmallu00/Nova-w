"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const database = require("./database");
const { BotManager } = require("./bot-manager");

const app = express();
const manager = new BotManager(database);

const PORT = Number(process.env.PORT || 9000);

const PANEL_USERNAME =
  process.env.PANEL_USERNAME || "vmallu";

const PANEL_PASSWORD =
  process.env.PANEL_PASSWORD || "vmallu";

const sessions = new Map();

app.disable("x-powered-by");

app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: false
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function createSession() {
  const token =
    crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    createdAt: Date.now()
  });

  return token;
}

function getToken(req) {
  const header =
    String(
      req.headers.authorization || ""
    );

  if (
    header.toLowerCase().startsWith("bearer ")
  ) {
    return header.slice(7).trim();
  }

  return null;
}

function isAuthenticated(req) {
  const token = getToken(req);

  if (!token) {
    return false;
  }

  return sessions.has(token);
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  next();
}

function success(res, data = {}) {
  return res.json({
    success: true,
    ...data
  });
}

function failure(
  res,
  error,
  status = 400
) {
  console.error(
    "[API ERROR]",
    error
  );

  return res.status(status).json({
    success: false,
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

function sanitizeSettings(settings) {
  return {
    defaultTarget:
      settings.defaultTarget || "",

    maxBots:
      Number(settings.maxBots || 20),

    autoReconnect:
      Boolean(settings.autoReconnect),

    reconnectDelay:
      Number(settings.reconnectDelay || 5000),

    moveInterval:
      Number(settings.moveInterval || 8000),

    jumpInterval:
      Number(settings.jumpInterval || 15000),

    moveDistance:
      Number(settings.moveDistance || 3)
  };
}

// --------------------------------------------------
// Health
// --------------------------------------------------

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",
      service: "fakepixel-afk-manager",
      time: new Date().toISOString()
    });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    return success(res, {
      service: "fakepixel-afk-manager",
      time: new Date().toISOString()
    });
  }
);

// --------------------------------------------------
// Login
// --------------------------------------------------

app.post(
  "/api/login",
  (req, res) => {
    const username =
      String(
        req.body?.username || ""
      ).trim();

    const password =
      String(
        req.body?.password || ""
      );

    if (
      username !== PANEL_USERNAME ||
      password !== PANEL_PASSWORD
    ) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password."
      });
    }

    const token =
      createSession();

    return success(res, {
      token
    });
  }
);

app.post(
  "/api/logout",
  requireAuth,
  (req, res) => {
    const token = getToken(req);

    if (token) {
      sessions.delete(token);
    }

    return success(res);
  }
);

// --------------------------------------------------
// Dashboard
// --------------------------------------------------

app.get(
  "/api/dashboard",
  requireAuth,
  (req, res) => {
    return success(res, {
      bots: manager.getAll(),
      settings:
        sanitizeSettings(
          manager.getSettings()
        )
    });
  }
);

// --------------------------------------------------
// Bots
// --------------------------------------------------

app.get(
  "/api/bots",
  requireAuth,
  (req, res) => {
    return success(res, {
      bots: manager.getAll()
    });
  }
);

app.post(
  "/api/bots",
  requireAuth,
  (req, res) => {
    try {
      const bot =
        manager.create(
          req.body || {}
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.get(
  "/api/bots/:id",
  requireAuth,
  (req, res) => {
    const bot =
      manager.get(
        req.params.id
      );

    if (!bot) {
      return failure(
        res,
        "Bot not found.",
        404
      );
    }

    return success(res, {
      bot
    });
  }
);

app.delete(
  "/api/bots/:id",
  requireAuth,
  async (req, res) => {
    try {
      const removed =
        await manager.delete(
          req.params.id
        );

      if (!removed) {
        return failure(
          res,
          "Bot not found.",
          404
        );
      }

      return success(res);
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// Individual bot actions
// --------------------------------------------------

app.post(
  "/api/bots/:id/start",
  requireAuth,
  async (req, res) => {
    try {
      const bot =
        await manager.start(
          req.params.id
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.post(
  "/api/bots/:id/stop",
  requireAuth,
  async (req, res) => {
    try {
      const bot =
        await manager.stop(
          req.params.id
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.post(
  "/api/bots/:id/restart",
  requireAuth,
  async (req, res) => {
    try {
      const bot =
        await manager.restart(
          req.params.id
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.post(
  "/api/bots/:id/rejoin",
  requireAuth,
  async (req, res) => {
    try {
      const bot =
        await manager.rejoin(
          req.params.id
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// All bot actions
// --------------------------------------------------

app.post(
  "/api/bots/start-all",
  requireAuth,
  async (req, res) => {
    try {
      const results =
        await manager.startAll();

      return success(res, {
        results
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.post(
  "/api/bots/stop-all",
  requireAuth,
  async (req, res) => {
    try {
      const results =
        await manager.stopAll();

      return success(res, {
        results
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

app.post(
  "/api/bots/rejoin-all",
  requireAuth,
  async (req, res) => {
    try {
      const results =
        await manager.rejoinAll();

      return success(res, {
        results
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// Bot logs
// --------------------------------------------------

app.get(
  "/api/bots/:id/logs",
  requireAuth,
  (req, res) => {
    try {
      const logs =
        manager.getLogs(
          req.params.id
        );

      return success(res, {
        logs
      });
    } catch (error) {
      return failure(
        res,
        error,
        404
      );
    }
  }
);

// --------------------------------------------------
// Bot chat
// --------------------------------------------------

app.post(
  "/api/bots/:id/chat",
  requireAuth,
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ""
        ).trim();

      if (!message) {
        return failure(
          res,
          "Message is required."
        );
      }

      await manager.chat(
        req.params.id,
        message
      );

      return success(res);
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// Bot configuration
// --------------------------------------------------

app.put(
  "/api/bots/:id/config",
  requireAuth,
  (req, res) => {
    try {
      const bot =
        manager.updateConfig(
          req.params.id,
          req.body || {}
        );

      return success(res, {
        bot
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// Global settings
// --------------------------------------------------

app.get(
  "/api/settings",
  requireAuth,
  (req, res) => {
    return success(res, {
      settings:
        sanitizeSettings(
          manager.getSettings()
        )
    });
  }
);

app.put(
  "/api/settings",
  requireAuth,
  (req, res) => {
    try {
      const body =
        req.body || {};

      const changes = {};

      if (
        body.defaultTarget !==
        undefined
      ) {
        changes.defaultTarget =
          String(
            body.defaultTarget
          ).trim();
      }

      if (
        body.maxBots !==
        undefined
      ) {
        changes.maxBots =
          Math.max(
            1,
            Number(body.maxBots)
          );
      }

      if (
        body.autoReconnect !==
        undefined
      ) {
        changes.autoReconnect =
          Boolean(
            body.autoReconnect
          );
      }

      if (
        body.reconnectDelay !==
        undefined
      ) {
        changes.reconnectDelay =
          Math.max(
            1000,
            Number(
              body.reconnectDelay
            )
          );
      }

      if (
        body.moveInterval !==
        undefined
      ) {
        changes.moveInterval =
          Math.max(
            1000,
            Number(
              body.moveInterval
            )
          );
      }

      if (
        body.jumpInterval !==
        undefined
      ) {
        changes.jumpInterval =
          Math.max(
            1000,
            Number(
              body.jumpInterval
            )
          );
      }

      if (
        body.moveDistance !==
        undefined
      ) {
        changes.moveDistance =
          Math.max(
            1,
            Number(
              body.moveDistance
            )
          );
      }

      const settings =
        manager.updateSettings(
          changes
        );

      return success(res, {
        settings:
          sanitizeSettings(
            settings
          )
      });
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  }
);

// --------------------------------------------------
// Frontend fallback
// Express 5 uses the named wildcard syntax.
// --------------------------------------------------

app.get(
  "/*splat",
  (req, res, next) => {
    if (
      req.path.startsWith("/api/")
    ) {
      return next();
    }

    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

// --------------------------------------------------
// Error handler
// --------------------------------------------------

app.use(
  (error, req, res, next) => {
    console.error(
      "[SERVER ERROR]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
);

// --------------------------------------------------
// Start
// --------------------------------------------------

async function startServer() {
  try {
    await manager.restore();

    const server =
      app.listen(
        PORT,
        "0.0.0.0",
        () => {
          console.log(
            "========================================"
          );

          console.log(
            " FakePixel Multi-Bot Manager"
          );

          console.log(
            ` Web panel: http://0.0.0.0:${PORT}`
          );

          console.log(
            ` Stored bots: ${manager.state.bots.length}`
          );

          console.log(
            "========================================"
          );
        }
      );

    const autoStart =
      String(
        process.env.AUTO_START_BOTS ||
        "false"
      ).toLowerCase() === "true";

    if (autoStart) {
      console.log(
        "[SERVER] AUTO_START_BOTS=true"
      );

      setTimeout(() => {
        manager
          .startAll()
          .then(results => {
            console.log(
              "[SERVER] Auto-start results:",
              results
            );
          })
          .catch(error => {
            console.error(
              "[SERVER] Auto-start error:",
              error.message
            );
          });
      }, 3000);
    }

    async function shutdown(signal) {
      console.log(
        `[SERVER] ${signal} received.`
      );

      try {
        await manager.shutdown();

        server.close(() => {
          process.exit(0);
        });
      } catch (error) {
        console.error(
          "[SERVER] Shutdown error:",
          error.message
        );

        process.exit(1);
      }
    }

    process.once(
      "SIGTERM",
      () => shutdown("SIGTERM")
    );

    process.once(
      "SIGINT",
      () => shutdown("SIGINT")
    );
  } catch (error) {
    console.error(
      "[SERVER] Startup failed:",
      error
    );

    process.exit(1);
  }
}

startServer();
