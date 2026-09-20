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
      Number(options.timeout || 20000);

    this.authenticated = false;
    this.started = false;
    this.timer = null;

    this._messageHandler = null;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.authenticated = false;

    this.log('Authentication handler started.');

    this._messageHandler = message => {
      this.handleMessage(message);
    };

    if (
      this.bot &&
      typeof this.bot.on === 'function'
    ) {
      this.bot.on(
        'message',
        this._messageHandler
      );
    }

    this.timer = setTimeout(() => {
      if (!this.authenticated) {
        this.emit(
          'authTimeout',
          new Error(
            'Minecraft authentication timed out.'
          )
        );
      }
    }, this.timeout);
  }

  handleMessage(message) {
    let text = '';

    try {
      if (typeof message === 'string') {
        text = message;
      } else if (
        message &&
        typeof message.toString === 'function'
      ) {
        text = message.toString();
      }
    } catch (_) {
      return;
    }

    if (!text) {
      return;
    }

    const lower = text
      .toLowerCase()
      .replace(/§[0-9a-fk-or]/gi, '')
      .trim();

    this.log(`Server: ${text}`);

    /*
     * REGISTER
     */

    if (
      lower.includes('/register') ||
      lower.includes('register') ||
      lower.includes('please register') ||
      lower.includes('register your account') ||
      lower.includes('please use /register')
    ) {
      this.register();
      return;
    }

    /*
     * LOGIN
     */

    if (
      lower.includes('/login') ||
      lower.includes('login') ||
      lower.includes('please login') ||
      lower.includes('please log in') ||
      lower.includes('log in')
    ) {
      this.login();
      return;
    }

    /*
     * ALREADY LOGGED IN / AUTH SUCCESS
     */

    if (
      lower.includes('successfully logged') ||
      lower.includes('login successful') ||
      lower.includes('logged in') ||
      lower.includes('successfully registered') ||
      lower.includes('registration successful') ||
      lower.includes('welcome back')
    ) {
      this.markAuthenticated();
    }
  }

  register() {
    if (
      !this.bot ||
      typeof this.bot.chat !== 'function'
    ) {
      this.emit(
        'authError',
        new Error(
          'Minecraft bot chat function is unavailable.'
        )
      );

      return;
    }

    this.log('Registration prompt detected.');

    try {
      this.bot.chat(
        `/register ${this.password} ${this.password}`
      );

      this.emit(
        'authLog',
        `Sent /register command.`
      );
    } catch (error) {
      this.emit(
        'authError',
        error
      );
    }
  }

  login() {
    if (
      !this.bot ||
      typeof this.bot.chat !== 'function'
    ) {
      this.emit(
        'authError',
        new Error(
          'Minecraft bot chat function is unavailable.'
        )
      );

      return;
    }

    this.log('Login prompt detected.');

    try {
      this.bot.chat(
        `/login ${this.password}`
      );

      this.emit(
        'authLog',
        `Sent /login command.`
      );

      /*
       * Some servers do not send a clear
       * "login successful" message.
       *
       * Give FakePixel a short delay and
       * consider authentication complete.
       */
      setTimeout(() => {
        if (!this.authenticated) {
          this.markAuthenticated();
        }
      }, 1500);

    } catch (error) {
      this.emit(
        'authError',
        error
      );
    }
  }

  markAuthenticated() {
    if (this.authenticated) {
      return;
    }

    this.authenticated = true;

    this.clearTimer();

    this.log(
      'Minecraft authentication completed.'
    );

    this.emit('authenticated');
  }

  isAuthenticated() {
    return this.authenticated;
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  stop() {
    this.clearTimer();

    if (
      this.bot &&
      this._messageHandler &&
      typeof this.bot.removeListener === 'function'
    ) {
      this.bot.removeListener(
        'message',
        this._messageHandler
      );
    }

    this._messageHandler = null;
    this.started = false;
  }

  log(message) {
    this.emit(
      'authLog',
      String(message)
    );
  }
}

/*
 * Export BOTH ways.
 *
 * This allows:
 *
 * const MinecraftAuth = require('./minecraft-auth');
 *
 * and:
 *
 * const { MinecraftAuth } = require('./minecraft-auth');
 */

module.exports = MinecraftAuth;
module.exports.MinecraftAuth = MinecraftAuth;
