import express from "express";
import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = express();
app.use(express.json());

const presenterSessions = new Map();
const presenterSessionTtlMs = 5 * 60 * 1000;

function errorWithStatus(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, error, fallback = "internal_error") {
  const status = error.status || 500;
  console.error(error.message || error);
  res.status(status).json({ error: status === 500 ? fallback : error.message });
}

async function getDiscordUser(accessToken) {
  if (!accessToken) {
    throw errorWithStatus(401, "missing_access_token");
  }

  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw errorWithStatus(response.status === 401 ? 401 : 502, "discord_user_lookup_failed");
  }

  return data;
}

function profileFromDiscordUser(user) {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.global_name || user.username,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null,
  };
}

function createLiveKitToken(prefix, profile) {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: `${prefix}-${profile.userId}-${randomUUID()}`,
      name: profile.displayName,
      metadata: JSON.stringify({ profile }),
    },
  );
  at.addGrant({ room: "minha-activity-room", roomJoin: true, canPublish: true, canSubscribe: true });
  return at;
}

function cleanupPresenterSessions() {
  const now = Date.now();
  for (const [session, entry] of presenterSessions) {
    if (entry.expiresAt <= now) presenterSessions.delete(session);
  }
}

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.post(["/api/token", "/token", "/.proxy/api/token"], async (req, res) => {
  const { code } = req.body;

  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error("Discord OAuth2 não retornou access_token:", data);
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) res.set("Retry-After", retryAfter);
      return res.status(response.ok ? 502 : response.status).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error("Erro trocando code por token:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post(["/api/presenter-session", "/presenter-session", "/.proxy/api/presenter-session"], async (req, res) => {
  try {
    const user = await getDiscordUser(req.body?.access_token);
    cleanupPresenterSessions();

    const session = randomUUID();
    presenterSessions.set(session, {
      profile: profileFromDiscordUser(user),
      expiresAt: Date.now() + presenterSessionTtlMs,
    });

    res.json({ session });
  } catch (err) {
    sendError(res, err, "presenter_session_error");
  }
});

app.post(["/api/livekit-token", "/livekit-token", "/.proxy/api/livekit-token"], async (req, res) => {
  try {
    const user = await getDiscordUser(req.body?.access_token);
    const profile = profileFromDiscordUser(user);
    const at = createLiveKitToken("discord-user", profile);

    res.json({
      livekitUrl: process.env.LIVEKIT_URL,
      token: await at.toJwt(),
    });
  } catch (err) {
    sendError(res, err, "livekit_token_error");
  }
});

app.post(["/api/presenter-token", "/presenter-token", "/.proxy/api/presenter-token"], async (req, res) => {
  try {
    cleanupPresenterSessions();
    const session = presenterSessions.get(req.body?.session);
    if (!session || session.expiresAt <= Date.now()) {
      throw errorWithStatus(401, "invalid_presenter_session");
    }
    presenterSessions.delete(req.body.session);

    const at = createLiveKitToken("presenter", session.profile);

    res.json({
      livekitUrl: process.env.LIVEKIT_URL,
      token: await at.toJwt(),
    });
  } catch (err) {
    sendError(res, err, "presenter_token_error");
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", app: "UATU Server" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server rodando na porta ${PORT}`);
});
