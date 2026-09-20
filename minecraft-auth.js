'use strict';

const EventEmitter = require('events');

class MinecraftAuth extends EventEmitter {
  constructor(bot, options = {}) {
    super();

    this.bot = bot;

    this.password =
      options.password ||
      process.env.DEFAULT_MC_PASSWORD ||
      'vmallu';

    this.timeout =
      Number(options.timeout || 30000);

    this.authenticated = false;
    this.started = false;
    this.stopped = false;

    this.authTimer = null;
    this.messageHandler = null;

    this.registerSent = false;
    this.loginSent = false;

    this.lastCommandTime = 0;
    this.commandCooldown = 2000;
  }

  /*
  |--------------------------------------------------------------------------
  | Start
  |--------------------------------------------------------------------------
  */

  start() {
    if (this.started) {
      return;
    }

    if (!this.bot) {
      this.emit(
        'authError',
        new Error('Minecraft bot is not available.')
      );
      return;
    }

    this.started = true;
    this.stopped = false;

    this.log(
      'Authentication watcher started.'
    );

    /*
     * Listen only to actual Minecraft chat messages.
     *
     * We deliberately do NOT treat every message as an auth
     * message. This prevents messages such as:
     *
     * 100/100 Mana
     * Welcome to FakePixel SkyBlock!
     * Profile: Strawberry
     *
     * from being reported as authentication events.
     */
    this.messageHandler = (message) => {
      this.handleMessage(message);
    };

    this.bot.on(
      'message',
      this.messageHandler
    );

    /*
     * Give FakePixel time to send the login/register prompt.
     *
     * IMPORTANT:
     * This timeout only tells fakepixel-bot.js that the auth
     * helper did not see a recognizable auth prompt.
     *
     * It does NOT disconnect the Minecraft bot.
     */
    this.authTimer = setTimeout(() => {
      this.authTimer = null;

      if (
        this.authenticated ||
        this.stopped
      ) {
        return;
      }

      this.log(
        'No authentication prompt detected within timeout; continuing to monitor the server.'
      );

      this.emit('authTimeout');
    }, this.timeout);
  }

  /*
  |--------------------------------------------------------------------------
  | Handle Minecraft message
  |--------------------------------------------------------------------------
  */

  handleMessage(message) {
    if (
      this.stopped ||
      this.authenticated
    ) {
      return;
    }

    const text =
      this.toPlainText(message);

    if (!text) {
      return;
    }

    /*
     * Strip Minecraft formatting.
     */
    const clean =
      this.cleanMessage(text);

    if (!clean) {
      return;
    }

    const lower =
      clean.toLowerCase();

    /*
     * --------------------------------------------------------------
     * IMPORTANT:
     *
     * Ignore normal FakePixel messages.
     * --------------------------------------------------------------
     */

    if (
      this.isNormalServerMessage(lower)
    ) {
      return;
    }

    /*
     * --------------------------------------------------------------
     * REGISTER
     * --------------------------------------------------------------
     */

    if (
      this.isRegisterPrompt(lower)
    ) {
      this.sendRegister();
      return;
    }

    /*
     * --------------------------------------------------------------
     * LOGIN
     * --------------------------------------------------------------
     */

    if (
      this.isLoginPrompt(lower)
    ) {
      this.sendLogin();
      return;
    }

    /*
     * --------------------------------------------------------------
     * AUTH SUCCESS
     * --------------------------------------------------------------
     */

    if (
      this.isAuthenticationSuccess(lower)
    ) {
      this.markAuthenticated();
      return;
    }

    /*
     * --------------------------------------------------------------
     * AUTH FAILURE
     * --------------------------------------------------------------
     */

    if (
      this.isAuthenticationFailure(lower)
    ) {
      this.log(
        `Authentication failure message: ${clean}`
      );

      this.emit(
        'authFailure',
        clean
      );

      return;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Ignore normal FakePixel messages
  |--------------------------------------------------------------------------
  */

  isNormalServerMessage(text) {
    if (!text) {
      return true;
    }

    /*
     * Mana / health / HUD messages.
     */
    if (
      /^\d+\s*\/\s*\d+\s+\d+\s*\/\s*\d+\s*mana/i.test(text)
    ) {
      return true;
    }

    if (
      /mana/i.test(text) &&
      /\d+\s*\/\s*\d+/.test(text)
    ) {
      return true;
    }

    if (
      /health/i.test(text) &&
      /\d+\s*\/\s*\d+/.test(text)
    ) {
      return true;
    }

    /*
     * Common FakePixel gameplay messages.
     */
    const ignored = [
      'welcome to fakepixel',
      'profile:',
      'you have',
      'coins',
      'skyblock',
      'objective',
      'defense',
      'speed',
      'strength',
      'critical',
      'experience',
      'level',
      'collection',
      'your island',
      'joined',
      'left',
      'spooked into the lobby'
    ];

    for (const phrase of ignored) {
      if (text.includes(phrase)) {
        /*
         * "skyblock" by itself must not be treated as
         * authentication.
         */
        return true;
      }
    }

    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Register detection
  |--------------------------------------------------------------------------
  */

  isRegisterPrompt(text) {
    if (!text) {
      return false;
    }

    /*
     * Require registration-specific wording.
     *
     * We don't trigger simply because the word "register"
     * appears somewhere in normal chat.
     */

    if (
      /please\s+register/i.test(text)
    ) {
      return true;
    }

    if (
      /register\s+(your|an|a)\s+account/i.test(text)
    ) {
      return true;
    }

    if (
      /use\s+\/register/i.test(text)
    ) {
      return true;
    }

    if (
      /type\s+\/register/i.test(text)
    ) {
      return true;
    }

    if (
      /\/register\s+<password>/i.test(text)
    ) {
      return true;
    }

    if (
      /\/register/i.test(text) &&
      /password/i.test(text)
    ) {
      return true;
    }

    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Login detection
  |--------------------------------------------------------------------------
  */

  isLoginPrompt(text) {
    if (!text) {
      return false;
    }

    if (
      /please\s+login/i.test(text)
    ) {
      return true;
    }

    if (
      /please\s+log\s*in/i.test(text)
    ) {
      return true;
    }

    if (
      /use\s+\/login/i.test(text)
    ) {
      return true;
    }

    if (
      /type\s+\/login/i.test(text)
    ) {
      return true;
    }

    if (
      /\/login\s+<password>/i.test(text)
    ) {
      return true;
    }

    if (
      /\/login/i.test(text) &&
      /password/i.test(text)
    ) {
      return true;
    }

    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication success
  |--------------------------------------------------------------------------
  */

  isAuthenticationSuccess(text) {
    if (!text) {
      return false;
    }

    const successPatterns = [
      'logged in successfully',
      'login successful',
      'successfully logged in',
      'successfully logged-in',
      'you are now logged in',
      'authentication successful',
      'authenticated successfully',
      'registration successful',
      'registered successfully',
      'account registered successfully'
    ];

    return successPatterns.some(
      (pattern) =>
        text.includes(pattern)
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication failure
  |--------------------------------------------------------------------------
  */

  isAuthenticationFailure(text) {
    if (!text) {
      return false;
    }

    const patterns = [
      'incorrect password',
      'wrong password',
      'invalid password',
      'incorrect login',
      'invalid login',
      'wrong login',
      'login failed',
      'registration failed',
      'already registered',
      'already logged in'
    ];

    return patterns.some(
      (pattern) =>
        text.includes(pattern)
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Register
  |--------------------------------------------------------------------------
  */

  sendRegister() {
    if (
      this.stopped ||
      this.authenticated ||
      !this.bot
    ) {
      return;
    }

    if (this.registerSent) {
      return;
    }

    if (!this.canSendCommand()) {
      return;
    }

    this.registerSent = true;
    this.lastCommandTime =
      Date.now();

    this.log(
      'Registration prompt detected. Sending /register.'
    );

    try {
      this.bot.chat(
        `/register ${this.password} ${this.password}`
      );

      this.emit(
        'authLog',
        'Sent /register command.'
      );
    } catch (error) {
      this.registerSent = false;

      this.emit(
        'authError',
        error
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Login
  |--------------------------------------------------------------------------
  */

  sendLogin() {
    if (
      this.stopped ||
      this.authenticated ||
      !this.bot
    ) {
      return;
    }

    if (this.loginSent) {
      return;
    }

    if (!this.canSendCommand()) {
      return;
    }

    this.loginSent = true;
    this.lastCommandTime =
      Date.now();

    this.log(
      'Login prompt detected. Sending /login.'
    );

    try {
      this.bot.chat(
        `/login ${this.password}`
      );

      this.emit(
        'authLog',
        'Sent /login command.'
      );
    } catch (error) {
      this.loginSent = false;

      this.emit(
        'authError',
        error
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Command cooldown
  |--------------------------------------------------------------------------
  */

  canSendCommand() {
    return (
      Date.now() -
        this.lastCommandTime >=
      this.commandCooldown
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Mark authenticated
  |--------------------------------------------------------------------------
  */

  markAuthenticated() {
    if (
      this.authenticated ||
      this.stopped
    ) {
      return;
    }

    this.authenticated = true;

    this.clearAuthTimer();

    this.log(
      'Authentication confirmed.'
    );

    this.emit(
      'authenticated'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Public status
  |--------------------------------------------------------------------------
  */

  isAuthenticated() {
    return this.authenticated;
  }

  /*
  |--------------------------------------------------------------------------
  | Stop
  |--------------------------------------------------------------------------
  */

  stop() {
    this.stopped = true;
    this.started = false;

    this.clearAuthTimer();

    if (
      this.bot &&
      this.messageHandler
    ) {
      try {
        this.bot.removeListener(
          'message',
          this.messageHandler
        );
      } catch (_) {}
    }

    this.messageHandler = null;

    this.log(
      'Authentication watcher stopped.'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Timer
  |--------------------------------------------------------------------------
  */

  clearAuthTimer() {
    if (this.authTimer) {
      clearTimeout(
        this.authTimer
      );

      this.authTimer = null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Text helpers
  |--------------------------------------------------------------------------
  */

  cleanMessage(text) {
    return String(text)
      /*
       * Minecraft formatting codes.
       */
      .replace(
        /§[0-9a-fk-or]/gi,
        ''
      )

      /*
       * Remove control characters.
       */
      .replace(
        /[\u0000-\u001F\u007F]/g,
        ' '
      )

      /*
       * Normalize whitespace.
       */
      .replace(
        /\s+/g,
        ' '
      )

      .trim();
  }

  toPlainText(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    if (
      typeof value === 'string'
    ) {
      return value;
    }

    try {
      if (
        typeof value.toString ===
        'function'
      ) {
        return value.toString();
      }
    } catch (_) {}

    return String(value);
  }

  /*
  |--------------------------------------------------------------------------
  | Logging
  |--------------------------------------------------------------------------
  */

  log(message) {
    console.log(
      `[AUTH] ${message}`
    );

    this.emit(
      'authLog',
      message
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Cleanup
  |--------------------------------------------------------------------------
  */

  destroy() {
    this.stop();

    this.removeAllListeners();

    this.bot = null;
  }
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = MinecraftAuth;
module.exports.MinecraftAuth = MinecraftAuth;
