import { Room, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

function log(msg) {
  const el = document.getElementById('debug-log');
  el.innerHTML += `<div>${msg}</div>`;
}

let room = null;
let videoStream = null;
let audioStream = null;

// Popula o dropdown com os dispositivos de áudio disponíveis
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
  const res = await fetch('/api/presenter-token', { method: 'POST' });
  const { livekitUrl, token } = await res.json();
  log(`Token recebido: ${token ? 'OK' : 'FALHOU'}`);

  room = new Room();
  await room.connect(livekitUrl, token);
  log('Conectado na sala LiveKit');
}

document.getElementById('share-btn').addEventListener('click', async () => {
  try {
    if (!room) await connect();

    // Vídeo + áudio: captura de tela com áudio embutido
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

    // Publica tracks: vídeo sempre, áudio do stream se existir
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

function stop() {
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
  log('Compartilhamento parado');
}