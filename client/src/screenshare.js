import { Room, RoomEvent, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

let room = null;
let localStream = null;
let currentVideoEl = null; // ← novo

export async function connectRoom(token) {
  room = new Room();

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const el = track.attach();
    el.id = `remote-${participant.identity}-${track.kind}`;

    if (track.kind === 'video') {
      el.style.width = '100%';
      document.getElementById('remote-screens').appendChild(el);
      currentVideoEl = el; // ← guarda referência
    } else if (track.kind === 'audio') {
      el.style.display = 'none';
      document.body.appendChild(el);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
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