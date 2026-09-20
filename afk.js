"use strict";

class AFKController {
  constructor(bot, options = {}) {
    this.bot = bot;

    this.moveInterval = Number(
      options.moveInterval || 8000
    );

    this.jumpInterval = Number(
      options.jumpInterval || 15000
    );

    this.moveDistance = Number(
      options.moveDistance || 3
    );

    this.moveTimer = null;
    this.jumpTimer = null;
    this.running = false;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    this.scheduleMove();
    this.scheduleJump();

    this.log(
      "AFK movement started."
    );
  }

  stop() {
    this.running = false;

    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }

    if (this.jumpTimer) {
      clearTimeout(this.jumpTimer);
      this.jumpTimer = null;
    }

    this.releaseControls();

    this.log(
      "AFK movement stopped."
    );
  }

  scheduleMove() {
    if (!this.running) {
      return;
    }

    this.moveTimer = setTimeout(() => {
      this.randomMove();
      this.scheduleMove();
    }, this.moveInterval);
  }

  scheduleJump() {
    if (!this.running) {
      return;
    }

    this.jumpTimer = setTimeout(() => {
      this.jump();
      this.scheduleJump();
    }, this.jumpInterval);
  }

  randomMove() {
    if (
      !this.running ||
      !this.bot ||
      !this.bot.entity
    ) {
      return;
    }

    const directions = [
      "forward",
      "back",
      "left",
      "right"
    ];

    const direction =
      directions[
        Math.floor(
          Math.random() *
          directions.length
        )
      ];

    const duration =
      Math.max(
        500,
        Math.floor(
          this.moveDistance * 350 +
          Math.random() * 900
        )
      );

    this.releaseMovement();

    try {
      this.bot.setControlState(
        direction,
        true
      );

      setTimeout(() => {
        if (!this.running) {
          return;
        }

        try {
          this.bot.setControlState(
            direction,
            false
          );
        } catch (_) {}
      }, duration);

      this.log(
        `AFK movement: ${direction}`
      );
    } catch (error) {
      this.log(
        `Movement error: ${error.message}`
      );
    }
  }

  jump() {
    if (
      !this.running ||
      !this.bot
    ) {
      return;
    }

    try {
      this.bot.setControlState(
        "jump",
        true
      );

      setTimeout(() => {
        try {
          this.bot.setControlState(
            "jump",
            false
          );
        } catch (_) {}
      }, 500);

      this.log("AFK jump.");
    } catch (error) {
      this.log(
        `Jump error: ${error.message}`
      );
    }
  }

  releaseMovement() {
    if (!this.bot) {
      return;
    }

    for (const key of [
      "forward",
      "back",
      "left",
      "right"
    ]) {
      try {
        this.bot.setControlState(
          key,
          false
        );
      } catch (_) {}
    }
  }

  releaseControls() {
    this.releaseMovement();

    try {
      this.bot.setControlState(
        "jump",
        false
      );
    } catch (_) {}
  }

  update(options = {}) {
    if (
      options.moveInterval !==
      undefined
    ) {
      this.moveInterval = Math.max(
        1000,
        Number(options.moveInterval)
      );
    }

    if (
      options.jumpInterval !==
      undefined
    ) {
      this.jumpInterval = Math.max(
        1000,
        Number(options.jumpInterval)
      );
    }

    if (
      options.moveDistance !==
      undefined
    ) {
      this.moveDistance = Math.max(
        1,
        Number(options.moveDistance)
      );
    }
  }

  log(message) {
    if (this.bot) {
      this.bot.emit(
        "afkLog",
        String(message)
      );
    }
  }

  destroy() {
    this.stop();
    this.bot = null;
  }
}

module.exports = {
  AFKController
};
