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

setup()
  .then(async (auth) => {
    const res = await fetch('/.proxy/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: auth.access_token }),
    });
    const { token } = await res.json();

    initFullscreenControls();

    await connectRoom(token);

    const broadcastBtn = document.getElementById('broadcast-btn');
    broadcastBtn.addEventListener('click', async () => {
      // Prioriza URL configurada (ex: https://uatu.pages.dev/presenter.html)
      const presenterUrl = import.meta.env.VITE_PRESENTER_URL || new URL('/presenter.html', window.location.href).href;
      console.log('Tentando abrir presenter:', presenterUrl);

      try {
        await discordSdk.commands.openExternalLink({ url: presenterUrl });
      } catch (err) {
        console.warn('openExternalLink falhou, tentando fallback:', err);
        try {
          window.open(presenterUrl, '_blank');
        } catch (_) {}

        // Fallback: copia o link para a área de transferência e dá feedback no botão
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
  })
  .catch((err) => {
    console.error('Erro no setup:', err);
  });