import fs from "node:fs";
import path from "node:path";
import { normalizeSide } from "./normalizers.js";

const DEFAULT_PATTERN_FILE = path.resolve(process.cwd(), "data", "cau-patterns.txt");
const MIN_PATTERN_LENGTH = 4;
const MIN_SAMPLE_SIZE = 3;
const MIN_SUPPORT_RATE = 0.55;
const DEFAULT_RELOAD_MS = 15000;

function getFileMeta(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  } catch {
    return null;
  }
}

function inferSideFromRaw(rawValue) {
  const normalized = normalizeSide(rawValue);
  if (normalized) {
    return normalized;
  }

  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const cleaned = String(rawValue).trim().toUpperCase();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith("T")) {
    return "TAI";
  }

  if (cleaned.startsWith("X")) {
    return "XIU";
  }

  return null;
}

function ensureCounts(map, pattern) {
  let counts = map.get(pattern);
  if (!counts) {
    counts = {
      tai: 0,
      xiu: 0,
      total: 0
    };
    map.set(pattern, counts);
  }
  return counts;
}

function recordPattern(map, pattern, side) {
  if (!pattern || (side !== "TAI" && side !== "XIU")) {
    return;
  }

  const counts = ensureCounts(map, pattern);
  if (side === "TAI") {
    counts.tai += 1;
  } else {
    counts.xiu += 1;
  }
  counts.total += 1;
}

function parsePatternText(text) {
  const patternMap = new Map();
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;

  const lines = String(text || "").split(/\r?\n/);
  const dashPattern = /([TX]{4,})\s*-\s*([TX])\b/i;
  const jsonPattern = /"([TX]{2,})"\s*:\s*"([^"]+)"/;

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const dashMatch = line.match(dashPattern);
    if (dashMatch) {
      const pattern = dashMatch[1].toUpperCase();
      const side = dashMatch[2].toUpperCase() === "T" ? "TAI" : "XIU";
      recordPattern(patternMap, pattern, side);
      minLength = Math.min(minLength, pattern.length);
      maxLength = Math.max(maxLength, pattern.length);
      continue;
    }

    const jsonMatch = line.match(jsonPattern);
    if (jsonMatch) {
      const pattern = jsonMatch[1].toUpperCase();
      const side = inferSideFromRaw(jsonMatch[2]);
      if (side) {
        recordPattern(patternMap, pattern, side);
        minLength = Math.min(minLength, pattern.length);
        maxLength = Math.max(maxLength, pattern.length);
      }
    }
  }

  if (!Number.isFinite(minLength) || minLength === Number.POSITIVE_INFINITY) {
    minLength = 0;
  }

  return {
    patternMap,
    minLength,
    maxLength,
    totalPatterns: patternMap.size
  };
}

export function loadCauPatternStore(patternFilePath = DEFAULT_PATTERN_FILE) {
  const resolvedPath = path.resolve(patternFilePath);
  const fileMeta = getFileMeta(resolvedPath);
  const loadedAt = new Date().toISOString();

  try {
    const rawText = fs.readFileSync(resolvedPath, "utf8");
    const parsed = parsePatternText(rawText);

    return {
      available: parsed.totalPatterns > 0,
      filePath: resolvedPath,
      loadedAt,
      lastCheckedAt: Date.now(),
      fileMeta,
      ...parsed
    };
  } catch (error) {
    return {
      available: false,
      filePath: resolvedPath,
      loadedAt,
      lastCheckedAt: Date.now(),
      fileMeta,
      error: error?.message || "Unable to read pattern file",
      patternMap: new Map(),
      minLength: 0,
      maxLength: 0,
      totalPatterns: 0
    };
  }
}

export function refreshCauPatternStore(store, patternFilePath = DEFAULT_PATTERN_FILE, options = {}) {
  const minIntervalMs = Number.isFinite(options?.minIntervalMs)
    ? options.minIntervalMs
    : DEFAULT_RELOAD_MS;
  const now = Date.now();

  if (store?.lastCheckedAt && now - store.lastCheckedAt < minIntervalMs) {
    return store;
  }

  const resolvedPath = path.resolve(patternFilePath);
  const fileMeta = getFileMeta(resolvedPath);

  if (!fileMeta) {
    return {
      ...(store || {}),
      available: false,
      filePath: resolvedPath,
      lastCheckedAt: now,
      fileMeta,
      error: "Pattern file not found"
    };
  }

  if (store?.fileMeta?.mtimeMs === fileMeta.mtimeMs && store?.fileMeta?.size === fileMeta.size) {
    return {
      ...(store || {}),
      lastCheckedAt: now,
      fileMeta
    };
  }

  return loadCauPatternStore(resolvedPath);
}

export function findCauPatternMatch(history, store) {
  if (!store?.available || !(store.patternMap instanceof Map)) {
    return null;
  }

  const sides = (history || [])
    .map((item) => item.actualResult)
    .filter((side) => side === "TAI" || side === "XIU");

  const minLenConfig = Math.max(MIN_PATTERN_LENGTH, store.minLength || 0);
  if (sides.length < minLenConfig) {
    return null;
  }

  const historyString = sides.map((side) => (side === "TAI" ? "T" : "X")).join("");
  const maxLen = Math.min(store.maxLength || 0, historyString.length);
  const minLen = minLenConfig;

  for (let len = maxLen; len >= minLen; len -= 1) {
    // lấy N ký tự từ đầu (vì lịch sử đã reverse, đầu là mới nhất)
    const pattern = historyString.slice(0, len);
    const counts = store.patternMap.get(pattern);
    if (!counts || counts.total <= 0) {
      continue;
    }

    const predictedResult = counts.tai >= counts.xiu ? "TAI" : "XIU";
    const support = Math.max(counts.tai, counts.xiu);
    const supportRate = support / counts.total;

    if (counts.total < MIN_SAMPLE_SIZE || supportRate < MIN_SUPPORT_RATE) {
      continue;
    }

    const lengthBoost = Math.min(0.14, Math.max(0, (len - 4) * 0.018));
    const sampleBoost = Math.min(0.08, Math.log10(counts.total + 1) * 0.04);
    const confidence = Math.min(
      0.9,
      Math.max(0.52, 0.52 + (supportRate - 0.5) * 0.7 + lengthBoost + sampleBoost)
    );

    return {
      pattern,
      length: len,
      predictedResult,
      tai: counts.tai,
      xiu: counts.xiu,
      sampleSize: counts.total,
      supportRate,
      confidence
    };
  }

  return null;
}
