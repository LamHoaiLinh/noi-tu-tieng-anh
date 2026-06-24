(() => {
  "use strict";

  const AVATARS = ["😀", "😎", "🤓", "🦊", "🐼", "🐯", "🐸", "🦁", "🐵", "🐧", "🦄", "🚀", "🌟", "🔥", "🍀", "🎯"];
  const REACTIONS = ["❤️", "😂", "🔥", "👏", "💡"];
  const STORAGE_KEYS = {
    apiUrl: "ewc_api_url",
    playerId: "ewc_player_id",
    nick: "ewc_nick",
    avatar: "ewc_avatar",
    theme: "ewc_theme",
    sound: "ewc_sound"
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    apiUrl: "",
    roomCode: "",
    playerId: localStorage.getItem(STORAGE_KEYS.playerId) || randomId("P"),
    nickname: localStorage.getItem(STORAGE_KEYS.nick) || "",
    avatar: localStorage.getItem(STORAGE_KEYS.avatar) || AVATARS[0],
    room: null,
    players: [],
    usedWords: [],
    chat: [],
    reactions: [],
    pollTimer: null,
    lobbyPollTimer: null,
    lastVersion: 0,
    turnOverlayVisible: false,
    lastReactionSeen: new Set(),
    soundOn: localStorage.getItem(STORAGE_KEYS.sound) !== "off",
    lastEventKey: "",
    countdownInterval: null,
    pendingRequest: false
  };

  function init() {
    initConfig();
    initTheme();
    fillAvatarSelects();
    wireEvents();
    buildReactions();
    hydrateLobbyFromUrl();
    $("soundToggle").textContent = state.soundOn ? "🔊" : "🔇";
    if (!state.apiUrl) openConfigModal("Bạn cần dán URL Apps Script Web App trước khi chơi.");
    startLobbyRoomPolling();
  }

  function initConfig() {
    const embedded = (window.EWC_CONFIG && window.EWC_CONFIG.API_URL || "").trim();
    const saved = localStorage.getItem(STORAGE_KEYS.apiUrl) || "";
    state.apiUrl = saved || (embedded && !embedded.includes("PASTE_APPS_SCRIPT") ? embedded : "");
    $("scriptUrlInput").value = state.apiUrl;
  }

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme) || "light";
    document.documentElement.dataset.theme = saved;
    $("themeToggle").textContent = saved === "dark" ? "☀️" : "🌙";
  }

  function fillAvatarSelects() {
    [$("hostAvatar"), $("joinAvatar")].forEach((select) => {
      select.innerHTML = AVATARS.map(a => `<option value="${a}">${a}</option>`).join("");
      select.value = state.avatar;
    });
    $("hostNick").value = state.nickname;
    $("joinNick").value = state.nickname;
  }

  function hydrateLobbyFromUrl() {
    const params = new URLSearchParams(location.search);
    const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (room) $("joinRoomCode").value = room;
  }

  function wireEvents() {
    $("configBtn").addEventListener("click", () => openConfigModal());
    $("closeConfigBtn").addEventListener("click", closeConfigModal);
    $("saveConfigBtn").addEventListener("click", saveConfig);
    $("themeToggle").addEventListener("click", toggleTheme);
    $("soundToggle").addEventListener("click", toggleSound);
    $("topicSelect").addEventListener("change", () => $("customTopicWrap").classList.toggle("hidden", $("topicSelect").value !== "Custom"));
    $("infiniteMode").addEventListener("change", () => $("totalRounds").disabled = $("infiniteMode").checked);
    $("createForm").addEventListener("submit", onCreateRoom);
    $("joinForm").addEventListener("submit", onJoinRoom);
    $("refreshRoomsBtn").addEventListener("click", () => loadOpenRooms(false));
    $("leaveBtn").addEventListener("click", leaveRoom);
    $("copyLinkBtn").addEventListener("click", copyInviteLink);
    $("startGameBtn").addEventListener("click", startGame);
    $("wordForm").addEventListener("submit", submitWord);
    $("overlayWordForm").addEventListener("submit", submitOverlayWord);
    $("passTurnBtn").addEventListener("click", passTurn);
    $("overlayPassBtn").addEventListener("click", passTurn);
    $("chatForm").addEventListener("submit", sendChat);
    $("clearChatViewBtn").addEventListener("click", () => { $("chatList").innerHTML = ""; toast("Đã xóa phần hiển thị chat trên máy bạn."); });
    document.querySelectorAll(".team-btn").forEach(btn => btn.addEventListener("click", () => setTeam(btn.dataset.team)));
    window.addEventListener("beforeunload", () => {
      if (state.roomCode && state.playerId && navigator.sendBeacon && state.apiUrl) {
        const payload = JSON.stringify({ action: "heartbeat", roomCode: state.roomCode, playerId: state.playerId });
        try { navigator.sendBeacon(state.apiUrl, payload); } catch (_) {}
      }
    });
  }

  function buildReactions() {
    $("reactionBar").innerHTML = REACTIONS.map(e => `<button class="reaction-btn" type="button" data-emoji="${e}" title="Thả ${e}">${e}</button>`).join("");
    $("reactionBar").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => sendReaction(btn.dataset.emoji)));
  }

  function startLobbyRoomPolling() {
    stopLobbyRoomPolling();
    const run = async () => {
      if (!state.roomCode && state.apiUrl) await loadOpenRooms(true);
      const min = 4500;
      const max = 6500;
      state.lobbyPollTimer = setTimeout(run, Math.floor(min + Math.random() * (max - min)));
    };
    run();
  }

  function stopLobbyRoomPolling() {
    if (state.lobbyPollTimer) clearTimeout(state.lobbyPollTimer);
    state.lobbyPollTimer = null;
  }

  async function loadOpenRooms(silent = true) {
    const box = $("openRoomsList");
    if (!state.apiUrl) {
      box.innerHTML = `<div class="empty-rooms">Cần cấu hình Apps Script trước để tải danh sách phòng.</div>`;
      return;
    }
    try {
      const res = await api("listRooms", {}, { silent: true, noPending: true });
      renderOpenRooms(res.rooms || []);
    } catch (err) {
      if (!silent) toast("Chưa tải được danh sách phòng. Kiểm tra Apps Script URL.", "error");
      box.innerHTML = `<div class="empty-rooms">Chưa tải được danh sách phòng.</div>`;
    }
  }

  function renderOpenRooms(rooms) {
    const box = $("openRoomsList");
    if (!rooms.length) {
      box.innerHTML = `<div class="empty-rooms">Chưa có phòng nào đang mở. Anh có thể tạo phòng mới bên dưới.</div>`;
      return;
    }
    box.innerHTML = rooms.map(r => {
      const canJoin = r.status === "lobby" && Number(r.activeHumans || 0) < Number(r.maxPlayers || 12);
      const statusText = r.status === "lobby" ? "Đang chờ" : "Đang chơi";
      const ruleText = r.chainRule === "first-letter" ? "nối chữ đầu" : "nối chữ cuối";
      return `<button class="room-card-mini ${canJoin ? "" : "disabled"}" type="button" data-room="${escapeAttr(r.roomCode)}" ${canJoin ? "" : "disabled"}>
        <div class="room-card-top"><strong>${escapeHtml(r.roomName || "Phòng nối từ")}</strong><span>${r.passwordProtected ? "🔒" : "🔓"}</span></div>
        <div class="room-card-code">${escapeHtml(r.roomCode)} · ${escapeHtml(statusText)}</div>
        <div class="room-card-meta">${Number(r.activeHumans || 0)}/${Number(r.maxPlayers || 12)} người · ${Number(r.botCount || 0)} bot · ${escapeHtml(r.mode === "team" ? "Team Battle" : "Đấu cá nhân")}</div>
        <div class="room-card-meta">${escapeHtml(r.topic || "All")} · ${escapeHtml(ruleText)} · ${Number(r.turnSeconds || 30)} giây/lượt</div>
      </button>`;
    }).join("");
    box.querySelectorAll("button[data-room]").forEach(btn => btn.addEventListener("click", () => selectRoomFromList(btn.dataset.room)));
  }

  function selectRoomFromList(roomCode) {
    $("joinRoomCode").value = sanitizeRoom(roomCode);
    $("joinNick").focus();
    toast(`Đã chọn phòng ${sanitizeRoom(roomCode)}. Nhập nickname rồi bấm Join.`, "success");
  }

  async function onCreateRoom(event) {
    event.preventDefault();
    if (!ensureApi()) return;
    const nickname = sanitizeName($("hostNick").value);
    const avatar = $("hostAvatar").value || AVATARS[0];
    saveIdentity(nickname, avatar);
    const topic = $("topicSelect").value === "Custom" ? sanitizeTopic($("customTopic").value || "Custom") : $("topicSelect").value;
    const payload = {
      roomName: sanitizeTopic($("roomName").value || `${nickname} - Nối từ`),
      roomPassword: $("roomPassword").value.trim(),
      playerId: state.playerId,
      nickname,
      avatar,
      maxPlayers: clampNumber($("maxPlayers").value, 2, 12, 8),
      botCount: clampNumber($("botCount").value, 0, 3, 0),
      turnSeconds: clampNumber($("turnSeconds").value, 15, 60, 30),
      roundMode: $("infiniteMode").checked ? "infinite" : "finite",
      totalRounds: clampNumber($("totalRounds").value, 1, 99, 10),
      topic,
      chainRule: $("chainRule").value,
      mode: $("gameMode").value
    };
    const res = await api("createRoom", payload);
    enterRoom(res.roomCode, res.state);
    toast(`Đã tạo phòng ${res.roomCode}.`, "success");
    playTone("success");
  }

  async function onJoinRoom(event) {
    event.preventDefault();
    if (!ensureApi()) return;
    const roomCode = sanitizeRoom($("joinRoomCode").value);
    const nickname = sanitizeName($("joinNick").value);
    const avatar = $("joinAvatar").value || AVATARS[0];
    saveIdentity(nickname, avatar);
    const res = await api("joinRoom", { roomCode, playerId: state.playerId, nickname, avatar, roomPassword: $("joinRoomPassword").value.trim() });
    enterRoom(roomCode, res.state);
    toast(`Đã vào phòng ${roomCode}.`, "success");
    playTone("turn");
  }

  function saveIdentity(nickname, avatar) {
    state.nickname = nickname;
    state.avatar = avatar;
    localStorage.setItem(STORAGE_KEYS.playerId, state.playerId);
    localStorage.setItem(STORAGE_KEYS.nick, nickname);
    localStorage.setItem(STORAGE_KEYS.avatar, avatar);
  }

  function enterRoom(roomCode, snapshot) {
    stopLobbyRoomPolling();
    state.roomCode = roomCode;
    $("lobbyScreen").classList.add("hidden");
    $("roomScreen").classList.remove("hidden");
    $("roomCodeText").textContent = roomCode;
    updateUrlRoom(roomCode);
    renderState(snapshot);
    startPolling();
  }

  function updateUrlRoom(roomCode) {
    if (location.protocol === "file:") return;
    const url = new URL(location.href);
    url.searchParams.set("room", roomCode);
    history.replaceState({}, "", url.toString());
  }

  function startPolling() {
    stopPolling();
    const poll = async () => {
      if (!state.roomCode || state.pendingRequest) return;
      try {
        const res = await api("getState", { roomCode: state.roomCode, playerId: state.playerId, version: state.lastVersion }, { silent: true });
        if (res && res.state) renderState(res.state);
      } catch (err) {
        console.warn(err);
      } finally {
        const min = window.EWC_CONFIG?.POLL_MIN_MS || 1100;
        const max = window.EWC_CONFIG?.POLL_MAX_MS || 1600;
        state.pollTimer = setTimeout(poll, Math.floor(min + Math.random() * (max - min)));
      }
    };
    poll();
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  async function startGame() {
    const res = await api("startGame", { roomCode: state.roomCode, playerId: state.playerId });
    renderState(res.state);
    toast("Trận đấu đã bắt đầu.", "success");
    playTone("turn");
  }

  async function setTeam(team) {
    const res = await api("setTeam", { roomCode: state.roomCode, playerId: state.playerId, team });
    renderState(res.state);
    toast(`Bạn đã chọn đội ${team}.`, "success");
  }

  async function submitWord(event) {
    event.preventDefault();
    await submitWordFromInput($("wordInput"));
  }

  async function submitOverlayWord(event) {
    event.preventDefault();
    await submitWordFromInput($("overlayWordInput"));
  }

  async function submitWordFromInput(input) {
    const word = input.value.trim().toLowerCase();
    if (!word) return;
    setWordControlsDisabled(true);
    try {
      const res = await api("submitWord", { roomCode: state.roomCode, playerId: state.playerId, word });
      renderState(res.state);
      $("wordInput").value = "";
      $("overlayWordInput").value = "";
      if (res.accepted) {
        toast(`Đúng: ${word} (+${res.scoreDelta} điểm).`, "success");
        playTone("success");
      } else {
        toast(res.message || "Từ không hợp lệ, mất lượt.", "error");
        playTone("error");
      }
    } finally {
      setWordControlsDisabled(false);
      if (isMyTurn()) input.focus();
    }
  }

  async function passTurn() {
    if (!isMyTurn()) {
      toast("Chưa đến lượt bạn hoặc đội của bạn.", "error");
      return;
    }
    setWordControlsDisabled(true);
    try {
      const res = await api("passTurn", { roomCode: state.roomCode, playerId: state.playerId });
      renderState(res.state);
      $("wordInput").value = "";
      $("overlayWordInput").value = "";
      toast(res.message || "Đã bỏ qua lượt.", "error");
      playTone("error");
    } finally {
      setWordControlsDisabled(false);
    }
  }

  function setWordControlsDisabled(disabled) {
    ["wordInput", "overlayWordInput", "submitWordBtn", "overlaySubmitBtn", "passTurnBtn", "overlayPassBtn"].forEach(id => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
    if ($("submitWordBtn")) $("submitWordBtn").textContent = disabled ? "Đang gửi..." : "Submit";
    if ($("overlaySubmitBtn")) $("overlaySubmitBtn").textContent = disabled ? "Đang gửi..." : "Nộp từ";
  }

  async function sendChat(event) {
    event.preventDefault();
    const input = $("chatInput");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    const res = await api("sendChat", { roomCode: state.roomCode, playerId: state.playerId, message }, { silent: true });
    renderState(res.state);
  }

  async function sendReaction(emoji) {
    const res = await api("react", { roomCode: state.roomCode, playerId: state.playerId, emoji }, { silent: true });
    renderState(res.state);
    spawnReaction(emoji);
  }

  async function leaveRoom() {
    try {
      if (state.roomCode) await api("leaveRoom", { roomCode: state.roomCode, playerId: state.playerId }, { silent: true });
    } catch (_) {}
    stopPolling();
    stopCountdown();
    state.roomCode = "";
    state.room = null;
    $("roomScreen").classList.add("hidden");
    $("lobbyScreen").classList.remove("hidden");
    startLobbyRoomPolling();
    if (location.protocol !== "file:") {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState({}, "", url.toString());
    }
    toast("Bạn đã thoát khỏi phòng.");
  }

  function renderState(snapshot) {
    if (!snapshot) return;
    state.room = snapshot.room;
    state.players = snapshot.players || [];
    state.usedWords = snapshot.usedWords || [];
    state.chat = snapshot.chat || [];
    state.reactions = snapshot.reactions || [];
    state.lastVersion = Number(snapshot.room?.version || state.lastVersion || 0);

    renderHeader();
    renderPreGame();
    renderTurn();
    renderTurnOverlay();
    renderChain();
    renderPlayers();
    renderChat();
    renderReactions();
    reactToEvents();
  }

  function renderHeader() {
    const room = state.room;
    $("roomCodeText").textContent = room.roomCode || state.roomCode;
    const activeHumans = state.players.filter(p => p.type !== "bot" && p.status === "active").length;
    const activeAll = state.players.filter(p => p.status === "active").length;
    $("playersCountText").textContent = `${activeHumans}/${room.maxPlayers} người · ${activeAll} lượt chơi`;
    $("roomModeBadge").textContent = room.mode === "team" ? "Team Battle" : "Đấu cá nhân";
  }

  function renderPreGame() {
    const room = state.room;
    const me = getMe();
    const isLobby = room.status === "lobby";
    $("preGamePanel").classList.toggle("hidden", !isLobby);
    $("startGameBtn").classList.toggle("hidden", !(isLobby && room.hostId === state.playerId));
    $("teamChooser").classList.toggle("hidden", !(isLobby && room.mode === "team"));
    if (room.mode === "team") {
      document.querySelectorAll(".team-btn").forEach(btn => btn.classList.toggle("active", me && me.team === btn.dataset.team));
      $("preGameHint").textContent = room.hostId === state.playerId ? "Bạn là chủ phòng. Người chơi có thể đổi đội trước khi bắt đầu." : "Bạn có thể chọn hoặc đổi đội trước khi chủ phòng bắt đầu.";
    } else {
      $("preGameHint").textContent = room.hostId === state.playerId ? "Bạn là chủ phòng. Bấm bắt đầu khi mọi người đã sẵn sàng." : "Chờ chủ phòng bắt đầu.";
    }
  }

  function renderTurn() {
    const room = state.room;
    const isPlaying = room.status === "playing";
    const me = getMe();
    const current = state.players.find(p => p.playerId === room.currentTurnPlayerId);
    const currentText = room.mode === "team"
      ? `Đội ${room.currentTeam || "-"}`
      : current ? `${current.avatar} ${current.nickname}` : "Chưa có";
    $("turnOwnerText").textContent = isPlaying ? currentText : (room.status === "ended" ? "Trận đấu đã kết thúc" : "Đang ở phòng chờ");
    $("lastWordText").textContent = room.currentWord || "---";
    $("chainRuleText").textContent = room.chainRule === "first-letter" ? "Nối bằng chữ cái đầu của từ trước" : "Nối bằng chữ cái cuối của từ trước";
    $("roundText").textContent = room.roundMode === "infinite" ? `Vòng ${room.currentRound || 0} · Vô hạn` : `Vòng ${room.currentRound || 0}/${room.totalRounds}`;

    const canPlay = isMyTurn();
    $("wordInput").disabled = !canPlay;
    $("submitWordBtn").disabled = !canPlay;
    $("wordInput").placeholder = canPlay ? "Đến lượt bạn, nhập từ..." : "Chưa đến lượt bạn...";
    $("turnMessage").textContent = getTurnMessage(canPlay);
    startCountdown();
  }

  function requiredLetter() {
    const room = state.room;
    const currentWord = room?.currentWord || "";
    if (!currentWord) return "";
    return room.chainRule === "first-letter" ? currentWord[0] : currentWord[currentWord.length - 1];
  }

  function getTurnMessage(canPlay) {
    const room = state.room;
    if (room.status === "lobby") return "Trò chơi sẽ bắt đầu khi chủ phòng bấm Bắt đầu.";
    if (room.status === "ended") return room.lastEvent || "Trận đấu đã kết thúc.";
    const currentWord = room.currentWord || "";
    if (!currentWord) return "Đang chọn từ khởi đầu...";
    const required = room.chainRule === "first-letter" ? currentWord[0] : currentWord[currentWord.length - 1];
    if (canPlay) return `Bạn cần nhập từ tiếng Anh bắt đầu bằng chữ “${required.toUpperCase()}”.`;
    if (room.mode === "team") return `Chờ đội ${room.currentTeam || "-"} nhập từ bắt đầu bằng chữ “${required.toUpperCase()}”.`;
    return `Chờ người chơi hiện tại nhập từ bắt đầu bằng chữ “${required.toUpperCase()}”.`;
  }

  function renderTurnOverlay() {
    const overlay = $("turnOverlay");
    const room = state.room;
    const myTurn = isMyTurn();
    if (!room || room.status !== "playing" || !myTurn) {
      overlay.classList.add("hidden");
      state.turnOverlayVisible = false;
      return;
    }
    const me = getMe();
    const current = room.currentWord || "---";
    const required = requiredLetter();
    $("overlayCurrentWord").textContent = current;
    $("overlayTurnTitle").textContent = room.mode === "team" ? `Đội ${me.team} đến lượt` : "Đến lượt bạn";
    $("overlayRuleText").textContent = required ? `Nhập từ tiếng Anh bắt đầu bằng chữ “${required.toUpperCase()}”.` : "Nhập từ tiếng Anh tiếp theo.";
    const wasHidden = overlay.classList.contains("hidden");
    overlay.classList.remove("hidden");
    if (wasHidden || !state.turnOverlayVisible) {
      playTone("turn");
      setTimeout(() => $("overlayWordInput").focus(), 80);
    }
    state.turnOverlayVisible = true;
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    state.countdownInterval = setInterval(updateCountdown, 250);
  }

  function stopCountdown() {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;
  }

  function updateCountdown() {
    const room = state.room;
    if (!room || room.status !== "playing") {
      $("timerNumber").textContent = "--";
      $("timerBar").style.width = "0%";
      if ($("overlayTimerNumber")) $("overlayTimerNumber").textContent = "--";
      if ($("overlayTimerBar")) $("overlayTimerBar").style.width = "0%";
      return;
    }
    const started = new Date(room.turnStartedAt).getTime();
    const turnMs = Number(room.turnSeconds || 30) * 1000;
    const elapsed = Date.now() - started;
    const left = Math.max(0, Math.ceil((turnMs - elapsed) / 1000));
    const pct = Math.max(0, Math.min(100, ((turnMs - elapsed) / turnMs) * 100));
    $("timerNumber").textContent = String(left);
    $("timerBar").style.width = `${pct}%`;
    if ($("overlayTimerNumber")) $("overlayTimerNumber").textContent = String(left);
    if ($("overlayTimerBar")) $("overlayTimerBar").style.width = `${pct}%`;
  }

  function renderChain() {
    const box = $("chainWords");
    const words = state.usedWords.filter(w => String(w.valid) === "true" || w.valid === true);
    if (!words.length && state.room.currentWord) {
      box.innerHTML = `<div class="chain-word"><span class="word-text">${escapeHtml(state.room.currentWord)}</span></div>`;
      return;
    }
    box.innerHTML = words.map((w, idx) => `
      <div class="chain-word" title="${escapeAttr(w.nickname || "Hệ thống")}">
        ${idx > 0 ? `<span class="arrow">→</span>` : ""}
        <span class="word-text">${escapeHtml(w.word)}</span>
      </div>
    `).join("");
    box.scrollLeft = box.scrollWidth;
  }

  function renderPlayers() {
    const room = state.room;
    const sorted = [...state.players].sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(a.orderIndex || 0) - Number(b.orderIndex || 0));
    $("playersList").innerHTML = sorted.map(p => {
      const current = room.mode === "team" ? (p.team === room.currentTeam && room.status === "playing") : p.playerId === room.currentTurnPlayerId;
      const badges = [p.type === "bot" ? "Bot" : "Người chơi", room.mode === "team" ? `Đội ${p.team || "-"}` : "", p.status !== "active" ? p.status : ""].filter(Boolean).join(" · ");
      return `<div class="player-row ${current ? "current" : ""}">
        <div class="avatar">${escapeHtml(p.avatar || "🙂")}</div>
        <div class="player-main">
          <div class="player-name">${escapeHtml(p.nickname || "Người chơi")}</div>
          <div class="player-sub">${escapeHtml(badges)} · ${Number(p.validCount || 0)} từ đúng · ${Number(p.penalty || 0)} phạt</div>
        </div>
        <div class="score-pill">${Number(p.score || 0)}</div>
      </div>`;
    }).join("");

    const teamBox = $("teamScoreBox");
    if (room.mode === "team") {
      const a = state.players.filter(p => p.team === "A").reduce((sum, p) => sum + Number(p.score || 0), 0);
      const b = state.players.filter(p => p.team === "B").reduce((sum, p) => sum + Number(p.score || 0), 0);
      teamBox.classList.remove("hidden");
      teamBox.innerHTML = `<div class="team-score">Đội A<strong>${a}</strong></div><div class="team-score">Đội B<strong>${b}</strong></div>`;
    } else {
      teamBox.classList.add("hidden");
    }
  }

  function renderChat() {
    const list = $("chatList");
    list.innerHTML = state.chat.slice(-60).map(c => {
      const system = c.playerId === "SYSTEM";
      return `<div class="chat-item ${system ? "system-chat" : ""}">
        <div class="chat-meta">${system ? "⚙️ Hệ thống" : `${escapeHtml(c.avatar || "🙂")} ${escapeHtml(c.nickname || "")}`}</div>
        <div>${escapeHtml(c.message || "")}</div>
      </div>`;
    }).join("");
    list.scrollTop = list.scrollHeight;
  }

  function renderReactions() {
    state.reactions.slice(-20).forEach(r => {
      const key = r.reactionId || `${r.playerId}-${r.createdAt}-${r.emoji}`;
      if (!state.lastReactionSeen.has(key)) {
        state.lastReactionSeen.add(key);
        spawnReaction(r.emoji || "👏");
      }
    });
  }

  function reactToEvents() {
    const eventKey = `${state.room.version}-${state.room.lastEvent || ""}`;
    if (eventKey === state.lastEventKey) return;
    state.lastEventKey = eventKey;
    if (!state.room.lastEvent) return;
    const msg = state.room.lastEvent.toLowerCase();
    if (msg.includes("đúng")) playTone("success");
    else if (msg.includes("sai") || msg.includes("hết giờ") || msg.includes("không hợp lệ")) playTone("error");
    else if (msg.includes("lượt")) playTone("turn");
  }

  function isMyTurn() {
    const room = state.room;
    const me = getMe();
    if (!room || !me || room.status !== "playing" || me.status !== "active") return false;
    if (room.mode === "team") return me.team && me.team === room.currentTeam;
    return room.currentTurnPlayerId === state.playerId;
  }

  function getMe() { return state.players.find(p => p.playerId === state.playerId); }

  async function api(action, payload = {}, opts = {}) {
    if (!ensureApi(opts.silent)) throw new Error("Missing API URL");
    if (!opts.noPending) state.pendingRequest = true;
    try {
      const res = await fetch(state.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, ...payload })
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error("Server không trả JSON hợp lệ. Kiểm tra URL deploy Apps Script."); }
      if (!data.ok) throw new Error(data.error || "Có lỗi không xác định.");
      return data;
    } catch (err) {
      if (!opts.silent) toast(err.message || String(err), "error", 5200);
      throw err;
    } finally {
      if (!opts.noPending) state.pendingRequest = false;
    }
  }

  function ensureApi(silent = false) {
    if (state.apiUrl) return true;
    if (!silent) openConfigModal("Bạn cần dán URL Apps Script Web App trước khi chơi.");
    return false;
  }

  function openConfigModal(message) {
    if (message) toast(message, "error", 4200);
    $("configModal").classList.remove("hidden");
    $("scriptUrlInput").focus();
  }
  function closeConfigModal() { $("configModal").classList.add("hidden"); }
  function saveConfig() {
    const url = $("scriptUrlInput").value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
      toast("URL chưa đúng định dạng Web App /exec của Google Apps Script.", "error");
      return;
    }
    state.apiUrl = url;
    localStorage.setItem(STORAGE_KEYS.apiUrl, url);
    closeConfigModal();
    toast("Đã lưu URL Apps Script.", "success");
    loadOpenRooms(false);
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEYS.theme, next);
    $("themeToggle").textContent = next === "dark" ? "☀️" : "🌙";
  }
  function toggleSound() {
    state.soundOn = !state.soundOn;
    localStorage.setItem(STORAGE_KEYS.sound, state.soundOn ? "on" : "off");
    $("soundToggle").textContent = state.soundOn ? "🔊" : "🔇";
    if (state.soundOn) playTone("turn");
  }

  async function copyInviteLink() {
    const base = location.href.split("?")[0];
    const link = `${base}?room=${encodeURIComponent(state.roomCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Đã copy link mời.", "success");
    } catch (_) {
      toast(`Link mời: ${link}`);
    }
  }

  function playTone(type) {
    if (!state.soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const map = { success: [720, 920], error: [220, 160], turn: [460, 620] };
      const [f1, f2] = map[type] || map.turn;
      osc.type = "sine";
      osc.frequency.setValueAtTime(f1, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), now + .12);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.08, now + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + .24);
    } catch (_) {}
  }

  function spawnReaction(emoji) {
    const host = $("floatingHost");
    const el = document.createElement("div");
    el.className = "float-reaction";
    el.textContent = emoji;
    el.style.left = `${12 + Math.random() * 76}%`;
    el.style.bottom = `${10 + Math.random() * 28}%`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  function toast(message, type = "info", duration = 3200) {
    const host = $("toastHost");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function sanitizeRoom(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
  function sanitizeName(value) { return String(value || "").trim().replace(/[<>]/g, "").slice(0, 24) || `Player${Math.floor(Math.random() * 999)}`; }
  function sanitizeTopic(value) { return String(value || "All").trim().replace(/[<>]/g, "").slice(0, 40) || "All"; }
  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }
  function randomId(prefix = "ID") { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[s]));
  }
  function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }

  init();
})();
