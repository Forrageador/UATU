import express from 'express';
import 'dotenv/config';
import { AccessToken } from 'livekit-server-sdk';

const app = express();
app.use(express.json());

app.post('/api/token', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      console.error('Discord OAuth2 não retornou access_token:', data);
      return res.status(400).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('Erro trocando code por token:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/livekit-token', async (req, res) => {
  const { access_token } = req.body;

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: `discord-user-${Date.now()}` }
  );
  at.addGrant({ room: 'minha-activity-room', roomJoin: true, canPublish: true, canSubscribe: true });

  res.json({
    livekitUrl: process.env.LIVEKIT_URL,
    token: await at.toJwt(),
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));