import { Room, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

function log(msg) {
  const el = document.getElementById('debug-log');
  el.innerHTML += `<div>${msg}</div>`;
}

let room = null;
let videoStream = null;
let audioStream = null;

// fontes de audio
async function listAudioDevices() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    log(`Aviso: não foi possível pré-autorizar áudio (${err.message})`);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((d) => d.kind === 'audioinput');

  const select = document.getElementById('audio-source');
  select.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'Nenhum';
  select.appendChild(noneOption);
  audioInputs.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Dispositivo ${device.deviceId.slice(0, 6)}`;
    select.appendChild(option);
  });

  log(`Dispositivos de áudio encontrados: ${audioInputs.length}`);
}

listAudioDevices();

async function connect() {
  // Se houver VITE_SERVER_URL definida (ex: Railway), usa ela. Senão usa o proxy relativo.
  const serverBase = import.meta.env.VITE_SERVER_URL ? import.meta.env.VITE_SERVER_URL.replace(/\/$/, '') : '';
  const tokenEndpoint = serverBase ? `${serverBase}/api/presenter-token` : '/.proxy/api/presenter-token';

  log(`Obtendo token de: ${tokenEndpoint}`);
  const res = await fetch(tokenEndpoint, { method: 'POST' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Servidor retornou status ${res.status}: ${errorText.slice(0, 100)}`);
  }

  const data = await res.json();
  const { token, livekitUrl: serverLivekitUrl } = data;
  log(`Token recebido: ${token ? 'OK' : 'FALHOU'}`);

  // Fora do Discord, precisa usar a URL direta do LiveKit (ex: wss://...livekit.cloud).
  // Dentro do proxy do Discord, usaria wss://<id>.discordsays.com/.proxy/livekit.
  const livekitUrl = serverLivekitUrl || `wss://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/.proxy/livekit`;
  log(`Conectando ao LiveKit...`);

  const newRoom = new Room();
  try {
    await newRoom.connect(livekitUrl, token);
    room = newRoom; // só atribui APÓS conectar com sucesso
    log('Conectado na sala LiveKit com sucesso!');
  } catch (err) {
    room = null;
    throw err;
  }
}

document.getElementById('share-btn').addEventListener('click', async () => {
  try {
    if (!room) await connect();

    videoStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: true,
    });

    const rawVideoTrack = videoStream.getVideoTracks()[0];
    rawVideoTrack.contentHint = 'motion';
    const videoTrack = new LocalVideoTrack(rawVideoTrack);

    const publishPromises = [
      room.localParticipant.publishTrack(videoTrack, {
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
        simulcast: false,
      }),
    ];

    const screenAudioTrack = videoStream.getAudioTracks()[0];
    if (screenAudioTrack) {
      const lkScreenAudio = new LocalAudioTrack(screenAudioTrack);
      publishPromises.push(
        room.localParticipant.publishTrack(lkScreenAudio, {
          audioPreset: { maxBitrate: 128_000 },
          dtx: false,
        }),
      );
    }

    // Fonte de áudio externa (opcional)
    const selectedDeviceId = document.getElementById('audio-source').value;
    if (selectedDeviceId) {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedDeviceId } },
      });
      const rawAudioTrack = audioStream.getAudioTracks()[0];
      const audioTrack = new LocalAudioTrack(rawAudioTrack);
      publishPromises.push(
        room.localParticipant.publishTrack(audioTrack, {
          audioPreset: { maxBitrate: 128_000 },
          dtx: false,
        }),
      );
    }

    await Promise.all(publishPromises);
    log('Publicado: vídeo (tela) + áudio do stream' +
        (selectedDeviceId ? ' + áudio (fonte selecionada)' : ''));

    rawVideoTrack.addEventListener('ended', stop);
  } catch (err) {
    log(`ERRO: ${err.name} - ${err.message}`);
  }
});

document.getElementById('stop-btn').addEventListener('click', stop);

async function stop() {
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }

  if (room) {
    try {
      await room.localParticipant.unpublishAllTracks();
      await room.disconnect();
    } catch (err) {
      log(`Aviso ao desconectar do LiveKit: ${err.message}`);
    }
    room = null;
  }

  log('Compartilhamento parado');
}