import CONFIG from './config.js';

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();
    const foods = foodSystem.getFoods();

    // Food collisions
    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      // Skip if dragon has spawn immunity
      if (dragon.immunityTimer > 0) continue;
      const head = dragon.head;
      for (let i = foods.length - 1; i >= 0; i--) {
        const food = foods[i];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist = (dragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) + (food.radius || CONFIG.FOOD_RADIUS);
        if (dist < hitDist) {
          foodSystem.removeFood(food.id);
          this.eventBus.emit('collision:eat', { dragon, food });
        }
      }
    }

    // Dragon collisions
    for (let i = 0; i < dragons.length; i++) {
      if (!dragons[i].alive) continue;
      for (let j = i + 1; j < dragons.length; j++) {
        if (!dragons[j].alive) continue;
        this.checkDragonCollisions(dragons[i], dragons[j]);
      }
    }
  }

  checkDragonCollisions(d1, d2) {
    // Skip if either has spawn immunity
    if (d1.immunityTimer > 0 || d2.immunityTimer > 0) return;

    const dx = d1.head.x - d2.head.x;
    const dy = d1.head.y - d2.head.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const headHitDist = (d1.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) +
                        (d2.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS);

    // HEAD vs HEAD collision
    if (dist < headHitDist) {
      const mx = (d1.head.x + d2.head.x) / 2;
      const my = (d1.head.y + d2.head.y) / 2;
      this.eventBus.emit('collision:head-hit', { d1, d2, x: mx, y: my });

      const len1 = d1.segments ? d1.segments.length : 0;
      const len2 = d2.segments ? d2.segments.length : 0;

      // IMPORTANT: only ever declare a death/shrink outcome for a dragon
      // that ISN'T remote. Every client runs this exact same collision
      // check locally, including for the opponent's dragon - but each
      // client's copy of the remote dragon is a lerped approximation, not
      // ground truth. If we let every client independently decide the
      // remote dragon's fate, they disagree (that's what caused PC to
      // think the opponent died - and stop rendering them - while the
      // opponent's own client never agreed). A dragon's fate is only ever
      // decided on the client that actually owns it; everyone else finds
      // out via the network (see applyRemotePositions() in main.js, which
      // now syncs `lives`/`alive` the same way it already synced segments).
      if (len1 < len2) {
        // d1 is shorter -> d1 dies
        if (!d1.isRemote) this.eventBus.emit('dragon:death', { dragon: d1, killer: d2 });
      } else if (len2 < len1) {
        // d2 is shorter -> d2 dies
        if (!d2.isRemote) this.eventBus.emit('dragon:death', { dragon: d2, killer: d1 });
      } else {
        // Equal size -> both shrink to start size (NOT die)
        if (!d1.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d1, reason: 'equal_head' });
        if (!d2.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d2, reason: 'equal_head' });
      }
      return;
    }

    // HEAD vs BODY collision
    this.checkHeadVsBody(d1, d2);
    this.checkHeadVsBody(d2, d1);
  }

  checkHeadVsBody(headDragon, bodyDragon) {
    if (headDragon.immunityTimer > 0 || bodyDragon.immunityTimer > 0) return;

    const head = headDragon.head;
    const headRadius = headDragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
    const bodyRadius = bodyDragon.headRadius || CONFIG.DRAGON_COLLISION_RADIUS;

    // Check headDragon's head against bodyDragon's body segments (skip head)
    for (let i = 1; i < bodyDragon.segments.length; i++) {
      const seg = bodyDragon.segments[i];
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitDist = headRadius + bodyRadius;

      if (dist < hitDist) {
        const len1 = headDragon.segments.length;
        const len2 = bodyDragon.segments.length;

        // Same rule as checkDragonCollisions: never declare an outcome for
        // a remote dragon, only for a dragon this client actually owns.
        if (len1 < len2) {
          // headDragon is smaller -> shrink to start size
          if (!headDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: headDragon, reason: 'head_vs_body', other: bodyDragon });
        } else if (len2 < len1) {
          // bodyDragon is smaller -> shrink to start size
          if (!bodyDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: bodyDragon, reason: 'head_vs_body', other: headDragon });
        } else {
          // Equal size -> both shrink to start size
          if (!headDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: headDragon, reason: 'equal_body' });
          if (!bodyDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: bodyDragon, reason: 'equal_body' });
        }
        return;
      }
    }
  }
}

export default CollisionSystem;
