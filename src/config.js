// ==================== CENTRAL GAME CONFIGURATION ====================


export const DRAGONS = [
  'aegis',
  'ignis',
  'infinite',
  'magnetron'
];

// Dragon image paths (local transparent PNGs - select screen portraits)
export const DRAGON_IMAGES = {
  aegis: './dragons/select/aegis.png',
  ignis: './dragons/select/ignis.png',
  infinite: './dragons/select/infinite.png',
  magnetron: './dragons/select/magnetron.png'
};

// Dragon power base stats and upgrade costs (placeholder)
export const DRAGON_POWERS = {
  aegis:     { defense: 3, speed: 2, rush: 2, attack: 2, color: '#9b4dff' },
  ignis:     { defense: 1, speed: 4, rush: 3, attack: 3, color: '#ff6b35' },
  infinite:  { defense: 2, speed: 2, rush: 1, attack: 4, color: '#00b4d8' },
  magnetron: { defense: 4, speed: 1, rush: 2, attack: 2, color: '#ff00aa' }
};

// Upgrade costs per stat (placeholder INFINITE coin prices)
export const POWER_UPGRADE_COSTS = {
  defense: 500,
  speed: 600,
  rush: 800,
  attack: 1000
};

// Max power level per stat
export const MAX_POWER_LEVEL = 10;

const CONFIG = {

  // ==================== ARENA ====================
  ARENA: {
    '1v1': { width: 2200, height: 2200 },
    '1v1AI': { width: 2200, height: 2200 },
    '2v2': { width: 2600, height: 2600 },
    '4v4': { width: 3200, height: 3200 },
    'FFA': { width: 3600, height: 3600 }
  },

  ARENA_BOUNDARY_THICKNESS: 12,
  ARENA_GRID_SIZE: 100,

  // ==================== CAMERA ====================
  CAMERA_BASE_ZOOM: 0.85,
  CAMERA_MIN_ZOOM: 0.85,
  CAMERA_MAX_ZOOM: 0.85,
  CAMERA_SMOOTH_FACTOR: 0.08,
  CAMERA_LEAD_DISTANCE: 90,

  // ==================== DRAGON MOVEMENT ====================
  DRAGON_BASE_SPEED: 3.42,

  DRAGON_BOOST_MULTIPLIER: 1.6,
  DRAGON_TURN_SPEED: 0.14,

  // ==================== DRAGON GROWTH ====================
  DRAGON_START_SEGMENTS: 5,
  DRAGON_MAX_SEGMENTS: 50,

  // ==================== ATTACK SYSTEM ====================
  ATTACK_METER_MAX: 20,        // infinite food eaten to fully charge ATTACK
  ATTACK_DURATION_MS: 5000,    // attack mode duration once triggered
  KILL_SEGMENTS_GAIN: 2,       // body segments the killer gains per kill
  // Neon kill-glow colors sampled from each dragon's head art
  DRAGON_NEON: {
    aegis: '#a800ff',
    ignis: '#ff6c00',
    infinite: '#007aff',
    magnetron: '#ff00d5'
  },
  DRAGON_SEGMENTS_PER_FOOD: 1,
  DRAGON_SEGMENT_SPACING: 0.65,

  // ==================== DRAGON DISPLAY ====================
  DRAGON_DISPLAY_SCALE: 0.08,
  DRAGON_COLLISION_RADIUS: 10,
  DRAGON_HEAD_HITBOX_RADIUS: 14,
  DRAGON_TAIL_TAPER_SCALE: 0.85,

  // ==================== HISTORY ====================
  POSITION_HISTORY_BUFFER_SIZE: 2000,

  // ==================== FOOD ====================
  FOOD_DENSITY: 0.00006,
  FOOD_RESPAWN_DELAY: 1000,
  FOOD_NORMAL_POINTS: 10,
  FOOD_BONUS_POINTS: 20,
  FOOD_BONUS_CHANCE: 0.12,
  FOOD_BONUS_SCALE: 1.2,
  FOOD_SYMBOL: '∞',
  FOOD_TYPES: ['blue', 'red', 'purple', 'orange'],
  FOOD_RADIUS: 4,

  // ==================== PLAYERS ====================
  MAX_PLAYERS: {
    '1v1': 2,
    '1v1AI': 2,
    '2v2': 4,
    '4v4': 8,
    'FFA': 8
  },

  PLAYER_SPAWN_MARGIN: 250,
  PLAYER_SPAWN_MIN_DISTANCE: 450,

  // ==================== GAME MODES ====================
  GAME_MODES: ['1v1', '1v1AI', '2v2', '4v4', 'FFA'],

  GAME_DURATION: {
    '1v1': 180000,
    '1v1AI': 180000,
    '2v2': 240000,
    '4v4': 300000,
    'FFA': 300000
  },

  // ==================== LIVES & RESPAWN ====================
  LIVES_PER_ROUND: 3,
  RESPAWN_DELAY_MS: 2000,
  SPAWN_IMMUNITY_MS: 2000,

  // ==================== EFFECTS ====================
  EFFECTS: {
    EAT_PARTICLES: 8,
    EAT_PARTICLE_SPEED: 3,
    EAT_PARTICLE_LIFE: 400,
    DEATH_PARTICLES: 30,
    DEATH_PARTICLE_SPEED: 6,
    DEATH_PARTICLE_LIFE: 800,
    KILL_SPARKLES: 12,
    KILL_SPARKLE_SPEED: 4,
    KILL_SPARKLE_LIFE: 600,
    IMPACT_SPARKS: 10,
    IMPACT_SPARK_SPEED: 5,
    IMPACT_SPARK_LIFE: 300,
    SHRINK_PARTICLES: 15,
    SHRINK_PARTICLE_SPEED: 4,
    SHRINK_PARTICLE_LIFE: 500,
    SHAKE_DECAY: 0.9,
    VIGNETTE_DECAY: 0.92
  },

  // ==================== NETWORK ====================
  NETWORK_UPDATE_RATE: 20,
  NETWORK_INTERPOLATION_DELAY: 100,
  NETWORK_PREDICTION_ENABLED: true,

  // ==================== PERFORMANCE ====================
  TARGET_FPS: 60,
  MAX_DELTA_TIME: 50,
  ENABLE_CULLING: true,
  RENDER_DISTANCE: 1600,

  // ==================== ASSETS ====================
  // Was raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/dragons/ -
  // GitHub's raw content host isn't meant for production hotlinking and was
  // rate-limiting/resetting connections under repeated load (the
  // ERR_CONNECTION_RESET errors on aegis_head/tail/body.png). These same
  // files already live in this repo, which Cloudflare Pages now serves
  // directly - so pointing at our own domain instead of GitHub's raw host
  // fixes the rate limiting and is also just plain faster (same CDN as the
  // rest of the site, no extra cross-origin hop).
  ASSET_BASE_URL: '/dragons/',
  DRAGON_NAMES: DRAGONS
};

Object.freeze(CONFIG);
Object.freeze(CONFIG.ARENA);
Object.freeze(CONFIG.MAX_PLAYERS);
Object.freeze(CONFIG.GAME_DURATION);
Object.freeze(CONFIG.EFFECTS);

export default CONFIG;
