"use strict";

class AFKController {
  constructor(owner, options = {}) {
    this.owner = owner;

    this.moveInterval = Number(
      options.moveInterval || 10000
    );

    this.jumpInterval = Number(
      options.jumpInterval || 2500
    );

    this.moveDistance = Number(
      options.moveDistance || 4
    );

    this.running = false;

    this.cycleTimer = null;
    this.jumpTimer = null;
    this.moveTimer = null;

    this.moveNumber = 0;
  }

  update(options = {}) {
    if (options.moveInterval !== undefined) {
      this.moveInterval = Number(options.moveInterval);
    }

    if (options.jumpInterval !== undefined) {
      this.jumpInterval = Number(options.jumpInterval);
    }

    if (options.moveDistance !== undefined) {
      this.moveDistance = Number(options.moveDistance);
    }
  }

  start() {
    if (this.running) {
      this.owner.log("AFK controller is already running.");
      return;
    }

    this.running = true;

    this.owner.log(
      `AFK STARTED: ${this.moveDistance} blocks forward/back.`
    );

    this.owner.log(
      `Movement cycle: every ${this.moveInterval}ms.`
    );

    this.owner.log(
      `Jump interval: ${this.jumpInterval}ms.`
    );

    /*
     * Start immediately.
     */
    this.runMovementCycle();

    /*
     * Continue every configured interval.
     */
    this.cycleTimer = setInterval(() => {
      this.runMovementCycle();
    }, Math.max(5000, this.moveInterval));

    /*
     * Independent jump loop.
     */
    this.jumpTimer = setInterval(() => {
      this.jump();
    }, Math.max(1500, this.jumpInterval));
  }

  async runMovementCycle() {
    if (
      !this.running ||
      !this.owner.bot ||
      !this.owner.bot.entity
    ) {
      this.owner.log(
        "AFK movement skipped: bot/entity unavailable."
      );
      return;
    }

    this.moveNumber++;

    const bot = this.owner.bot;

    const before = {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z
    };

    this.owner.log(
      `AFK cycle #${this.moveNumber} START. Position: ${this.formatPosition(before)}`
    );

    /*
     * FORWARD
     */
    await this.move("forward", 1200);

    if (!this.running) {
      return;
    }

    await this.sleep(700);

    /*
     * BACKWARD
     */
    await this.move("back", 1200);

    if (!this.running) {
      return;
    }

    const after = {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z
    };

    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const dz = after.z - before.z;

    const distance = Math.sqrt(
      dx * dx +
      dy * dy +
      dz * dz
    );

    this.owner.log(
      `AFK cycle #${this.moveNumber} END. Position: ${this.formatPosition(after)} | moved ${distance.toFixed(2)} blocks`
    );
  }

  async move(direction, duration) {
    if (
      !this.running ||
      !this.owner.bot ||
      !this.owner.bot.entity
    ) {
      return;
    }

    const bot = this.owner.bot;

    this.owner.log(
      `AFK moving ${direction} for ${duration}ms.`
    );

    try {
      /*
       * Clear every old movement state first.
       */
      bot.clearControlStates();

      /*
       * Hold movement.
       */
      bot.setControlState(
        direction,
        true
      );

      /*
       * Jump at the beginning of movement.
       */
      bot.setControlState(
        "jump",
        true
      );

      /*
       * Release jump shortly afterwards,
       * while continuing to walk.
       */
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
      }, 400);

      await this.sleep(duration);

      if (
        this.owner.bot
      ) {
        try {
          this.owner.bot.setControlState(
            direction,
            false
          );

          this.owner.bot.setControlState(
            "jump",
            false
          );
        } catch (_) {}
      }

    } catch (error) {
      this.owner.log(
        `AFK movement error: ${error.message}`
      );
    }
  }

  jump() {
    if (
      !this.running ||
      !this.owner.bot ||
      !this.owner.bot.entity
    ) {
      return;
    }

    const bot = this.owner.bot;

    try {
      this.owner.log(
        "AFK jump."
      );

      bot.setControlState(
        "jump",
        true
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
      }, 450);

    } catch (error) {
      this.owner.log(
        `Jump error: ${error.message}`
      );
    }
  }

  stop() {
    this.running = false;

    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }

    if (this.jumpTimer) {
      clearInterval(this.jumpTimer);
      this.jumpTimer = null;
    }

    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }

    if (this.owner.bot) {
      try {
        this.owner.bot.clearControlStates();
      } catch (_) {}
    }

    this.owner.log(
      "AFK controller stopped."
    );
  }

  formatPosition(position) {
    return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
  }

  sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  destroy() {
    this.stop();
  }
}

module.exports = {
  AFKController
};
