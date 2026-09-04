import { Room, RoomEvent } from 'livekit-client';

let room = null;

const participants = new Map();

let fullscreenIdentity = null;


function getDisplayName(identity) {
  if (!identity) return 'Desconhecido';
  if (identity.startsWith('presenter-')) {
    const suffix = identity.slice('presenter-'.length);
    return `Apresentador ${suffix.slice(0, 6)}`;
  }
  if (identity.startsWith('discord-user-')) {
    const suffix = identity.slice('discord-user-'.length);
    return `Usuário ${suffix.slice(0, 6)}`;
  }
  return identity;
}

function getInitial(identity) {
  const name = getDisplayName(identity);
  return name ? name[0].toUpperCase() : '?';
}


function updateGridLayout() {
  const grid = document.getElementById('participants-grid');
  const count = participants.size;

  if (count <= 1) {
    grid.style.gridTemplateColumns = '1fr';
  } else if (count === 2) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else if (count <= 4) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else if (count <= 6) {
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  } else {
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
  }
}


function createParticipantCard(identity) {
  const grid = document.getElementById('participants-grid');

  const card = document.createElement('div');
  card.className = 'participant-card';
  card.id = `card-${CSS.escape(identity)}`;

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-placeholder';

  const circle = document.createElement('div');
  circle.className = 'avatar-circle';
  circle.textContent = getInitial(identity);

  const nameEl = document.createElement('div');
  nameEl.className = 'participant-name';
  nameEl.textContent = getDisplayName(identity);

  avatarWrap.appendChild(circle);
  avatarWrap.appendChild(nameEl);
  card.appendChild(avatarWrap);

  grid.appendChild(card);

  participants.set(identity, { card, videoEl: null, audioEls: [] });
  updateGridLayout();
  return card;
}

function removeParticipantCard(identity) {
  const data = participants.get(identity);
  if (!data) return;

  data.audioEls.forEach((el) => el.remove());

  data.card.remove();
  participants.delete(identity);
  updateGridLayout();
}


function createCardControls(identity) {
  const controls = document.createElement('div');
  controls.className = 'card-controls';

  const label = document.createElement('span');
  label.className = 'stream-label';
  label.textContent = getDisplayName(identity);

  const volWrap = document.createElement('div');
  volWrap.className = 'volume-control';

  const volIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  volIcon.setAttribute('viewBox', '0 0 24 24');
  volIcon.setAttribute('width', '16');
  volIcon.setAttribute('height', '16');
  volIcon.setAttribute('fill', 'currentColor');
  volIcon.innerHTML = `
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
  `;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'volume-slider';
  slider.min = 0;
  slider.max = 100;
  slider.value = 100;

  slider.addEventListener('input', () => {
    const vol = slider.value / 100;
    const data = participants.get(identity);
    if (!data) return;
    if (data.videoEl) data.videoEl.volume = vol;
    data.audioEls.forEach((a) => (a.volume = vol));
    // sincroniza slider do fullscreen se for o mesmo participante
    if (fullscreenIdentity === identity) {
      const fsSlider = document.getElementById('fullscreen-volume-slider');
      const fsVideo = document.getElementById('fullscreen-video');
      if (fsSlider) fsSlider.value = slider.value;
      if (fsVideo) fsVideo.volume = vol;
    }
  });

  volWrap.appendChild(volIcon);
  volWrap.appendChild(slider);

  const fsBtn = document.createElement('button');
  fsBtn.className = 'fullscreen-btn';
  fsBtn.title = 'Tela cheia';
  fsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
    </svg>
  `;
  fsBtn.addEventListener('click', () => openFullscreen(identity));

  controls.appendChild(label);
  controls.appendChild(volWrap);
  controls.appendChild(fsBtn);

  return controls;
}


function attachVideoToCard(identity, track) {
  let data = participants.get(identity);
  if (!data) {
    createParticipantCard(identity);
    data = participants.get(identity);
  }

  if (data.videoEl) {
    data.videoEl.remove();
    data.videoEl = null;
  }

  // oculta avatar
  const avatar = data.card.querySelector('.avatar-placeholder');
  if (avatar) avatar.style.display = 'none';

  const el = track.attach();
  el.id = `remote-${identity}-video`;
  el.autoplay = true;
  el.playsInline = true;
  el.muted = false;
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'contain';
  el.style.borderRadius = '8px';

  data.card.insertBefore(el, data.card.firstChild);
  data.videoEl = el;

  data.card.classList.add('streaming');

  if (!data.card.querySelector('.card-controls')) {
    const controls = createCardControls(identity);
    data.card.appendChild(controls);
  }

  el.play().catch((err) => {
    console.warn('Autoplay bloqueado:', err);
  });
}

function attachAudioToCard(identity, track) {
  let data = participants.get(identity);
  if (!data) {
    createParticipantCard(identity);
    data = participants.get(identity);
  }

  const el = track.attach();
  el.id = `remote-${identity}-audio-${Date.now()}`;
  el.style.display = 'none';
  document.body.appendChild(el);

  data.audioEls.push(el);
}

function detachTrackFromCard(identity, track) {
  const data = participants.get(identity);
  if (!data) return;

  const elements = track.detach();

  elements.forEach((el) => {
    if (el === data.videoEl) {
      data.videoEl = null;
      checkCardStreaming(identity);
    } else {
      const idx = data.audioEls.indexOf(el);
      if (idx !== -1) data.audioEls.splice(idx, 1);
    }
    el.remove();
  });
}

function checkCardStreaming(identity) {
  const data = participants.get(identity);
  if (!data) return;

  if (!data.videoEl) {
    data.card.classList.remove('streaming');

    const controls = data.card.querySelector('.card-controls');
    if (controls) controls.remove();

    const avatar = data.card.querySelector('.avatar-placeholder');
    if (avatar) avatar.style.display = '';

    closeFullscreenIfMatches(identity);
  }
}


function openFullscreen(identity) {
  const data = participants.get(identity);
  if (!data || !data.videoEl) return;

  fullscreenIdentity = identity;

  const overlay = document.getElementById('fullscreen-overlay');
  const fsVideo = document.getElementById('fullscreen-video');
  const fsSlider = document.getElementById('fullscreen-volume-slider');
  const fsLabel = document.getElementById('fullscreen-label');

  fsVideo.srcObject = data.videoEl.srcObject;
  fsVideo.volume = data.videoEl.volume;

  if (fsSlider) fsSlider.value = data.videoEl.volume * 100;
  if (fsLabel) fsLabel.textContent = getDisplayName(identity);

  if (fsSlider) {
    fsSlider.oninput = () => {
      const vol = fsSlider.value / 100;
      fsVideo.volume = vol;
      const d = participants.get(identity);
      if (!d) return;
      if (d.videoEl) d.videoEl.volume = vol;
      d.audioEls.forEach((a) => (a.volume = vol));

      const cardSlider = d.card.querySelector('.volume-slider');
      if (cardSlider) cardSlider.value = fsSlider.value;
    };
  }

  fsVideo.play().catch(() => {});
  overlay.classList.remove('hidden');
}

function closeFullscreen() {
  const overlay = document.getElementById('fullscreen-overlay');
  const fsVideo = document.getElementById('fullscreen-video');

  overlay.classList.add('hidden');
  if (fsVideo) fsVideo.srcObject = null;
  fullscreenIdentity = null;
}

function closeFullscreenIfMatches(identity) {
  if (fullscreenIdentity === identity) closeFullscreen();
}

// ─── controles do overlay de tela cheia ─────────────────────────────────────

export function initFullscreenControls() {
  const exitBtn = document.getElementById('fullscreen-exit-btn');
  if (exitBtn) exitBtn.addEventListener('click', closeFullscreen);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFullscreen();
  });
}


export async function connectRoom(token) {
  room = new Room();

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    if (!participants.has(participant.identity)) {
      createParticipantCard(participant.identity);
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    closeFullscreenIfMatches(participant.identity);
    removeParticipantCard(participant.identity);
  });

  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    if (!participants.has(participant.identity)) {
      createParticipantCard(participant.identity);
    }
    if (track.kind === 'video') {
      attachVideoToCard(participant.identity, track);
    } else if (track.kind === 'audio') {
      attachAudioToCard(participant.identity, track);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
    detachTrackFromCard(participant.identity, track);
  });

  const livekitUrl = `wss://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/.proxy/livekit`;
  await room.connect(livekitUrl, token);

  room.remoteParticipants.forEach((participant) => {
    if (!participants.has(participant.identity)) {
      createParticipantCard(participant.identity);
    }
    participant.trackPublications.forEach((pub) => {
      if (pub.track && pub.isSubscribed) {
        if (pub.track.kind === 'video') {
          attachVideoToCard(participant.identity, pub.track);
        } else if (pub.track.kind === 'audio') {
          attachAudioToCard(participant.identity, pub.track);
        }
      }
    });
  });

  return room;
}