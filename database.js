"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const DEFAULT_STATE = {
  settings: {
    defaultPassword:
      process.env.DEFAULT_MC_PASSWORD || "vmallu",

    defaultTarget:
      process.env.DEFAULT_TARGET || "",

    maxBots:
      Number(process.env.MAX_BOTS || 20),

    autoReconnect:
      String(process.env.AUTO_RECONNECT || "true")
        .toLowerCase() === "true",

    reconnectDelay:
      Number(process.env.RECONNECT_DELAY || 5000),

    moveInterval:
      Number(process.env.DEFAULT_MOVE_INTERVAL || 8000),

    jumpInterval:
      Number(process.env.DEFAULT_JUMP_INTERVAL || 15000),

    moveDistance:
      Number(process.env.AFK_MOVE_DISTANCE || 3)
  },

  bots: []
};

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }
}

function cloneDefaultState() {
  return JSON.parse(
    JSON.stringify(DEFAULT_STATE)
  );
}

function loadState() {
  ensureDataDirectory();

  if (!fs.existsSync(STATE_FILE)) {
    const state = cloneDefaultState();
    saveState(state);
    return state;
  }

  try {
    const raw =
      fs.readFileSync(
        STATE_FILE,
        "utf8"
      );

    const saved =
      JSON.parse(raw);

    return {
      ...cloneDefaultState(),
      ...saved,

      settings: {
        ...DEFAULT_STATE.settings,
        ...(saved.settings || {})
      },

      bots: Array.isArray(saved.bots)
        ? saved.bots
        : []
    };
  } catch (error) {
    console.error(
      "[DATABASE] Failed to load state:",
      error.message
    );

    return cloneDefaultState();
  }
}

function saveState(state) {
  ensureDataDirectory();

  const temporaryFile =
    `${STATE_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      state,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    temporaryFile,
    STATE_FILE
  );
}

function getBots(state) {
  return state.bots;
}

function getBot(state, id) {
  return state.bots.find(
    bot => bot.id === id
  );
}

function addBot(state, bot) {
  state.bots.push(bot);
  saveState(state);
  return bot;
}

function updateBot(
  state,
  id,
  changes
) {
  const bot =
    getBot(state, id);

  if (!bot) {
    return null;
  }

  Object.assign(
    bot,
    changes
  );

  saveState(state);

  return bot;
}

function removeBot(
  state,
  id
) {
  const index =
    state.bots.findIndex(
      bot => bot.id === id
    );

  if (index === -1) {
    return false;
  }

  state.bots.splice(
    index,
    1
  );

  saveState(state);

  return true;
}

function updateSettings(
  state,
  changes
) {
  state.settings = {
    ...state.settings,
    ...changes
  };

  saveState(state);

  return state.settings;
}

function getSettings(state) {
  return state.settings;
}

module.exports = {
  DATA_DIR,
  STATE_FILE,
  loadState,
  saveState,
  getBots,
  getBot,
  addBot,
  updateBot,
  removeBot,
  updateSettings,
  getSettings
};
