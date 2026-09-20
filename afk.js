"use strict";

class AFKController {
  constructor(owner, options = {}) {
    this.owner = owner;

    this.moveInterval =
      Number(options.moveInterval || 8000);

    this.jumpInterval =
      Number(options.jumpInterval || 15000);

    this.moveDistance =
      Number(options.moveDistance || 3);

    this.moveTimer = null;
    this.jumpTimer = null;

    this.running = false;

    this.directions = [
      "forward",
      "back",
      "left",
      "right"
    ];
  }

  update(options = {}) {
    if (options.moveInterval !== undefined) {
      this.moveInterval =
        Number(options.moveInterval);
    }

    if (options.jumpInterval !== undefined) {
      this.jumpInterval =
        Number(options.jumpInterval);
    }

    if (options.moveDistance !== undefined) {
      this.moveDistance =
        Number(options.moveDistance);
    }

    if (this.running) {
      this.restartTimers();
    }
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    this.owner.log(
      "AFK controller started."
    );

    this.restartTimers();
  }

  restartTimers() {
    this.clearTimers();

    if (!this.running) {
      return;
    }

    this.performRandomMove();

    this.moveTimer = setInterval(
      () => {
        this.performRandomMove();
      },
      Math.max(
        1000,
        this.moveInterval
      )
    );

    this.jumpTimer = setInterval(
      () => {
        this.performJump();
      },
      Math.max(
        2000,
        this.jumpInterval
      )
    );
  }

  performRandomMove() {
    const bot = this.owner.bot;

    if (
      !bot ||
      !this.running ||
      !bot.entity
    ) {
      return;
    }

    const direction =
      this.directions[
        Math.floor(
          Math.random() *
          this.directions.length
        )
      ];

    try {
      bot.clearControlStates();

      bot.setControlState(
        direction,
        true
      );

      this.owner.log(
        `AFK moving ${direction}.`
      );

      const moveTime =
        800 +
        Math.floor(
          Math.random() * 1200
        );

      setTimeout(() => {
        if (
          !this.running ||
          !this.owner.bot
        ) {
          return;
        }

        try {
          this.owner.bot.setControlState(
            direction,
            false
          );
        } catch (_) {}
      }, moveTime);

    } catch (error) {
      this.owner.log(
        `AFK movement error: ${error.message}`
      );
    }
  }

  performJump() {
    const bot = this.owner.bot;

    if (
      !bot ||
      !this.running
    ) {
      return;
    }

    try {
      bot.setControlState(
        "jump",
        true
      );

      this.owner.log(
        "AFK jump."
      );

      setTimeout(() => {
        if (
          !this.running ||
          !this.owner.bot
        ) {
          return;
        }

        try {
          this.owner.bot.setControlState(
            "jump",
            false
          );
        } catch (_) {}
      }, 500);

    } catch (error) {
      this.owner.log(
        `AFK jump error: ${error.message}`
      );
    }
  }

  stop() {
    this.running = false;

    this.clearTimers();

    if (this.owner.bot) {
      try {
        this.owner.bot.clearControlStates();
      } catch (_) {}
    }

    this.owner.log(
      "AFK controller stopped."
    );
  }

  clearTimers() {
    if (this.moveTimer) {
      clearInterval(
        this.moveTimer
      );

      this.moveTimer = null;
    }

    if (this.jumpTimer) {
      clearInterval(
        this.jumpTimer
      );

      this.jumpTimer = null;
    }
  }

  destroy() {
    this.stop();
  }
}

module.exports = {
  AFKController
};
