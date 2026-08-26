import { Room, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

function log(msg) {
  const el = document.getElementById('debug-log');
  el.innerHTML += `<div>${msg}</div>`;
}

let room = null;
let localStream = null;

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

    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });

    const videoTrack = new LocalVideoTrack(localStream.getVideoTracks()[0]);
    await room.localParticipant.publishTrack(videoTrack);
    log('Vídeo publicado');

    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const audioTrack = new LocalAudioTrack(audioTracks[0]);
      await room.localParticipant.publishTrack(audioTrack);
      log('Áudio publicado');
    } else {
      log('Nenhuma track de áudio disponível (o navegador/guia não forneceu áudio)');
    }

    localStream.getVideoTracks()[0].addEventListener('ended', stop);
  } catch (err) {
    log(`ERRO: ${err.name} - ${err.message}`);
  }
});

document.getElementById('stop-btn').addEventListener('click', stop);

function stop() {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  log('Compartilhamento parado');
}