// ==================== CENTRAL GAME CONFIGURATION ====================
// Edit values here. No game logic changes required.

export const DRAGONS = [
  'aegis',
  'ignis',
  'infinite',
  'magnetron'
];

const CONFIG = {
  // ==================== ARENA ====================
  ARENA: {
    '1v1': { width: 1800, height: 1800 },
    '2v2': { width: 2200, height: 2200 },
    '4v4': { width: 2800, height: 2800 },
    'FFA': { width: 3000, height: 3000 }
  },
  ARENA_BOUNDARY_THICKNESS: 40,
  ARENA_GRID_SIZE: 100,

  // ==================== CAMERA ====================
  CAMERA_BASE_ZOOM: 1.0,
  CAMERA_MIN_ZOOM: 0.35,
  CAMERA_MAX_ZOOM: 1.5,
  CAMERA_ZOOM_PER_SEGMENT: -0.015,
  CAMERA_DRAGON_SCREEN_PERCENT_MAX: 0.35,
  CAMERA_SMOOTH_FACTOR: 0.08,
  CAMERA_DEADZONE: 50,

  // ==================== DRAGON MOVEMENT ====================
  DRAGON_BASE_SPEED: 4.5,
  DRAGON_SPEED_PER_SEGMENT_PENALTY: -0.02,
  DRAGON_MIN_SPEED: 2.5,
  DRAGON_TURN_SPEED: 0.12,
  DRAGON_TURN_SMOOTHING: 0.25,

  // ==================== DRAGON GROWTH ====================
  DRAGON_START_SEGMENTS: 3,          // head + body + tail
  DRAGON_MAX_SEGMENTS: 100,
  DRAGON_SEGMENTS_PER_FOOD: 1,
  DRAGON_SEGMENT_SPACING: 0.9,        // 0.9x = 10% overlap
  DRAGON_FOLLOW_SPEED: 0.18,          // 0.15–0.25 range
  DRAGON_FOLLOW_SPEED_DECAY: 0.002,  // slight slowdown per segment

  // ==================== DRAGON DISPLAY ====================
  DRAGON_DISPLAY_SCALE: 0.6,
  DRAGON_COLLISION_RADIUS: 18,
  DRAGON_HEAD_HITBOX_RADIUS: 22,
  DRAGON_TAIL_TAPER_SCALE: 0.75,

  // ==================== FOOD (INFINITE COLLECTIBLES) ====================
  FOOD_DENSITY: 0.0003,              // food per pixel²
  FOOD_RESPAWN_DELAY: 2000,            // ms
  FOOD_NORMAL_POINTS: 10,
  FOOD_BONUS_CHANCE: 0.05,
  FOOD_BONUS_POINTS: 50,
  FOOD_BONUS_SCALE: 1.3,
  FOOD_TYPES: ['normal', 'bonus', 'powerup'],
  FOOD_SYMBOL: '\u221E',              // Infinity symbol

  // ==================== PLAYERS ====================
  MAX_PLAYERS: {
    '1v1': 2,
    '2v2': 4,
    '4v4': 8,
    'FFA': 8
  },
  PLAYER_SPAWN_MARGIN: 200,
  PLAYER_SPAWN_MIN_DISTANCE: 300,

  // ==================== GAME MODES ====================
  GAME_MODES: ['1v1', '2v2', '4v4', 'FFA'],
  GAME_DURATION: {
    '1v1': 180000,
    '2v2': 240000,
    '4v4': 300000,
    'FFA': 300000
  },

  // ==================== MULTIPLAYER (Future-ready) ====================
  NETWORK_UPDATE_RATE: 20,
  NETWORK_INTERPOLATION_DELAY: 100,
  NETWORK_PREDICTION_ENABLED: true,

  // ==================== PERFORMANCE ====================
  TARGET_FPS: 60,
  MAX_DELTA_TIME: 50,
  POSITION_HISTORY_BUFFER_SIZE: 300,
  ENABLE_CULLING: true,
  RENDER_DISTANCE: 1200,

  // ==================== ASSETS ====================
 ASSET_BASE_URL: './dragons/',
DRAGON_NAMES: DRAGONS
};

// Freeze to prevent accidental mutation
Object.freeze(CONFIG);
Object.freeze(CONFIG.ARENA);
Object.freeze(CONFIG.MAX_PLAYERS);
Object.freeze(CONFIG.GAME_DURATION);

export default CONFIG;
