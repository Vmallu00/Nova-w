const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function defaultState() {
  return {
    bots: [],
    settings: {
      defaultPassword: process.env.DEFAULT_MC_PASSWORD || 'vmallu',
      defaultTarget: process.env.DEFAULT_TARGET || '',
      maxBots: Number(process.env.MAX_BOTS || 20),
      autoReconnect:
        String(process.env.AUTO_RECONNECT || 'true').toLowerCase() !== 'false',
      reconnectDelay: Number(process.env.RECONNECT_DELAY || 5000),
      moveInterval: Number(process.env.DEFAULT_MOVE_INTERVAL || 10000),
      jumpInterval: Number(process.env.DEFAULT_JUMP_INTERVAL || 2500),
      moveDistance: Number(process.env.AFK_MOVE_DISTANCE || 4)
    }
  };
}

function ensureStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(STATE_FILE)) {
      writeState(defaultState());
    }
  } catch (error) {
    console.error('[DATABASE] Failed to initialize storage:', error);
  }
}

function normalizeState(data) {
  const defaults = defaultState();

  if (!data || typeof data !== 'object') {
    return defaults;
  }

  const state = {
    ...defaults,
    ...data
  };

  if (!Array.isArray(state.bots)) {
    state.bots = [];
  }

  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = {};
  }

  state.settings = {
    ...defaults.settings,
    ...state.settings
  };

  return state;
}

function readState() {
  ensureStorage();

  try {
    if (!fs.existsSync(STATE_FILE)) {
      const state = defaultState();
      writeState(state);
      return state;
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8').trim();

    if (!raw) {
      const state = defaultState();
      writeState(state);
      return state;
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('[DATABASE] Invalid state.json. Resetting database.');

      const backup = `${STATE_FILE}.broken-${Date.now()}`;

      try {
        fs.renameSync(STATE_FILE, backup);
        console.log(`[DATABASE] Broken database backed up to ${backup}`);
      } catch (backupError) {
        console.error(
          '[DATABASE] Could not backup broken state.json:',
          backupError.message
        );
      }

      const state = defaultState();
      writeState(state);
      return state;
    }

    const state = normalizeState(parsed);

    return state;
  } catch (error) {
    console.error('[DATABASE] Failed to read state:', error);

    // Never return undefined.
    return defaultState();
  }
}

function writeState(state) {
  ensureStorageWithoutState();

  const safeState = normalizeState(state);

  const tempFile = `${STATE_FILE}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(safeState, null, 2),
      'utf8'
    );

    fs.renameSync(tempFile, STATE_FILE);

    return true;
  } catch (error) {
    console.error('[DATABASE] Failed to write state:', error);

    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (_) {}

    return false;
  }
}

function ensureStorageWithoutState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('[DATABASE] Failed to create data directory:', error);
  }
}

function updateState(mutator) {
  const state = readState();

  try {
    const result = mutator(state);

    if (result && typeof result === 'object') {
      return writeState(result);
    }

    return writeState(state);
  } catch (error) {
    console.error('[DATABASE] Failed to update state:', error);
    return false;
  }
}

/* =========================
   BOTS
========================= */

function getBots() {
  const state = readState();

  return Array.isArray(state.bots) ? state.bots : [];
}

function getBot(id) {
  return getBots().find(bot => String(bot.id) === String(id)) || null;
}

function addBot(bot) {
  if (!bot || typeof bot !== 'object') {
    throw new Error('Invalid bot data.');
  }

  const state = readState();

  if (!Array.isArray(state.bots)) {
    state.bots = [];
  }

  state.bots.push(bot);

  writeState(state);

  return bot;
}

function updateBot(id, updates) {
  const state = readState();

  if (!Array.isArray(state.bots)) {
    state.bots = [];
  }

  const index = state.bots.findIndex(
    bot => String(bot.id) === String(id)
  );

  if (index === -1) {
    return null;
  }

  state.bots[index] = {
    ...state.bots[index],
    ...updates,
    id: state.bots[index].id
  };

  writeState(state);

  return state.bots[index];
}

function removeBot(id) {
  const state = readState();

  if (!Array.isArray(state.bots)) {
    state.bots = [];
  }

  const oldLength = state.bots.length;

  state.bots = state.bots.filter(
    bot => String(bot.id) !== String(id)
  );

  const removed = state.bots.length !== oldLength;

  if (removed) {
    writeState(state);
  }

  return removed;
}

/* =========================
   SETTINGS
========================= */

function getSettings() {
  const state = readState();

  return {
    ...defaultState().settings,
    ...(state.settings || {})
  };
}

function updateSettings(updates) {
  const state = readState();

  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = {};
  }

  state.settings = {
    ...defaultState().settings,
    ...state.settings,
    ...(updates || {})
  };

  writeState(state);

  return state.settings;
}

/* =========================
   GENERIC
========================= */

function getState() {
  return readState();
}

function save(state) {
  return writeState(state);
}

/*
 * Initialize database when the module loads.
 */
ensureStorage();

/*
 * Export everything used by server.js / bot-manager.js.
 */
module.exports = {
  DATA_DIR,
  STATE_FILE,

  defaultState,
  ensureStorage,
  readState,
  writeState,
  updateState,

  getState,
  save,

  getBots,
  getBot,
  addBot,
  updateBot,
  removeBot,

  getSettings,
  updateSettings
};
