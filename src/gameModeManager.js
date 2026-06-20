import CONFIG from './config.js';

class GameModeManager {
  constructor() {
    this.mode = 'FFA';
    this.teams = new Map(); // playerId -> teamId
  }

  setMode(mode) {
    this.mode = mode;
    this.teams.clear();
  }

  getMode() {
    return this.mode;
  }

  getMaxPlayers() {
    return CONFIG.MAX_PLAYERS[this.mode] || 8;
  }

  getTeamForPlayer(playerIndex) {
    switch (this.mode) {
      case '1v1': return playerIndex % 2;
      case '2v2': return playerIndex % 2;
      case '4v4': return playerIndex % 4;
      case 'FFA': return playerIndex;
      default: return 0;
    }
  }

  getDuration() {
    return CONFIG.GAME_DURATION[this.mode] || 300000;
  }

  checkWinCondition(dragons) {
    const alive = dragons.filter(d => d.state === 'alive');

    if (this.mode === 'FFA') {
      if (alive.length <= 1) {
        return { winner: alive[0] || null, reason: 'last_alive' };
      }
    } else if (['1v1', '2v2', '4v4'].includes(this.mode)) {
      // Team mode: check if only one team remains
      const teamsAlive = new Set(alive.map(d => d.teamId));
      if (teamsAlive.size <= 1) {
        return { winner: alive[0] || null, reason: 'team_elimination' };
      }
    }

    return null;
  }

  getArenaSize() {
    return CONFIG.ARENA[this.mode] || CONFIG.ARENA['FFA'];
  }
}

export default GameModeManager;
