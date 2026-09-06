import { DiscordSDK } from '@discord/embedded-app-sdk';
import { connectRoom, initFullscreenControls, setAudioOutputDevice } from './screenshare';
import './style.css';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setupAudioOutputSelection() {
  const select = document.getElementById('audio-output-select');
  if (!select) return;

  try {
    // Pedir permissão rápida de áudio para liberar os labels dos dispositivos de saída
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    console.warn('Permissão de áudio negada, labels podem não aparecer', err);
  }

  const updateDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    const currentVal = select.value;
    select.innerHTML = '<option value="">Padrão do Sistema</option>';
    
    audioOutputs.forEach(d => {
      // Ignora o dispositivo padrão que já está representado
      if (d.deviceId === 'default') return;
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Dispositivo ${d.deviceId.slice(0, 5)}`;
      select.appendChild(opt);
    });

    if (currentVal && audioOutputs.find(d => d.deviceId === currentVal)) {
      select.value = currentVal;
    }
  };

  await updateDevices();
  navigator.mediaDevices.addEventListener('devicechange', updateDevices);

  select.addEventListener('change', () => {
    setAudioOutputDevice(select.value);
  });
}



async function fetchApi(path, body) {
  let serverBase = (import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/$/, '');
  if (serverBase && !serverBase.startsWith('http://') && !serverBase.startsWith('https://')) {
    serverBase = `https://${serverBase}`;
  }

  const proxyPath = path.startsWith('/') ? `/.proxy/api${path}` : `/.proxy/api/${path}`;
  const directPath = serverBase ? (path.startsWith('/') ? `${serverBase}/api${path}` : `${serverBase}/api/${path}`) : null;

  try {
    const res = await fetch(proxyPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (res.ok && !text.trim().startsWith('<')) {
      return JSON.parse(text);
    }
    console.warn(`Proxy do Discord retornou status ${res.status} (${text.slice(0, 80)}). Tentando fallback...`);
  } catch (err) {
    console.warn('Erro ao chamar proxy do Discord:', err);
  }

  if (directPath) {
    console.log('Tentando chamada direta ao servidor backend:', directPath);
    const directRes = await fetch(directPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const directText = await directRes.text();
    if (!directRes.ok || directText.trim().startsWith('<')) {
      throw new Error(`Servidor retornou status ${directRes.status}: ${directText.slice(0, 100)}`);
    }
    return JSON.parse(directText);
  }

  throw new Error(`Falha ao contactar a API em ${proxyPath} (resposta inválida).`);
}

async function setup() {
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });

  const { access_token } = await fetchApi('/token', { code });
  const auth = await discordSdk.commands.authenticate({ access_token });
  return auth;
}

function updateStatus(msg, isError = false) {
  const el = document.getElementById('status-text');
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? '#f38ba8' : '#a6e3a1';
  }
}

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
      updateStatus('Link de transmissão aberto no navegador!');
    } catch (err) {
      console.warn('openExternalLink falhou, tentando fallback:', err);
      try {
        window.open(presenterUrl, '_blank');
      } catch (_) {}

      try {
        await navigator.clipboard.writeText(presenterUrl);
        const originalText = broadcastBtn.innerHTML;
        broadcastBtn.textContent = 'Link copiado! Abra no navegador';
        updateStatus('Link copiado! Cole no seu navegador');
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
setupAudioOutputSelection();

async function start() {
  try {
    updateStatus('Conectando ao Discord SDK...');
    const auth = await setup();

    updateStatus('Obtendo token da sala LiveKit...');
    const { token, livekitUrl: serverLivekitUrl } = await fetchApi('/livekit-token', {
      access_token: auth.access_token,
    });
    updateStatus('Conectando à sala LiveKit...');

    await connectRoom(token, serverLivekitUrl);
    updateStatus('Conectado à sala! Aguardando transmissão...');
  } catch (err) {
    console.error('Erro no setup do Discord:', err);
    updateStatus(`Erro: ${err.message}`, true);
  }
}

start();