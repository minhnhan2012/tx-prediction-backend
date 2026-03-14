import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractPredictionRecord, sideToDisplay } from "./normalizers.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJson(jsonText) {
  if (!jsonText || typeof jsonText !== "string") {
    return null;
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function toIsoOrNull(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized ? normalized : null;
}

function toSafeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function mapReferencePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const bettingInfo = payload.betting_info && typeof payload.betting_info === "object"
    ? payload.betting_info
    : {};

  return {
    phien: toSafeString(payload.phien),
    ket_qua: sideToDisplay(payload.ket_qua) || toSafeString(payload.ket_qua),
    xuc_xac_1: Number.isFinite(payload.xuc_xac_1) ? payload.xuc_xac_1 : null,
    xuc_xac_2: Number.isFinite(payload.xuc_xac_2) ? payload.xuc_xac_2 : null,
    xuc_xac_3: Number.isFinite(payload.xuc_xac_3) ? payload.xuc_xac_3 : null,
    tong: Number.isFinite(payload.tong) ? payload.tong : null,
    md5_raw: toSafeString(payload.md5_raw),
    betting_info: {
      phien_cuoc: bettingInfo.phien_cuoc ?? null,
      tick: bettingInfo.tick ?? null,
      sub_tick: bettingInfo.sub_tick ?? null,
      trang_thai: toSafeString(bettingInfo.trang_thai),
      tong_nguoi_cuoc: bettingInfo.tong_nguoi_cuoc ?? null,
      tong_tien_cuoc: toSafeString(bettingInfo.tong_tien_cuoc),
      nguoi_cuoc: {
        tai: bettingInfo.nguoi_cuoc?.tai ?? null,
        xiu: bettingInfo.nguoi_cuoc?.xiu ?? null
      },
      tien_cuoc: {
        tai: toSafeString(bettingInfo.tien_cuoc?.tai),
        xiu: toSafeString(bettingInfo.tien_cuoc?.xiu)
      }
    },
    update_at: toIsoOrNull(payload.update_at),
    tick_update_at: toIsoOrNull(payload.tick_update_at)
  };
}

function mapSessionRow(row) {
  const predictionPayload = parseJson(row.prediction_payload);

  return {
    sessionId: row.session_id,
    predictedResult: row.predicted_result,
    actualResult: row.actual_result,
    status: row.status || "PENDING",
    countdown: row.countdown,
    betting: {
      tai: row.bet_tai,
      xiu: row.bet_xiu,
      total: row.bet_total,
      bettorsTai: row.bettors_tai,
      bettorsXiu: row.bettors_xiu,
      bettorsTotal: row.bettors_total
    },
    dices: parseJson(row.dices),
    point: row.point,
    reference: mapReferencePayload(predictionPayload),
    timestamps: {
      firstSeenAt: row.first_seen_at,
      predictionUpdatedAt: row.prediction_updated_at,
      resultUpdatedAt: row.result_updated_at,
      resolvedAt: row.resolved_at
    }
  };
}

export function createDatabase(config) {
  const dbPath = path.resolve(config.databasePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      predicted_result TEXT,
      actual_result TEXT,
      status TEXT,
      countdown INTEGER,
      bet_tai REAL,
      bet_xiu REAL,
      bet_total REAL,
      bettors_tai INTEGER,
      bettors_xiu INTEGER,
      bettors_total INTEGER,
      dices TEXT,
      point INTEGER,
      prediction_payload TEXT,
      result_payload TEXT,
      first_seen_at TEXT NOT NULL,
      prediction_updated_at TEXT,
      result_updated_at TEXT,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_prediction_updated
      ON sessions(prediction_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_resolved
      ON sessions(resolved_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status
      ON sessions(status);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      trigger_session_id TEXT NOT NULL UNIQUE,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_created
      ON alerts(created_at DESC);

    CREATE TABLE IF NOT EXISTS model_predictions (
      session_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      predicted_result TEXT NOT NULL,
      confidence REAL,
      score REAL,
      reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, model_name)
    );

    CREATE INDEX IF NOT EXISTS idx_model_predictions_model
      ON model_predictions(model_name, created_at DESC);
  `);

  const statements = {
    upsertPrediction: db.prepare(`
      INSERT INTO sessions (
        session_id,
        predicted_result,
        countdown,
        bet_tai,
        bet_xiu,
        bet_total,
        bettors_tai,
        bettors_xiu,
        bettors_total,
        prediction_payload,
        first_seen_at,
        prediction_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        predicted_result = COALESCE(excluded.predicted_result, sessions.predicted_result),
        countdown = COALESCE(excluded.countdown, sessions.countdown),
        bet_tai = COALESCE(excluded.bet_tai, sessions.bet_tai),
        bet_xiu = COALESCE(excluded.bet_xiu, sessions.bet_xiu),
        bet_total = COALESCE(excluded.bet_total, sessions.bet_total),
        bettors_tai = COALESCE(excluded.bettors_tai, sessions.bettors_tai),
        bettors_xiu = COALESCE(excluded.bettors_xiu, sessions.bettors_xiu),
        bettors_total = COALESCE(excluded.bettors_total, sessions.bettors_total),
        prediction_payload = COALESCE(excluded.prediction_payload, sessions.prediction_payload),
        prediction_updated_at = excluded.prediction_updated_at
    `),

    upsertResult: db.prepare(`
      INSERT INTO sessions (
        session_id,
        actual_result,
        dices,
        point,
        result_payload,
        first_seen_at,
        result_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        actual_result = COALESCE(excluded.actual_result, sessions.actual_result),
        dices = COALESCE(excluded.dices, sessions.dices),
        point = COALESCE(excluded.point, sessions.point),
        result_payload = COALESCE(excluded.result_payload, sessions.result_payload),
        result_updated_at = excluded.result_updated_at
    `),

    getForResolve: db.prepare(`
      SELECT session_id, predicted_result, actual_result, status
      FROM sessions
      WHERE session_id = ?
    `),

    markResolved: db.prepare(`
      UPDATE sessions
      SET status = ?, resolved_at = COALESCE(resolved_at, ?)
      WHERE session_id = ?
        AND status IS NULL
        AND predicted_result IS NOT NULL
        AND actual_result IS NOT NULL
    `),

    getCurrentSession: db.prepare(`
      SELECT *
      FROM sessions
      WHERE predicted_result IS NOT NULL
      ORDER BY prediction_updated_at DESC
      LIMIT 1
    `),

    getLatestPredictionPayload: db.prepare(`
      SELECT prediction_payload
      FROM sessions
      WHERE prediction_payload IS NOT NULL
      ORDER BY prediction_updated_at DESC
      LIMIT 1
    `),

    getSessionById: db.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = ?
      LIMIT 1
    `),

    // retrieve rows with prediction payload so we can extract confidence
    getAllPredictions: db.prepare(`
      SELECT session_id, predicted_result, actual_result, prediction_payload
      FROM sessions
      WHERE predicted_result IS NOT NULL
    `),

    getSummary: db.prepare(`
      SELECT
        COUNT(*) AS total_tracked,
        SUM(CASE WHEN predicted_result IS NOT NULL THEN 1 ELSE 0 END) AS predicted_sessions,
        SUM(CASE WHEN status IS NOT NULL THEN 1 ELSE 0 END) AS resolved_sessions,
        SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN predicted_result IS NOT NULL AND status IS NULL THEN 1 ELSE 0 END) AS pending
      FROM sessions
    `),

    getRecentResolved: db.prepare(`
      SELECT session_id, status, resolved_at, bet_tai, bet_xiu, bet_total, actual_result
      FROM sessions
      WHERE status IN ('WIN', 'LOSS')
      ORDER BY resolved_at DESC
      LIMIT ?
    `),

    getResolvedStatusesAsc: db.prepare(`
      SELECT status
      FROM sessions
      WHERE status IN ('WIN', 'LOSS')
      ORDER BY resolved_at ASC
    `),

    getBettingSamples: db.prepare(`
      SELECT
        session_id,
        status,
        actual_result,
        bet_tai,
        bet_xiu,
        bet_total
      FROM sessions
      WHERE status IN ('WIN', 'LOSS')
        AND (bet_tai IS NOT NULL OR bet_xiu IS NOT NULL OR bet_total IS NOT NULL)
      ORDER BY resolved_at DESC
      LIMIT ?
    `),

    getActualHistoryDesc: db.prepare(`
      SELECT session_id, actual_result, point, dices, resolved_at
      FROM sessions
      WHERE actual_result IN ('TAI', 'XIU')
      ORDER BY COALESCE(resolved_at, result_updated_at, prediction_updated_at, first_seen_at) DESC
      LIMIT ?
    `),

    listAlerts: db.prepare(`
      SELECT id, type, message, trigger_session_id, payload, created_at
      FROM alerts
      ORDER BY created_at DESC
      LIMIT ?
    `),

    insertAlert: db.prepare(`
      INSERT OR IGNORE INTO alerts (type, message, trigger_session_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),

    upsertModelPrediction: db.prepare(`
      INSERT INTO model_predictions (
        session_id,
        model_name,
        predicted_result,
        confidence,
        score,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, model_name) DO UPDATE SET
        predicted_result = excluded.predicted_result,
        confidence = excluded.confidence,
        score = excluded.score,
        reason = excluded.reason,
        created_at = excluded.created_at
    `),

    getModelPredictionsBySession: db.prepare(`
      SELECT model_name, predicted_result, confidence, score, reason, created_at
      FROM model_predictions
      WHERE session_id = ?
      ORDER BY score DESC, confidence DESC, model_name ASC
    `),

    getModelLeaderboard: db.prepare(`
      WITH recent_resolved AS (
        SELECT session_id, actual_result
        FROM sessions
        WHERE actual_result IN ('TAI', 'XIU')
        ORDER BY COALESCE(resolved_at, result_updated_at, prediction_updated_at, first_seen_at) DESC
        LIMIT ?
      )
      SELECT
        mp.model_name,
        COUNT(*) AS total,
        SUM(CASE WHEN mp.predicted_result = rr.actual_result THEN 1 ELSE 0 END) AS wins
      FROM model_predictions mp
      JOIN recent_resolved rr ON rr.session_id = mp.session_id
      GROUP BY mp.model_name
      ORDER BY total DESC, wins DESC, mp.model_name ASC
    `),

    getRecentModelOutcomes: db.prepare(`
      SELECT
        s.session_id,
        s.actual_result,
        mp.predicted_result,
        mp.confidence,
        CASE WHEN mp.predicted_result = s.actual_result THEN 'WIN' ELSE 'LOSS' END AS status,
        COALESCE(s.resolved_at, s.result_updated_at, s.prediction_updated_at, s.first_seen_at) AS resolved_at
      FROM model_predictions mp
      JOIN sessions s ON s.session_id = mp.session_id
      WHERE mp.model_name = ?
        AND s.actual_result IN ('TAI', 'XIU')
      ORDER BY COALESCE(s.resolved_at, s.result_updated_at, s.prediction_updated_at, s.first_seen_at) DESC
      LIMIT ?
    `),

    pruneSessions: db.prepare(`
      DELETE FROM sessions
      WHERE session_id IN (
        SELECT session_id
        FROM sessions
        ORDER BY COALESCE(resolved_at, prediction_updated_at, result_updated_at, first_seen_at) DESC
        LIMIT -1 OFFSET ?
      )
    `),

    pruneModelPredictions: db.prepare(`
      DELETE FROM model_predictions
      WHERE session_id NOT IN (SELECT session_id FROM sessions)
    `)
  };

  function resolveIfPossible(sessionId, timestamp) {
    const row = statements.getForResolve.get(sessionId);
    if (!row || !row.predicted_result || !row.actual_result || row.status) {
      return {
        resolved: false,
        status: row?.status || null,
        sessionId
      };
    }

    const status = row.predicted_result === row.actual_result ? "WIN" : "LOSS";
    const result = statements.markResolved.run(status, timestamp, sessionId);

    return {
      resolved: result.changes > 0,
      status: result.changes > 0 ? status : row.status,
      sessionId
    };
  }

  function upsertPrediction(record) {
    const timestamp = nowIso();
    statements.upsertPrediction.run(
      record.sessionId,
      record.predictedResult,
      record.countdown,
      record.betTai,
      record.betXiu,
      record.betTotal,
      record.bettorsTai,
      record.bettorsXiu,
      record.bettorsTotal,
      record.rawPayload ? JSON.stringify(record.rawPayload) : null,
      timestamp,
      timestamp
    );

    return resolveIfPossible(record.sessionId, timestamp);
  }

  function upsertResults(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }

    const timestamp = nowIso();
    const newlyResolved = [];

    db.exec("BEGIN TRANSACTION");
    try {
      for (const record of records) {
        statements.upsertResult.run(
          record.sessionId,
          record.actualResult,
          record.dices ? JSON.stringify(record.dices) : null,
          record.point,
          record.rawPayload ? JSON.stringify(record.rawPayload) : null,
          timestamp,
          timestamp
        );

        const resolved = resolveIfPossible(record.sessionId, timestamp);
        if (resolved.resolved) {
          newlyResolved.push(resolved);
        }
      }

      db.exec("COMMIT");
      return newlyResolved;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors.
      }

      throw error;
    }
  }

  function upsertModelPredictions(sessionId, modelPredictions) {
    if (!sessionId || !Array.isArray(modelPredictions) || modelPredictions.length === 0) {
      return;
    }

    const timestamp = nowIso();

    db.exec("BEGIN TRANSACTION");
    try {
      for (const modelPrediction of modelPredictions) {
        if (!modelPrediction?.modelName || !modelPrediction?.predictedResult) {
          continue;
        }

        statements.upsertModelPrediction.run(
          String(sessionId),
          String(modelPrediction.modelName),
          String(modelPrediction.predictedResult),
          Number.isFinite(modelPrediction.confidence) ? modelPrediction.confidence : null,
          Number.isFinite(modelPrediction.score) ? modelPrediction.score : null,
          toSafeString(modelPrediction.reason),
          timestamp
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors.
      }

      throw error;
    }
  }

  function listHistory(limit, statusFilter) {
    const safeLimit = Math.max(1, Math.min(limit || 100, 5000));
    const status = typeof statusFilter === "string" ? statusFilter.toUpperCase() : "ALL";

    let whereClause = "WHERE predicted_result IS NOT NULL";
    if (status === "WIN") {
      whereClause += " AND status = 'WIN'";
    } else if (status === "LOSS") {
      whereClause += " AND status = 'LOSS'";
    } else if (status === "PENDING") {
      whereClause += " AND status IS NULL";
    }

    const statement = db.prepare(`
      SELECT *
      FROM sessions
      ${whereClause}
      ORDER BY COALESCE(resolved_at, prediction_updated_at, result_updated_at, first_seen_at) DESC
      LIMIT ?
    `);

    return statement.all(safeLimit).map(mapSessionRow);
  }

  function getCurrentSession() {
    const row = statements.getCurrentSession.get();
    return row ? mapSessionRow(row) : null;
  }

  function getLatestReferenceRecord() {
    const row = statements.getLatestPredictionPayload.get();
    const payload = parseJson(row?.prediction_payload);
    if (!payload) {
      return null;
    }

    return extractPredictionRecord(payload);
  }

  function getSessionById(sessionId) {
    const row = statements.getSessionById.get(String(sessionId));
    return row ? mapSessionRow(row) : null;
  }

  function getSummary() {
    const row = statements.getSummary.get() || {};
    return {
      totalTracked: row.total_tracked || 0,
      predictedSessions: row.predicted_sessions || 0,
      resolvedSessions: row.resolved_sessions || 0,
      wins: row.wins || 0,
      losses: row.losses || 0,
      pending: row.pending || 0
    };
  }

  function getPredictionStats() {
    const rows = statements.getAllPredictions.all();
    const stats = {
      total: 0,
      correct: 0,
      accuracyPercent: 0,
      byConfidenceRange: {}
    };

    const ranges = [
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100]
    ];

    for (const [low, high] of ranges) {
      stats.byConfidenceRange[`${low}-${high}`] = { count: 0, correct: 0 };
    }

    for (const row of rows) {
      stats.total += 1;
      const correct = row.predicted_result === row.actual_result;
      if (correct) stats.correct += 1;

      let conf = null;
      try {
        const payload = JSON.parse(row.prediction_payload || "{}");
        conf = payload.confidence_percent;
      } catch (e) {
        conf = null;
      }

      if (conf !== null && typeof conf === "number") {
        for (const [low, high] of ranges) {
          if (conf >= low && conf < high) {
            const key = `${low}-${high}`;
            stats.byConfidenceRange[key].count += 1;
            if (correct) stats.byConfidenceRange[key].correct += 1;
            break;
          }
        }
      }
    }

    if (stats.total > 0) {
      stats.accuracyPercent = Math.round((stats.correct / stats.total) * 100 * 100) / 100;
    }

    return stats;
  }

  function getRecentResolved(limit) {
    const safeLimit = Math.max(1, Math.min(limit || 100, 5000));
    return statements.getRecentResolved.all(safeLimit);
  }

  function getResolvedStatusesAscending() {
    return statements.getResolvedStatusesAsc.all().map((row) => row.status);
  }

  function getBettingSamples(limit) {
    const safeLimit = Math.max(1, Math.min(limit || 100, 50000));
    return statements.getBettingSamples.all(safeLimit);
  }

  function getActualHistory(limit) {
    const safeLimit = Math.max(1, Math.min(limit || 200, 5000));
    const rows = statements.getActualHistoryDesc.all(safeLimit);

    return rows
      .map((row) => ({
        sessionId: row.session_id,
        actualResult: row.actual_result,
        point: Number.isFinite(row.point) ? row.point : null,
        dices: parseJson(row.dices),
        resolvedAt: row.resolved_at
      }))
      .reverse();
  }

  function listModelPredictions(sessionId) {
    return statements.getModelPredictionsBySession
      .all(String(sessionId))
      .map((row) => ({
        modelName: row.model_name,
        predictedResult: row.predicted_result,
        confidence: Number.isFinite(row.confidence) ? row.confidence : null,
        score: Number.isFinite(row.score) ? row.score : null,
        reason: row.reason,
        createdAt: row.created_at
      }));
  }

  function getModelLeaderboard(limitResolvedSessions) {
    const safeLimit = Math.max(20, Math.min(limitResolvedSessions || 300, 10000));

    return statements.getModelLeaderboard.all(safeLimit).map((row) => {
      const total = row.total || 0;
      const wins = row.wins || 0;
      const accuracy = total > 0 ? Number((wins / total).toFixed(4)) : null;

      return {
        modelName: row.model_name,
        total,
        wins,
        losses: total - wins,
        accuracy
      };
    });
  }

  function getRecentModelOutcomes(modelName, limit) {
    const safeModel = toSafeString(modelName);
    if (!safeModel) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(limit || 100, 5000));

    return statements.getRecentModelOutcomes.all(safeModel, safeLimit).map((row) => ({
      sessionId: row.session_id,
      predictedResult: row.predicted_result,
      actualResult: row.actual_result,
      confidence: Number.isFinite(row.confidence) ? row.confidence : null,
      status: row.status,
      resolvedAt: row.resolved_at
    }));
  }

  function getModelPerformanceMap(limitResolvedSessions) {
    const leaderboard = getModelLeaderboard(limitResolvedSessions);
    const modelMap = {};

    for (const item of leaderboard) {
      modelMap[item.modelName] = item.accuracy;
    }

    return modelMap;
  }

  function listAlerts(limit) {
    const safeLimit = Math.max(1, Math.min(limit || 100, 1000));
    return statements.listAlerts.all(safeLimit).map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      triggerSessionId: row.trigger_session_id,
      payload: parseJson(row.payload),
      createdAt: row.created_at
    }));
  }

  function tryCreateHighAccuracyAlert({ windowSize, winRateThreshold, triggerSessionId }) {
    const recent = getRecentResolved(windowSize);
    if (recent.length < windowSize) {
      return null;
    }

    const wins = recent.filter((item) => item.status === "WIN").length;
    const winRate = (wins / recent.length) * 100;

    if (winRate < winRateThreshold) {
      return null;
    }

    const timestamp = nowIso();
    const payload = {
      windowSize,
      wins,
      total: recent.length,
      winRate: Number(winRate.toFixed(2)),
      threshold: winRateThreshold
    };

    const message = `Win rate ${payload.winRate}% trong ${windowSize} phien gan nhat (nguong ${winRateThreshold}%).`;

    const result = statements.insertAlert.run(
      "HIGH_ACCURACY_STREAK",
      message,
      String(triggerSessionId),
      JSON.stringify(payload),
      timestamp
    );

    if (result.changes === 0) {
      return null;
    }

    return {
      type: "HIGH_ACCURACY_STREAK",
      message,
      triggerSessionId: String(triggerSessionId),
      payload,
      createdAt: timestamp
    };
  }

  function pruneSessions(maxRows) {
    if (!Number.isFinite(maxRows) || maxRows <= 0) {
      return 0;
    }

    const deletedSessions = statements.pruneSessions.run(maxRows).changes || 0;
    statements.pruneModelPredictions.run();

    return deletedSessions;
  }

  function close() {
    db.close();
  }

  return {
    upsertPrediction,
    upsertResults,
    upsertModelPredictions,
    listHistory,
    getCurrentSession,
    getLatestReferenceRecord,
    getSessionById,
    getSummary,
    getPredictionStats,
    getRecentResolved,
    getResolvedStatusesAscending,
    getBettingSamples,
    getActualHistory,
    listModelPredictions,
    getModelLeaderboard,
    getRecentModelOutcomes,
    getModelPerformanceMap,
    listAlerts,
    tryCreateHighAccuracyAlert,
    pruneSessions,
    close
  };
}






