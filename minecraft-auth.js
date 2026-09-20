'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class MinecraftAuth extends EventEmitter {
  constructor(options = {}) {
    super();

    this.bot = options.bot;
    this.username = String(options.username || '').trim();
    this.password = String(
      options.password ||
      process.env.DEFAULT_MC_PASSWORD ||
      'vmallu'
    );

    this.timeoutMs = Number(
      options.timeoutMs ||
      30000
    );

    this.started = false;
    this.authenticated = false;
    this.authCommandSent = false;
    this.waitingForAuthResult = false;

    this.timeoutTimer = null;

    this.registeredFile = path.join(
      __dirname,
      'data',
      'registered-accounts.json'
    );

    this.registeredAccounts = this.loadRegisteredAccounts();

    this.boundMessageHandler = null;
  }

  /* --------------------------------------------------------- */
  /* REGISTERED ACCOUNT STORAGE                                */
  /* --------------------------------------------------------- */

  ensureDataDirectory() {
    const dir = path.dirname(this.registeredFile);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {
        recursive: true
      });
    }
  }

  loadRegisteredAccounts() {
    try {
      this.ensureDataDirectory();

      if (!fs.existsSync(this.registeredFile)) {
        return {};
      }

      const raw = fs.readFileSync(
        this.registeredFile,
        'utf8'
      );

      if (!raw.trim()) {
        return {};
      }

      const parsed = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }

      return {};
    } catch (error) {
      this.emit(
        'log',
        `Could not load registered accounts: ${error.message}`
      );

      return {};
    }
  }

  saveRegisteredAccounts() {
    try {
      this.ensureDataDirectory();

      fs.writeFileSync(
        this.registeredFile,
        JSON.stringify(
          this.registeredAccounts,
          null,
          2
        ),
        'utf8'
      );

      return true;
    } catch (error) {
      this.emit(
        'log',
        `Could not save registered accounts: ${error.message}`
      );

      return false;
    }
  }

  isRegistered() {
    const key =
      this.username.toLowerCase();

    return Boolean(
      this.registeredAccounts[key]
    );
  }

  markRegistered() {
    const key =
      this.username.toLowerCase();

    this.registeredAccounts[key] = {
      username: this.username,
      registeredAt:
        this.registeredAccounts[key]?.registeredAt ||
        new Date().toISOString()
    };

    this.saveRegisteredAccounts();

    this.emit(
      'log',
      `Account ${this.username} marked as registered`
    );
  }

  /* --------------------------------------------------------- */
  /* START                                                      */
  /* --------------------------------------------------------- */

  start() {
    if (this.started) {
      return;
    }

    if (!this.bot) {
      this.emit(
        'error',
        new Error('Minecraft bot is not available')
      );
      return;
    }

    this.started = true;

    this.emit(
      'log',
      `Authentication started for ${this.username}`
    );

    this.boundMessageHandler =
      (message) => {
        this.handleMessage(message);
      };

    this.bot.on(
      'message',
      this.boundMessageHandler
    );

    /*
     * Give FakePixel a moment to send its auth prompt.
     */
    setTimeout(() => {
      if (!this.started || this.authenticated) {
        return;
      }

      /*
       * If the server hasn't sent a prompt yet, use the
       * saved registration state to make the appropriate
       * command.
       */
      if (this.isRegistered()) {
        this.sendLogin();
      } else {
        this.sendRegister();
      }
    }, 1200);

    this.timeoutTimer = setTimeout(() => {
      if (
        !this.started ||
        this.authenticated
      ) {
        return;
      }

      this.emit(
        'log',
        `Authentication timeout`
      );

      this.emit(
        'authTimeout'
      );
    }, this.timeoutMs);
  }

  /* --------------------------------------------------------- */
  /* MESSAGE HANDLING                                           */
  /* --------------------------------------------------------- */

  handleMessage(message) {
    const text =
      this.messageToText(message);

    if (!text) {
      return;
    }

    /*
     * IMPORTANT:
     *
     * Detect auth commands BEFORE checking normal messages.
     *
     * This means:
     *
     * "Use /login <your password>"
     *
     * will correctly trigger:
     *
     * /login vmallu
     */

    const normalized =
      this.cleanText(text).toLowerCase();

    /*
     * REGISTER PROMPT
     */
    if (
      this.containsRegisterPrompt(normalized)
    ) {
      /*
       * If already registered, NEVER register again.
       */
      if (this.isRegistered()) {
        this.emit(
          'log',
          `Server requested register, but ${this.username} is already registered; using /login`
        );

        this.sendLogin();

      } else {
        this.sendRegister();
      }

      return;
    }

    /*
     * LOGIN PROMPT
     */
    if (
      this.containsLoginPrompt(normalized)
    ) {
      this.sendLogin();
      return;
    }

    /*
     * AUTH SUCCESS
     */
    if (
      this.isAuthSuccess(normalized)
    ) {
      this.finishAuthentication();
      return;
    }

    /*
     * AUTH FAILURE
     */
    if (
      this.isAuthFailure(normalized)
    ) {
      /*
       * Wrong password should NOT mark the account as
       * registered/unregistered differently.
       */
      this.emit(
        'log',
        `Authentication failure: ${this.cleanText(text)}`
      );

      return;
    }

    /*
     * IMPORTANT:
     *
     * Ignore ordinary FakePixel messages.
     *
     * Examples:
     *
     * 100/100 Mana
     * Welcome to FakePixel SkyBlock!
     * Profile: Strawberry
     *
     * These are NOT authentication messages.
     */
    if (
      this.isNormalServerMessage(normalized)
    ) {
      return;
    }
  }

  /* --------------------------------------------------------- */
  /* REGISTER PROMPT                                            */
  /* --------------------------------------------------------- */

  containsRegisterPrompt(text) {
    if (!text) {
      return false;
    }

    /*
     * Examples:
     *
     * Use /register <password> <password>
     * Please register using /register ...
     * Register with /register ...
     */
    if (
      /\/register\b/.test(text)
    ) {
      return true;
    }

    if (
      /\bregister\b.*\bpassword\b/.test(text)
    ) {
      return true;
    }

    return false;
  }

  /* --------------------------------------------------------- */
  /* LOGIN PROMPT                                               */
  /* --------------------------------------------------------- */

  containsLoginPrompt(text) {
    if (!text) {
      return false;
    }

    /*
     * Examples:
     *
     * Use /login <your password>
     * Use: /login <your password>
     * Please login using /login ...
     * Login with /login ...
     */

    if (
      /\/login\b/.test(text)
    ) {
      return true;
    }

    if (
      /\blogin\b.*\bpassword\b/.test(text)
    ) {
      return true;
    }

    return false;
  }

  /* --------------------------------------------------------- */
  /* SEND REGISTER                                              */
  /* --------------------------------------------------------- */

  sendRegister() {
    if (
      !this.started ||
      this.authenticated ||
      !this.bot
    ) {
      return;
    }

    /*
     * Prevent repeatedly sending register every second.
     */
    if (
      this.authCommandSent &&
      this.waitingForAuthResult
    ) {
      return;
    }

    this.authCommandSent = true;
    this.waitingForAuthResult = true;

    const command =
      `/register ${this.password} ${this.password}`;

    this.emit(
      'log',
      `Sending first-time registration: /register ${this.password} ${this.password}`
    );

    try {
      this.bot.chat(command);

      /*
       * Mark registered immediately after the command is
       * successfully sent. This prevents the next reconnect
       * from attempting registration again.
       *
       * The server may take a moment to respond, but the
       * command itself has been sent successfully.
       */
      this.markRegistered();

    } catch (error) {
      this.authCommandSent = false;
      this.waitingForAuthResult = false;

      this.emit(
        'error',
        error
      );
    }
  }

  /* --------------------------------------------------------- */
  /* SEND LOGIN                                                 */
  /* --------------------------------------------------------- */

  sendLogin() {
    if (
      !this.started ||
      this.authenticated ||
      !this.bot
    ) {
      return;
    }

    /*
     * Prevent duplicate:
     *
     * /login vmallu
     * /login vmallu
     * /login vmallu
     *
     * every second.
     */
    if (
      this.authCommandSent &&
      this.waitingForAuthResult
    ) {
      return;
    }

    this.authCommandSent = true;
    this.waitingForAuthResult = true;

    const command =
      `/login ${this.password}`;

    this.emit(
      'log',
      `Sending login command: /login ${this.password}`
    );

    try {
      this.bot.chat(command);
    } catch (error) {
      this.authCommandSent = false;
      this.waitingForAuthResult = false;

      this.emit(
        'error',
        error
      );
    }
  }

  /* --------------------------------------------------------- */
  /* AUTH SUCCESS                                               */
  /* --------------------------------------------------------- */

  isAuthSuccess(text) {
    if (!text) {
      return false;
    }

    /*
     * Common authentication success messages.
     */
    const successPatterns = [
      /successfully logged/i,
      /successfully login/i,
      /successfully authenticated/i,
      /login successful/i,
      /logged in successfully/i,
      /authentication successful/i,
      /you are now logged/i,
      /you have been logged/i,
      /login complete/i,
      /authentication complete/i
    ];

    return successPatterns.some(
      pattern => pattern.test(text)
    );
  }

  /* --------------------------------------------------------- */
  /* AUTH FAILURE                                               */
  /* --------------------------------------------------------- */

  isAuthFailure(text) {
    if (!text) {
      return false;
    }

    const failurePatterns = [
      /incorrect password/i,
      /wrong password/i,
      /invalid password/i,
      /password is incorrect/i,
      /invalid login/i,
      /login failed/i,
      /authentication failed/i,
      /too many login/i,
      /too many attempts/i
    ];

    return failurePatterns.some(
      pattern => pattern.test(text)
    );
  }

  /* --------------------------------------------------------- */
  /* FINISH AUTH                                                */
  /* --------------------------------------------------------- */

  finishAuthentication() {
    if (
      this.authenticated
    ) {
      return;
    }

    this.authenticated = true;
    this.waitingForAuthResult = false;

    this.clearTimeout();

    this.emit(
      'log',
      `Authentication successful for ${this.username}`
    );

    this.emit(
      'authenticated'
    );
  }

  /* --------------------------------------------------------- */
  /* NORMAL MESSAGE FILTER                                      */
  /* --------------------------------------------------------- */

  isNormalServerMessage(text) {
    if (!text) {
      return true;
    }

    /*
     * Mana/status messages must never be treated as auth.
     */
    if (
      /\bmana\b/i.test(text) ||
      /\bhealth\b/i.test(text) ||
      /\bsaturation\b/i.test(text)
    ) {
      return true;
    }

    if (
      /welcome to fakepixel skyblock/i.test(text)
    ) {
      return true;
    }

    if (
      /^profile\s*:/i.test(text)
    ) {
      return true;
    }

    if (
      /skyblock experience/i.test(text)
    ) {
      return true;
    }

    return false;
  }

  /* --------------------------------------------------------- */
  /* STOP                                                        */
  /* --------------------------------------------------------- */

  stop() {
    this.started = false;

    this.clearTimeout();

    if (
      this.bot &&
      this.boundMessageHandler
    ) {
      try {
        this.bot.removeListener(
          'message',
          this.boundMessageHandler
        );
      } catch (_) {}
    }

    this.boundMessageHandler = null;
    this.authCommandSent = false;
    this.waitingForAuthResult = false;
  }

  clearTimeout() {
    if (this.timeoutTimer) {
      clearTimeout(
        this.timeoutTimer
      );

      this.timeoutTimer = null;
    }
  }

  /* --------------------------------------------------------- */
  /* TEXT HELPERS                                               */
  /* --------------------------------------------------------- */

  messageToText(message) {
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

  cleanText(text) {
    return String(text || '')
      /*
       * Minecraft formatting codes.
       */
      .replace(/§[0-9a-fk-or]/gi, '')
      .replace(/\u00a7[0-9a-fk-or]/gi, '')

      /*
       * Normalize whitespace.
       */
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/*
 * Support both:
 *
 * const MinecraftAuth = require('./minecraft-auth');
 *
 * and:
 *
 * const { MinecraftAuth } = require('./minecraft-auth');
 */
module.exports = MinecraftAuth;
module.exports.MinecraftAuth = MinecraftAuth;
