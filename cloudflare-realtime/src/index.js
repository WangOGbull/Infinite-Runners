const MAX_MESSAGE_BYTES = 8192;
const MAX_UPDATES_PER_SECOND = 30;
const ROOM_KEY_RE = /^[A-Za-z0-9_-]{1,96}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "infinite-runners-realtime" });
    }

    if (url.pathname !== "/game-sync") {
      return new Response("Not found", { status: 404 });
    }

    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = new Set(
      String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (allowedOrigins.size && !allowedOrigins.has(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const roomCode = url.searchParams.get("roomCode") || "";
    const matchId = url.searchParams.get("matchId") || "";
    if (!ROOM_KEY_RE.test(roomCode) || !ROOM_KEY_RE.test(matchId)) {
      return new Response("Invalid room", { status: 400 });
    }

    const id = env.GAME_ROOMS.idFromName(`${roomCode}:${matchId}`);
    return env.GAME_ROOMS.get(id).fetch(request);
  },
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.states = new Map();
    this.rateWindows = new WeakMap();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomCode = url.searchParams.get("roomCode") || "";
    const matchId = url.searchParams.get("matchId") || "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      authenticated: false,
      roomCode,
      matchId,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    try {
      const text =
        typeof rawMessage === "string"
          ? rawMessage
          : new TextDecoder().decode(rawMessage);

      if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }

      const message = JSON.parse(text);
      const attachment = socket.deserializeAttachment() || {
        authenticated: false,
      };

      if (!attachment.authenticated) {
        await this.authenticate(socket, message);
        return;
      }

      if (!this.allowUpdate(socket)) return;

      if (message?.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", serverTime: Date.now() }));
        return;
      }

      if (message?.type !== "state" || !isPlainObject(message.state)) return;

      const cleanState = sanitizeState(message.state);
      cleanState.serverReceivedAt = Date.now();
      this.states.set(attachment.playerId, cleanState);
      this.broadcastSnapshot();
    } catch {
      socket.close(1003, "Invalid message");
    }
  }

  async authenticate(socket, message) {
    if (
      message?.type !== "auth" ||
      typeof message.token !== "string" ||
      typeof message.playerId !== "string"
    ) {
      socket.close(1008, "Authentication required");
      return;
    }

    const claims = await verifyFirebaseIdToken(
      message.token,
      this.env.FIREBASE_PROJECT_ID,
    );

    const attachment = socket.deserializeAttachment() || {};
    if (
      !claims ||
      message.roomCode !== attachment.roomCode ||
      message.matchId !== attachment.matchId
    ) {
      socket.close(1008, "Invalid identity");
      return;
    }

    const isMember = await verifyRoomMembership({
      databaseUrl: this.env.FIREBASE_DATABASE_URL,
      token: message.token,
      roomCode: attachment.roomCode,
      playerId: message.playerId,
      uid: claims.sub,
    });
    if (!isMember) {
      socket.close(1008, "Player is not a room member");
      return;
    }

    const playerId = message.playerId;
    socket.serializeAttachment({
      authenticated: true,
      playerId,
      roomCode: attachment.roomCode,
      matchId: attachment.matchId,
    });
    socket.send(
      JSON.stringify({
        type: "ready",
        playerId,
        serverTime: Date.now(),
      }),
    );
    this.broadcastSnapshot();
  }

  allowUpdate(socket) {
    const now = Date.now();
    let window = this.rateWindows.get(socket);
    if (!window || now - window.startedAt >= 1000) {
      window = { startedAt: now, count: 0 };
      this.rateWindows.set(socket, window);
    }
    window.count += 1;
    return window.count <= MAX_UPDATES_PER_SECOND;
  }

  webSocketClose(socket) {
    this.removeSocket(socket);
  }

  webSocketError(socket) {
    this.removeSocket(socket);
  }

  removeSocket(socket) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.authenticated && attachment.playerId) {
      this.states.delete(attachment.playerId);
      this.broadcastSnapshot();
    }
  }

  broadcastSnapshot() {
    const payload = JSON.stringify({
      type: "snapshot",
      serverTime: Date.now(),
      players: Object.fromEntries(this.states),
    });

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.authenticated) continue;
      try {
        socket.send(payload);
      } catch {
        // Closing sockets are removed by the close/error handlers.
      }
    }
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sanitizeState(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return value.slice(0, 160);
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeState(item, depth + 1));
  }
  if (!isPlainObject(value)) return null;

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    ) {
      continue;
    }
    result[key.slice(0, 80)] = sanitizeState(item, depth + 1);
  }
  return result;
}

async function verifyRoomMembership({
  databaseUrl,
  token,
  roomCode,
  playerId,
  uid,
}) {
  try {
    if (!databaseUrl || !ROOM_KEY_RE.test(roomCode) || !ROOM_KEY_RE.test(playerId)) {
      return false;
    }
    const endpoint =
      `${String(databaseUrl).replace(/\/$/, "")}/rooms/` +
      `${encodeURIComponent(roomCode)}/players/${encodeURIComponent(playerId)}.json` +
      `?auth=${encodeURIComponent(token)}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return false;
    const player = await response.json();
    return player && player.authUid === uid;
  } catch {
    return false;
  }
}

async function verifyFirebaseIdToken(token, projectId) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]);
    const now = Math.floor(Date.now() / 1000);

    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      claims.aud !== projectId ||
      claims.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 128 ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      typeof claims.iat !== "number" ||
      claims.iat > now + 300
    ) {
      return null;
    }

    const response = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      { cf: { cacheTtl: 3600, cacheEverything: true } },
    );
    if (!response.ok) return null;

    const keys = await response.json();
    const jwk = keys.keys?.find((key) => key.kid === header.kid);
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToBytes(parts[2]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      data,
    );

    return valid ? claims : null;
  } catch {
    return null;
  }
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
