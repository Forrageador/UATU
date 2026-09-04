import { DiscordSDK } from '@discord/embedded-app-sdk';
import { connectRoom, initFullscreenControls } from './screenshare';
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

// Registra o botão de transmitir imediatamente, independente de quando a auth terminar
function setupBroadcastButton() {
  const broadcastBtn = document.getElementById('broadcast-btn');
  if (!broadcastBtn) return;

  broadcastBtn.addEventListener('click', async () => {
    let customPresenterUrl = (import.meta.env.VITE_PRESENTER_URL || '').trim();
    if (customPresenterUrl && !customPresenterUrl.startsWith('http://') && !customPresenterUrl.startsWith('https://')) {
      customPresenterUrl = `https://${customPresenterUrl}`;
    }
    const presenterUrl = customPresenterUrl || new URL('/presenter.html', window.location.href).href;
    console.log('Tentando abrir presenter:', presenterUrl);

    try {
      await discordSdk.commands.openExternalLink({ url: presenterUrl });
    } catch (err) {
      console.warn('openExternalLink falhou, tentando fallback:', err);
      try {
        window.open(presenterUrl, '_blank');
      } catch (_) {}

      try {
        await navigator.clipboard.writeText(presenterUrl);
        const originalText = broadcastBtn.innerHTML;
        broadcastBtn.textContent = 'Link copiado! Abra no seu navegador';
        setTimeout(() => {
          broadcastBtn.innerHTML = originalText;
        }, 3500);
      } catch (copyErr) {
        alert(`Abra este link no seu navegador para transmitir:\n${presenterUrl}`);
      }
    }
  });
}

setupBroadcastButton();
initFullscreenControls();

setup()
  .then(async (auth) => {
    console.log('Discord autenticado com sucesso!');
    const res = await fetch('/.proxy/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: auth.access_token }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Erro ao obter livekit-token (${res.status}): ${errBody}`);
    }
    const { token } = await res.json();

    console.log('Conectando ao LiveKit no Discord...');
    await connectRoom(token);
    console.log('Conectado ao LiveKit no Discord com sucesso!');
  })
  .catch((err) => {
    console.error('Erro no setup do Discord:', err);
  });