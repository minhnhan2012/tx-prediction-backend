function stripVietnameseAccents(input) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getByPath(source, path) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const parts = path.split(".");
  let current = source;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    current = current[part];
  }

  return current;
}

function pickFirst(source, paths) {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeNumericString(raw) {
  let cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";

    if (decimalSeparator === ",") {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }

    return cleaned;
  }

  if (dotCount > 1) {
    return cleaned.replace(/\./g, "");
  }

  if (commaCount > 1) {
    return cleaned.replace(/,/g, "");
  }

  if (commaCount === 1 && dotCount === 0) {
    const [left, right] = cleaned.split(",");
    if (right.length === 3 && left.length >= 1) {
      return `${left}${right}`;
    }
    return `${left}.${right}`;
  }

  if (dotCount === 1 && commaCount === 0) {
    const [left, right] = cleaned.split(".");
    if (right.length === 3 && left.length >= 1) {
      return `${left}${right}`;
    }
    return cleaned;
  }

  return cleaned;
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeNumericString(trimmed);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed);
}

function toSessionId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeSide(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = stripVietnameseAccents(String(value))
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  if (!normalized) {
    return null;
  }

  if (normalized.includes("TAI") || normalized === "T" || normalized === "OVER") {
    return "TAI";
  }

  if (normalized.includes("XIU") || normalized === "X" || normalized === "UNDER") {
    return "XIU";
  }

  return null;
}

export function sideToDisplay(value) {
  const side = normalizeSide(value);
  if (side === "TAI") {
    return "T\u00e0i";
  }

  if (side === "XIU") {
    return "X\u1ec9u";
  }

  return null;
}

function unwrapPredictionPayload(payload) {
  if (Array.isArray(payload) && payload.length > 0) {
    return payload[0];
  }

  if (payload && typeof payload === "object") {
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      const data = payload.data;
      if (
        data.phien !== undefined ||
        data.ket_qua !== undefined ||
        data.dem_nguoc !== undefined ||
        data.betting_info !== undefined
      ) {
        return data;
      }
    }

    if (payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)) {
      return payload.result;
    }
  }

  return payload;
}

function parsePredictionDice(source) {
  const x1 = toInteger(pickFirst(source, ["xuc_xac_1", "x1", "dice_1"]));
  const x2 = toInteger(pickFirst(source, ["xuc_xac_2", "x2", "dice_2"]));
  const x3 = toInteger(pickFirst(source, ["xuc_xac_3", "x3", "dice_3"]));

  if (!Number.isInteger(x1) || !Number.isInteger(x2) || !Number.isInteger(x3)) {
    return null;
  }

  return [x1, x2, x3];
}

export function extractPredictionRecord(payload) {
  const source = unwrapPredictionPayload(payload);
  if (!source || typeof source !== "object") {
    return null;
  }

  const sessionId = toSessionId(
    pickFirst(source, [
      "betting_info.phien_cuoc",
      "phien_cuoc",
      "phien",
      "session_id",
      "sessionId",
      "id",
      "session"
    ])
  );

  if (!sessionId) {
    return null;
  }

  const predictedResult = normalizeSide(
    pickFirst(source, ["ket_qua", "prediction", "predict", "result", "du_doan"])
  );

  const countdown = toInteger(
    pickFirst(source, [
      "betting_info.dem_nguoc",
      "dem_nguoc",
      "countdown",
      "time_left",
      "remaining_seconds"
    ])
  );

  const betTai = toNumber(
    pickFirst(source, [
      "betting_info.tien_cuoc.tai",
      "betting_info.tong_tien_cuoc.tai",
      "betting_info.total_bet.tai",
      "bettingInfo.totalBet.tai",
      "tong_tien_tai",
      "tai_amount",
      "tai_money"
    ])
  );

  const betXiu = toNumber(
    pickFirst(source, [
      "betting_info.tien_cuoc.xiu",
      "betting_info.tong_tien_cuoc.xiu",
      "betting_info.total_bet.xiu",
      "bettingInfo.totalBet.xiu",
      "tong_tien_xiu",
      "xiu_amount",
      "xiu_money"
    ])
  );

  let betTotal = toNumber(
    pickFirst(source, [
      "betting_info.tong_tien_cuoc",
      "betting_info.tong_tien_cuoc.tong",
      "betting_info.total_bet.total",
      "bettingInfo.totalBet.total",
      "tong_tien_cuoc",
      "total_bet"
    ])
  );

  if (!Number.isFinite(betTotal) && (Number.isFinite(betTai) || Number.isFinite(betXiu))) {
    betTotal = (betTai || 0) + (betXiu || 0);
  }

  const bettorsTai = toInteger(
    pickFirst(source, [
      "betting_info.nguoi_cuoc.tai",
      "betting_info.so_nguoi_cuoc.tai",
      "betting_info.bettors.tai",
      "bettingInfo.bettors.tai",
      "nguoi_cuoc_tai"
    ])
  );

  const bettorsXiu = toInteger(
    pickFirst(source, [
      "betting_info.nguoi_cuoc.xiu",
      "betting_info.so_nguoi_cuoc.xiu",
      "betting_info.bettors.xiu",
      "bettingInfo.bettors.xiu",
      "nguoi_cuoc_xiu"
    ])
  );

  let bettorsTotal = toInteger(
    pickFirst(source, [
      "betting_info.tong_nguoi_cuoc",
      "betting_info.so_nguoi_cuoc.tong",
      "betting_info.bettors.total",
      "bettingInfo.bettors.total",
      "tong_nguoi_cuoc"
    ])
  );

  if (!Number.isFinite(bettorsTotal) && (Number.isFinite(bettorsTai) || Number.isFinite(bettorsXiu))) {
    bettorsTotal = (bettorsTai || 0) + (bettorsXiu || 0);
  }

  const sourceSessionId = toSessionId(pickFirst(source, ["phien", "session"])) || sessionId;
  const md5Raw = pickFirst(source, ["md5_raw", "md5Raw"]);
  const sourceDices = parsePredictionDice(source);
  const sourceTotal = toInteger(pickFirst(source, ["tong", "point", "total"]));

  return {
    sessionId,
    sourceSessionId,
    predictedResult,
    countdown,
    betTai,
    betXiu,
    betTotal,
    bettorsTai,
    bettorsXiu,
    bettorsTotal,
    tick: toInteger(pickFirst(source, ["betting_info.tick", "tick"])),
    subTick: toInteger(pickFirst(source, ["betting_info.sub_tick", "sub_tick"])),
    bettingStatus: pickFirst(source, ["betting_info.trang_thai", "trang_thai"]),
    md5Raw: md5Raw ? String(md5Raw) : null,
    sourceDices,
    sourceTotal,
    updateAt: pickFirst(source, ["update_at", "updated_at"]),
    tickUpdateAt: pickFirst(source, ["tick_update_at"]),
    rawPayload: source
  };
}

function parseDices(rawDices) {
  if (Array.isArray(rawDices)) {
    const dices = rawDices
      .map((value) => toInteger(value))
      .filter((value) => Number.isInteger(value));

    return dices.length > 0 ? dices : null;
  }

  if (typeof rawDices === "string") {
    const dices = rawDices
      .split(/[^\d-]+/)
      .map((token) => Number.parseInt(token, 10))
      .filter((value) => Number.isInteger(value));

    return dices.length > 0 ? dices : null;
  }

  return null;
}

function resolveResultsList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidates = [
    payload.list,
    payload.data?.list,
    payload.result?.list,
    payload.sessions,
    payload.data,
    payload.result
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function extractResultRecords(payload) {
  const items = resolveResultsList(payload);

  return items
    .map((item) => {
      const sessionId = toSessionId(
        pickFirst(item, ["id", "session_id", "sessionId", "phien", "session"])
      );

      if (!sessionId) {
        return null;
      }

      const actualResult = normalizeSide(
        pickFirst(item, ["resultTruyenThong", "result", "ket_qua", "outcome"])
      );

      const dices = parseDices(pickFirst(item, ["dices", "dice", "xuc_xac"]));
      const point = toInteger(pickFirst(item, ["point", "total", "tong_diem"]));

      return {
        sessionId,
        actualResult,
        dices,
        point,
        rawPayload: item
      };
    })
    .filter(Boolean);
}
