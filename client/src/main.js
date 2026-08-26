import { DiscordSDK } from '@discord/embedded-app-sdk';
import { connectRoom, startScreenShare, stopScreenShare } from './screenshare';

function log(msg) {
  const el = document.getElementById('debug-log');
  el.innerHTML += `<div>${msg}</div>`;
}

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setup() {
  await discordSdk.ready();
  log('ready() OK');

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });
  log('authorize() OK');

  const response = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();
  log(`token trocado: ${access_token ? 'presente' : 'AUSENTE'}`);

  const auth = await discordSdk.commands.authenticate({ access_token });
  log('authenticate() OK');
  return auth;
}

setup()
  .then(async (auth) => {
    log('1. Setup OK');

    const res = await fetch('/.proxy/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: auth.access_token }),
    });
    const { token } = await res.json();
    log(`2. token LiveKit=${token ? 'presente' : 'AUSENTE'}`);

    await connectRoom(token);
    log('3. connectRoom OK');

    shareBtn.addEventListener('click', async () => {
      log('5. Botão clicado');
      try {
        await startScreenShare();
        log('6. startScreenShare OK');
      } catch (err) {
        log(`ERRO no startScreenShare: ${err.name} - ${err.message}`);
      }
    });

    document.getElementById('stop-btn').addEventListener('click', stopScreenShare);
  })
  .catch((err) => {
    log(`ERRO GERAL: ${err.name} - ${err.message}`);
  });