const $ = (id) => document.getElementById(id);
const TARGET_DEFAULT = 12;
const PPFD_ESTIMATE_FACTOR = 0.0185;
const MOL_PER_LUX = 0.145;
const DLI_HISTORY_KEY = "hydrolight_dli_history";
const DLI_STATE_KEY = "hydrolight_dli_state";
const MQTT_TOPIC_PREFIX = "hydrolight/device/";

let target = Number(localStorage.getItem("hydrolight_target") || TARGET_DEFAULT);
let dli = null;
let dliDay = dayKey();
let lastAccumulateAt = 0;
let gotDliFromMqtt = false;
let gotLuxFromMqtt = false;
let latestPpfd = null;
let mqttClient = null;
let lastMqttMessageAt = 0;
let deviceOnline = null;
let deviceLastSeenAt = 0;
let drawTimer = null;
const luxSamples = [];

function dayKey(date = new Date()) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // storage unavailable, keep values in memory only
  }
}

function readDliHistory() {
  const history = readJson(DLI_HISTORY_KEY, {});
  return history && typeof history === "object" ? history : {};
}

function fmt(value, digits = 1) {
  return Number(value).toLocaleString("id-ID", {
    maximumFractionDigits: digits,
  });
}

function fmtFixed(value, digits = 2) {
  return Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function showToast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}

function bind(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

function updateClock() {
  document.querySelectorAll(".clock").forEach((el) => {
    const now = new Date();
    el.textContent =
      now.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) +
      " · " +
      now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  });
}

function loadDliToday() {
  dliDay = dayKey();
  const history = readDliHistory();
  const value = history[dliDay];
  dli = typeof value === "number" ? value : null;
  const state = readJson(DLI_STATE_KEY, null);
  if (state && state.day === dliDay && typeof state.at === "number") {
    lastAccumulateAt = state.at;
  } else {
    lastAccumulateAt = 0;
  }
}

function saveDli() {
  if (dli === null) return;
  const today = dayKey();
  if (today !== dliDay) {
    dliDay = today;
    dli = 0;
    lastAccumulateAt = Date.now();
  }
  const history = readDliHistory();
  history[dliDay] = dli;
  const keys = Object.keys(history).sort();
  while (keys.length > 60) {
    delete history[keys.shift()];
  }
  writeJson(DLI_HISTORY_KEY, history);
  writeJson(DLI_STATE_KEY, { day: dliDay, at: lastAccumulateAt });
}

function updateProgress() {
  const fills = document.querySelectorAll(".progress-fill");
  setText("dliTarget", "Target " + fmt(target) + " mol");
  setText("targetValue", fmt(target) + " mol");
  if (dli === null || !Number.isFinite(dli)) {
    fills.forEach((fill) => (fill.style.width = "0%"));
    setText("progressPercent", "—");
    setText("progressBadge", "—");
    setText("dliCurrent", "—");
    setText("dliVal", "—");
    setText("dliTrend", "—");
    return;
  }
  const percent =
    target > 0 ? Math.min(100, Math.round((dli / target) * 100)) : 0;
  fills.forEach((fill) => (fill.style.width = percent + "%"));
  setText("progressPercent", percent + "%");
  setText("progressBadge", percent >= 100 ? "Tercapai" : "Berjalan");
  setText("dliCurrent", fmtFixed(dli, 2) + " mol");
  setText("dliVal", fmtFixed(dli, 2));
  setText("dliTrend", percent + "%");
}

function accumulateDli(ppfd) {
  if (gotDliFromMqtt || !Number.isFinite(ppfd)) return;
  const today = dayKey();
  if (today !== dliDay) {
    dliDay = today;
    dli = null;
    lastAccumulateAt = 0;
  }
  const now = Date.now();
  if (!lastAccumulateAt) {
    lastAccumulateAt = now;
    saveDli();
    updateProgress();
    return;
  }
  const dt = (now - lastAccumulateAt) / 1000;
  if (dt < 1) return;
  lastAccumulateAt = now;
  if (dt > 30) {
    saveDli();
    return;
  }
  dli = (dli === null ? 0 : dli) + (ppfd * dt) / 1e6;
  saveDli();
  updateProgress();
  renderHistoryRows();
  scheduleDraw();
}

function updateLuxReading(lux) {
  const luxText = Math.round(lux).toLocaleString("id-ID");
  setText("luxVal", luxText);
  setText("cardLuxVal", luxText);
  latestPpfd = lux * PPFD_ESTIMATE_FACTOR;
  const now = Date.now();
  const last = luxSamples[luxSamples.length - 1];
  if (!last || now - last.t >= 1000) {
    luxSamples.push({ t: now, v: lux });
    if (luxSamples.length > 90) luxSamples.shift();
  } else {
    last.v = lux;
  }
  accumulateDli(latestPpfd);
  scheduleDraw();
}

function setLux(value) {
  gotLuxFromMqtt = true;
  updateLuxReading(value);
}

function setMol(value) {
  const mol = Number(value).toFixed(2);
  setText("molVal", mol);
  setText("cardMolVal", mol);
  if (!gotLuxFromMqtt) updateLuxReading(value / MOL_PER_LUX);
}

function setDli(value) {
  gotDliFromMqtt = true;
  dli = value;
  dliDay = dayKey();
  saveDli();
  updateProgress();
  renderHistoryRows();
  scheduleDraw();
}

function setLed(value) {
  const on = /^(1|true|on|nyala|menyala)$/i.test(value.toString().trim());
  document.querySelectorAll("[data-led]").forEach((el) => {
    el.textContent = on ? "Menyala" : "Mati";
  });
  const dot = $("ledDot");
  if (dot) dot.className = "status-dot " + (on ? "ok" : "waiting");
}

function setDataNote(text) {
  setText("dataNote", text);
}

function setMqttStatus(state, text) {
  document.querySelectorAll(".device-card").forEach((card) => {
    const info = card.querySelector(".device-connection");
    if (info) {
      info.innerHTML =
        '<span class="dot"></span>' +
        (state === "online"
          ? "Terhubung ke broker"
          : state === "waiting"
            ? "Menghubungkan broker"
            : "Broker offline");
    }
  });
  const dot = $("mqttDot");
  if (dot) {
    dot.className =
      "status-dot " +
      (state === "online" ? "ok" : state === "waiting" ? "waiting" : "off");
  }
  setDataNote(
    state === "online"
      ? "Terhubung"
      : state === "waiting"
        ? "Menghubungkan broker"
        : text,
  );
}

function setIotStatus(state) {
  deviceOnline = state === "online";
  const label =
    state === "online"
      ? "IoT Terhubung"
      : state === "offline"
        ? "IoT Terputus"
        : "Menunggu IoT";
  const short =
    state === "online"
      ? "Online"
      : state === "offline"
        ? "Offline"
        : "Menunggu";
  document.querySelectorAll(".device-status").forEach((el) => {
    el.textContent = short;
    el.dataset.state = state;
  });
  const pill = $("iotStatus");
  if (pill) {
    pill.dataset.state = state;
    const text = pill.querySelector(".connection-text");
    if (text) text.textContent = label;
  }
  const stateText = $("iotState");
  if (stateText) stateText.textContent = label;
  const dot = $("iotDot");
  if (dot) {
    dot.className =
      "status-dot " +
      (state === "online" ? "ok" : state === "waiting" ? "waiting" : "off");
  }
}

function markDeviceActivity() {
  deviceLastSeenAt = Date.now();
  if (deviceOnline !== true) setIotStatus("online");
}

function getMqttUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("mqtt");
  let stored = null;
  try {
    stored = localStorage.getItem("hydrolight_mqtt_url");
  } catch (error) {
    stored = null;
  }
  if (fromQuery) {
    try {
      localStorage.setItem("hydrolight_mqtt_url", fromQuery);
    } catch (error) {
      stored = fromQuery;
    }
    return fromQuery;
  }
  if (stored) return stored;
  if (
    window.location.protocol === "http:" ||
    window.location.protocol === "https:"
  ) {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return scheme + "://" + window.location.hostname + ":9001";
  }
  return "ws://localhost:9001";
}

function toNumber(payload) {
  const value = Number(payload.toString().trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function handleMqttMessage(topic, payload) {
  const value = payload.toString().trim();
  const key = topic.startsWith(MQTT_TOPIC_PREFIX)
    ? topic.slice(MQTT_TOPIC_PREFIX.length)
    : topic;
  lastMqttMessageAt = Date.now();
  if (key === "status") {
    const online = /^online$/i.test(value);
    deviceLastSeenAt = Date.now();
    setIotStatus(online ? "online" : "offline");
    return;
  }
  markDeviceActivity();
  if (key === "lux") {
    const luxValue = toNumber(value);
    if (luxValue !== null) setLux(luxValue);
  } else if (key === "mol") {
    const molValue = toNumber(value);
    if (molValue !== null) setMol(molValue);
  } else if (key === "dli") {
    const dliValue = toNumber(value);
    if (dliValue !== null) setDli(dliValue);
  } else if (key === "led") {
    setLed(value);
  }
}

function connectMqtt() {
  if (typeof mqtt === "undefined") {
    setMqttStatus("offline", "MQTT gagal");
    setIotStatus("offline");
    return;
  }
  const url = getMqttUrl();
  setMqttStatus("waiting", "Menghubungkan");
  setIotStatus("waiting");
  mqttClient = mqtt.connect(url, {
    clientId: "hydrolight-web-" + Math.random().toString(16).slice(2, 10),
    reconnectPeriod: 3000,
    connectTimeout: 5000,
    clean: true,
  });
  mqttClient.on("connect", () => {
    setMqttStatus("online", "Online");
    setDataNote("Menunggu data sensor");
    if (deviceOnline !== true) setIotStatus("waiting");
    mqttClient.subscribe(MQTT_TOPIC_PREFIX + "#", { qos: 0 });
  });
  mqttClient.on("reconnect", () => {
    setMqttStatus("waiting", "Menghubungkan");
    setIotStatus("waiting");
  });
  mqttClient.on("close", () => {
    setMqttStatus("offline", "Offline");
    setIotStatus("offline");
  });
  mqttClient.on("offline", () => {
    setMqttStatus("offline", "Offline");
    setIotStatus("offline");
  });
  mqttClient.on("error", (error) => {
    console.warn("MQTT error:", error && error.message ? error.message : error);
    setMqttStatus("offline", "MQTT error");
    setIotStatus("offline");
  });
  mqttClient.on("message", handleMqttMessage);
  window.hydrolightMqtt = mqttClient;
  window.hydrolightMqttUrl = url;
}

function setupCanvas(id) {
  const canvas = $(id);
  if (!canvas || !canvas.offsetParent) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

function drawLuxChart(id) {
  const o = setupCanvas(id);
  if (!o) return;
  const { ctx: x, w, h } = o;
  x.clearRect(0, 0, w, h);
  const L = 46;
  const R = 12;
  const T = 14;
  const B = 28;
  const pw = w - L - R;
  const ph = h - T - B;
  const maxSample = luxSamples.length
    ? Math.max(...luxSamples.map((s) => s.v))
    : 0;
  const maxY = Math.max(1000, Math.ceil(maxSample / 1000) * 1000);
  x.font = "10px Inter, system-ui, sans-serif";
  x.strokeStyle = "#e9efe6";
  x.fillStyle = "#7b8a80";
  x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    x.beginPath();
    x.moveTo(L, y);
    x.lineTo(w - R, y);
    x.stroke();
    x.fillText(Math.round(maxY * (1 - i / 4)).toLocaleString("id-ID"), 4, y + 3);
  }
  if (!luxSamples.length) {
    x.fillStyle = "#a9b4ac";
    x.font = "12px Inter, system-ui, sans-serif";
    x.textAlign = "center";
    x.fillText("—", w / 2, T + ph / 2);
    x.textAlign = "left";
    return;
  }
  const n = luxSamples.length;
  const labelCount = Math.min(5, n);
  x.textAlign = "center";
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i * (n - 1)) / Math.max(1, labelCount - 1));
    const xx = n === 1 ? L + pw / 2 : L + (pw * idx) / (n - 1);
    x.fillStyle = "#7b8a80";
    x.fillText(
      new Date(luxSamples[idx].t).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      xx,
      h - 8,
    );
  }
  x.textAlign = "left";
  const pointX = (i) => (n === 1 ? L + pw / 2 : L + (pw * i) / (n - 1));
  const pointY = (v) => T + ph * (1 - v / maxY);
  x.beginPath();
  luxSamples.forEach((s, i) => {
    const xx = pointX(i);
    const yy = pointY(s.v);
    if (i) x.lineTo(xx, yy);
    else x.moveTo(xx, yy);
  });
  x.save();
  x.lineTo(L + pw, T + ph);
  x.lineTo(L, T + ph);
  x.closePath();
  const gradient = x.createLinearGradient(0, T, 0, T + ph);
  gradient.addColorStop(0, "rgba(36,122,82,0.26)");
  gradient.addColorStop(1, "rgba(36,122,82,0)");
  x.fillStyle = gradient;
  x.fill();
  x.restore();
  x.beginPath();
  luxSamples.forEach((s, i) => {
    const xx = pointX(i);
    const yy = pointY(s.v);
    if (i) x.lineTo(xx, yy);
    else x.moveTo(xx, yy);
  });
  x.strokeStyle = "#247a52";
  x.lineWidth = 2.4;
  x.lineJoin = "round";
  x.lineCap = "round";
  x.stroke();
  const last = luxSamples[n - 1];
  x.beginPath();
  x.arc(pointX(n - 1), pointY(last.v), 3.5, 0, Math.PI * 2);
  x.fillStyle = "#247a52";
  x.fill();
  x.strokeStyle = "#ffffff";
  x.lineWidth = 2;
  x.stroke();
}

function getLastDays(count) {
  const history = readDliHistory();
  const days = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(base);
    date.setDate(base.getDate() - i);
    const key = dayKey(date);
    const value = history[key];
    days.push({
      key,
      label: date.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
      }),
      value: typeof value === "number" ? value : null,
    });
  }
  return days;
}

function drawDliChart(id) {
  const o = setupCanvas(id);
  if (!o) return;
  const { ctx: x, w, h } = o;
  x.clearRect(0, 0, w, h);
  const days = getLastDays(7);
  const values = days
    .map((d) => d.value)
    .filter((v) => typeof v === "number");
  const maxValue = values.length ? Math.max(...values) : 0;
  const max = Math.max(target * 1.25, maxValue * 1.2, 1);
  const L = 40;
  const R = 12;
  const T = 16;
  const B = 28;
  const pw = w - L - R;
  const ph = h - T - B;
  x.font = "10px Inter, system-ui, sans-serif";
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    x.strokeStyle = "#e9efe6";
    x.beginPath();
    x.moveTo(L, y);
    x.lineTo(w - R, y);
    x.stroke();
    x.fillStyle = "#7b8a80";
    x.fillText(fmt(max * (1 - i / 4), 1), 4, y + 3);
  }
  const goalY = T + ph * (1 - target / max);
  x.strokeStyle = "#d7a13b";
  x.setLineDash([5, 4]);
  x.beginPath();
  x.moveTo(L, goalY);
  x.lineTo(w - R, goalY);
  x.stroke();
  x.setLineDash([]);
  const slot = pw / days.length;
  const barWidth = Math.min(30, slot * 0.5);
  days.forEach((day, i) => {
    const center = L + slot * i + slot / 2;
    const label = day.label;
    x.fillStyle = "#7b8a80";
    x.textAlign = "center";
    x.fillText(label, center, h - 8);
    if (typeof day.value !== "number") {
      x.fillStyle = "#c8d2ca";
      x.fillText("—", center, T + ph - 6);
      return;
    }
    const barHeight = Math.max(2, (ph * day.value) / max);
    const barTop = T + ph - barHeight;
    x.fillStyle = i === days.length - 1 ? "#b5ef45" : "#247a52";
    x.beginPath();
    x.roundRect(center - barWidth / 2, barTop, barWidth, barHeight, 7);
    x.fill();
    x.fillStyle = "#46564d";
    x.fillText(fmt(day.value, 1), center, Math.max(10, barTop - 6));
  });
  x.textAlign = "left";
}

function drawAll() {
  drawLuxChart("luxChart");
  drawLuxChart("monitorChart");
  drawDliChart("weekChart");
  drawDliChart("historyChart");
}

function scheduleDraw() {
  if (drawTimer) return;
  drawTimer = setTimeout(() => {
    drawTimer = null;
    drawAll();
  }, 400);
}

function renderHistoryRows() {
  const body = $("historyRows");
  if (!body) return;
  const rows = getLastDays(7).reverse();
  const hasData = rows.some(
    (row) => typeof row.value === "number" && row.value > 0,
  );
  if (!hasData) {
    body.innerHTML = '<tr><td colspan="5" class="empty-row">—</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((row) => {
      if (typeof row.value !== "number") {
        return `<tr><td>${row.label}</td><td>—</td><td>${fmt(target)}</td><td>—</td><td><span class="pill muted">—</span></td></tr>`;
      }
      const diff = row.value - target;
      const ok = Math.abs(diff) <= target * 0.1;
      const status = ok
        ? "Sesuai target"
        : diff > 0
          ? "Kelebihan"
          : "Kekurangan";
      return `<tr><td>${row.label}</td><td><strong>${fmtFixed(row.value, 2)}</strong></td><td>${fmt(target)}</td><td>${diff > 0 ? "+" : ""}${fmtFixed(diff, 2)}</td><td><span class="pill ${ok ? "" : "warn"}">${status}</span></td></tr>`;
    })
    .join("");
}

bind("saveTarget", "click", () => {
  const input = $("targetInput");
  const value = Number(input && input.value);
  if (!value || value < 1 || value > 40) {
    return showToast("Masukkan target antara 1–40 mol.");
  }
  target = value;
  localStorage.setItem("hydrolight_target", String(target));
  updateProgress();
  renderHistoryRows();
  drawAll();
  showToast("Target DLI diperbarui.");
});

const targetInput = $("targetInput");
if (targetInput) targetInput.value = target;

document.querySelectorAll(".refresh-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    drawAll();
    showToast("Tampilan diperbarui.");
  }),
);

function downloadCsv() {
  const rows = [
    ["Tanggal", "DLI", "Target", "Selisih", "Status"],
    ...getLastDays(7)
      .reverse()
      .map((row) => {
        if (typeof row.value !== "number") {
          return [row.label, "", target, "", ""];
        }
        const diff = row.value - target;
        const status =
          Math.abs(diff) <= target * 0.1
            ? "Sesuai target"
            : diff > 0
              ? "Kelebihan"
              : "Kekurangan";
        return [
          row.label,
          row.value.toFixed(2),
          target,
          diff.toFixed(2),
          status,
        ];
      }),
  ];
  const csv = rows.map((row) => row.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "riwayat-dli-hydrolight.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("File CSV disiapkan.");
}

bind("exportCsv", "click", downloadCsv);
bind("exportOverviewCsv", "click", downloadCsv);

updateClock();
setInterval(updateClock, 1000);
loadDliToday();
updateProgress();
renderHistoryRows();
drawAll();
window.addEventListener("resize", () => setTimeout(drawAll, 100));

connectMqtt();

setInterval(() => {
  if (!mqttClient || !mqttClient.connected) return;
  const now = Date.now();
  if (!lastMqttMessageAt || now - lastMqttMessageAt > 30000) {
    setDataNote("Menunggu data sensor");
    if (deviceOnline === true && now - deviceLastSeenAt > 30000) {
      setIotStatus("offline");
    }
  }
}, 10000);
