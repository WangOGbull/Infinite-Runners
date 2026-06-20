  update(deltaTime) {
    this.gameTimer = Date.now() - this.gameStartTime;
    const minutes = Math.floor(this.gameTimer / 60000);
    const seconds = Math.floor((this.gameTimer % 60000) / 1000);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    this.foodSystem.update(deltaTime);

    // Update input state (boost, joystick visual)
    this.movementSystem.update(this.dragonManager, this.cameraSystem, deltaTime);

    // Build complete input map for ALL dragons — single source of truth
    const inputMap = new Map();

    for (const dragon of this.dragonManager.getLivingDragons()) {
      let angle;
      if (dragon === this.localDragon) {
        angle = this.movementSystem.getInputAngle(
          dragon.id,
          dragon.head.x,
          dragon.head.y,
          this.cameraSystem
        );
      } else {
        angle = this.aiController.getInputAngle(dragon);
      }
      inputMap.set(dragon.id, angle);
    }

    // Single update for all dragons — no double-update
    this.dragonManager.update(deltaTime, inputMap);

    this.cameraSystem.update(this.localDragon, this.arenaManager);
    this.collisionSystem.checkAll(this.dragonManager, this.foodSystem, this.arenaManager);

    const result = this.gameModeManager.checkWinCondition(this.dragonManager.getAllDragons());
    if (result && result.winner) {
      this.endGame();
      return;
    }

    const score = this.localDragon ? this.localDragon.score : 0;
    const collected = this.localDragon ? this.localDragon.collected : 0;
    this.uiManager.updateHUD(score, timeStr);

    const minimap = document.getElementById('minimapCanvas');
    if (minimap) {
      this.uiManager.renderMinimap(
        minimap,
        this.cameraSystem,
        this.arenaManager,
        this.dragonManager.getAllDragons(),
        this.foodSystem.getFoods()
      );
    }
  }
