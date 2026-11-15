const $ = (id) => document.getElementById(id);
const targetDefault = 12;
let target = Number(localStorage.getItem("hydrolight_target") || targetDefault);
let dli = 6.2;
const historyData = [
  { d: "09 Nov", v: 12.4 },
  { d: "10 Nov", v: 11.1 },
  { d: "11 Nov", v: 12.0 },
  { d: "12 Nov", v: 13.6 },
  { d: "13 Nov", v: 10.2 },
  { d: "14 Nov", v: 12.3 },
  { d: "15 Nov", v: 11.8 },
];

function showToast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}
function fmt(value) {
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 });
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
updateClock();
setInterval(updateClock, 1000);

function updateProgress() {
  const percent = Math.min(100, Math.round((dli / target) * 100));
  const gap = Math.max(0, target - dli);
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  set("progressPercent", percent + "%");
  const fill = $("progressFill");
  if (fill) fill.style.width = percent + "%";
  set("dliCurrent", fmt(dli) + " mol");
  set("dliTarget", "Target " + fmt(target) + " mol");
  set("dliVal", fmt(dli));
  set("dliTrend", percent + "% dari target harian");
  set(
    "progressNote",
    gap > 0
      ? "Masih diperlukan sekitar " +
          fmt(gap) +
          " mol m⁻² untuk mencapai target harian."
      : "Target DLI harian telah tercapai.",
  );
  set("progressBadge", percent >= 100 ? "Tercapai" : "Berjalan");
  set(
    "alertText",
    gap > 0
      ? "Lampu LED menyala otomatis saat cahaya kurang."
      : "Target DLI hari ini telah tercapai.",
  );
}
function bind(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

bind("saveTarget", "click", () => {
  const input = $("targetInput");
  const value = Number(input && input.value);
  if (!value || value < 1 || value > 40)
    return showToast("Masukkan target antara 1–40 mol.");
  target = value;
  localStorage.setItem("hydrolight_target", String(target));
  updateProgress();
  renderHistoryRows();
  drawAll();
  showToast("Target DLI diperbarui menjadi " + fmt(target) + " mol.");
});
const targetInput = $("targetInput");
if (targetInput) targetInput.value = target;

document.querySelectorAll(".refresh-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    drawAll();
    showToast("Tampilan diperbarui · data demo");
  }),
);

function setupCanvas(id) {
  const canvas = $(id);
  if (!canvas || !canvas.offsetParent) return null;
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}
function lineChart(id, series, labels, maxY) {
  const o = setupCanvas(id);
  if (!o) return;
  const { ctx: x, w, h } = o;
  x.clearRect(0, 0, w, h);
  const L = 38,
    R = 10,
    T = 12,
    B = 27,
    pw = w - L - R,
    ph = h - T - B;
  x.font = "10px system-ui";
  x.fillStyle = "#879287";
  x.strokeStyle = "#e9eee7";
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    x.beginPath();
    x.moveTo(L, y);
    x.lineTo(w - R, y);
    x.stroke();
    x.fillText(Math.round(maxY * (1 - i / 4)), 4, y + 3);
  }
  labels.forEach((label, i) => {
    const xx = L + (pw * i) / (labels.length - 1);
    if (i % 2 === 0 || labels.length < 8) x.fillText(label, xx - 12, h - 7);
  });
  series.forEach((s) => {
    x.beginPath();
    s.data.forEach((v, i) => {
      const xx = L + (pw * i) / (s.data.length - 1),
        yy = T + ph * (1 - v / maxY);
      i ? x.lineTo(xx, yy) : x.moveTo(xx, yy);
    });
    x.strokeStyle = s.color;
    x.lineWidth = 2.5;
    x.setLineDash(s.dash ? [5, 5] : []);
    x.stroke();
    x.setLineDash([]);
  });
}
function barChart(id, data, goal) {
  const o = setupCanvas(id);
  if (!o) return;
  const { ctx: x, w, h } = o;
  x.clearRect(0, 0, w, h);
  const L = 34,
    R = 10,
    T = 12,
    B = 28,
    pw = w - L - R,
    ph = h - T - B,
    max = Math.max(16, goal * 1.25);
  x.font = "10px system-ui";
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph * i) / 4;
    x.strokeStyle = "#e9eee7";
    x.beginPath();
    x.moveTo(L, y);
    x.lineTo(w - R, y);
    x.stroke();
    x.fillStyle = "#879287";
    x.fillText(Math.round(max * (1 - i / 4)), 5, y + 3);
  }
  const gy = T + ph * (1 - goal / max);
  x.strokeStyle = "#d99a39";
  x.setLineDash([5, 4]);
  x.beginPath();
  x.moveTo(L, gy);
  x.lineTo(w - R, gy);
  x.stroke();
  x.setLineDash([]);
  const slot = pw / data.length,
    bw = Math.min(32, slot * 0.55);
  data.forEach((d, i) => {
    const xx = L + slot * i + slot / 2 - bw / 2,
      yy = T + ph * (1 - d.v / max),
      hh = (ph * d.v) / max;
    x.fillStyle =
      Math.abs(d.v - goal) <= goal * 0.1
        ? "#4b9a69"
        : d.v > goal
          ? "#d99a39"
          : "#d96b61";
    x.beginPath();
    x.roundRect(xx, yy, bw, hh, 5);
    x.fill();
    x.fillStyle = "#657267";
    x.textAlign = "center";
    x.fillText(d.v.toFixed(1).replace(".", ","), xx + bw / 2, yy - 5);
    x.fillText(d.d, xx + bw / 2, h - 8);
  });
  x.textAlign = "left";
}
function renderHistoryRows() {
  const body = $("historyRows");
  if (!body) return;
  body.innerHTML = historyData
    .slice()
    .reverse()
    .map((d) => {
      const diff = d.v - target,
        ok = Math.abs(diff) <= target * 0.1;
      const status = ok
        ? "Sesuai target"
        : diff > 0
          ? "Kelebihan"
          : "Kekurangan";
      return `<tr><td>${d.d}</td><td><strong>${d.v.toFixed(1).replace(".", ",")}</strong></td><td>${fmt(target)}</td><td>${diff > 0 ? "+" : ""}${diff.toFixed(1).replace(".", ",")}</td><td><span class="pill ${ok ? "" : "warn"}">${status}</span></td></tr>`;
    })
    .join("");
}
function drawAll() {
  const labels = ["06", "08", "10", "12", "14", "16", "18", "20", "22"];
  const actual = [18, 35, 78, 145, 170, 158, 120, 75, 25];
  const setpoint = [22, 48, 90, 155, 180, 175, 145, 95, 35];
  lineChart(
    "ppfdChart",
    [
      { data: actual, color: "#378c5a" },
      { data: setpoint, color: "#dfa13e", dash: true },
    ],
    labels,
    220,
  );
  lineChart(
    "ppfdChart2",
    [
      { data: actual, color: "#378c5a" },
      { data: setpoint, color: "#dfa13e", dash: true },
    ],
    labels,
    220,
  );
  barChart("weekChart", historyData, target);
  barChart("historyChart", historyData, target);
}
bind("exportCsv", "click", () => {
  const rows = [
    ["Tanggal", "DLI tercapai", "Target", "Selisih", "Status"],
    ...historyData.map((d) => [
      d.d,
      d.v,
      target,
      (d.v - target).toFixed(1),
      Math.abs(d.v - target) <= target * 0.1
        ? "Sesuai target"
        : d.v > target
          ? "Kelebihan"
          : "Kekurangan",
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "riwayat-dli-hydrolight-demo.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("File CSV berhasil disiapkan.");
});
updateProgress();
renderHistoryRows();
drawAll();
window.addEventListener("resize", () => setTimeout(drawAll, 100));
