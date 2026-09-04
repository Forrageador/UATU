import { Room, RoomEvent, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

let room = null;
let localStream = null;
let currentVideoEl = null;

function clearVideoContainer() {
  const container = document.getElementById('remote-screens');
  container.querySelectorAll('video').forEach((v) => v.remove());
  currentVideoEl = null;
}

export async function connectRoom(token) {
  room = new Room();

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === 'video') {
      // Remove qualquer vídeo anterior antes de anexar o novo.
      // Sem isso, ao reconectar o apresentador, o elemento antigo (preto/congelado)
      // permanece no DOM junto com o novo, causando tela preta.
      clearVideoContainer();

      const el = track.attach();
      el.id = `remote-${participant.identity}-video`;
      el.style.width = '100%';
      el.autoplay = true;
      el.playsInline = true;

      document.getElementById('remote-screens').appendChild(el);
      currentVideoEl = el;

      // Força reprodução para contornar políticas de autoplay do browser.
      // Sem isso, o <video> pode ficar parado (tela preta) mesmo com a stream ativa.
      el.play().catch((err) => {
        console.warn('Autoplay bloqueado, aguardando interação do usuário:', err);
      });

    } else if (track.kind === 'audio') {
      const el = track.attach();
      el.id = `remote-${participant.identity}-audio`;
      el.style.display = 'none';
      document.body.appendChild(el);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });

  // Apresentador desconectou — limpa o container para não exibir tela congelada.
  // Ao reconectar, TrackSubscribed cria um elemento novo e chama play() automaticamente.
  room.on(RoomEvent.ParticipantDisconnected, () => {
    clearVideoContainer();
  });

  const livekitUrl = `wss://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/.proxy/livekit`;
  await room.connect(livekitUrl, token);
  return room;
}

export async function startScreenShare() {
  if (!room) throw new Error('Sala não conectada ainda');

  localStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 24, max: 30 } },
    audio: true,
  });

  const videoTrack = new LocalVideoTrack(localStream.getVideoTracks()[0]);
  await room.localParticipant.publishTrack(videoTrack);

  localStream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
}

export function stopScreenShare() {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
}