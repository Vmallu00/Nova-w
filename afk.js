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

    this.loopTimer = null;
    this.jumpTimer = null;
    this.moveTimer = null;

    this.direction = "forward";

    this.forwardTime = 1100;
    this.backwardTime = 1100;
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

    /*
     * 4 blocks at normal Minecraft walking speed.
     */
    this.calculateMovementTime();

    if (this.running) {
      this.restartTimers();
    }
  }

  calculateMovementTime() {
    /*
     * Normal Minecraft walking speed is roughly
     * 4.3 blocks/second.
     *
     * 4 blocks ≈ 0.93 seconds.
     *
     * Add a little extra time so the movement
     * is clearly visible.
     */

    const distance =
      Math.max(
        1,
        this.moveDistance
      );

    const seconds =
      distance / 4.3;

    const milliseconds =
      seconds * 1000;

    this.forwardTime =
      Math.round(
        milliseconds + 100
      );

    this.backwardTime =
      Math.round(
        milliseconds + 100
      );
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    this.calculateMovementTime();

    this.owner.log(
      "AFK movement started: 4 blocks forward/back with jumping."
    );

    this.startLoop();
  }

  startLoop() {
    this.clearTimers();

    if (!this.running) {
      return;
    }

    /*
     * Immediately start by moving forward.
     */
    this.moveForward();

    /*
     * Repeat the complete forward/back cycle.
     */
    this.loopTimer = setInterval(
      () => {
        if (!this.running) {
          return;
        }

        this.runCycle();
      },
      Math.max(
        8000,
        this.moveInterval
      )
    );
  }

  async runCycle() {
    if (
      !this.running ||
      !this.owner.bot ||
      !this.owner.bot.entity
    ) {
      return;
    }

    await this.moveForward();

    if (!this.running) {
      return;
    }

    await this.sleep(700);

    if (!this.running) {
      return;
    }

    await this.moveBackward();
  }

  moveForward() {
    return this.moveDirection(
      "forward",
      this.forwardTime
    );
  }

  moveBackward() {
    return this.moveDirection(
      "back",
      this.backwardTime
    );
  }

  moveDirection(
    direction,
    duration
  ) {
    return new Promise(resolve => {
      if (
        !this.running ||
        !this.owner.bot ||
        !this.owner.bot.entity
      ) {
        resolve();
        return;
      }

      const bot =
        this.owner.bot;

      try {
        bot.clearControlStates();

        /*
         * Make sure the bot keeps its current
         * horizontal direction.
         *
         * forward = walk in facing direction
         * back    = walk backwards
         */

        bot.setControlState(
          direction,
          true
        );

        /*
         * Jump while moving.
         */
        bot.setControlState(
          "jump",
          true
        );

        this.owner.log(
          `AFK: moving ${direction} about ${this.moveDistance} blocks.`
        );

        /*
         * Release jump shortly after starting.
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
        }, 350);

        /*
         * Stop movement after the time needed
         * for approximately 4 blocks.
         */
        this.moveTimer =
          setTimeout(() => {
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

            resolve();
          }, duration);

      } catch (error) {
        this.owner.log(
          `AFK movement error: ${error.message}`
        );

        resolve();
      }
    });
  }

  /*
   * Extra jumping every few seconds while AFK.
   */
  startJumpLoop() {
    if (!this.running) {
      return;
    }

    if (this.jumpTimer) {
      clearInterval(
        this.jumpTimer
      );
    }

    this.jumpTimer =
      setInterval(() => {
        if (
          !this.running ||
          !this.owner.bot
        ) {
          return;
        }

        try {
          this.owner.bot.setControlState(
            "jump",
            true
          );

          this.owner.log(
            "AFK: jump."
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
          }, 400);

        } catch (_) {}
      }, this.jumpInterval);
  }

  restartTimers() {
    this.clearTimers();

    if (!this.running) {
      return;
    }

    this.calculateMovementTime();

    this.moveForward();

    /*
     * Extra jump every 2.5 seconds.
     */
    this.startJumpLoop();

    /*
     * Complete forward/back cycle approximately
     * every 10 seconds.
     */
    this.loopTimer =
      setInterval(
        () => {
          if (!this.running) {
            return;
          }

          this.runCycle();
        },
        Math.max(
          10000,
          this.moveInterval
        )
      );
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;

    this.clearTimers();

    if (this.owner.bot) {
      try {
        this.owner.bot.clearControlStates();
      } catch (_) {}
    }

    this.owner.log(
      "AFK movement stopped."
    );
  }

  clearTimers() {
    if (this.loopTimer) {
      clearInterval(
        this.loopTimer
      );

      this.loopTimer = null;
    }

    if (this.jumpTimer) {
      clearInterval(
        this.jumpTimer
      );

      this.jumpTimer = null;
    }

    if (this.moveTimer) {
      clearTimeout(
        this.moveTimer
      );

      this.moveTimer = null;
    }

    if (this.owner.bot) {
      try {
        this.owner.bot.clearControlStates();
      } catch (_) {}
    }
  }

  sleep(ms) {
    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  destroy() {
    this.stop();
  }
}

module.exports = {
  AFKController
};
