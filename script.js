
"use strict";

const $ = (id) => document.getElementById(id);

const audio = new Audio();
audio.preload = "metadata";
audio.volume = 0.8;

const state = {
  songs: [],
  index: -1,
  shuffle: false,
  repeat: false,
  played: 0,
  favorites: new Set(),
  audioContext: null,
  analyser: null,
  filters: [],
  source: null,
  connected: false,
  objectUrls: new Set(),
  toastTimer: null
};

const fileInput = $("fileInput");
const playlist = $("playlist");
const playBtn = $("playBtn");
const seek = $("seek");
const canvas = $("visualizer");
const ctx = canvas.getContext("2d");
const disc = $("disc");
const statusEl = $("status");
const eqVisual = $("eqVisual");

function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function displayName(fileName) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function selectedSong() {
  return state.songs[state.index] || null;
}

function updateMode() {
  $("statMode").textContent = state.shuffle
    ? "SHUFFLE"
    : state.repeat ? "REPEAT" : "NORMAL";
  $("shuffleBtn").classList.toggle("active", state.shuffle);
  $("repeatBtn").classList.toggle("active", state.repeat);
}

function updateTrackInfo() {
  const song = selectedSong();
  $("trackTitle").textContent = song ? song.title : "No track selected";
  $("trackArtist").textContent = song
    ? `${song.file.name} · LOCAL FILE`
    : "Add music from your device";
  $("favoriteBtn").classList.toggle(
    "active", song ? state.favorites.has(song.id) : false
  );
  $("favoriteBtn").textContent =
    song && state.favorites.has(song.id) ? "♥" : "♡";
  $("visualLabel").textContent = song ? "NOW LOADED" : "READY TO PLAY";
  $("songCount").textContent = state.songs.length;
  $("statTracks").textContent = String(state.songs.length).padStart(2, "0");
  $("statPlayed").textContent = String(state.played).padStart(2, "0");
  renderPlaylist();
}

function renderPlaylist() {
  playlist.replaceChildren();

  if (!state.songs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Belum ada lagu di playlist.";
    playlist.append(empty);
    return;
  }

  state.songs.forEach((song, index) => {
    const row = document.createElement("div");
    row.className = "song" + (index === state.index ? " active" : "");

    const art = document.createElement("div");
    art.className = "song-art";
    art.textContent = index === state.index && !audio.paused ? "♫" : "♪";

    const details = document.createElement("div");
    details.className = "song-details";

    const title = document.createElement("strong");
    title.textContent = song.title;

    const subtitle = document.createElement("small");
    subtitle.textContent =
      `${index === state.index ? "CURRENT TRACK" : "LOCAL AUDIO"} · ` +
      (song.duration ? formatTime(song.duration) : "Audio file");

    details.append(title, subtitle);

    const select = document.createElement("button");
    select.className = "song-play";
    select.textContent = index === state.index && !audio.paused ? "Ⅱ" : "▶";
    select.setAttribute("aria-label", `Putar ${song.title}`);
    select.addEventListener("click", () => {
      if (index === state.index) {
        togglePlayback();
      } else {
        loadSong(index, true);
      }
    });

    const remove = document.createElement("button");
    remove.className = "song-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Hapus ${song.title}`);
    remove.addEventListener("click", () => removeSong(index));

    row.append(art, details, select, remove);
    playlist.append(row);
  });
}

function addFiles(files) {
  const incoming = Array.from(files).filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|m4a|wav|ogg|aac|flac|opus|weba)$/i.test(file.name)
  );

  if (!incoming.length) {
    notify("Pilih file audio yang didukung.");
    return;
  }

  let added = 0;
  for (const file of incoming) {
    const url = URL.createObjectURL(file);
    const song = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      url,
      title: displayName(file.name),
      duration: 0
    };

    state.songs.push(song);
    state.objectUrls.add(url);
    added++;
  }

  updateTrackInfo();
  notify(`${added} lagu ditambahkan ke playlist.`);

  if (state.index === -1 && state.songs.length) {
    loadSong(0, false);
  }
}

function loadSong(index, autoplay = true) {
  if (!state.songs.length) {
    notify("Tambahkan lagu terlebih dahulu.");
    return;
  }

  if (index < 0) index = state.songs.length - 1;
  if (index >= state.songs.length) index = 0;

  const song = state.songs[index];
  state.index = index;

  audio.pause();
  audio.src = song.url;
  audio.load();

  $("currentTime").textContent = "0:00";
  $("duration").textContent = "0:00";
  seek.value = 0;
  updateTrackInfo();

  if (autoplay) {
    startPlayback();
  } else {
    playBtn.textContent = "▶";
    statusEl.textContent = "LOADED";
    statusEl.classList.remove("playing");
    disc.classList.remove("spinning");
  }
}

async function ensureAudioGraph() {
  if (!state.audioContext) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Browser ini belum mendukung audio processing.");
    }

    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaElementSource(audio);
    const frequencies = [60, 230, 910, 3600, 14000];
    const filters = frequencies.map((frequency, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = ["lowshelf", "peaking", "peaking", "peaking", "highshelf"][index];
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(analyser);
    analyser.connect(audioContext.destination);

    state.audioContext = audioContext;
    state.source = source;
    state.filters = filters;
    state.analyser = analyser;
    state.connected = true;
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

async function startPlayback() {
  if (!selectedSong()) {
    notify("Tambahkan lagu terlebih dahulu.");
    fileInput.click();
    return;
  }

  try {
    await ensureAudioGraph();
    await audio.play();
  } catch (error) {
    console.error(error);
    notify(error.message || "Tidak dapat memutar file ini.");
  }
}

function togglePlayback() {
  if (!selectedSong()) {
    fileInput.click();
    return;
  }

  if (audio.paused) startPlayback();
  else audio.pause();
}

function nextTrack() {
  if (!state.songs.length) return;

  let next = state.index + 1;
  if (state.shuffle && state.songs.length > 1) {
    do {
      next = Math.floor(Math.random() * state.songs.length);
    } while (next === state.index);
  }

  loadSong(next, true);
}

function previousTrack() {
  if (!state.songs.length) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  loadSong(state.index - 1, true);
}

function removeSong(index) {
  const song = state.songs[index];
  if (!song) return;

  const wasCurrent = index === state.index;

  if (wasCurrent) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  URL.revokeObjectURL(song.url);
  state.objectUrls.delete(song.url);
  state.favorites.delete(song.id);
  state.songs.splice(index, 1);

  if (!state.songs.length) {
    state.index = -1;
    playBtn.textContent = "▶";
    statusEl.textContent = "STANDBY";
    disc.classList.remove("spinning");
  } else if (wasCurrent) {
    state.index = Math.min(index, state.songs.length - 1);
    loadSong(state.index, false);
  } else if (index < state.index) {
    state.index--;
  }

  updateTrackInfo();
  notify("Lagu dihapus dari playlist.");
}

function createEqualizerBars() {
  eqVisual.replaceChildren();
  for (let i = 0; i < 31; i++) {
    const bar = document.createElement("span");
    bar.style.height = "4px";
    eqVisual.append(bar);
  }
}

const presets = {
  flat:  [0, 0, 0, 0, 0],
  bass:  [7, 4, 0, -1, 1],
  club:  [6, 2, -2, 3, 5],
  vocal: [-2, -1, 4, 3, -2]
};

function setPreset(name) {
  const values = presets[name] || presets.flat;

  document.querySelectorAll("[data-eq]").forEach((input, i) => {
    input.value = values[i];
    if (state.filters[i]) {
      state.filters[i].gain.value = values[i];
    }
  });

  document.querySelectorAll(".preset").forEach(button => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
}

document.querySelectorAll("[data-eq]").forEach(input => {
  input.addEventListener("input", () => {
    const index = Number(input.dataset.eq);
    if (state.filters[index]) {
      state.filters[index].gain.value = Number(input.value);
    }

    document.querySelectorAll(".preset").forEach(button => {
      button.classList.remove("active");
    });
  });
});

document.querySelectorAll(".preset").forEach(button => {
  button.addEventListener("click", () => setPreset(button.dataset.preset));
});

$("resetEq").addEventListener("click", () => setPreset("flat"));

playBtn.addEventListener("click", togglePlayback);
$("prevBtn").addEventListener("click", previousTrack);
$("nextBtn").addEventListener("click", nextTrack);

$("shuffleBtn").addEventListener("click", () => {
  state.shuffle = !state.shuffle;
  updateMode();
  notify(state.shuffle ? "Shuffle aktif." : "Shuffle nonaktif.");
});

$("repeatBtn").addEventListener("click", () => {
  state.repeat = !state.repeat;
  audio.loop = state.repeat;
  updateMode();
  notify(state.repeat ? "Repeat aktif." : "Repeat nonaktif.");
});

$("favoriteBtn").addEventListener("click", () => {
  const song = selectedSong();
  if (!song) return;

  if (state.favorites.has(song.id)) {
    state.favorites.delete(song.id);
  } else {
    state.favorites.add(song.id);
  }
  updateTrackInfo();
});

$("addBtn").addEventListener("click", () => fileInput.click());
$("addTop").addEventListener("click", () => fileInput.click());
$("browseBtn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", event => {
  addFiles(event.target.files);
  event.target.value = "";
});

const dropZone = $("dropZone");

["dragenter", "dragover"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", event => {
  addFiles(event.dataTransfer.files);
});

audio.addEventListener("loadedmetadata", () => {
  const song = selectedSong();
  if (song) song.duration = audio.duration || 0;
  $("duration").textContent = formatTime(audio.duration);
  renderPlaylist();
});

audio.addEventListener("timeupdate", () => {
  $("currentTime").textContent = formatTime(audio.currentTime);
  $("duration").textContent = formatTime(audio.duration);

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.value = String((audio.currentTime / audio.duration) * 1000);
  }
});

seek.addEventListener("input", () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  }
});

$("volume").addEventListener("input", event => {
  audio.volume = Number(event.target.value);
  $("volumeValue").textContent = `${Math.round(audio.volume * 100)}%`;
});

audio.addEventListener("play", () => {
  playBtn.textContent = "Ⅱ";
  playBtn.setAttribute("aria-label", "Jeda");
  statusEl.textContent = "PLAYING";
  statusEl.classList.add("playing");
  disc.classList.add("spinning");
  state.played++;
  $("statPlayed").textContent = String(state.played).padStart(2, "0");
  renderPlaylist();
});

audio.addEventListener("pause", () => {
  playBtn.textContent = "▶";
  playBtn.setAttribute("aria-label", "Putar");
  statusEl.textContent = "PAUSED";
  statusEl.classList.remove("playing");
  disc.classList.remove("spinning");
  renderPlaylist();
});

audio.addEventListener("ended", () => {
  if (state.repeat) return;
  if (state.index < state.songs.length - 1 || state.shuffle) nextTrack();
  else {
    playBtn.textContent = "▶";
    statusEl.textContent = "FINISHED";
    disc.classList.remove("spinning");
  }
});

audio.addEventListener("error", () => {
  if (selectedSong()) notify("File tidak dapat diputar atau format tidak didukung.");
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawVisualizer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) {
    requestAnimationFrame(drawVisualizer);
    return;
  }

  ctx.clearRect(0, 0, width, height);

  const count = 42;
  let values;

  if (state.analyser) {
    values = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(values);
  }

  const gap = 3;
  const barWidth = Math.max(2, (width * 0.88) / count - gap);
  const totalWidth = count * (barWidth + gap);
  const startX = (width - totalWidth) / 2;
  const centerY = height / 2;
  const time = performance.now() / 550;

  for (let i = 0; i < count; i++) {
    const bin = values ? values[Math.floor(i * values.length / count)] / 255 : 0;
    const idle = 0.07 + (Math.sin(time + i * 0.55) + 1) * 0.035;
    const amplitude = Math.max(idle, bin * 0.85);
    const barHeight = Math.max(3, amplitude * height * 0.68);
    const x = startX + i * (barWidth + gap);

    ctx.fillStyle = i % 3 === 0 ? "#ffffff" : "#777777";
    ctx.globalAlpha = 0.45 + amplitude * 0.55;
    ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(drawVisualizer);
}

function animateEq() {
  const bars = eqVisual.children;
  const data = state.analyser
    ? new Uint8Array(state.analyser.frequencyBinCount)
    : null;

  if (data) state.analyser.getByteFrequencyData(data);

  for (let i = 0; i < bars.length; i++) {
    const value = data
      ? data[Math.floor(i * data.length / bars.length)] / 255
      : (Math.sin(performance.now() / 330 + i * .7) + 1) * .10;

    const height = Math.max(4, 6 + value * 52);
    bars[i].style.height = `${height}px`;
    bars[i].style.opacity = String(.45 + value * .55);
  }

  requestAnimationFrame(animateEq);
}

createEqualizerBars();
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
drawVisualizer();
animateEq();
updateMode();
updateTrackInfo();
setPreset("flat");

window.addEventListener("pagehide", () => {
  audio.pause();
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls.clear();
});
                      
