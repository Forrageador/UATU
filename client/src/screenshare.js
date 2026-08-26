import { Room, RoomEvent, LocalVideoTrack } from 'livekit-client';

let room = null;
let localStream = null;

export async function connectRoom(token) {
  room = new Room();

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  const el = track.attach();
  el.id = `remote-${participant.identity}-${track.kind}`;

  if (track.kind === 'video') {
    el.style.width = '100%';
    document.getElementById('remote-screens').appendChild(el);
  } else if (track.kind === 'audio') {
    // elemento de áudio não precisa aparecer visualmente, só tocar
    el.style.display = 'none';
    document.body.appendChild(el);
  }
});

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
  track.detach().forEach((el) => el.remove());
});

  // Conecta através do proxy do Discord, não direto no domínio do LiveKit.
  // O Discord reescreve /.proxy/livekit para o "target" configurado no
  // URL Mapping (prefix "/livekit") do Developer Portal.
  const livekitUrl = `wss://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/.proxy/livekit`;

  await room.connect(livekitUrl, token);
  return room;
}

export async function startScreenShare() {
  if (!room) throw new Error('Sala não conectada ainda');

  localStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
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