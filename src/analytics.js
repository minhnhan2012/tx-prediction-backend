function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function percentage(part, total) {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return round((part / total) * 100, 2);
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function pearsonCorrelation(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) {
    return null;
  }

  const xMean = avg(xs);
  const yMean = avg(ys);

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let index = 0; index < xs.length; index += 1) {
    const xDiff = xs[index] - xMean;
    const yDiff = ys[index] - yMean;

    numerator += xDiff * yDiff;
    xVariance += xDiff * xDiff;
    yVariance += yDiff * yDiff;
  }

  if (xVariance === 0 || yVariance === 0) {
    return null;
  }

  return numerator / Math.sqrt(xVariance * yVariance);
}

export function calculateWindowStats(resolvedRows, windows) {
  const safeRows = Array.isArray(resolvedRows) ? resolvedRows : [];
  const safeWindows = Array.isArray(windows) ? windows : [];

  return safeWindows.map((windowSize) => {
    const sample = safeRows.slice(0, windowSize);
    const wins = sample.filter((row) => row.status === "WIN").length;
    const losses = sample.filter((row) => row.status === "LOSS").length;
    const total = sample.length;

    return {
      windowSize,
      sampleSize: total,
      wins,
      losses,
      winRate: percentage(wins, total)
    };
  });
}

export function calculateStreaks(statusesAscending) {
  const statuses = Array.isArray(statusesAscending) ? statusesAscending : [];

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentType = null;
  let currentLength = 0;

  for (const status of statuses) {
    if (status !== "WIN" && status !== "LOSS") {
      continue;
    }

    if (status === currentType) {
      currentLength += 1;
    } else {
      currentType = status;
      currentLength = 1;
    }

    if (status === "WIN" && currentLength > longestWinStreak) {
      longestWinStreak = currentLength;
    }

    if (status === "LOSS" && currentLength > longestLossStreak) {
      longestLossStreak = currentLength;
    }
  }

  const latestStatus = statuses[statuses.length - 1] || null;
  let latestStreakLength = 0;
  if (latestStatus === "WIN" || latestStatus === "LOSS") {
    for (let index = statuses.length - 1; index >= 0; index -= 1) {
      if (statuses[index] === latestStatus) {
        latestStreakLength += 1;
      } else {
        break;
      }
    }
  }

  return {
    longestWinStreak,
    longestLossStreak,
    currentStreak: {
      type: latestStatus,
      length: latestStreakLength
    }
  };
}

export function calculateBettingImpact(rows) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const betTai = Number.isFinite(row.bet_tai) ? row.bet_tai : 0;
      const betXiu = Number.isFinite(row.bet_xiu) ? row.bet_xiu : 0;
      const betTotal = Number.isFinite(row.bet_total) ? row.bet_total : betTai + betXiu;

      if (!Number.isFinite(betTotal) || betTotal < 0) {
        return null;
      }

      const dominantSide =
        betTai > betXiu ? "TAI" : betXiu > betTai ? "XIU" : "BALANCED";

      return {
        status: row.status,
        actualResult: row.actual_result,
        betTai,
        betXiu,
        betTotal,
        dominantSide,
        winValue: row.status === "WIN" ? 1 : 0,
        imbalanceRatio: betTotal > 0 ? (betTai - betXiu) / betTotal : 0
      };
    })
    .filter(Boolean);

  const totalSample = normalizedRows.length;
  if (totalSample === 0) {
    return {
      sampleSize: 0,
      averageTotalBet: null,
      averageTotalBetWhenWin: null,
      averageTotalBetWhenLoss: null,
      winRateWhenTaiMoneyHigher: null,
      winRateWhenXiuMoneyHigher: null,
      dominantMoneyMatchedActualRate: null,
      imbalanceVsWinCorrelation: null
    };
  }

  const winRows = normalizedRows.filter((row) => row.status === "WIN");
  const lossRows = normalizedRows.filter((row) => row.status === "LOSS");
  const taiHigherRows = normalizedRows.filter((row) => row.dominantSide === "TAI");
  const xiuHigherRows = normalizedRows.filter((row) => row.dominantSide === "XIU");
  const dominantRows = normalizedRows.filter((row) => row.dominantSide !== "BALANCED");

  const dominantMatchedCount = dominantRows.filter(
    (row) => row.dominantSide === row.actualResult
  ).length;

  return {
    sampleSize: totalSample,
    averageTotalBet: round(avg(normalizedRows.map((row) => row.betTotal)), 2),
    averageTotalBetWhenWin: round(avg(winRows.map((row) => row.betTotal)), 2),
    averageTotalBetWhenLoss: round(avg(lossRows.map((row) => row.betTotal)), 2),
    winRateWhenTaiMoneyHigher: percentage(
      taiHigherRows.filter((row) => row.status === "WIN").length,
      taiHigherRows.length
    ),
    winRateWhenXiuMoneyHigher: percentage(
      xiuHigherRows.filter((row) => row.status === "WIN").length,
      xiuHigherRows.length
    ),
    dominantMoneyMatchedActualRate: percentage(dominantMatchedCount, dominantRows.length),
    imbalanceVsWinCorrelation: round(
      pearsonCorrelation(
        normalizedRows.map((row) => row.imbalanceRatio),
        normalizedRows.map((row) => row.winValue)
      ),
      4
    )
  };
}

export function withGlobalWinRate(summary) {
  const safe = summary || {};
  const wins = Number.isFinite(safe.wins) ? safe.wins : 0;
  const resolvedSessions = Number.isFinite(safe.resolvedSessions)
    ? safe.resolvedSessions
    : 0;

  return {
    ...safe,
    winRate: percentage(wins, resolvedSessions)
  };
}
