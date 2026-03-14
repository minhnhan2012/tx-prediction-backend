import path from "node:path";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { loadConfig, parseWindowsParam } from "./config.js";
import {
  calculateBettingImpact,
  calculateStreaks,
  calculateWindowStats,
  withGlobalWinRate
} from "./analytics.js";
import { createDatabase } from "./database.js";
import { sideToDisplay } from "./normalizers.js";
import { MonitorService } from "./monitorService.js";
import { PredictorEngine } from "./predictorEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const config = loadConfig();
const database = createDatabase(config);
const predictor = new PredictorEngine({ config, database });
const monitor = new MonitorService({ config, database, predictor });

const app = express();

// Middleware
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use("/public", express.static(publicDir));

// Logging middleware
const logRequests = process.env.LOG_REQUESTS === "true";
if (logRequests) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// CORS middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

function parseLimit(rawLimit, fallback, max) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseBankroll(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const cleaned = String(rawValue).replace(/[^\d]/g, "");
  const parsed = Number.parseInt(cleaned, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseBetUnit(rawValue, fallbackUnit = 1000) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackUnit;
  }

  return Math.max(10, parsed);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function roundMoney(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function roundToBetUnit(value, betUnit, mode = "floor") {
  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = parseBetUnit(betUnit, 1000);
  if (unit <= 1) {
    return roundMoney(value);
  }

  const normalized = value / unit;
  let rounded = 0;

  if (mode === "ceil") {
    rounded = Math.ceil(normalized);
  } else if (mode === "round") {
    rounded = Math.round(normalized);
  } else {
    rounded = Math.floor(normalized);
  }

  return Math.max(0, rounded * unit);
}

function stakePercentFromConfidence(confidencePercent, maxStakePercent) {
  if (!Number.isFinite(confidencePercent) || confidencePercent < 60) {
    return 0;
  }

  let stakePercent = 0;
  if (confidencePercent >= 85) {
    stakePercent = 9.5;
  } else if (confidencePercent >= 80) {
    stakePercent = 8;
  } else if (confidencePercent >= 75) {
    stakePercent = 7;
  } else if (confidencePercent >= 70) {
    stakePercent = 6;
  } else if (confidencePercent >= 65) {
    stakePercent = 4.5;
  } else {
    stakePercent = 3;
  }

  const cap = Math.max(maxStakePercent || 0, confidencePercent >= 70 ? 6 : 0, 8);
  return clampNumber(stakePercent, 1, cap);
}

function simulateProfitLoss({
  bankroll,
  outcomes,
  minConfidencePercent,
  maxStakePercent,
  payoutMultiplier,
  loseMultiplier,
  betUnit
}) {
  const rows = Array.isArray(outcomes) ? [...outcomes].reverse() : [];

  let currentBankroll = bankroll;
  let betCount = 0;
  let wins = 0;
  let losses = 0;
  let totalStake = 0;
  let totalReturn = 0;
  let lastAppliedSessionId = null;

  for (const row of rows) {
    if (!Number.isFinite(currentBankroll) || currentBankroll <= 0) {
      break;
    }

    const confidencePercent = Number.isFinite(row?.confidence) ? row.confidence * 100 : null;
    if (!Number.isFinite(confidencePercent) || confidencePercent < minConfidencePercent) {
      continue;
    }

    const stakePercent = stakePercentFromConfidence(confidencePercent, maxStakePercent);
    if (stakePercent <= 0) {
      continue;
    }

    let stake = roundToBetUnit((currentBankroll * stakePercent) / 100, betUnit, "floor");
    if (!Number.isFinite(stake) || stake <= 0) {
      continue;
    }

    if (stake > currentBankroll) {
      stake = roundToBetUnit(currentBankroll, betUnit, "floor");
    }

    if (!Number.isFinite(stake) || stake <= 0) {
      continue;
    }

    betCount += 1;
    totalStake += stake;
    lastAppliedSessionId = row?.sessionId || lastAppliedSessionId;

    if (row.status === "WIN") {
      wins += 1;
      const grossReturn = stake * payoutMultiplier;
      const netProfit = grossReturn - stake;
      totalReturn += grossReturn;
      currentBankroll += netProfit;
    } else {
      losses += 1;
      const netLoss = stake * loseMultiplier;
      currentBankroll -= netLoss;
    }
  }

  const netProfit = currentBankroll - bankroll;
  const roiPercent = bankroll > 0 ? (netProfit / bankroll) * 100 : null;

  return {
    quy_tac: {
      thang_nhan_x: payoutMultiplier,
      thua_mat_x: loseMultiplier
    },
    don_vi_dat_cuoc: parseBetUnit(betUnit, 1000),
    mau_lich_su: rows.length,
    lenh_da_mo: betCount,
    lenh_thang: wins,
    lenh_thua: losses,
    ty_le_thang_percent: betCount > 0 ? Number(((wins / betCount) * 100).toFixed(2)) : null,
    tong_tien_dat: roundMoney(totalStake),
    tong_tien_thu_ve: roundMoney(totalReturn),
    loi_nhuan_rong: roundMoney(netProfit),
    loi_nhuan_rong_text: formatCurrency(netProfit),
    roi_percent: Number.isFinite(roiPercent) ? Number(roiPercent.toFixed(2)) : null,
    so_du_uoc_tinh: roundMoney(currentBankroll),
    so_du_uoc_tinh_text: formatCurrency(currentBankroll),
    cap_nhat_den_phien: lastAppliedSessionId
  };
}

function attachBankrollAdvice(prediction, bankroll) {
  if (!prediction || !Number.isFinite(bankroll) || bankroll <= 0) {
    return prediction;
  }

  const advice = prediction.goi_y_dat_cuoc;
  if (!advice) {
    return {
      ...prediction,
      bankroll_input: bankroll
    };
  }

  const payoutMultiplier = Number.isFinite(advice?.quy_tac_thanh_toan?.thang_nhan_x)
    ? advice.quy_tac_thanh_toan.thang_nhan_x
    : 1.98;
  const loseMultiplier = Number.isFinite(advice?.quy_tac_thanh_toan?.thua_mat_x)
    ? advice.quy_tac_thanh_toan.thua_mat_x
    : 1;

  const percent = Number.isFinite(advice.ti_le_von_goi_y_percent)
    ? advice.ti_le_von_goi_y_percent
    : 0;

  const betUnit = parseBetUnit(config.bettingUnit, 1000);

  let suggestedAmount = advice.nen_dat
    ? roundToBetUnit((bankroll * percent) / 100, betUnit, "floor")
    : 0;

  if (advice.nen_dat && bankroll >= betUnit && (!Number.isFinite(suggestedAmount) || suggestedAmount <= 0)) {
    suggestedAmount = betUnit;
  }

  if (Number.isFinite(suggestedAmount) && suggestedAmount > bankroll) {
    suggestedAmount = roundToBetUnit(bankroll, betUnit, "floor");
  }

  if (!Number.isFinite(suggestedAmount) || suggestedAmount < 0) {
    suggestedAmount = 0;
  }

  const estimatedRemain = Math.max(0, bankroll - suggestedAmount);
  const bankrollAfterWin = bankroll + suggestedAmount * (payoutMultiplier - 1);

  const minConfidencePercent = Number.isFinite(advice?.nguong_su_dung?.min_confidence_percent)
    ? advice.nguong_su_dung.min_confidence_percent
    : 60;

  const recentOutcomes = database.getRecentModelOutcomes("ensemble", 120);
  const pnlStats = simulateProfitLoss({
    bankroll,
    outcomes: recentOutcomes,
    minConfidencePercent,
    maxStakePercent: Number.isFinite(config.betAdviceMaxBankrollPercent)
      ? config.betAdviceMaxBankrollPercent
      : 8,
    payoutMultiplier,
    loseMultiplier,
    betUnit
  });

  return {
    ...prediction,
    bankroll_input: bankroll,
    goi_y_dat_cuoc: {
      ...advice,
      don_vi_dat_cuoc: betUnit,
      don_vi_dat_cuoc_text: formatCurrency(betUnit),
      so_von_nhap: bankroll,
      so_von_nhap_text: formatCurrency(bankroll),
      so_tien_goi_y: suggestedAmount,
      so_tien_goi_y_text: formatCurrency(suggestedAmount),
      von_con_lai_uoc_tinh: roundMoney(estimatedRemain),
      von_con_lai_uoc_tinh_text: formatCurrency(estimatedRemain),
      giai_thich_so_du: advice.nen_dat
        ? "Von con lai uoc tinh la so du ngay sau khi vao lenh de xuat o van hien tai."
        : "Van nay NEN DOI nen so du duoc giu nguyen, khong bi tru tien.",
      von_theo_doi_hien_tai: pnlStats.so_du_uoc_tinh,
      von_theo_doi_hien_tai_text: pnlStats.so_du_uoc_tinh_text,
      loi_lo_da_chot: pnlStats.loi_nhuan_rong,
      loi_lo_da_chot_text: pnlStats.loi_nhuan_rong_text,
      ket_qua_tai_chinh_1_lenh: {
        quy_tac: {
          thang_nhan_x: payoutMultiplier,
          thua_mat_x: loseMultiplier
        },
        neu_thang_thu_ve: roundMoney(suggestedAmount * payoutMultiplier),
        neu_thang_loi_nhuan_rong: roundMoney(suggestedAmount * (payoutMultiplier - 1)),
        neu_thua_mat: roundMoney(suggestedAmount * loseMultiplier),
        von_sau_thang: roundMoney(bankrollAfterWin),
        von_sau_thua: roundMoney(estimatedRemain)
      },
      thong_ke_loi_lo: pnlStats
    }
  };
}

function makeStatsResponse(windows) {
  const summary = withGlobalWinRate(database.getSummary());
  const maxWindow = Math.max(...windows);
  const recentResolved = database.getRecentResolved(maxWindow);
  const windowStats = calculateWindowStats(recentResolved, windows);
  const streaks = calculateStreaks(database.getResolvedStatusesAscending());

  return {
    generatedAt: new Date().toISOString(),
    summary,
    windows: windowStats,
    streaks
  };
}

function getCurrentPredictionSnapshot() {
  return monitor.getLatestPredictionSnapshot() || predictor.buildCurrentPrediction();
}

app.get("/", (req, res) => {
  res.json({
    service: config.serviceName,
    message: "TX monitor backend is running",
    endpoints: [
      "GET /health",
      "GET /tool",
      "GET /api/current-session",
      "GET /api/predictor/current",
      "GET /api/predictor/models",
      "GET /api/history?limit=100&status=all",
      "GET /api/stats?windows=10,50,100",
      "GET /api/analytics/betting?limit=500",
      "GET /api/alerts?limit=20",
      "GET /api/dashboard",
      "GET /api/sessions/:id",
      "GET /api/stream (SSE)",
      "POST /api/sync"
    ]
  });
});

app.get("/tool", (req, res) => {
  res.sendFile(path.join(publicDir, "tool.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: config.serviceName,
    now: new Date().toISOString(),
    monitor: monitor.getState(),
    config: {
      predictionApiUrl: config.predictionApiUrl,
      predictionPollMs: config.predictionPollMs,
      resultsPollMs: config.resultsPollMs,
      alertWindowSize: config.alertWindowSize,
      alertWinRateThreshold: config.alertWinRateThreshold,
      betAdvice: {
        minConfidence: config.betAdviceMinConfidence,
        minWinRate10: config.betAdviceMinWinRate10,
        minWinRate30: config.betAdviceMinWinRate30,
        minEnsembleAccuracy: config.betAdviceMinEnsembleAccuracy,
        minSignalScore: config.betAdviceMinSignalScore,
        strongSignalScore: config.betAdviceStrongSignalScore,
        maxBankrollPercent: config.betAdviceMaxBankrollPercent,
        bettingUnit: config.bettingUnit
      }
    }
  });
});

app.get("/api/current-session", (req, res) => {
  const currentSession = database.getCurrentSession();
  res.json({
    currentSession,
    monitor: monitor.getState()
  });
});

// simplified public result format (Vietnamese field names)
app.get("/api/summary", (req, res) => {
  const current = database.getCurrentSession();
  if (!current || !current.reference) {
    res.status(404).json({ message: "Không có phiên hiện tại" });
    return;
  }

  // base info comes from reference payload mapping
  const result = { ...current.reference };
  const snap = getCurrentPredictionSnapshot();
  if (snap) {
    // prediction.ket_qua already a display string ("Tài"/"Xỉu")
    result.du_doan = snap.prediction.ket_qua || null;
    // confidence_percent already part of prediction payload; rename for clarity
    result.ti_le_dung = snap.prediction.confidence_percent;
  } else {
    result.du_doan = null;
    result.ti_le_dung = null;
  }

  res.json(result);
});

app.get("/api/predictor/current", (req, res) => {
  const snapshot = getCurrentPredictionSnapshot();
  if (!snapshot) {
    res.status(404).json({
      message: "Chua co du lieu de tao du doan",
      hint: "Cho service poll prediction API it giay roi thu lai."
    });
    return;
  }

  const leaderboard = database.getModelLeaderboard(config.predictorModelEvalWindow);
  const bankroll = parseBankroll(req.query.bankroll);
  const predictionPayload = attachBankrollAdvice(snapshot.prediction, bankroll);

  res.json({
    ...predictionPayload,
    _meta: {
      generatedAt: snapshot.generatedAt,
      sessionId: snapshot.sessionId,
      ensemble: snapshot.ensemble,
      leaderboardWindow: config.predictorModelEvalWindow,
      modelLeaderboard: leaderboard,
      patternStore: predictor.getPatternStoreInfo ? predictor.getPatternStoreInfo() : null,
      bankroll
    }
  });
});

app.get("/api/predictor/models", (req, res) => {
  const limit = parseLimit(req.query.limit, config.predictorModelEvalWindow, 5000);
  const snapshot = getCurrentPredictionSnapshot();
  const sessionId = req.query.sessionId || snapshot?.sessionId || null;

  res.json({
    generatedAt: new Date().toISOString(),
    leaderboardWindow: limit,
    leaderboard: database.getModelLeaderboard(limit),
    sessionId,
    sessionPredictions: sessionId ? database.listModelPredictions(sessionId) : []
  });
});

app.get("/api/history", (req, res) => {
  const limit = parseLimit(
    req.query.limit,
    config.historyDefaultLimit,
    config.historyMaxLimit
  );

  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const history = database.listHistory(limit, status);

  res.json({
    limit,
    status,
    count: history.length,
    history
  });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = database.getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ message: "Session not found" });
    return;
  }

  res.json({ session });
});

app.get("/api/stats", (req, res) => {
  const windows = parseWindowsParam(req.query.windows);
  const stats = makeStatsResponse(windows);
  res.json(stats);
});

app.get("/api/analytics/betting", (req, res) => {
  const limit = parseLimit(req.query.limit, config.bettingSampleSize, 50000);
  const rows = database.getBettingSamples(limit);

  res.json({
    generatedAt: new Date().toISOString(),
    sampleLimit: limit,
    sampleSize: rows.length,
    analytics: calculateBettingImpact(rows)
  });
});

// prediction accuracy summary
app.get("/api/analytics/predictions", (req, res) => {
  const stats = database.getPredictionStats();
  res.json({
    generatedAt: new Date().toISOString(),
    stats
  });
});

app.get("/api/alerts", (req, res) => {
  const limit = parseLimit(req.query.limit, 20, 1000);
  const alerts = database.listAlerts(limit);

  res.json({
    count: alerts.length,
    alerts
  });
});

app.get("/api/dashboard", (req, res) => {
  const windows = config.defaultWindows;
  const stats = makeStatsResponse(windows);
  const currentSession = database.getCurrentSession();
  const history = database.listHistory(50, "all");
  const alerts = database.listAlerts(10);

  res.json({
    generatedAt: new Date().toISOString(),
    currentSession,
    predictor: getCurrentPredictionSnapshot(),
    modelLeaderboard: database.getModelLeaderboard(config.predictorModelEvalWindow),
    stats,
    latestHistory: history,
    alerts,
    monitor: monitor.getState()
  });
});

app.post("/api/sync", async (req, res, next) => {
  try {
    const state = await monitor.runNow();
    res.json({
      success: true,
      syncedAt: new Date().toISOString(),
      monitor: state,
      predictor: getCurrentPredictionSnapshot()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent("connected", {
    at: new Date().toISOString(),
    service: config.serviceName
  });

  sendEvent("predictor", getCurrentPredictionSnapshot());

  const handleUpdate = (payload) => {
    sendEvent("update", payload);
    if (payload.source === "prediction") {
      sendEvent("predictor", getCurrentPredictionSnapshot());
    }
  };

  const handleAlert = (payload) => sendEvent("alert", payload);

  monitor.on("update", handleUpdate);
  monitor.on("alert", handleAlert);

  const keepAlive = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    monitor.off("update", handleUpdate);
    monitor.off("alert", handleAlert);
    res.end();
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled API error:", error);
  res.status(500).json({
    message: "Internal server error",
    details: error?.message || "unknown"
  });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[${config.serviceName}] listening on http://${config.host}:${config.port}`);
  console.log(`[${config.serviceName}] prediction API: ${config.predictionApiUrl}`);
  console.log(`[${config.serviceName}] prediction poll: ${config.predictionPollMs}ms`);
  console.log(`[${config.serviceName}] results poll: ${config.resultsPollMs}ms`);
});

monitor.start();

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  monitor.stop();

  server.close(() => {
    database.close();
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));













