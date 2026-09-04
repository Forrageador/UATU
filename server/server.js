import express from "express";
import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = express();
app.use(express.json());

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

    if (!data.access_token) {
      console.error("Discord OAuth2 não retornou access_token:", data);
      return res.status(400).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error("Erro trocando code por token:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post(["/api/livekit-token", "/livekit-token", "/.proxy/api/livekit-token"], async (req, res) => {
  try {
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: `discord-user-${Date.now()}` }
    );
    at.addGrant({ room: "minha-activity-room", roomJoin: true, canPublish: true, canSubscribe: true });

    res.json({
      livekitUrl: process.env.LIVEKIT_URL,
      token: await at.toJwt(),
    });
  } catch (err) {
    console.error("Erro gerando livekit-token:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post(["/api/presenter-token", "/presenter-token", "/.proxy/api/presenter-token"], async (req, res) => {
  try {
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: `presenter-${Date.now()}` }
    );
    at.addGrant({ room: "minha-activity-room", roomJoin: true, canPublish: true, canSubscribe: true });

    res.json({
      livekitUrl: process.env.LIVEKIT_URL,
      token: await at.toJwt(),
    });
  } catch (err) {
    console.error("Erro gerando presenter-token:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", app: "UATU Server" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server rodando na porta ${PORT}`);
});