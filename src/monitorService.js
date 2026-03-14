import { EventEmitter } from "node:events";
import { extractPredictionRecord, extractResultRecords } from "./normalizers.js";

function nowIso() {
  return new Date().toISOString();
}

function toErrorPayload(error) {
  return {
    message: error?.message || "Unknown error",
    at: nowIso()
  };
}

export class MonitorService extends EventEmitter {
  constructor({ config, database, predictor }) {
    super();
    this.config = config;
    this.database = database;
    this.predictor = predictor;

    this.predictionTimer = null;
    this.resultsTimer = null;

    this.isPredictionPolling = false;
    this.isResultsPolling = false;

    this.latestPredictionSnapshot = null;

    this.state = {
      startedAt: null,
      lastPredictionFetchAt: null,
      lastResultsFetchAt: null,
      lastPredictionError: null,
      lastResultsError: null,
      lastPredictionBuiltAt: null
    };
  }

  getState() {
    return {
      ...this.state,
      isPredictionPolling: this.isPredictionPolling,
      isResultsPolling: this.isResultsPolling
    };
  }

  getLatestPredictionSnapshot() {
    return this.latestPredictionSnapshot;
  }

  async fetchJson(url) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache"
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  emitUpdate(payload) {
    this.emit("update", {
      ...payload,
      emittedAt: nowIso()
    });
  }

  emitAlert(alert) {
    if (!alert) {
      return;
    }

    this.emit("alert", {
      ...alert,
      emittedAt: nowIso()
    });
  }

  handleResolvedSession(sessionId) {
    const alert = this.database.tryCreateHighAccuracyAlert({
      windowSize: this.config.alertWindowSize,
      winRateThreshold: this.config.alertWinRateThreshold,
      triggerSessionId: sessionId
    });

    if (alert) {
      this.emitAlert(alert);
    }
  }

  rebuildPredictionFromDatabase() {
    if (!this.predictor) {
      return null;
    }

    const snapshot = this.predictor.buildCurrentPrediction();
    if (snapshot) {
      this.latestPredictionSnapshot = snapshot;
      this.state.lastPredictionBuiltAt = nowIso();
    }

    return snapshot;
  }

  buildPredictionFromRecord(predictionRecord) {
    if (!this.predictor) {
      return null;
    }

    const snapshot = this.predictor.buildPrediction(predictionRecord);
    if (snapshot) {
      this.latestPredictionSnapshot = snapshot;
      this.state.lastPredictionBuiltAt = nowIso();
    }

    return snapshot;
  }

  async pollPrediction() {
    if (this.isPredictionPolling) {
      return;
    }

    this.isPredictionPolling = true;

    try {
      const payload = await this.fetchJson(this.config.predictionApiUrl);
      const predictionRecord = extractPredictionRecord(payload);

      if (!predictionRecord) {
        throw new Error("Prediction payload does not include a valid session id");
      }

      const resolved = this.database.upsertPrediction(predictionRecord);
      if (resolved.resolved) {
        this.handleResolvedSession(resolved.sessionId);
      }

      const predictionSnapshot = this.buildPredictionFromRecord(predictionRecord);

      this.database.pruneSessions(this.config.maxStoredSessions);

      this.state.lastPredictionFetchAt = nowIso();
      this.state.lastPredictionError = null;

      this.emitUpdate({
        source: "prediction",
        sessionId: predictionRecord.sessionId,
        countdown: predictionRecord.countdown,
        predictedResult: predictionSnapshot?.prediction?.ket_qua || null,
        confidencePercent: predictionSnapshot?.prediction?.confidence_percent || null
      });
    } catch (error) {
      this.state.lastPredictionError = toErrorPayload(error);
    } finally {
      this.isPredictionPolling = false;
    }
  }

  async pollResults() {
    if (this.isResultsPolling) {
      return;
    }

    this.isResultsPolling = true;

    try {
      const payload = await this.fetchJson(this.config.resultsApiUrl);
      const resultRecords = extractResultRecords(payload);

      if (resultRecords.length === 0) {
        this.state.lastResultsFetchAt = nowIso();
        this.state.lastResultsError = null;
        return;
      }

      const resolvedRecords = this.database.upsertResults(resultRecords);
      for (const resolved of resolvedRecords) {
        this.handleResolvedSession(resolved.sessionId);
      }

      this.rebuildPredictionFromDatabase();
      this.database.pruneSessions(this.config.maxStoredSessions);

      this.state.lastResultsFetchAt = nowIso();
      this.state.lastResultsError = null;

      this.emitUpdate({
        source: "results",
        affectedSessions: resultRecords.length,
        resolvedSessions: resolvedRecords.length
      });
    } catch (error) {
      this.state.lastResultsError = toErrorPayload(error);
    } finally {
      this.isResultsPolling = false;
    }
  }

  async runNow() {
    await Promise.all([this.pollPrediction(), this.pollResults()]);
    return this.getState();
  }

  start() {
    if (this.predictionTimer || this.resultsTimer) {
      return;
    }

    this.state.startedAt = nowIso();

    void this.pollPrediction();
    void this.pollResults();

    this.predictionTimer = setInterval(() => {
      void this.pollPrediction();
    }, this.config.predictionPollMs);

    this.resultsTimer = setInterval(() => {
      void this.pollResults();
    }, this.config.resultsPollMs);
  }

  stop() {
    if (this.predictionTimer) {
      clearInterval(this.predictionTimer);
      this.predictionTimer = null;
    }

    if (this.resultsTimer) {
      clearInterval(this.resultsTimer);
      this.resultsTimer = null;
    }
  }
}
