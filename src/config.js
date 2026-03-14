const DEFAULT_WINDOWS = [10, 50, 100];

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (Number.isFinite(min) && parsed < min) {
    return min;
  }

  if (Number.isFinite(max) && parsed > max) {
    return max;
  }

  return parsed;
}

function toFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (Number.isFinite(min) && parsed < min) {
    return min;
  }

  if (Number.isFinite(max) && parsed > max) {
    return max;
  }

  return parsed;
}

export function parseWindowsParam(rawWindows) {
  if (!rawWindows || typeof rawWindows !== "string") {
    return [...DEFAULT_WINDOWS];
  }

  const parsed = rawWindows
    .split(",")
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 10);

  if (parsed.length === 0) {
    return [...DEFAULT_WINDOWS];
  }

  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

export function loadConfig() {
  return Object.freeze({
    serviceName: process.env.SERVICE_NAME || "tx-prediction-backend",
    host: process.env.HOST || "0.0.0.0",
    port: toInt(process.env.PORT, 3000, 1, 65535),
    predictionApiUrl:
      process.env.PREDICTION_API_URL ||
      "https://aims-discussions-nottingham-milton.trycloudflare.com/api/txmd5",
    resultsApiUrl:
      process.env.RESULTS_API_URL ||
      "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    predictionPollMs: toInt(process.env.PREDICTION_POLL_MS, 1500, 500, 60000),
    resultsPollMs: toInt(process.env.RESULTS_POLL_MS, 2000, 500, 60000),
    requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 6000, 1000, 60000),
    databasePath: process.env.DATABASE_PATH || "./data/tx-monitor.sqlite",
    historyDefaultLimit: toInt(process.env.HISTORY_DEFAULT_LIMIT, 100, 1, 1000),
    historyMaxLimit: toInt(process.env.HISTORY_MAX_LIMIT, 500, 1, 5000),
    maxStoredSessions: toInt(process.env.MAX_STORED_SESSIONS, 10000, 100, 200000),
    alertWindowSize: toInt(process.env.ALERT_WINDOW_SIZE, 5, 2, 50),
    alertWinRateThreshold: toFloat(process.env.ALERT_WIN_RATE_THRESHOLD, 80, 1, 100),
    bettingSampleSize: toInt(process.env.BETTING_SAMPLE_SIZE, 500, 10, 50000),
    predictorHistorySize: toInt(process.env.PREDICTOR_HISTORY_SIZE, 400, 50, 2000),
    predictorModelEvalWindow: toInt(process.env.PREDICTOR_MODEL_EVAL_WINDOW, 300, 50, 5000),
    betAdviceMinConfidence: toFloat(process.env.BET_ADVICE_MIN_CONFIDENCE, 57, 50, 90),
    betAdviceMinWinRate10: toFloat(process.env.BET_ADVICE_MIN_WIN_RATE_10, 55, 40, 90),
    betAdviceMinWinRate30: toFloat(process.env.BET_ADVICE_MIN_WIN_RATE_30, 56, 40, 90),
    betAdviceMinEnsembleAccuracy: toFloat(process.env.BET_ADVICE_MIN_ENSEMBLE_ACC, 60, 40, 95),
    betAdviceMinSignalScore: toFloat(process.env.BET_ADVICE_MIN_SIGNAL_SCORE, 54, 35, 95),
    betAdviceStrongSignalScore: toFloat(process.env.BET_ADVICE_STRONG_SIGNAL_SCORE, 72, 45, 100),
    betAdviceMaxBankrollPercent: toFloat(process.env.BET_ADVICE_MAX_BANKROLL_PERCENT, 8, 0.5, 12),
    bettingUnit: toInt(process.env.BETTING_UNIT, 1000, 10, 100000),
    patternDataPath: process.env.PATTERN_DATA_PATH || "./data/cau-patterns.txt",
    defaultWindows: [...DEFAULT_WINDOWS]
  });
}





