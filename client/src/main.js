import { DiscordSDK } from '@discord/embedded-app-sdk';
import { connectRoom, initFullscreenControls, setAudioOutputDevice } from './screenshare';
import './style.css';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setupAudioOutputSelection() {
  const select = document.getElementById('audio-output-select');
  if (!select) return;

  const updateDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    const currentVal = select.value;
    select.innerHTML = '<option value="">Padrão do Sistema</option>';
    
    let hasHiddenLabels = false;

    audioOutputs.forEach(d => {
      if (d.deviceId === 'default' || d.deviceId === 'communications') return;
      if (!d.label) hasHiddenLabels = true;
      
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      // Exibe parte do ID apenas se o label estiver vazio
      opt.textContent = d.label || `Dispositivo de Áudio (${d.deviceId.slice(0, 4)}...)`;
      select.appendChild(opt);
    });

    if (hasHiddenLabels) {
      const unlockOpt = document.createElement('option');
      unlockOpt.value = 'unlock';
      unlockOpt.textContent = '🔓 Mostrar nomes reais...';
      unlockOpt.style.color = '#f38ba8';
      select.appendChild(unlockOpt);
    }

    if (currentVal && (audioOutputs.find(d => d.deviceId === currentVal) || currentVal === 'unlock')) {
      select.value = currentVal;
    }
  };

  await updateDevices();
  navigator.mediaDevices.addEventListener('devicechange', updateDevices);

  select.addEventListener('change', async () => {
    if (select.value === 'unlock') {
      try {
        // Pede permissão de áudio para liberar a leitura dos "labels"
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        select.value = ''; // Reseta para padrão enquanto recarrega
        await updateDevices(); // Atualiza a lista agora com os nomes liberados
      } catch (err) {
        console.warn('Permissão negada ou falha ao obter acesso ao microfone', err);
        alert('É necessário permitir acesso ao microfone para ver os nomes dos dispositivos de saída.');
        select.value = '';
      }
      return;
    }

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
  const insideDiscord = window.location.hostname.endsWith('.discordsays.com');
  const endpoint = !insideDiscord && directPath ? directPath : proxyPath;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  } catch (err) {
    console.error(`Erro de rede ao chamar ${endpoint}:`, err);
    throw new Error(`Não foi possível acessar a API em ${endpoint}. Verifique a disponibilidade do servidor e o mapeamento /api da atividade.`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    if (res.status === 429) {
      throw new Error('Limite de requisições atingido. Aguarde antes de abrir a atividade novamente.');
    }
    throw new Error(`A API em ${endpoint} retornou uma resposta inválida (HTTP ${res.status}). Verifique o servidor e o mapeamento /api da atividade.`);
  }

  if (!res.ok) {
    const message = data?.error_description || data?.message || data?.error;
    // Reconhece também o bloqueio retornado como HTTP 400 por versões anteriores do backend.
    if (res.status === 429 || /rate.?limit/i.test(message || '')) {
      const retryAfter = Number(data?.retry_after);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? `Aguarde ${Math.ceil(retryAfter)} segundos antes de tentar novamente.`
        : 'Aguarde antes de abrir a atividade novamente.';
      throw new Error(`Limite de requisições atingido no Discord. ${wait}`);
    }
    throw new Error(`Falha na API (HTTP ${res.status}): ${message || 'erro ao processar a solicitação'}`);
  }

  return data;
}

async function setup() {
  await discordSdk.ready();

  updateStatus('Solicitando autorização ao Discord...');
  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });

  updateStatus('Obtendo token de autenticação do Discord...');
  const { access_token } = await fetchApi('/token', { code });
  updateStatus('Autenticando no Discord...');
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
