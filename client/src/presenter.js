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
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: true,
    });

    const rawVideoTrack = localStream.getVideoTracks()[0];
    rawVideoTrack.contentHint = 'motion'; // prioriza fluidez em vez de nitidez de texto

    const videoTrack = new LocalVideoTrack(rawVideoTrack);
    const audioTracks = localStream.getAudioTracks();

    const publishPromises = [
      room.localParticipant.publishTrack(videoTrack, {
        videoEncoding: {
          maxBitrate: 3_000_000,
          maxFramerate: 30,
        },
        simulcast: false,
      }),
    ];

    if (audioTracks.length > 0) {
      const audioTrack = new LocalAudioTrack(audioTracks[0]);
      publishPromises.push(
        room.localParticipant.publishTrack(audioTrack, {
          audioPreset: {
            maxBitrate: 128_000,
          },
          dtx: false,
        })
      );
    } else {
      log('Nenhuma track de áudio disponível (o navegador/guia não forneceu áudio)');
    }

    await Promise.all(publishPromises);
    log(`Publicado: vídeo${audioTracks.length > 0 ? ' + áudio' : ' (sem áudio)'} em qualidade alta`);

    rawVideoTrack.addEventListener('ended', stop);
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