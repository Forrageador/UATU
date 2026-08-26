import { DiscordSDK } from '@discord/embedded-app-sdk';
import { connectRoom } from './screenshare';
import './style.css';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setup() {
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });

  const response = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  const auth = await discordSdk.commands.authenticate({ access_token });
  return auth;
}

setup()
  .then(async (auth) => {
    const res = await fetch('/.proxy/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: auth.access_token }),
    });
    const { token } = await res.json();

    await connectRoom(token);
  })
  .catch((err) => {
    console.error('Erro no setup:', err);
  });