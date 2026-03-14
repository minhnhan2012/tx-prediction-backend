import { normalizeSide, sideToDisplay } from "./normalizers.js";
import { loadCauPatternStore, refreshCauPatternStore, findCauPatternMatch } from "./cauPattern.js";

const BASE_MODEL_WEIGHTS = {
  reference_api: 1.08,
  markov_1: 1.1,
  markov_2: 1.15,
  streak_reversion: 0.95,
  money_pressure: 1.0,
  point_trend: 0.9,
  frequency_balance: 0.85,
  long_balance: 0.78,
  short_momentum: 0.9,
  ewma_trend: 1.0,
  cycle_detector: 0.88,
  regime_ngram: 1.05,
  cau_pattern: 1.02,
  sequence_memory: 1.08,
  mistake_feedback: 0.92
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

// build a map from confidence-range ("50-60") to observed accuracy (ratio)
function buildCalibrationMap(stats) {
  const map = {};
  if (!stats || !stats.byConfidenceRange) return map;
  for (const [range, bucket] of Object.entries(stats.byConfidenceRange)) {
    if (bucket.count > 0) {
      map[range] = bucket.correct / bucket.count;
    }
  }
  return map;
}

// apply calibration: input confidence percent (0-100), returns adjusted percent
function calibrateConfidence(confPercent, calibMap) {
  if (confPercent == null || typeof confPercent !== "number") return confPercent;
  for (const key of Object.keys(calibMap)) {
    const [low, high] = key.split("-").map(Number);
    if (confPercent >= low && confPercent < high) {
      const adj = calibMap[key];
      return typeof adj === "number" ? adj * 100 : confPercent;
    }
  }
  return confPercent;
}

function oppositeSide(side) {
  if (side === "TAI") {
    return "XIU";
  }

  if (side === "XIU") {
    return "TAI";
  }

  return null;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function makeSeededRandom(seedInput) {
  const text = String(seedInput || "0");
  let seed = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    seed ^= text.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DICE_COMBOS_BY_TOTAL = (() => {
  const map = new Map();
  for (let a = 1; a <= 6; a += 1) {
    for (let b = 1; b <= 6; b += 1) {
      for (let c = 1; c <= 6; c += 1) {
        const total = a + b + c;
        if (!map.has(total)) {
          map.set(total, []);
        }
        map.get(total).push([a, b, c]);
      }
    }
  }
  return map;
})();

function pickDiceByTotal(total, rng) {
  const combos = DICE_COMBOS_BY_TOTAL.get(total) || [];
  if (combos.length === 0) {
    return null;
  }

  const index = Math.floor(rng() * combos.length);
  return combos[index];
}

function buildPredictedDice({ sessionId, side }) {
  // Keep dice stable in one session for the same side.
  const rng = makeSeededRandom(`${sessionId}:${side}`);
  const range = side === "TAI" ? [11, 18] : [3, 10];

  const targetTotal = range[0] + Math.floor(rng() * (range[1] - range[0] + 1));

  let dice = pickDiceByTotal(targetTotal, rng);
  if (!dice) {
    for (let total = range[0]; total <= range[1]; total += 1) {
      dice = pickDiceByTotal(total, rng);
      if (dice) {
        break;
      }
    }
  }

  if (!dice) {
    return side === "TAI" ? [4, 4, 4] : [2, 2, 2];
  }

  return dice;
}

function getLastStreak(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const latest = history[history.length - 1].actualResult;
  if (latest !== "TAI" && latest !== "XIU") {
    return null;
  }

  let length = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].actualResult === latest) {
      length += 1;
    } else {
      break;
    }
  }

  return {
    side: latest,
    length
  };
}

function buildModelSignal(modelName, predictedResult, confidence, reason) {
  const side = normalizeSide(predictedResult);
  if (!side) {
    return null;
  }

  return {
    modelName,
    predictedResult: side,
    confidence: clamp(confidence, 0.5, 0.95),
    reason: reason || null
  };
}

function modelReferenceApi(referenceRecord) {
  if (!referenceRecord?.predictedResult) {
    return null;
  }

  return buildModelSignal(
    "reference_api",
    referenceRecord.predictedResult,
    0.62,
    "Lay ket_qua tham khao truc tiep tu API txmd5."
  );
}

function modelMarkov1(history) {
  if (!Array.isArray(history) || history.length < 8) {
    return null;
  }

  const latestSide = history[history.length - 1].actualResult;
  if (!latestSide) {
    return null;
  }

  const transitions = {
    TAI: 0,
    XIU: 0
  };

  for (let index = 1; index < history.length; index += 1) {
    const prev = history[index - 1].actualResult;
    const next = history[index].actualResult;

    if (prev === latestSide && (next === "TAI" || next === "XIU")) {
      transitions[next] += 1;
    }
  }

  const total = transitions.TAI + transitions.XIU;
  if (total < 3) {
    return null;
  }

  const predictedResult = transitions.TAI >= transitions.XIU ? "TAI" : "XIU";
  const ratio = Math.max(transitions.TAI, transitions.XIU) / total;
  const confidence = 0.52 + (ratio - 0.5) * 0.8 + Math.min(total, 20) * 0.004;

  return buildModelSignal(
    "markov_1",
    predictedResult,
    confidence,
    `Markov-1 tu ket qua gan nhat (${latestSide}), mau ${total}.`
  );
}

function modelMarkov2(history) {
  if (!Array.isArray(history) || history.length < 12) {
    return null;
  }

  const prev1 = history[history.length - 2]?.actualResult;
  const prev2 = history[history.length - 1]?.actualResult;
  if (!prev1 || !prev2) {
    return null;
  }

  const state = `${prev1}-${prev2}`;
  const transitions = {
    TAI: 0,
    XIU: 0
  };

  for (let index = 2; index < history.length; index += 1) {
    const sourceState = `${history[index - 2].actualResult}-${history[index - 1].actualResult}`;
    const next = history[index].actualResult;

    if (sourceState === state && (next === "TAI" || next === "XIU")) {
      transitions[next] += 1;
    }
  }

  const total = transitions.TAI + transitions.XIU;
  if (total < 3) {
    return null;
  }

  const predictedResult = transitions.TAI >= transitions.XIU ? "TAI" : "XIU";
  const ratio = Math.max(transitions.TAI, transitions.XIU) / total;
  const confidence = 0.54 + (ratio - 0.5) * 0.9 + Math.min(total, 15) * 0.005;

  return buildModelSignal(
    "markov_2",
    predictedResult,
    confidence,
    `Markov-2 theo trang thai ${state}, mau ${total}.`
  );
}

function modelStreakReversion(history) {
  const streak = getLastStreak(history);
  if (!streak) {
    return null;
  }

  if (streak.length >= 4) {
    return buildModelSignal(
      "streak_reversion",
      oppositeSide(streak.side),
      0.6 + Math.min((streak.length - 4) * 0.03, 0.14),
      `Chuoi ${streak.side} dai ${streak.length} phien, uu tien dao chieu.`
    );
  }

  if (streak.length === 3) {
    return buildModelSignal(
      "streak_reversion",
      oppositeSide(streak.side),
      0.58,
      `Chuoi ${streak.side} 3 phien, mo hinh reversion.`
    );
  }

  return buildModelSignal(
    "streak_reversion",
    streak.side,
    0.53,
    "Chuoi ngan, tiep tuc theo dong hien tai."
  );
}

function modelMoneyPressure(referenceRecord) {
  const betTai = referenceRecord?.betTai;
  const betXiu = referenceRecord?.betXiu;
  const betTotal = referenceRecord?.betTotal;

  if (
    !Number.isFinite(betTai) ||
    !Number.isFinite(betXiu) ||
    !Number.isFinite(betTotal) ||
    betTotal <= 0
  ) {
    return null;
  }

  const diff = betTai - betXiu;
  const imbalance = Math.abs(diff) / betTotal;
  const dominant = diff >= 0 ? "TAI" : "XIU";
  const predictedResult = oppositeSide(dominant);
  const confidence = 0.52 + Math.min(imbalance * 0.65, 0.28);

  return buildModelSignal(
    "money_pressure",
    predictedResult,
    confidence,
    `Tien cuoc lech ${round(imbalance * 100, 2)}%, uu tien di nguoc dong tien.`
  );
}

function modelPointTrend(history) {
  const points = (history || [])
    .map((item) => item.point)
    .filter((value) => Number.isFinite(value))
    .slice(-12);

  if (points.length < 6) {
    return null;
  }

  const averagePoint = points.reduce((sum, value) => sum + value, 0) / points.length;
  const predictedResult = averagePoint >= 10.5 ? "TAI" : "XIU";
  const confidence = 0.51 + Math.min(Math.abs(averagePoint - 10.5) / 8, 0.23);

  return buildModelSignal(
    "point_trend",
    predictedResult,
    confidence,
    `Diem trung binh ${round(averagePoint, 2)} trong ${points.length} phien gan nhat.`
  );
}

function modelFrequencyBalance(history) {
  const recent = (history || []).slice(-20);
  if (recent.length < 8) {
    return null;
  }

  let taiCount = 0;
  let xiuCount = 0;

  for (const row of recent) {
    if (row.actualResult === "TAI") {
      taiCount += 1;
    } else if (row.actualResult === "XIU") {
      xiuCount += 1;
    }
  }

  if (taiCount === xiuCount) {
    return null;
  }

  const predictedResult = taiCount > xiuCount ? "XIU" : "TAI";
  const diff = Math.abs(taiCount - xiuCount) / recent.length;
  const confidence = 0.51 + Math.min(diff * 0.55, 0.2);

  return buildModelSignal(
    "frequency_balance",
    predictedResult,
    confidence,
    `Can bang tan suat 20 phien: TAI=${taiCount}, XIU=${xiuCount}.`
  );
}

function modelLongBalance(history) {
  const recent = (history || []).slice(-60);
  if (recent.length < 20) {
    return null;
  }

  let taiCount = 0;
  let xiuCount = 0;

  for (const row of recent) {
    if (row.actualResult === "TAI") {
      taiCount += 1;
    } else if (row.actualResult === "XIU") {
      xiuCount += 1;
    }
  }

  if (taiCount === xiuCount) {
    return null;
  }

  const predictedResult = taiCount > xiuCount ? "XIU" : "TAI";
  const diff = Math.abs(taiCount - xiuCount) / recent.length;
  const confidence = 0.505 + Math.min(diff * 0.4, 0.16);

  return buildModelSignal(
    "long_balance",
    predictedResult,
    confidence,
    `Can bang tan suat 60 phien: TAI=${taiCount}, XIU=${xiuCount}.`
  );
}

function modelShortMomentum(history) {
  const recent = (history || []).slice(-5);
  if (recent.length < 5) {
    return null;
  }

  let taiCount = 0;
  let xiuCount = 0;

  for (const row of recent) {
    if (row.actualResult === "TAI") {
      taiCount += 1;
    } else if (row.actualResult === "XIU") {
      xiuCount += 1;
    }
  }

  if (taiCount === xiuCount) {
    return null;
  }

  const predictedResult = taiCount > xiuCount ? "TAI" : "XIU";
  const diff = Math.abs(taiCount - xiuCount) / recent.length;

  return buildModelSignal(
    "short_momentum",
    predictedResult,
    0.52 + Math.min(diff * 0.25, 0.16),
    `Dong luong 5 phien gan nhat: TAI=${taiCount}, XIU=${xiuCount}.`
  );
}

function modelEwmaTrend(history) {
  const sides = (history || [])
    .map((item) => item.actualResult)
    .filter((side) => side === "TAI" || side === "XIU")
    .slice(-18);

  if (sides.length < 8) {
    return null;
  }

  let weightedSignal = 0;
  let totalWeight = 0;
  let weight = 1;

  for (let index = sides.length - 1; index >= 0; index -= 1) {
    weightedSignal += (sides[index] === "TAI" ? 1 : -1) * weight;
    totalWeight += weight;
    weight *= 0.86;
  }

  const normalizedSignal = totalWeight > 0 ? weightedSignal / totalWeight : 0;
  if (Math.abs(normalizedSignal) < 0.06) {
    return null;
  }

  const predictedResult = normalizedSignal >= 0 ? "TAI" : "XIU";
  const confidence = 0.52 + Math.min(Math.abs(normalizedSignal) * 0.55, 0.24);

  return buildModelSignal(
    "ewma_trend",
    predictedResult,
    confidence,
    `EWMA xu huong ${sides.length} phien, do lech ${round(normalizedSignal, 3)}.`
  );
}

function modelCycleDetector(history) {
  const sides = (history || [])
    .map((item) => item.actualResult)
    .filter((side) => side === "TAI" || side === "XIU")
    .slice(-10);

  if (sides.length < 6) {
    return null;
  }

  const last = sides[sides.length - 1];
  const previous = sides[sides.length - 2];
  const last3 = sides[sides.length - 3];
  const last4 = sides[sides.length - 4];

  if (last === last3 && previous === last4 && last !== previous) {
    return buildModelSignal(
      "cycle_detector",
      oppositeSide(last),
      0.58,
      `Phat hien chu ky 2 buoc (${previous}-${last}), du doan tiep tuc luan phien.`
    );
  }

  if (sides.length >= 9) {
    const patternA = sides.slice(sides.length - 3).join("-");
    const patternB = sides.slice(sides.length - 6, sides.length - 3).join("-");

    if (patternA === patternB) {
      return buildModelSignal(
        "cycle_detector",
        sides[sides.length - 3],
        0.57,
        `Mau 3 buoc ${patternA} lap lai 2 lan.`
      );
    }
  }

  return null;
}

function modelRegimeNgram(history) {
  const sides = (history || [])
    .map((item) => item.actualResult)
    .filter((side) => side === "TAI" || side === "XIU")
    .slice(-220);

  if (sides.length < 24) {
    return null;
  }

  for (let order = 4; order >= 2; order -= 1) {
    if (sides.length < order + 8) {
      continue;
    }

    const context = sides.slice(-order).join("-");
    const counts = { TAI: 0, XIU: 0 };
    let weightedSamples = 0;

    for (let index = order; index < sides.length; index += 1) {
      const candidate = sides.slice(index - order, index).join("-");
      if (candidate !== context) {
        continue;
      }

      const next = sides[index];
      if (next !== "TAI" && next !== "XIU") {
        continue;
      }

      const age = sides.length - index;
      const decay = Math.pow(0.985, age);
      counts[next] += decay;
      weightedSamples += decay;
    }

    if (weightedSamples < 2.2) {
      continue;
    }

    const predictedResult = counts.TAI >= counts.XIU ? "TAI" : "XIU";
    const ratio = Math.max(counts.TAI, counts.XIU) / Math.max(0.0001, counts.TAI + counts.XIU);
    const confidence = 0.53 + (ratio - 0.5) * 0.85 + Math.min(weightedSamples, 12) * 0.008;

    return buildModelSignal(
      "regime_ngram",
      predictedResult,
      confidence,
      `Hoc cau N-gram bac ${order}, mau quy doi ${round(weightedSamples, 2)} (${context}).`
    );
  }

  return null;
}

function modelSequenceMemory(history) {
  const sides = (history || [])
    .map((item) => item.actualResult)
    .filter((side) => side === "TAI" || side === "XIU")
    .slice(-280);

  if (sides.length < 30) {
    return null;
  }

  const windowSizes = [6, 5, 4];

  for (const windowSize of windowSizes) {
    if (sides.length < windowSize + 12) {
      continue;
    }

    const context = sides.slice(-windowSize).join("-");
    const counts = { TAI: 0, XIU: 0 };
    let weightedSamples = 0;

    for (let index = windowSize; index < sides.length; index += 1) {
      const candidate = sides.slice(index - windowSize, index).join("-");
      if (candidate !== context) {
        continue;
      }

      const next = sides[index];
      if (next !== "TAI" && next !== "XIU") {
        continue;
      }

      const age = sides.length - index;
      const decay = Math.pow(0.992, age);
      counts[next] += decay;
      weightedSamples += decay;
    }

    if (weightedSamples < 2.8) {
      continue;
    }

    const predictedResult = counts.TAI >= counts.XIU ? "TAI" : "XIU";
    const ratio = Math.max(counts.TAI, counts.XIU) / Math.max(0.0001, counts.TAI + counts.XIU);
    const confidence = 0.54 + (ratio - 0.5) * 0.95 + Math.min(weightedSamples, 10) * 0.01;

    return buildModelSignal(
      "sequence_memory",
      predictedResult,
      confidence,
      `Mau cau ${windowSize} buoc (${context}), mau quy doi ${round(weightedSamples, 2)}.`
    );
  }

  return null;
}

function modelCauPattern(patternMatch) {
  if (!patternMatch) {
    return null;
  }

  const supportPercent = round(patternMatch.supportRate * 100, 2);
  const patternSide = sideToDisplay(patternMatch.predictedResult) || patternMatch.predictedResult;

  return buildModelSignal(
    "cau_pattern",
    patternMatch.predictedResult,
    patternMatch.confidence,
    `Khop cau ${patternMatch.pattern} (len ${patternMatch.length}), ${supportPercent}% nghieng ${patternSide}.`
  );
}
function modelMistakeFeedback(referenceRecord, recentPerformance) {
  const baseSide = normalizeSide(referenceRecord?.predictedResult);
  if (!baseSide) {
    return null;
  }

  const streakType = recentPerformance?.currentStreak?.type;
  const streakLength = recentPerformance?.currentStreak?.length || 0;

  if (streakType === "LOSS" && streakLength >= 2) {
    return buildModelSignal(
      "mistake_feedback",
      oppositeSide(baseSide),
      0.55 + Math.min((streakLength - 1) * 0.02, 0.08),
      `Hoc tu chuoi sai ${streakLength} phien, dieu chinh nguoc huong cu.`
    );
  }

  if (streakType === "WIN" && streakLength >= 2) {
    return buildModelSignal(
      "mistake_feedback",
      baseSide,
      0.54 + Math.min((streakLength - 1) * 0.015, 0.06),
      `Chuoi dung ${streakLength} phien, uu tien huong dang on dinh.`
    );
  }

  return null;
}

function runModelSuite({ referenceRecord, history, recentPerformance, patternMatch }) {
  return [
    modelReferenceApi(referenceRecord),
    modelMarkov1(history),
    modelMarkov2(history),
    modelStreakReversion(history),
    modelMoneyPressure(referenceRecord),
    modelPointTrend(history),
    modelFrequencyBalance(history),
    modelLongBalance(history),
    modelShortMomentum(history),
    modelEwmaTrend(history),
    modelCycleDetector(history),
    modelRegimeNgram(history),
    modelSequenceMemory(history),
    modelCauPattern(patternMatch),
    modelMistakeFeedback(referenceRecord, recentPerformance)
  ].filter(Boolean);
}

function buildPerformanceMap(modelLeaderboard) {
  const map = {};
  const rows = Array.isArray(modelLeaderboard) ? modelLeaderboard : [];
  const priorWeight = 18;

  for (const row of rows) {
    const modelName = row?.modelName;
    if (!modelName) {
      continue;
    }

    const total = Number.isFinite(row.total) ? row.total : 0;
    const wins = Number.isFinite(row.wins) ? row.wins : 0;
    const rawAccuracy =
      Number.isFinite(row.accuracy) ? row.accuracy : total > 0 ? wins / total : 0.5;

    map[modelName] = {
      total,
      wins,
      accuracy: clamp(rawAccuracy, 0, 1),
      smoothedAccuracy: clamp((wins + priorWeight * 0.5) / (total + priorWeight), 0, 1)
    };
  }

  return map;
}

function combinePerformanceMaps(longMap, shortMap) {
  const names = new Set([...Object.keys(longMap || {}), ...Object.keys(shortMap || {})]);
  const combined = {};

  for (const modelName of names) {
    const longPerf = longMap?.[modelName] || {
      total: 0,
      wins: 0,
      accuracy: 0.5,
      smoothedAccuracy: 0.5
    };

    const shortPerf = shortMap?.[modelName] || longPerf;

    combined[modelName] = {
      total: Math.max(longPerf.total || 0, shortPerf.total || 0),
      wins: Math.max(longPerf.wins || 0, shortPerf.wins || 0),
      accuracy: clamp((longPerf.accuracy || 0.5) * 0.7 + (shortPerf.accuracy || 0.5) * 0.3, 0, 1),
      smoothedAccuracy: clamp(
        (longPerf.smoothedAccuracy || 0.5) * 0.7 + (shortPerf.smoothedAccuracy || 0.5) * 0.3,
        0,
        1
      ),
      longSmoothedAccuracy: longPerf.smoothedAccuracy || 0.5,
      shortSmoothedAccuracy: shortPerf.smoothedAccuracy || 0.5
    };
  }

  return combined;
}

function getModelPerformance(modelPerformanceMap, modelName) {
  return (
    modelPerformanceMap?.[modelName] || {
      total: 0,
      wins: 0,
      accuracy: 0.5,
      smoothedAccuracy: 0.5,
      longSmoothedAccuracy: 0.5,
      shortSmoothedAccuracy: 0.5
    }
  );
}

function summarizeResolvedWindow(rows, windowSize) {
  const sample = Array.isArray(rows) ? rows.slice(0, windowSize) : [];
  const wins = sample.filter((row) => row.status === "WIN").length;
  const losses = sample.filter((row) => row.status === "LOSS").length;
  const sampleSize = sample.length;

  return {
    windowSize,
    sampleSize,
    wins,
    losses,
    winRate: sampleSize > 0 ? round((wins / sampleSize) * 100, 2) : null
  };
}

function getCurrentStatusStreak(recentRowsDesc) {
  const rows = Array.isArray(recentRowsDesc) ? recentRowsDesc : [];
  const latest = rows[0]?.status;

  if (latest !== "WIN" && latest !== "LOSS") {
    return {
      type: null,
      length: 0
    };
  }

  let length = 0;
  for (const row of rows) {
    if (row.status === latest) {
      length += 1;
    } else {
      break;
    }
  }

  return {
    type: latest,
    length
  };
}

function buildRecentPerformanceSummary(database, modelLeaderboard) {
  const ensembleOutcomes = database.getRecentModelOutcomes?.("ensemble", 80) || [];
  const fallbackRows = database.getRecentResolved(80);
  const recentRows = ensembleOutcomes.length > 0 ? ensembleOutcomes : fallbackRows;
  const ensembleRow = (modelLeaderboard || []).find((item) => item.modelName === "ensemble");

  return {
    source: ensembleOutcomes.length > 0 ? "ensemble_model" : "session_status",
    last10: summarizeResolvedWindow(recentRows, 10),
    last30: summarizeResolvedWindow(recentRows, 30),
    last50: summarizeResolvedWindow(recentRows, 50),
    currentStreak: getCurrentStatusStreak(recentRows),
    ensemble: ensembleRow
      ? {
          sampleSize: ensembleRow.total || 0,
          wins: ensembleRow.wins || 0,
          losses: (ensembleRow.total || 0) - (ensembleRow.wins || 0),
          accuracy: Number.isFinite(ensembleRow.accuracy) ? ensembleRow.accuracy : null,
          accuracyPercent: Number.isFinite(ensembleRow.accuracy)
            ? round(ensembleRow.accuracy * 100, 2)
            : null
        }
      : null
  };
}

function buildEnsemble(modelSignals, modelPerformanceMap, fallbackSide, recentPerformance) {
  if (!Array.isArray(modelSignals) || modelSignals.length === 0) {
    const side = fallbackSide || "TAI";
    return {
      predictedResult: side,
      confidence: 0.5,
      scoreTai: side === "TAI" ? 1 : 0,
      scoreXiu: side === "XIU" ? 1 : 0,
      supportTai: side === "TAI" ? 1 : 0,
      supportXiu: side === "XIU" ? 1 : 0,
      supportRate: 0.5,
      edge: 0,
      expectedAccuracy: 0.5,
      topModels: [],
      weightedModels: []
    };
  }

  let scoreTai = 0;
  let scoreXiu = 0;
  let supportTai = 0;
  let supportXiu = 0;
  let weightedAccuracySum = 0;
  let totalWeight = 0;

  const weightedModels = modelSignals.map((signal) => {
    const baseWeight = BASE_MODEL_WEIGHTS[signal.modelName] || 1;
    const performance = getModelPerformance(modelPerformanceMap, signal.modelName);

    const reliability = Number.isFinite(performance.smoothedAccuracy)
      ? performance.smoothedAccuracy
      : 0.5;

    const longAccuracy = Number.isFinite(performance.longSmoothedAccuracy)
      ? performance.longSmoothedAccuracy
      : reliability;

    const shortAccuracy = Number.isFinite(performance.shortSmoothedAccuracy)
      ? performance.shortSmoothedAccuracy
      : reliability;

    const driftPenalty = clamp(1 - Math.max(0, longAccuracy - shortAccuracy) * 0.6, 0.76, 1.04);
    const sampleFactor = clamp(0.82 + Math.min(performance.total, 180) / 360, 0.82, 1.32);
    const accuracyFactor = clamp(0.74 + reliability * 0.92, 0.72, 1.38);

    const effectiveWeight = baseWeight * sampleFactor * accuracyFactor * driftPenalty;
    const calibratedConfidence = clamp(
      signal.confidence * (0.9 + (shortAccuracy - 0.5) * 0.8),
      0.5,
      0.95
    );
    const weightedScore = effectiveWeight * calibratedConfidence;

    if (signal.predictedResult === "TAI") {
      supportTai += 1;
      scoreTai += weightedScore;
    } else {
      supportXiu += 1;
      scoreXiu += weightedScore;
    }

    totalWeight += effectiveWeight;
    weightedAccuracySum += reliability * effectiveWeight;

    return {
      modelName: signal.modelName,
      predictedResult: signal.predictedResult,
      confidence: signal.confidence,
      calibratedConfidence: round(calibratedConfidence, 4),
      effectiveWeight: round(effectiveWeight, 4),
      historicalAccuracy: round(reliability, 4),
      shortAccuracy: round(shortAccuracy, 4),
      sampleSize: performance.total,
      score: round(weightedScore, 4),
      reason: signal.reason
    };
  });

  const predictedResult = scoreTai >= scoreXiu ? "TAI" : "XIU";
  const totalScore = scoreTai + scoreXiu;
  const edge = totalScore > 0 ? Math.abs(scoreTai - scoreXiu) / totalScore : 0;
  const supportForWinner = predictedResult === "TAI" ? supportTai : supportXiu;
  const supportRate = modelSignals.length > 0 ? supportForWinner / modelSignals.length : 0.5;
  const expectedAccuracy = totalWeight > 0 ? weightedAccuracySum / totalWeight : 0.5;

  const recentWinRate10 = recentPerformance?.last10?.winRate;
  const recentWinRate30 = recentPerformance?.last30?.winRate;
  const recentLossStreak =
    recentPerformance?.currentStreak?.type === "LOSS"
      ? recentPerformance.currentStreak.length || 0
      : 0;
  const recentFactor = Number.isFinite(recentWinRate10)
    ? clamp(0.88 + ((recentWinRate10 - 50) / 100) * 0.8, 0.75, 1.2)
    : 1;

  const voteGap = Math.abs(supportTai - supportXiu) / Math.max(1, modelSignals.length);
  const sortedScores = weightedModels.map((item) => item.score || 0).sort((a, b) => b - a);
  const topScore = sortedScores[0] || 0;
  const secondScore = sortedScores[1] || 0;
  const topMargin = topScore > 0 ? (topScore - secondScore) / topScore : 0;

  let confidence =
    0.49 + edge * 0.34 + (supportRate - 0.5) * 0.24 + (expectedAccuracy - 0.5) * 0.45;

  confidence *= recentFactor;

  if (modelSignals.length < 6) {
    confidence -= 0.03;
  }

  if (edge < 0.05) {
    confidence -= 0.035;
  }

  if (edge < 0.03) {
    confidence -= 0.02;
  }

  if (supportRate < 0.58) {
    confidence -= (0.58 - supportRate) * 0.35;
  }

  if (topMargin < 0.08) {
    confidence -= 0.018;
  }

  if (topMargin < 0.05) {
    confidence -= 0.012;
  }

  if (recentLossStreak >= 2) {
    confidence -= Math.min(0.05, recentLossStreak * 0.012);
  }

  if (Number.isFinite(recentWinRate10) && recentWinRate10 < 50) {
    confidence -= clamp(((50 - recentWinRate10) / 100) * 0.18, 0, 0.07);
  }

  if (Number.isFinite(recentWinRate10) && recentWinRate10 >= 58) {
    confidence += clamp(((recentWinRate10 - 58) / 100) * 0.12, 0, 0.03);
  }

  if (
    Number.isFinite(recentWinRate30) &&
    Number.isFinite(recentWinRate10) &&
    recentWinRate30 < 52 &&
    recentWinRate10 < 55
  ) {
    confidence -= 0.015;
  }

  if (voteGap < 0.2) {
    confidence -= (0.2 - voteGap) * 0.12;
  }

  confidence = clamp(confidence, 0.5, 0.92);

  const topModels = [...weightedModels]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6);

  return {
    predictedResult,
    confidence,
    scoreTai: round(scoreTai, 4),
    scoreXiu: round(scoreXiu, 4),
    supportTai,
    supportXiu,
    supportRate: round(supportRate, 4),
    edge: round(edge, 4),
    expectedAccuracy: round(expectedAccuracy, 4),
    recentFactor: round(recentFactor, 4),
    voteGap: round(voteGap, 4),
    topMargin: round(topMargin, 4),
    topModels,
    weightedModels
  };
}

function readAdviceConfig(config) {
  return {
    minConfidencePercent: Number.isFinite(config?.betAdviceMinConfidence)
      ? config.betAdviceMinConfidence
      : 57,
    minWinRate10: Number.isFinite(config?.betAdviceMinWinRate10)
      ? config.betAdviceMinWinRate10
      : 55,
    minWinRate30: Number.isFinite(config?.betAdviceMinWinRate30)
      ? config.betAdviceMinWinRate30
      : 56,
    minEnsembleAccuracy: Number.isFinite(config?.betAdviceMinEnsembleAccuracy)
      ? config.betAdviceMinEnsembleAccuracy
      : 60,
    minSignalScore: Number.isFinite(config?.betAdviceMinSignalScore)
      ? config.betAdviceMinSignalScore
      : 54,
    strongSignalScore: Number.isFinite(config?.betAdviceStrongSignalScore)
      ? config.betAdviceStrongSignalScore
      : 72,
    maxBankrollPercent: Number.isFinite(config?.betAdviceMaxBankrollPercent)
      ? config.betAdviceMaxBankrollPercent
      : 8
  };
}

function formatStakeRange(stakePercent) {
  if (!Number.isFinite(stakePercent) || stakePercent <= 0) {
    return "0%";
  }

  const minStake = Math.max(0.5, stakePercent * 0.7);
  return `${round(minStake, 2)}% - ${round(stakePercent, 2)}%`;
}

function calculateAdaptiveStakePercent({
  confidencePercent,
  strength,
  maxBankrollPercent
}) {
  if (!Number.isFinite(confidencePercent) || confidencePercent < 60 || strength === "KHONG_CUOC") {
    return 0;
  }

  // Increase sizing for high-confidence signals so profit targets are not too slow.
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

  if (strength === "MANH") {
    stakePercent += 0.8;
  } else if (strength === "NHE") {
    stakePercent -= 0.5;
  }

  const confidenceBoost = Math.max(0, (confidencePercent - 70) * 0.08);
  stakePercent += confidenceBoost;

  const effectiveMax = Math.max(maxBankrollPercent || 0, confidencePercent >= 70 ? 6 : 0);

  return clamp(stakePercent, 1, effectiveMax > 0 ? effectiveMax : 8);
}

function buildBettingAdvice({
  ensemble,
  referenceRecord,
  recentPerformance,
  modelSignals,
  config
}) {
  const adviceConfig = readAdviceConfig(config);
  const confidencePercent = round((ensemble.confidence || 0.5) * 100, 2) || 50;
  const edgePercent = round((ensemble.edge || 0) * 100, 2) || 0;
  const consensusPercent = round((ensemble.supportRate || 0.5) * 100, 2) || 50;

  const winRate10 = recentPerformance?.last10?.winRate;
  const winRate30 = recentPerformance?.last30?.winRate;
  const ensembleAccuracy = recentPerformance?.ensemble?.accuracyPercent;
  const ensembleSample = recentPerformance?.ensemble?.sampleSize || 0;
  const winRate30Sample = recentPerformance?.last30?.sampleSize || 0;
  const lowWinRate30 = Number.isFinite(winRate30) && winRate30Sample >= 20 && winRate30 < adviceConfig.minWinRate30;
  const lowEnsembleAcc = Number.isFinite(ensembleAccuracy) && ensembleSample >= 25 && ensembleAccuracy < adviceConfig.minEnsembleAccuracy;
  const streakType = recentPerformance?.currentStreak?.type || null;
  const streakLength = recentPerformance?.currentStreak?.length || 0;

  let imbalancePercent = null;
  let dominantMoneySide = null;

  if (
    Number.isFinite(referenceRecord?.betTai) &&
    Number.isFinite(referenceRecord?.betXiu) &&
    Number.isFinite(referenceRecord?.betTotal) &&
    referenceRecord.betTotal > 0
  ) {
    const diff = referenceRecord.betTai - referenceRecord.betXiu;
    imbalancePercent = round((Math.abs(diff) / referenceRecord.betTotal) * 100, 2);
    dominantMoneySide = diff >= 0 ? "TAI" : "XIU";
  }

  let signalScore = 28;
  signalScore += (confidencePercent - 50) * 1.55;
  signalScore += edgePercent * 0.52;
  signalScore += (consensusPercent - 50) * 0.9;
  signalScore += Math.max(0, modelSignals.length - 6) * 1.2;

  if (Number.isFinite(winRate10)) {
    signalScore += (winRate10 - 50) * 0.72;
  }

  if (Number.isFinite(winRate30)) {
    signalScore += (winRate30 - 50) * 0.38;
  }

  if (Number.isFinite(ensembleAccuracy)) {
    signalScore += (ensembleAccuracy - 50) * 0.35;
  }

  if (streakType === "LOSS" && streakLength >= 2) {
    signalScore -= Math.min(8, streakLength * 2);
  }

  if (streakType === "WIN" && streakLength >= 2) {
    signalScore += Math.min(4, streakLength);
  }

  if (Number.isFinite(imbalancePercent) && dominantMoneySide) {
    if (imbalancePercent >= 12 && dominantMoneySide === ensemble.predictedResult) {
      signalScore -= 4;
    } else if (imbalancePercent >= 12 && dominantMoneySide !== ensemble.predictedResult) {
      signalScore += 2;
    }
  }

  if (modelSignals.length < 6) {
    signalScore -= 5;
  }

  if (edgePercent < 7) {
    signalScore -= 4;
  }

  if (consensusPercent < 56) {
    signalScore -= 6;
  }

  if (streakType === "LOSS" && streakLength >= 3) {
    signalScore -= Math.min(12, streakLength * 2.5);
  }

  if (lowWinRate30) {
    signalScore -= 6;
  }

  if (lowEnsembleAcc) {
    signalScore -= 7;
  }

  signalScore = clamp(signalScore, 0, 99);

  let strength = "KHONG_CUOC";

  if (
    signalScore >= adviceConfig.strongSignalScore &&
    confidencePercent >= adviceConfig.minConfidencePercent + 5 &&
    consensusPercent >= 60
  ) {
    strength = "MANH";
  } else if (
    signalScore >= Math.max(adviceConfig.minSignalScore + 8, 60) &&
    confidencePercent >= adviceConfig.minConfidencePercent + 2 &&
    consensusPercent >= 56
  ) {
    strength = "VUA";
  } else if (
    signalScore >= adviceConfig.minSignalScore &&
    confidencePercent >= adviceConfig.minConfidencePercent &&
    consensusPercent >= 55
  ) {
    strength = "NHE";
  }

  if (
    confidencePercent < adviceConfig.minConfidencePercent ||
    edgePercent < 6.5 ||
    (Number.isFinite(winRate10) && winRate10 < adviceConfig.minWinRate10) ||
    consensusPercent < 56 ||
    lowWinRate30 ||
    lowEnsembleAcc ||
    (streakType === "LOSS" && streakLength >= 3)
  ) {
    strength = "KHONG_CUOC";
  }

  const bankrollPercent = calculateAdaptiveStakePercent({
    confidencePercent,
    strength,
    maxBankrollPercent: adviceConfig.maxBankrollPercent
  });

  const shouldBet = strength !== "KHONG_CUOC";
  const reasons = [
    `Confidence tong hop ${confidencePercent}% va do lech phieu ${edgePercent}%.`,
    `Do dong thuan model: ${consensusPercent}% (${ensemble.supportTai}/${ensemble.supportXiu}).`
  ];

  if (Number.isFinite(winRate10)) {
    reasons.push(`Win rate 10 phien gan nhat: ${winRate10}% (${recentPerformance.source}).`);
  }

  if (Number.isFinite(winRate30)) {
    reasons.push(`Win rate 30 phien gan nhat: ${winRate30}%.`);
  }

  if (Number.isFinite(ensembleAccuracy)) {
    const sampleSize = recentPerformance?.ensemble?.sampleSize || 0;
    reasons.push(`Do chinh xac ensemble: ${ensembleAccuracy}% tren ${sampleSize} mau.`);
  }

  if (Number.isFinite(imbalancePercent) && dominantMoneySide) {
    reasons.push(
      `Dong tien lech ${imbalancePercent}% nghieng ${sideToDisplay(dominantMoneySide)}.`
    );
  }

  const warnings = [];

  if (confidencePercent < adviceConfig.minConfidencePercent + 2) {
    warnings.push(
      `Confidence thap hon nguong an toan (${adviceConfig.minConfidencePercent + 2}%).`
    );
  }

  if (Number.isFinite(winRate10) && winRate10 < adviceConfig.minWinRate10 + 2) {
    warnings.push(`Win rate 10 phien chua on dinh (${winRate10}%).`);
  }

  if (edgePercent < 6.5) {
    warnings.push(`Edge thap (${edgePercent}%), de bi nhieu sai so.`);
  }

  if (consensusPercent < 56) {
    warnings.push(`Do dong thuan model thap (${consensusPercent}%).`);
  }
  if (lowWinRate30) {
    warnings.push(`Win rate 30 phien thap (${winRate30}%).`);
  }

  if (lowEnsembleAcc) {
    warnings.push(`Ty le dung ensemble thap (${ensembleAccuracy}%).`);
  }


  if (streakType === "LOSS" && streakLength >= 2) {
    warnings.push(`He thong dang co chuoi thua ${streakLength} phien.`);
  }

  if (
    Number.isFinite(imbalancePercent) &&
    dominantMoneySide &&
    imbalancePercent >= 18 &&
    dominantMoneySide === ensemble.predictedResult
  ) {
    warnings.push("Dong tien va du doan cung chieu, can giam von de tranh bay tam ly.");
  }

  if (!shouldBet) {
    warnings.push("Khuyen nghi doi them du lieu, uu tien bao toan von.");
  }

  return {
    nen_dat: shouldBet,
    khuyen_nghi: shouldBet ? "CO_THE_DAT" : "NEN_DOI",
    cua_goi_y: shouldBet ? sideToDisplay(ensemble.predictedResult) : null,
    muc_do_tin_hieu: strength,
    diem_tin_hieu: round(signalScore, 2),
    ti_le_von_goi_y_percent: round(bankrollPercent, 2),
    ti_le_von_goi_y_text: formatStakeRange(bankrollPercent),
    quy_tac_thanh_toan: {
      thang_nhan_x: 1.98,
      thua_mat_x: 1
    },
    quan_ly_von: shouldBet
      ? "Khong vao lenh qua tay, dung theo muc von goi y."
      : "Bo qua van nay, cho tin hieu manh hon.",
    ly_do: reasons.slice(0, 6),
    canh_bao: warnings.slice(0, 5),
    chi_so: {
      confidence_percent: confidencePercent,
      edge_percent: edgePercent,
      dong_thuan_model_percent: consensusPercent,
      win_rate_10: winRate10,
      win_rate_30: winRate30,
      ensemble_accuracy_percent: ensembleAccuracy,
      so_model_tham_gia: modelSignals.length
    },
    nguong_su_dung: {
      min_confidence_percent: adviceConfig.minConfidencePercent,
      min_win_rate_10: adviceConfig.minWinRate10,
      min_win_rate_30: adviceConfig.minWinRate30,
      min_ensemble_accuracy: adviceConfig.minEnsembleAccuracy,
      min_signal_score: adviceConfig.minSignalScore,
      strong_signal_score: adviceConfig.strongSignalScore
    }
  };
}

function toPreviousSessionId(sessionId) {
  const value = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(value) || value <= 1) {
    return null;
  }

  return String(value - 1);
}

function buildFinalPredictionByEnsemble({
  referenceRecord,
  ensemble,
  modelSignals,
  dice,
  total,
  bettingAdvice
}) {
  return {
    phien: String(referenceRecord.sessionId),
    ket_qua: sideToDisplay(ensemble.predictedResult),
    confidence_percent: round(ensemble.confidence * 100, 2),
    xuc_xac_1: dice[0],
    xuc_xac_2: dice[1],
    xuc_xac_3: dice[2],
    tong: total,
    phuong_phap: "ENSEMBLE_WEIGHTED_VOTE",
    model_tham_gia: modelSignals.length,
    model_ung_ho: {
      tai: ensemble.supportTai,
      xiu: ensemble.supportXiu
    },
    score: {
      tai: ensemble.scoreTai,
      xiu: ensemble.scoreXiu
    },
    edge_percent: round((ensemble.edge || 0) * 100, 2),
    dong_thuan_model_percent: round((ensemble.supportRate || 0.5) * 100, 2),
    top_models: ensemble.topModels,
    goi_y_dat_cuoc: {
      nen_dat: bettingAdvice.nen_dat,
      muc_do_tin_hieu: bettingAdvice.muc_do_tin_hieu,
      ti_le_von_goi_y_percent: bettingAdvice.ti_le_von_goi_y_percent
    }
  };
}

function formatCauPattern(patternMatch) {
  if (!patternMatch) {
    return null;
  }

  return {
    pattern: patternMatch.pattern,
    length: patternMatch.length,
    du_doan: sideToDisplay(patternMatch.predictedResult),
    confidence_percent: round(patternMatch.confidence * 100, 2),
    mau: patternMatch.sampleSize,
    tan_suat: {
      tai: patternMatch.tai,
      xiu: patternMatch.xiu
    },
    ti_le_ung_ho_percent: round(patternMatch.supportRate * 100, 2)
  };
}
function toToolFormat({
  referenceRecord,
  ensemble,
  modelSignals,
  dice,
  total,
  finalPrediction,
  bettingAdvice,
  recentPerformance,
  patternMatch
}) {
  const side = ensemble.predictedResult;
  const bettingInfo = referenceRecord.rawPayload?.betting_info || {};

  const sourceSessionFromApi = referenceRecord.sourceSessionId
    ? String(referenceRecord.sourceSessionId)
    : null;

  const sourceSessionId =
    sourceSessionFromApi && sourceSessionFromApi !== String(referenceRecord.sessionId)
      ? sourceSessionFromApi
      : toPreviousSessionId(referenceRecord.sessionId);

  return {
    phien: String(referenceRecord.sessionId),
    phien_tiep_theo: String(referenceRecord.sessionId),
    phien_hien_tai: sourceSessionId,
    ket_qua: sideToDisplay(side),
    xuc_xac_1: dice[0],
    xuc_xac_2: dice[1],
    xuc_xac_3: dice[2],
    tong: total,
    md5_raw: referenceRecord.md5Raw || null,
    betting_info: {
      phien_cuoc: bettingInfo.phien_cuoc ?? Number(referenceRecord.sessionId),
      tick: bettingInfo.tick ?? referenceRecord.tick ?? null,
      sub_tick: bettingInfo.sub_tick ?? referenceRecord.subTick ?? null,
      trang_thai: bettingInfo.trang_thai || referenceRecord.bettingStatus || "BETTING",
      tong_nguoi_cuoc: bettingInfo.tong_nguoi_cuoc ?? referenceRecord.bettorsTotal ?? null,
      tong_tien_cuoc:
        bettingInfo.tong_tien_cuoc || formatMoney(referenceRecord.betTotal) || null,
      nguoi_cuoc: {
        tai: bettingInfo.nguoi_cuoc?.tai ?? referenceRecord.bettorsTai ?? null,
        xiu: bettingInfo.nguoi_cuoc?.xiu ?? referenceRecord.bettorsXiu ?? null
      },
      tien_cuoc: {
        tai: bettingInfo.tien_cuoc?.tai || formatMoney(referenceRecord.betTai) || null,
        xiu: bettingInfo.tien_cuoc?.xiu || formatMoney(referenceRecord.betXiu) || null
      }
    },
    confidence_percent: round(ensemble.confidence * 100, 2),
    source: {
      phien: sourceSessionFromApi,
      ket_qua_tham_khao: sideToDisplay(referenceRecord.predictedResult),
      tong_tham_khao: referenceRecord.sourceTotal,
      md5_raw: referenceRecord.md5Raw,
      update_at: referenceRecord.updateAt,
      tick_update_at: referenceRecord.tickUpdateAt
    },
    cau_pattern: formatCauPattern(patternMatch),
    models: modelSignals.map((item) => ({
      ten: item.modelName,
      du_doan: sideToDisplay(item.predictedResult),
      confidence_percent: round(item.confidence * 100, 2),
      ly_do: item.reason
    })),
    ensemble_detail: {
      score_tai: ensemble.scoreTai,
      score_xiu: ensemble.scoreXiu,
      support_tai: ensemble.supportTai,
      support_xiu: ensemble.supportXiu,
      edge_percent: round((ensemble.edge || 0) * 100, 2),
      dong_thuan_model_percent: round((ensemble.supportRate || 0.5) * 100, 2),
      expected_accuracy_percent: round((ensemble.expectedAccuracy || 0.5) * 100, 2),
      top_models: ensemble.topModels
    },
    hieu_suat_gan_day: recentPerformance,
    goi_y_dat_cuoc: bettingAdvice,
    trang_thai_du_doan: "TONG_HOP_THUAT_TOAN",
    du_doan_cuoi_cung: finalPrediction
  };
}

export class PredictorEngine {
  constructor({ config, database }) {
    this.config = config;
    this.database = database;
    this.patternStore = loadCauPatternStore(config.patternDataPath);
  }

  buildPrediction(referenceRecord) {
    if (!referenceRecord?.sessionId) {
      return null;
    }

    const history = this.database.getActualHistory(this.config.predictorHistorySize);

    const modelLeaderboard = this.database.getModelLeaderboard(this.config.predictorModelEvalWindow);
    const shortEvalWindow = Math.max(
      30,
      Math.min(80, Math.floor(this.config.predictorModelEvalWindow / 5))
    );
    const shortLeaderboard = this.database.getModelLeaderboard(shortEvalWindow);

    const modelPerformanceMap = combinePerformanceMaps(
      buildPerformanceMap(modelLeaderboard),
      buildPerformanceMap(shortLeaderboard)
    );

    const recentPerformance = buildRecentPerformanceSummary(this.database, modelLeaderboard);
    const patternMatch = findCauPatternMatch(history, this.patternStore);
    const modelSignals = runModelSuite({
      referenceRecord,
      history,
      recentPerformance,
      patternMatch
    });

    // calibration: use historical stats to adjust confidence
    const stats = this.database.getPredictionStats ? this.database.getPredictionStats() : null;
    const calibMap = buildCalibrationMap(stats);

    const latestHistorySide = history[history.length - 1]?.actualResult || null;
    const fallbackSide = referenceRecord.predictedResult || latestHistorySide || "TAI";

    let ensemble = buildEnsemble(modelSignals, modelPerformanceMap, fallbackSide, recentPerformance);
    if (ensemble && typeof ensemble.confidence === "number") {
      const rawPercent = round(ensemble.confidence * 100, 2);
      const adjPercent = calibrateConfidence(rawPercent, calibMap);
      ensemble.confidence = clamp(adjPercent / 100, 0, 1);
    }

    const dice = buildPredictedDice({
      sessionId: referenceRecord.sessionId,
      side: ensemble.predictedResult
    });

    const total = dice[0] + dice[1] + dice[2];

    const bettingAdvice = buildBettingAdvice({
      ensemble,
      referenceRecord,
      recentPerformance,
      modelSignals,
      config: this.config
    });

    const finalPrediction = buildFinalPredictionByEnsemble({
      referenceRecord,
      ensemble,
      modelSignals,
      dice,
      total,
      bettingAdvice
    });

    const prediction = toToolFormat({
      referenceRecord,
      ensemble,
      modelSignals,
      dice,
      total,
      finalPrediction,
      bettingAdvice,
      recentPerformance,
      patternMatch
    });

    const modelRowsForStorage = [
      ...modelSignals.map((signal) => ({
        modelName: signal.modelName,
        predictedResult: signal.predictedResult,
        confidence: signal.confidence,
        score: signal.confidence,
        reason: signal.reason
      })),
      {
        modelName: "ensemble",
        predictedResult: ensemble.predictedResult,
        confidence: ensemble.confidence,
        score: Math.max(ensemble.scoreTai || 0, ensemble.scoreXiu || 0),
        reason: "Tong hop trong so tu cac model va hieu suat gan day."
      }
    ];

    this.database.upsertModelPredictions(referenceRecord.sessionId, modelRowsForStorage);

    return {
      generatedAt: new Date().toISOString(),
      sessionId: referenceRecord.sessionId,
      ensemble,
      modelSignals,
      finalPrediction,
      bettingAdvice,
      recentPerformance,
      patternMatch,
      predictionStatus: "TONG_HOP_THUAT_TOAN",
      prediction
    };
  }

  buildCurrentPrediction() {
    const referenceRecord = this.database.getLatestReferenceRecord();
    if (!referenceRecord) {
      return null;
    }

    return this.buildPrediction(referenceRecord);
  }
}









































































