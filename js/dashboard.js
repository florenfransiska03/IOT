(function () {
  "use strict";

  const THEME_KEY = "agl-theme";
  const MODE_KEY = "agl-mode";
  const PHASE_KEY = "agl-phase";
  const SCHEDULE_KEY = "agl-schedule";
  const DLI_DAILY_KEY = "agl-dli-daily";
  const DLI_DAYS = 7;
  const STALE_MS = 15000;
  const DLI_TARGET = 18.0;

  const TOPICS = {
    lux: "hydrolight/device/lux",
    mol: "hydrolight/device/mol",
    led: "hydrolight/device/led",
    suhu: "hydrolight/device/suhu",
    kelembapan: "hydrolight/device/kelembapan",
    status: "hydrolight/device/status",
    command: "hydrolight/device/command",
  };

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const cssVar = (name) =>
    getComputedStyle(root).getPropertyValue(name).trim();

  function withAlpha(color, alpha) {
    const value = String(color).trim();
    const hex = value.replace("#", "");
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) {
      return `rgba(52, 185, 129, ${alpha})`;
    }
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function storageGet(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* storage unavailable */
    }
  }

  function loadDailyDli() {
    try {
      const parsed = JSON.parse(storageGet(DLI_DAILY_KEY, "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function recordDailyDli() {
    if (telemetry.dli === null) return;
    const day = todayISO();
    const previous = Number(dailyDli[day]) || 0;
    dailyDli[day] = Math.max(previous, telemetry.dli);

    const now = Date.now();
    if (now - lastDliPersistTs >= 10000) {
      lastDliPersistTs = now;
      storageSet(DLI_DAILY_KEY, JSON.stringify(dailyDli));
    }
  }

  const pad = (n) => String(n).padStart(2, "0");

  const HOURS = Array.from({ length: 24 }, (_, i) => `${pad(i)}:00`);

  const SAMPLE_KEEP_MS = 24 * 60 * 60 * 1000;
  const SAMPLE_MIN_INTERVAL_MS = 15000;

  const INTERVAL_OPTIONS = {
    30: { windowBuckets: 48 },
    60: { windowBuckets: 24 },
  };

  const samples = [];
  let chartInterval = 30;
  let chartRange = "all";
  let lastSampleTs = 0;

  const telemetry = {
    lux: null,
    mol: null,
    led: null,
    suhu: null,
    kelembapan: null,
    dli: null,
    lastSeen: 0,
  };

  const history = {};
  const dailyDli = loadDailyDli();
  let lastDliPersistTs = 0;
  let dliTotal = Number(dailyDli[todayISO()]) || 0;
  if (dliTotal > 0) telemetry.dli = dliTotal;
  let lastMol = null;
  let lastMolTs = null;
  let deviceStatus = null;
  let mqttConnected = false;
  let mqttEverConnected = false;
  let mqttError = false;
  let mqttClient = null;

  function num(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return value.toLocaleString("id-ID", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function isoToDisplay(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function showToast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  /* ---------- Theme ---------- */

  let chart = null;
  let dliChart = null;
  let dliDonut = null;

  function resizeCharts() {
    requestAnimationFrame(() => {
      if (chart) chart.resize();
      if (dliChart) dliChart.resize();
      if (dliDonut) dliDonut.resize();
    });
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* storage unavailable */
    }
    document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeBtn === theme);
    });
    updateChartTheme();
  }

  function initTheme() {
    const current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(current);
    document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(btn.dataset.themeBtn));
    });
  }

  /* ---------- Chart ---------- */

  function chartThemeColors() {
    return {
      grid: cssVar("--chart-grid"),
      tick: cssVar("--chart-tick"),
      surface: cssVar("--surface"),
      ppfd: cssVar("--ppfd"),
      dli: cssVar("--dli-line"),
      suhu: cssVar("--suhu"),
    };
  }

  function updateChartTheme() {
    const colors = chartThemeColors();

    if (chart) {
      const [ppfd, suhu] = chart.data.datasets;

      ppfd.borderColor = colors.ppfd;
      ppfd.pointBackgroundColor = colors.ppfd;
      ppfd.pointBorderColor = colors.surface;

      suhu.borderColor = colors.suhu;
      suhu.pointBackgroundColor = colors.suhu;
      suhu.pointBorderColor = colors.surface;

      chart.options.scales.x.ticks.color = colors.tick;
      chart.options.scales.y.grid.color = colors.grid;
      chart.options.scales.y.ticks.color = colors.tick;
      chart.options.scales.y1.ticks.color = colors.tick;
      chart.update("none");
    }

    if (dliChart) {
      const bar = dliChart.data.datasets[0];
      bar.backgroundColor = withAlpha(colors.dli, 0.6);
      bar.hoverBackgroundColor = withAlpha(colors.dli, 0.85);
      bar.borderColor = colors.dli;

      dliChart.options.scales.x.ticks.color = colors.tick;
      dliChart.options.scales.y.grid.color = colors.grid;
      dliChart.update("none");
    }

    if (dliDonut) {
      const ring = dliDonut.data.datasets[0];
      ring.backgroundColor = [colors.dli, withAlpha(colors.dli, 0.14)];
      dliDonut.update("none");
    }
  }

  function chartSeries() {
    const ppfd = new Array(HOURS.length).fill(null);
    const dli = new Array(HOURS.length).fill(null);
    const suhu = new Array(HOURS.length).fill(null);

    Object.keys(history).forEach((key) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= HOURS.length) return;
      const entry = history[key];
      ppfd[index] = entry.mol;
      dli[index] = entry.dli;
      suhu[index] = entry.suhu;
    });

    return { ppfd, dli, suhu };
  }

  function aggregateSeries(intervalMinutes) {
    if (intervalMinutes >= 60) {
      const base = chartSeries();
      return { labels: HOURS, ppfd: base.ppfd, suhu: base.suhu };
    }

    const cfg = INTERVAL_OPTIONS[intervalMinutes] || INTERVAL_OPTIONS[30];
    const bucketMs = intervalMinutes * 60 * 1000;
    const buckets = new Map();

    samples.forEach((sample) => {
      const key = Math.floor(sample.t / bucketMs) * bucketMs;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          suhu: { sum: 0, count: 0 },
          mol: { sum: 0, count: 0 },
        };
        buckets.set(key, bucket);
      }
      if (Number.isFinite(sample.suhu)) {
        bucket.suhu.sum += sample.suhu;
        bucket.suhu.count += 1;
      }
      if (Number.isFinite(sample.mol)) {
        bucket.mol.sum += sample.mol;
        bucket.mol.count += 1;
      }
    });

    const keys = Array.from(buckets.keys())
      .sort((a, b) => a - b)
      .slice(-cfg.windowBuckets);

    const labels = keys.map((key) => {
      const date = new Date(key);
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    });

    const pick = (key, field) => {
      const bucket = buckets.get(key);
      if (!bucket) return null;
      const stat = bucket[field];
      return stat.count ? stat.sum / stat.count : null;
    };

    return {
      labels,
      ppfd: keys.map((key) => pick(key, "mol")),
      suhu: keys.map((key) => pick(key, "suhu")),
    };
  }

  function updateChartData() {
    const data = aggregateSeries(chartInterval);
    const visible = chartRangeMap[chartRange] || chartRangeMap.all;
    const hasPpfd = data.ppfd.some((v) => v !== null);
    const hasSuhu = data.suhu.some((v) => v !== null);
    const hasData =
      (visible.includes("ppfd") && hasPpfd) ||
      (visible.includes("suhu") && hasSuhu);

    const empty = $("chartEmpty");
    if (empty) empty.hidden = hasData;
    if (chart) {
      chart.data.labels = data.labels;
      chart.data.datasets[0].data = data.ppfd;
      chart.data.datasets[1].data = data.suhu;
      chart.update("none");
    }

    updateDliChart();
  }

  function dliDailySeries() {
    const labels = [];
    const values = [];
    const now = new Date();

    for (let offset = DLI_DAYS - 1; offset >= 0; offset -= 1) {
      const date = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - offset,
      );
      const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const value = Number(dailyDli[iso]);
      labels.push(`${pad(date.getDate())}/${pad(date.getMonth() + 1)}`);
      values.push(Number.isFinite(value) ? value : null);
    }

    return { labels, values };
  }

  function updateDliChart() {
    const data = dliDailySeries();
    const hasData = data.values.some((v) => v !== null);

    const empty = $("dliChartEmpty");
    if (empty) empty.hidden = hasData;
    if (!dliChart) return;

    dliChart.data.labels = data.labels;
    dliChart.data.datasets[0].data = data.values;
    dliChart.update("none");
  }

  function buildChart() {
    const canvas = $("timeseries");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      const empty = $("chartEmpty");
      if (empty) empty.textContent = "Grafik tidak dapat dimuat (Chart.js offline).";
      return;
    }

    const colors = chartThemeColors();
    const data = aggregateSeries(chartInterval);

    chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "PPFD / Mol",
            data: data.ppfd,
            yAxisID: "y",
            borderColor: colors.ppfd,
            pointBackgroundColor: colors.ppfd,
            pointBorderColor: colors.surface,
            pointRadius: 3.4,
            pointHoverRadius: 6,
            pointBorderWidth: 2,
            borderWidth: 2.6,
            tension: 0.4,
            fill: true,
            backgroundColor: function (context) {
              const { ctx, chartArea } = context.chart;
              const line = chartThemeColors().ppfd;
              if (!chartArea) return withAlpha(line, 0.14);
              const gradient = ctx.createLinearGradient(
                0,
                chartArea.top,
                0,
                chartArea.bottom,
              );
              gradient.addColorStop(0, withAlpha(line, 0.34));
              gradient.addColorStop(0.55, withAlpha(line, 0.12));
              gradient.addColorStop(1, withAlpha(line, 0));
              return gradient;
            },
          },
          {
            label: "Suhu",
            data: data.suhu,
            yAxisID: "y1",
            borderColor: colors.suhu,
            pointBackgroundColor: colors.suhu,
            pointBorderColor: colors.surface,
            pointRadius: 2.8,
            pointHoverRadius: 5,
            pointBorderWidth: 2,
            borderWidth: 2.2,
            borderDash: [5, 5],
            tension: 0.4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c1a12",
            titleColor: "#eafbe0",
            bodyColor: "#c3ccc0",
            borderColor: "rgba(201, 245, 90, 0.25)",
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            boxPadding: 4,
            titleFont: { family: "Poppins", size: 12, weight: "600" },
            bodyFont: { family: "Poppins", size: 11, weight: "400" },
            callbacks: {
              label: function (context) {
                if (context.parsed.y === null) return null;
                const units = ["µmol/m²/s", "°C"];
                return ` ${context.dataset.label}: ${context.parsed.y} ${units[context.datasetIndex]}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            border: { display: false },
            ticks: {
              color: colors.tick,
              font: { family: "Poppins", size: 11, weight: "500" },
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 12,
              padding: 8,
            },
          },
          y: {
            position: "left",
            min: 0,
            max: 20,
            display: true,
            title: { display: false },
            grid: { color: colors.grid, drawBorder: false },
            border: { display: false },
            ticks: {
              display: true,
              stepSize: 2,
              color: colors.tick,
              font: { family: "Poppins", size: 10, weight: "500" },
              padding: 6,
            },
          },
          y1: {
            position: "right",
            min: 0,
            max: 40,
            display: true,
            title: { display: false },
            grid: { drawOnChartArea: false, drawBorder: false },
            border: { display: false },
            ticks: {
              display: true,
              stepSize: 5,
              color: colors.tick,
              font: { family: "Poppins", size: 10, weight: "500" },
              padding: 6,
            },
          },
        },
      },
    });

    initRangeTabs();
    initIntervalTabs();
    applyChartRange(chartRange, false);
    updateChartData();
  }

  function buildDliChart() {
    const canvas = $("dliChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      const empty = $("dliChartEmpty");
      if (empty) empty.textContent = "Grafik tidak dapat dimuat (Chart.js offline).";
      return;
    }

    const colors = chartThemeColors();
    const data = dliDailySeries();

    dliChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "DLI",
            data: data.values,
            backgroundColor: withAlpha(colors.dli, 0.6),
            hoverBackgroundColor: withAlpha(colors.dli, 0.85),
            borderColor: colors.dli,
            borderWidth: 1.4,
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 46,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c1a12",
            titleColor: "#eafbe0",
            bodyColor: "#c3ccc0",
            borderColor: "rgba(201, 245, 90, 0.25)",
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            boxPadding: 4,
            titleFont: { family: "Poppins", size: 12, weight: "600" },
            bodyFont: { family: "Poppins", size: 11, weight: "400" },
            callbacks: {
              label: function (context) {
                if (context.parsed.y === null) return null;
                return ` DLI: ${context.parsed.y.toFixed(2)} mol/m²/d`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            border: { display: false },
            ticks: {
              color: colors.tick,
              font: { family: "Poppins", size: 11, weight: "500" },
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 12,
              padding: 8,
            },
          },
          y: {
            position: "left",
            min: 0,
            suggestedMax: DLI_TARGET,
            title: { display: false },
            grid: { color: colors.grid, drawBorder: false },
            border: { display: false },
            ticks: {
              color: colors.tick,
              font: { family: "Poppins", size: 10, weight: "500" },
              maxRotation: 0,
              padding: 6,
            },
          },
        },
      },
    });

    updateDliChart();
  }

  /* ---------- DLI donut ---------- */

  function updateDliDonut() {
    if (!dliDonut) return;
    const value =
      telemetry.dli === null
        ? 0
        : Math.min(DLI_TARGET, Math.max(0, telemetry.dli));
    const remaining = Math.max(0, DLI_TARGET - value);
    dliDonut.data.datasets[0].data = [value, remaining];
    dliDonut.update("none");
  }

  function buildDliDonut() {
    const canvas = $("dliDonut");
    if (!canvas || typeof Chart === "undefined") return;

    const colors = chartThemeColors();

    dliDonut = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["Capaian", "Sisa"],
        datasets: [
          {
            data: [0, DLI_TARGET],
            backgroundColor: [colors.dli, withAlpha(colors.dli, 0.14)],
            borderWidth: 0,
            hoverOffset: 0,
            spacing: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "76%",
        rotation: -90,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });

    updateDliDonut();
  }

  /* ---------- Chart range filters ---------- */

  const chartRangeMap = {
    all: ["ppfd", "suhu"],
    mol: ["ppfd"],
    suhu: ["suhu"],
  };

  function applyChartRange(range, render) {
    const visible = chartRangeMap[range] || chartRangeMap.all;

    if (chart) {
      chart.data.datasets.forEach((dataset, index) => {
        const key = ["ppfd", "suhu"][index];
        dataset.hidden = !visible.includes(key);
      });

      const showPpfd = visible.includes("ppfd");
      const showSuhu = visible.includes("suhu");

      chart.options.scales.y.display = showPpfd;
      chart.options.scales.y1.display = showSuhu;
      chart.options.scales.y1.position = showPpfd ? "right" : "left";

      if (render !== false) chart.update();
    }

    document.querySelectorAll("[data-legend]").forEach((item) => {
      item.classList.toggle("is-dim", !visible.includes(item.dataset.legend));
    });
  }

  function initRangeTabs() {
    const tabs = $("chartTabs");
    if (!tabs) return;
    tabs.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-range]");
      if (!btn) return;
      chartRange = chartRangeMap[btn.dataset.range] ? btn.dataset.range : "all";

      tabs.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      applyChartRange(chartRange, false);
      updateChartData();
    });
  }

  /* ---------- Chart interval tabs ---------- */

  function initIntervalTabs() {
    const tabs = $("intervalTabs");
    if (!tabs) return;
    tabs.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-interval]");
      if (!btn) return;
      const next = Number(btn.dataset.interval);
      chartInterval = INTERVAL_OPTIONS[next] ? next : 30;
      tabs.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      updateChartData();
    });
  }

  /* ---------- Live telemetry rendering ---------- */

  function setLamp(led) {
    const el = $("lampState");
    if (el) {
      el.classList.toggle("on", led === true);
      el.classList.toggle("off", led === false);
      el.classList.toggle("idle", led === null || led === undefined);
      el.innerHTML =
        '<span class="lamp-dot"></span>' +
        (led === true ? "ON" : led === false ? "OFF" : "—");
    }

    const nodeLed = $("nodeLed");
    if (nodeLed) {
      nodeLed.textContent =
        led === true ? "LED ON" : led === false ? "LED OFF" : "LED —";
      nodeLed.classList.toggle("is-off", led === false);
    }

    const luxChip = $("luxChip");
    if (luxChip) {
      luxChip.textContent =
        led === true ? "ON" : led === false ? "OFF" : "—";
    }
  }

  function renderLive() {
    const suhuValue = $("suhuValue");
    const suhuChip = $("suhuChip");
    const humValue = $("humValue");
    const humChip = $("humChip");
    const luxValue = $("luxValue");
    const molValue = $("molValue");
    const parValue = $("parValue");
    const dliValue = $("dliValue");
    const dliChip = $("dliChip");
    const dliRemaining = $("dliRemaining");

    if (suhuValue) suhuValue.textContent = num(telemetry.suhu, 1);
    if (humValue) humValue.textContent = num(telemetry.kelembapan, 1);
    if (suhuChip) {
      suhuChip.textContent = telemetry.suhu === null ? "—" : "Live";
    }
    if (humChip) {
      humChip.textContent = telemetry.kelembapan === null ? "—" : "Live";
    }

    if (luxValue) luxValue.textContent = num(telemetry.lux, 0);
    if (molValue) molValue.textContent = num(telemetry.mol, 0);
    if (parValue) parValue.textContent = num(telemetry.mol, 0);

    if (dliValue) {
      dliValue.textContent = telemetry.dli === null ? "—" : telemetry.dli.toFixed(2);
    }

    const percent =
      telemetry.dli === null ? null : (telemetry.dli / DLI_TARGET) * 100;

    if (dliChip) {
      dliChip.textContent = percent === null ? "—" : `${Math.round(percent)}%`;
    }
    updateDliDonut();
    if (dliRemaining) {
      dliRemaining.textContent =
        telemetry.dli === null
          ? "Sisa kebutuhan: —"
          : `Sisa kebutuhan: ${Math.max(0, DLI_TARGET - telemetry.dli).toFixed(2)} mol/m²/d`;
    }

    setLamp(telemetry.led);
  }

  function connectionState() {
    const fresh =
      telemetry.lastSeen > 0 && Date.now() - telemetry.lastSeen < STALE_MS;
    if (!mqttConnected) {
      if (mqttEverConnected) return { key: "offline", label: "Terputus" };
      if (mqttError) return { key: "offline", label: "Gagal terhubung" };
      return { key: "waiting", label: "Menghubungkan…" };
    }
    if (fresh) return { key: "online", label: "Online" };
    if (deviceStatus === "offline") return { key: "offline", label: "Offline" };
    return { key: "waiting", label: "Menunggu data" };
  }

  function renderConnection() {
    const dot = $("nodeDot");
    const status = $("nodeStatus");
    if (!dot || !status) return;

    const state = connectionState();
    dot.classList.remove("is-online", "is-waiting", "is-offline");
    dot.classList.add(`is-${state.key}`);
    status.classList.remove("is-waiting", "is-offline");
    status.textContent = state.label;
    if (state.key === "waiting") status.classList.add("is-waiting");
    if (state.key === "offline") status.classList.add("is-offline");
  }

  /* ---------- History table ---------- */

  function renderHistory() {
    const body = $("historyRows");
    if (!body) return;

    body.innerHTML = HOURS.map((label, index) => {
      const entry = history[pad(index)];
      if (!entry) {
        return `<tr>
          <td class="time">${label}</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td class="dli">—</td>
          <td>—</td>
        </tr>`;
      }

      const suhuText = entry.suhu === null ? "—" : `${num(entry.suhu, 1)} °C`;
      const humText =
        entry.kelembapan === null || entry.kelembapan === undefined
          ? "—"
          : `${num(entry.kelembapan, 1)} %`;
      const luxText = entry.lux === null ? "—" : `${num(entry.lux, 0)} lx`;
      const molText = entry.mol === null ? "—" : `${num(entry.mol, 0)} µmol/m²/s`;
      const dliText = entry.dli === null ? "—" : `${entry.dli.toFixed(2)} mol/m²/d`;
      const status =
        entry.led === null
          ? "—"
          : entry.led
            ? '<span class="status-pill on">ON</span>'
            : '<span class="status-pill off">OFF</span>';

      return `<tr>
        <td class="time">${label}</td>
        <td>${suhuText}</td>
        <td>${humText}</td>
        <td>${luxText}</td>
        <td>${molText}</td>
        <td class="dli">${dliText}</td>
        <td>${status}</td>
      </tr>`;
    }).join("");
  }

  /* ---------- Date fields ---------- */

  function initDateFields() {
    const iso = todayISO();
    document.querySelectorAll(".date-field").forEach((field) => {
      const input = field.querySelector("[data-date-input]");
      const label = field.querySelector("[data-date-text]");
      if (!input || !label) return;

      input.value = iso;
      label.textContent = isoToDisplay(iso);

      input.addEventListener("change", () => {
        if (input.value) label.textContent = isoToDisplay(input.value);
      });
    });
  }

  /* ---------- Export CSV ---------- */

  function downloadCsv() {
    const rangeSelect = $("exportRange");
    const rangeLabel =
      rangeSelect && rangeSelect.selectedIndex >= 0
        ? rangeSelect.options[rangeSelect.selectedIndex].text
        : "Per Hari";
    const dateField = document.querySelector(".export-card [data-date-input]");
    const iso = (dateField && dateField.value) || todayISO();

    const header = [
      "Waktu",
      "Suhu (C)",
      "Kelembapan (%)",
      "Lux (lx)",
      "Mol / PPFD (umol/m2/s)",
      "Akumulasi DLI (mol/m2/d)",
      "Status Lampu",
      "Tanggal",
      "Rentang",
    ];

    const rows = HOURS.map((label, index) => {
      const entry = history[pad(index)];
      return [
        label,
        entry && entry.suhu !== null ? entry.suhu.toFixed(1) : "—",
        entry && entry.kelembapan !== null && entry.kelembapan !== undefined
          ? entry.kelembapan.toFixed(1)
          : "—",
        entry && entry.lux !== null ? entry.lux : "—",
        entry && entry.mol !== null ? entry.mol : "—",
        entry && entry.dli !== null ? entry.dli.toFixed(2) : "—",
        entry && entry.led !== null ? (entry.led ? "ON" : "OFF") : "—",
        isoToDisplay(iso),
        rangeLabel,
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `telemetry-${iso}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("File CSV berhasil disiapkan.");
  }

  /* ---------- Controls (mode & fase lokal) ---------- */

  function initControls() {
    const modeSwitch = $("modeSwitch");
    const phaseSwitch = $("phaseSwitch");
    const schedulePanel = $("schedulePanel");
    const scheduleStart = $("scheduleStart");
    const scheduleEnd = $("scheduleEnd");
    const scheduleStatus = $("scheduleStatus");
    const nodeMode = $("nodeMode");
    const PHASES = ["Seedling", "Vegetative", "Flowering"];

    const storedSchedule = (() => {
      try {
        return JSON.parse(storageGet(SCHEDULE_KEY, "null"));
      } catch (error) {
        return null;
      }
    })();

    if (
      scheduleStart &&
      storedSchedule &&
      /^\d{2}:\d{2}$/.test(storedSchedule.start || "")
    ) {
      scheduleStart.value = storedSchedule.start;
    }
    if (
      scheduleEnd &&
      storedSchedule &&
      /^\d{2}:\d{2}$/.test(storedSchedule.end || "")
    ) {
      scheduleEnd.value = storedSchedule.end;
    }

    const queryMode = (
      new URLSearchParams(location.search).get("mode") || ""
    ).toLowerCase();
    const storedMode = storageGet(MODE_KEY, "");
    let mode =
      queryMode === "jadwal" || (!queryMode && storedMode === "Jadwal")
        ? "Jadwal"
        : "Auto";
    let phase = PHASES.includes(storageGet(PHASE_KEY, ""))
      ? storageGet(PHASE_KEY, "")
      : "Vegetative";

    function refresh() {
      if (nodeMode) {
        nodeMode.textContent =
          mode === "Jadwal"
            ? `(Jadwal ${scheduleStart ? scheduleStart.value : "—"}–${scheduleEnd ? scheduleEnd.value : "—"})`
            : `(Auto ${phase})`;
      }

      if (scheduleStatus) {
        scheduleStatus.textContent = `${scheduleStart ? scheduleStart.value : "—"} – ${scheduleEnd ? scheduleEnd.value : "—"}`;
      }
    }

    function syncModeButtons() {
      if (!modeSwitch) return;
      modeSwitch.querySelectorAll("button[data-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
      });
    }

    function syncPhaseButtons() {
      if (!phaseSwitch) return;
      phaseSwitch.querySelectorAll("button[data-phase]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.phase === phase);
      });
    }

    function applyMode(next) {
      mode = next === "Jadwal" ? "Jadwal" : "Auto";
      const scheduleActive = mode === "Jadwal";
      syncModeButtons();

      if (schedulePanel) {
        schedulePanel.classList.toggle("is-disabled", !scheduleActive);
        schedulePanel.setAttribute("aria-disabled", String(!scheduleActive));
      }
      [scheduleStart, scheduleEnd].forEach((input) => {
        if (input) input.disabled = !scheduleActive;
      });

      storageSet(MODE_KEY, mode);
      refresh();
      resizeCharts();
    }

    function applyPhase(next) {
      phase = PHASES.includes(next) ? next : "Vegetative";
      syncPhaseButtons();
      storageSet(PHASE_KEY, phase);
      refresh();
    }

    function persistSchedule() {
      storageSet(
        SCHEDULE_KEY,
        JSON.stringify({
          start: scheduleStart ? scheduleStart.value : "",
          end: scheduleEnd ? scheduleEnd.value : "",
        }),
      );
    }

    if (modeSwitch) {
      modeSwitch.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-mode]");
        if (!btn) return;
        applyMode(btn.dataset.mode);
      });
    }

    if (phaseSwitch) {
      phaseSwitch.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-phase]");
        if (!btn) return;
        applyPhase(btn.dataset.phase);
      });
    }

    [scheduleStart, scheduleEnd].forEach((input) => {
      if (!input) return;
      input.addEventListener("input", () => {
        refresh();
        persistSchedule();
      });
      input.addEventListener("change", () => {
        refresh();
        persistSchedule();
      });
    });

    applyPhase(phase);
    applyMode(mode);

    const download = $("downloadCsv");
    if (download) download.addEventListener("click", downloadCsv);
  }

  /* ---------- MQTT ---------- */

  function brokerUrl() {
    const override = new URLSearchParams(location.search).get("broker");
    if (override) return override;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const host = location.hostname || "localhost";
    return `${scheme}://${host}:9001`;
  }

  function integrateDli(nextMol, now) {
    if (lastMol !== null && lastMolTs !== null) {
      const dt = (now - lastMolTs) / 1000;
      if (dt > 0 && dt < 30) {
        dliTotal += ((lastMol + nextMol) / 2) * dt / 1e6;
      }
    }
    lastMol = nextMol;
    lastMolTs = now;
    telemetry.dli = dliTotal;
  }

  function recordHistory(now) {
    recordDailyDli();

    const hour = pad(new Date(now).getHours());
    history[hour] = {
      suhu: telemetry.suhu,
      kelembapan: telemetry.kelembapan,
      lux: telemetry.lux,
      mol: telemetry.mol,
      dli: telemetry.dli,
      led: telemetry.led,
    };

    if (now - lastSampleTs >= SAMPLE_MIN_INTERVAL_MS) {
      samples.push({
        t: now,
        suhu: telemetry.suhu,
        mol: telemetry.mol,
        dli: telemetry.dli,
      });
      lastSampleTs = now;

      const cutoff = now - SAMPLE_KEEP_MS;
      while (samples.length && samples[0].t < cutoff) samples.shift();
    }
  }

  function handleMessage(topic, raw) {
    const value = raw.trim();
    const now = Date.now();

    if (topic === TOPICS.status) {
      const next = value.toLowerCase();
      deviceStatus = next === "online" || next === "offline" ? next : deviceStatus;
      if (deviceStatus === "online") telemetry.lastSeen = now;
      renderConnection();
      return;
    }

    if (topic === TOPICS.lux) {
      const lux = parseFloat(value);
      if (Number.isFinite(lux)) {
        telemetry.lux = lux;
        telemetry.lastSeen = now;
      }
    } else if (topic === TOPICS.mol) {
      const mol = parseFloat(value);
      if (Number.isFinite(mol)) {
        integrateDli(mol, now);
        telemetry.mol = mol;
        telemetry.lastSeen = now;
      }
    } else if (topic === TOPICS.led) {
      if (/^true$/i.test(value)) telemetry.led = true;
      else if (/^false$/i.test(value)) telemetry.led = false;
      telemetry.lastSeen = now;
    } else if (topic === TOPICS.suhu) {
      const suhu = parseFloat(value);
      if (Number.isFinite(suhu)) {
        telemetry.suhu = suhu;
        telemetry.lastSeen = now;
      }
    } else if (topic === TOPICS.kelembapan) {
      const kelembapan = parseFloat(value);
      if (Number.isFinite(kelembapan)) {
        telemetry.kelembapan = kelembapan;
        telemetry.lastSeen = now;
      }
    } else {
      return;
    }

    recordHistory(now);
    renderLive();
    renderHistory();
    updateChartData();
    renderConnection();
  }

  function initMqtt() {
    if (typeof mqtt === "undefined") {
      const status = $("nodeStatus");
      if (status) {
        status.textContent = "Library MQTT gagal dimuat";
        status.classList.add("is-offline");
      }
      return;
    }

    const url = brokerUrl();
    mqttClient = mqtt.connect(url, {
      path: "/",
      clientId: `hydrolight-web-${Math.random().toString(16).slice(2, 10)}`,
      clean: true,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
    });

    mqttClient.on("connect", () => {
      mqttConnected = true;
      mqttEverConnected = true;
      mqttError = false;
      deviceStatus = null;
      mqttClient.subscribe("hydrolight/device/+");
      renderConnection();
      showToast(`Terhubung ke broker MQTT (${url}).`);
    });

    mqttClient.on("reconnect", renderConnection);

    mqttClient.on("close", () => {
      mqttConnected = false;
      renderConnection();
    });

    mqttClient.on("offline", () => {
      mqttConnected = false;
      renderConnection();
    });

    mqttClient.on("error", () => {
      mqttConnected = false;
      mqttError = true;
      renderConnection();
    });

    mqttClient.on("message", (topic, payload) => {
      handleMessage(topic, payload.toString());
    });

    setInterval(renderConnection, 5000);
  }

  /* ---------- Boot ---------- */

  initTheme();
  renderLive();
  renderHistory();
  renderConnection();
  initDateFields();
  initControls();
  buildChart();
  buildDliChart();
  buildDliDonut();
  initMqtt();

  if (chart || dliChart || dliDonut) updateChartTheme();

  window.addEventListener("resize", resizeCharts);

  window.hydrolightDashboard = {
    get chart() {
      return chart;
    },
    get dliChart() {
      return dliChart;
    },
    get dliDonut() {
      return dliDonut;
    },
    get client() {
      return mqttClient;
    },
    telemetry,
    history,
    chartSeries,
  };
})();
