import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { AccessToken } from "livekit-server-sdk";
dotenv.config({ path: "../.env" });

const app = express();
const port = 3001;

app.use(express.json());

app.post("/api/token", async (req, res) => {
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });

  const { access_token } = await response.json();
  res.send({ access_token });
});

app.post("/api/livekit-token", async (req, res) => {
  const { access_token } = req.body;

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: `discord-user-${Date.now()}` }
  );
  at.addGrant({ room: "minha-activity-room", roomJoin: true, canPublish: true, canSubscribe: true });

  res.send({
    livekitUrl: process.env.LIVEKIT_URL,
    token: await at.toJwt(),
  });
});

app.post("/api/presenter-token", async (req, res) => {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: `presenter-${Date.now()}` }
  );
  at.addGrant({ room: "minha-activity-room", roomJoin: true, canPublish: true, canSubscribe: true });

  res.send({
    livekitUrl: process.env.LIVEKIT_URL,
    token: await at.toJwt(),
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});