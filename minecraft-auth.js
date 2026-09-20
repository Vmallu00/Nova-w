"use strict";

const AUTH_TIMEOUT = 20000;

function cleanMessage(message) {
  return String(message || "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRegisterPrompt(message) {
  const text = cleanMessage(message);

  return (
    text.includes("/register") ||
    text.includes("register") &&
    (
      text.includes("password") ||
      text.includes("account")
    )
  );
}

function isLoginPrompt(message) {
  const text = cleanMessage(message);

  return (
    text.includes("/login") ||
    text.includes("login") ||
    text.includes("log in") ||
    text.includes("please login") ||
    text.includes("please log in")
  );
}

function isAlreadyRegistered(message) {
  const text = cleanMessage(message);

  return (
    text.includes("already registered") ||
    text.includes("already registered") ||
    text.includes("account already exists") ||
    text.includes("already exists")
  );
}

function isAuthenticationSuccess(message) {
  const text = cleanMessage(message);

  return (
    text.includes("successfully logged") ||
    text.includes("successfully login") ||
    text.includes("logged in") ||
    text.includes("login successful") ||
    text.includes("logged successfully") ||
    text.includes("authentication successful")
  );
}

class MinecraftAuth {
  constructor(bot, options = {}) {
    this.bot = bot;

    this.password =
      options.password ||
      process.env.DEFAULT_MC_PASSWORD ||
      "vmallu";

    this.authenticated = false;
    this.busy = false;
    this.timer = null;
    this.started = false;
  }

  start() {
    this.started = true;
    this.authenticated = false;
    this.busy = false;

    this.clearTimer();

    this.timer = setTimeout(() => {
      if (!this.authenticated) {
        this.log(
          "Authentication timeout."
        );

        this.bot.emit(
          "authTimeout"
        );
      }
    }, AUTH_TIMEOUT);
  }

  handleMessage(message) {
    if (this.authenticated) {
      return;
    }

    const text =
      cleanMessage(message);

    if (!text) {
      return;
    }

    if (
      isAuthenticationSuccess(text)
    ) {
      this.markAuthenticated();
      return;
    }

    if (
      isAlreadyRegistered(text)
    ) {
      this.login();
      return;
    }

    if (
      isLoginPrompt(text)
    ) {
      this.login();
      return;
    }

    if (
      isRegisterPrompt(text)
    ) {
      this.register();
    }
  }

  register() {
    if (
      this.authenticated ||
      this.busy
    ) {
      return;
    }

    this.busy = true;

    this.log(
      "Sending registration command."
    );

    try {
      this.bot.chat(
        `/register ${this.password} ${this.password}`
      );
    } catch (error) {
      this.busy = false;

      this.log(
        `Registration error: ${error.message}`
      );

      return;
    }

    setTimeout(() => {
      this.busy = false;

      if (!this.authenticated) {
        this.login();
      }
    }, 2500);
  }

  login() {
    if (
      this.authenticated ||
      this.busy
    ) {
      return;
    }

    this.busy = true;

    this.log(
      "Sending login command."
    );

    try {
      this.bot.chat(
        `/login ${this.password}`
      );
    } catch (error) {
      this.busy = false;

      this.log(
        `Login error: ${error.message}`
      );

      return;
    }

    setTimeout(() => {
      this.busy = false;
    }, 2500);
  }

  forceLogin() {
    if (this.authenticated) {
      return;
    }

    this.busy = false;
    this.login();
  }

  markAuthenticated() {
    if (this.authenticated) {
      return;
    }

    this.authenticated = true;
    this.busy = false;

    this.clearTimer();

    this.log(
      "Minecraft authentication completed."
    );

    this.bot.emit(
      "authenticated"
    );
  }

  reset() {
    this.authenticated = false;
    this.busy = false;
    this.started = false;

    this.clearTimer();
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  log(message) {
    this.bot.emit(
      "authLog",
      String(message)
    );
  }

  destroy() {
    this.clearTimer();
    this.reset();
  }
}

module.exports = {
  MinecraftAuth,
  cleanMessage,
  isRegisterPrompt,
  isLoginPrompt,
  isAlreadyRegistered,
  isAuthenticationSuccess
};
