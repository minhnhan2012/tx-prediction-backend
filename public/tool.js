const el = {
  headline: document.getElementById("headline"),
  syncState: document.getElementById("syncState"),
  refreshBtn: document.getElementById("refreshBtn"),
  sessionId: document.getElementById("sessionId"),
  sourceSessionId: document.getElementById("sourceSessionId"),
  predictionResult: document.getElementById("predictionResult"),
  confidence: document.getElementById("confidence"),
  finalPredictionResult: document.getElementById("finalPredictionResult"),
  finalPredictionMeta: document.getElementById("finalPredictionMeta"),
  patternName: document.getElementById("patternName"),
  patternMeta: document.getElementById("patternMeta"),
  diceRow: document.getElementById("diceRow"),
  betStatus: document.getElementById("betStatus"),
  betTick: document.getElementById("betTick"),
  bettors: document.getElementById("bettors"),
  betTotal: document.getElementById("betTotal"),
  betTai: document.getElementById("betTai"),
  betXiu: document.getElementById("betXiu"),
  bankrollInput: document.getElementById("bankrollInput"),
  applyBankrollBtn: document.getElementById("applyBankrollBtn"),
  bankrollHint: document.getElementById("bankrollHint"),
  betAdviceDecision: document.getElementById("betAdviceDecision"),
  betAdviceSide: document.getElementById("betAdviceSide"),
  betAdviceScore: document.getElementById("betAdviceScore"),
  betAdviceStake: document.getElementById("betAdviceStake"),
  betAdviceAmount: document.getElementById("betAdviceAmount"),
  betAdviceRule: document.getElementById("betAdviceRule"),
  betAdviceRemainExplain: document.getElementById("betAdviceRemainExplain"),
  betAdviceUnit: document.getElementById("betAdviceUnit"),
  betAdviceTrackedBalance: document.getElementById("betAdviceTrackedBalance"),
  betAdviceTrackedPnl: document.getElementById("betAdviceTrackedPnl"),
  recentPerf: document.getElementById("recentPerf"),
  betAdvicePnlNet: document.getElementById("betAdvicePnlNet"),
  betAdvicePnlRoi: document.getElementById("betAdvicePnlRoi"),
  betAdvicePnlCount: document.getElementById("betAdvicePnlCount"),
  betAdvicePnlBalance: document.getElementById("betAdvicePnlBalance"),
  betAdviceReasons: document.getElementById("betAdviceReasons"),
  betAdviceWarnings: document.getElementById("betAdviceWarnings"),
  modelsBody: document.getElementById("modelsBody"),
  leaderboard: document.getElementById("leaderboard"),
  jsonOutput: document.getElementById("jsonOutput")
};

function safe(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

const BANKROLL_STORAGE_KEY = "tx_predictor_bankroll";

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function normalizeBankrollInput(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const cleaned = String(rawValue).replace(/[^\d]/g, "").trim();
  if (!cleaned) {
    return null;
  }

  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getBankrollValue() {
  return normalizeBankrollInput(el.bankrollInput?.value);
}

function setBankrollToInput(value) {
  if (!el.bankrollInput) {
    return;
  }

  if (!Number.isFinite(value) || value <= 0) {
    el.bankrollInput.value = "";
    return;
  }

  el.bankrollInput.value = String(Math.round(value));
}

function loadBankrollFromStorage() {
  try {
    const raw = localStorage.getItem(BANKROLL_STORAGE_KEY);
    return normalizeBankrollInput(raw);
  } catch {
    return null;
  }
}

function saveBankrollToStorage(value) {
  try {
    if (!Number.isFinite(value) || value <= 0) {
      localStorage.removeItem(BANKROLL_STORAGE_KEY);
      return;
    }

    localStorage.setItem(BANKROLL_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage errors.
  }
}

function renderDice(prediction) {
  const values = [prediction?.xuc_xac_1, prediction?.xuc_xac_2, prediction?.xuc_xac_3];
  const total = prediction?.tong;

  el.diceRow.innerHTML = `
    <span class="dice">${safe(values[0])}</span>
    <span class="dice">${safe(values[1])}</span>
    <span class="dice">${safe(values[2])}</span>
    <span class="dice total">Tong: ${safe(total)}</span>
  `;
}

function renderFinalPrediction(prediction) {
  const finalPrediction = prediction?.du_doan_cuoi_cung;
  if (!finalPrediction) {
    el.finalPredictionResult.textContent = "Chua co du lieu";
    el.finalPredictionMeta.textContent =
      "Ket qua cuoi cung se la quyet dinh tong hop tu cac thuat toan.";
    return;
  }

  el.finalPredictionResult.textContent = `${safe(finalPrediction.ket_qua)} (${safe(
    finalPrediction.confidence_percent
  )}%)`;

  const method = safe(finalPrediction.phuong_phap);
  const modelCount = safe(finalPrediction.model_tham_gia);
  const taiSupport = safe(finalPrediction.model_ung_ho?.tai);
  const xiuSupport = safe(finalPrediction.model_ung_ho?.xiu);

  el.finalPredictionMeta.textContent = `${method} | Model: ${modelCount} | Tai: ${taiSupport} - Xiu: ${xiuSupport}`;
}
function renderCauPattern(prediction) {
  if (!el.patternName || !el.patternMeta) {
    return;
  }

  const pattern = prediction?.cau_pattern;
  if (!pattern) {
    el.patternName.textContent = "Chua co cau phu hop";
    el.patternMeta.textContent = "Can them du lieu de nhan biet dang cau.";
    return;
  }

  const predicted = safe(pattern.du_doan);
  el.patternName.textContent = `${safe(pattern.pattern)} -> ${predicted}`;

  const support = safe(pattern.ti_le_ung_ho_percent);
  const conf = safe(pattern.confidence_percent);
  const sample = safe(pattern.mau);
  const length = safe(pattern.length);

  el.patternMeta.textContent = `Len ${length} | Mau ${sample} | Ung ho ${support}% | Confidence ${conf}%`;
}


function renderList(root, items) {
  if (!Array.isArray(items) || items.length === 0) {
    root.innerHTML = "<li>-</li>";
    return;
  }

  root.innerHTML = items.map((item) => `<li>${safe(item)}</li>`).join("");
}

function renderBetAdvice(prediction) {
  const advice = prediction?.goi_y_dat_cuoc;
  const perf = prediction?.hieu_suat_gan_day;

  if (!advice) {
    el.betAdviceDecision.textContent = "Chua co du lieu";
    el.betAdviceSide.textContent = "Dang doi du lieu danh gia rui ro.";
    el.betAdviceScore.textContent = "-";
    el.betAdviceStake.textContent = "-";
    el.betAdviceAmount.textContent = "-";
    el.betAdviceRule.textContent = "Quy tac: thang x1.98, thua mat toan bo tien dat.";
    el.betAdviceRemainExplain.textContent = "NEN DOI thi khong tru tien, so du van giu nguyen.";
    el.betAdviceUnit.textContent = "-";
    el.betAdviceTrackedBalance.textContent = "-";
    el.betAdviceTrackedPnl.textContent = "-";
    el.recentPerf.textContent = "-";
    el.betAdvicePnlNet.textContent = "-";
    el.betAdvicePnlRoi.textContent = "-";
    el.betAdvicePnlCount.textContent = "-";
    el.betAdvicePnlBalance.textContent = "-";
    el.bankrollHint.textContent = "Nhap tong von de tool tinh so tien nen vao cho moi van.";
    renderList(el.betAdviceReasons, []);
    renderList(el.betAdviceWarnings, []);
    return;
  }

  const decisionText = advice.nen_dat
    ? `Co the dat: ${safe(advice.cua_goi_y)}`
    : "Khuyen nghi: NEN DOI";

  el.betAdviceDecision.textContent = decisionText;
  el.betAdviceSide.textContent = `Muc tin hieu: ${safe(advice.muc_do_tin_hieu)} | Quan ly von: ${safe(
    advice.quan_ly_von
  )}`;
  el.betAdviceScore.textContent = `${safe(advice.diem_tin_hieu)} / 100`;
  el.betAdviceStake.textContent = safe(advice.ti_le_von_goi_y_text);

  const inputBankroll = getBankrollValue();
  const betUnit = Number.isFinite(advice?.don_vi_dat_cuoc) ? advice.don_vi_dat_cuoc : 1000;
  const betUnitText = safe(advice?.don_vi_dat_cuoc_text, formatMoney(betUnit));

  let suggestedAmountText = "Nhap von de tinh";
  let bankrollText = advice.so_von_nhap_text || null;
  let remainText = advice.von_con_lai_uoc_tinh_text || null;

  if (advice.so_tien_goi_y_text !== null && advice.so_tien_goi_y_text !== undefined) {
    suggestedAmountText = `${safe(advice.so_tien_goi_y_text)} (${safe(advice.so_tien_goi_y)} d)`;
  } else if (Number.isFinite(inputBankroll)) {
    const percent = Number.isFinite(advice.ti_le_von_goi_y_percent)
      ? advice.ti_le_von_goi_y_percent
      : 0;
    const rawAmount = advice.nen_dat ? (inputBankroll * percent) / 100 : 0;
    const roundedAmount = betUnit > 1 ? Math.floor(rawAmount / betUnit) * betUnit : Math.round(rawAmount);
    const remain = Math.max(0, inputBankroll - roundedAmount);

    suggestedAmountText = `${safe(formatMoney(roundedAmount))} (${Math.round(roundedAmount)} d)`;
    bankrollText = formatMoney(inputBankroll);
    remainText = formatMoney(remain);
  }

  const oneTrade = advice.ket_qua_tai_chinh_1_lenh;
  if (oneTrade && Number.isFinite(oneTrade.neu_thang_loi_nhuan_rong)) {
    suggestedAmountText += ` | Thang +${safe(formatMoney(oneTrade.neu_thang_loi_nhuan_rong))}, Thua -${safe(
      formatMoney(oneTrade.neu_thua_mat)
    )}`;
  }

  el.betAdviceAmount.textContent = suggestedAmountText;

  const payoutWin = advice?.quy_tac_thanh_toan?.thang_nhan_x;
  const payoutLose = advice?.quy_tac_thanh_toan?.thua_mat_x;
  el.betAdviceRule.textContent = `Quy tac: thang x${safe(payoutWin, 1.98)}, thua mat x${safe(
    payoutLose,
    1
  )} tien dat.`;
  el.betAdviceRemainExplain.textContent = safe(
    advice.giai_thich_so_du,
    "Von con lai uoc tinh la so du ngay sau lenh de xuat."
  );
  el.betAdviceUnit.textContent = `${safe(betUnitText)} d`;

  const trackedBalanceText = safe(
    advice.von_theo_doi_hien_tai_text,
    advice?.thong_ke_loi_lo?.so_du_uoc_tinh_text
  );
  const trackedPnlText = safe(
    advice.loi_lo_da_chot_text,
    advice?.thong_ke_loi_lo?.loi_nhuan_rong_text
  );
  el.betAdviceTrackedBalance.textContent = trackedBalanceText;
  el.betAdviceTrackedPnl.textContent = trackedPnlText;

  if (bankrollText) {
    const trackedHint = trackedBalanceText && trackedBalanceText !== "-"
      ? ` | So du mo phong: ${trackedBalanceText}`
      : "";
    el.bankrollHint.textContent = `Von nhap: ${safe(bankrollText)} | Von sau lenh nay: ${safe(remainText)}${trackedHint}`;
  } else {
    el.bankrollHint.textContent = "Nhap tong von de tool tinh so tien nen vao cho moi van.";
  }

  const last10 = perf?.last10;
  const last30 = perf?.last30;
  const ensemble = perf?.ensemble;

  const perfText =
    `WR10: ${safe(last10?.winRate)}% (${safe(last10?.wins)}/${safe(last10?.sampleSize)}) | ` +
    `WR30: ${safe(last30?.winRate)}% | ` +
    `Ensemble: ${safe(ensemble?.accuracyPercent)}% | ` +
    `Nguon hoc: ${safe(perf?.source)}`;

  el.recentPerf.textContent = perfText;

  const pnl = advice?.thong_ke_loi_lo;
  if (pnl) {
    const pnlNet = Number.isFinite(pnl.loi_nhuan_rong)
      ? `${safe(formatMoney(pnl.loi_nhuan_rong))} (${safe(pnl.loi_nhuan_rong)} d)`
      : "-";
    const pnlRoi = Number.isFinite(pnl.roi_percent) ? `${pnl.roi_percent}%` : "-";
    const pnlCount = `${safe(pnl.lenh_da_mo)}/${safe(pnl.mau_lich_su)} (W:${safe(pnl.lenh_thang)} L:${safe(
      pnl.lenh_thua
    )})`;

    el.betAdvicePnlNet.textContent = pnlNet;
    el.betAdvicePnlRoi.textContent = pnlRoi;
    el.betAdvicePnlCount.textContent = pnlCount;
    el.betAdvicePnlBalance.textContent = safe(pnl.so_du_uoc_tinh_text);
  } else {
    el.betAdvicePnlNet.textContent = "-";
    el.betAdvicePnlRoi.textContent = "-";
    el.betAdvicePnlCount.textContent = "-";
    el.betAdvicePnlBalance.textContent = "-";
  }

  renderList(el.betAdviceReasons, advice.ly_do || []);
  renderList(el.betAdviceWarnings, advice.canh_bao || []);
}

function renderModels(prediction) {
  const models = prediction?.models || [];
  if (models.length === 0) {
    el.modelsBody.innerHTML = "<tr><td colspan='4'>Chua co du lieu</td></tr>";
    return;
  }

  el.modelsBody.innerHTML = models
    .map(
      (model) => `
        <tr>
          <td>${safe(model.ten)}</td>
          <td>${safe(model.du_doan)}</td>
          <td>${safe(model.confidence_percent)}%</td>
          <td>${safe(model.ly_do, "-")}</td>
        </tr>
      `
    )
    .join("");
}

function renderLeaderboard(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    el.leaderboard.innerHTML = "<li>Chua co du lieu leaderboard</li>";
    return;
  }

  el.leaderboard.innerHTML = rows
    .slice(0, 8)
    .map((row) => {
      const accuracy =
        row.accuracy !== null && row.accuracy !== undefined
          ? `${(row.accuracy * 100).toFixed(2)}%`
          : "-";
      return `<li><span>${safe(row.modelName)}</span><strong>${accuracy}</strong></li>`;
    })
    .join("");
}

function renderPrediction(data) {
  if (!data) {
    return;
  }

  const nextSession = data.phien_tiep_theo ?? data.phien;
  const sourceSession = data.phien_hien_tai ?? data.source?.phien;

  el.headline.textContent = sourceSession
    ? `Du doan Tai/Xiu van tiep theo: ${safe(nextSession)} (tham chieu ${safe(sourceSession)})`
    : `Du doan Tai/Xiu van tiep theo: ${safe(nextSession)}`;

  el.sessionId.textContent = safe(nextSession);
  el.sourceSessionId.textContent = safe(sourceSession);
  el.predictionResult.textContent = safe(data.ket_qua);
  el.confidence.textContent = `${safe(data.confidence_percent)}%`;

  const betting = data.betting_info || {};
  el.betStatus.textContent = safe(betting.trang_thai);
  el.betTick.textContent = `${safe(betting.tick)} / ${safe(betting.sub_tick)}`;
  el.bettors.textContent = safe(betting.tong_nguoi_cuoc);
  el.betTotal.textContent = safe(betting.tong_tien_cuoc);
  el.betTai.textContent = safe(betting.tien_cuoc?.tai);
  el.betXiu.textContent = safe(betting.tien_cuoc?.xiu);

  renderDice(data);
  renderFinalPrediction(data);
  renderCauPattern(data);
  renderBetAdvice(data);
  renderModels(data);
  el.jsonOutput.textContent = JSON.stringify(data, null, 2);
}

function setSyncState(text, isError = false) {
  el.syncState.textContent = text;
  el.syncState.style.color = isError ? "#ff6978" : "";
}

async function refreshAll() {
  try {
    setSyncState("Syncing...");

    const bankroll = getBankrollValue();
    const predictorUrl = Number.isFinite(bankroll)
      ? `/api/predictor/current?bankroll=${encodeURIComponent(bankroll)}`
      : "/api/predictor/current";

    const [predictionRes, modelRes] = await Promise.all([
      fetch(predictorUrl),
      fetch("/api/predictor/models")
    ]);

    if (!predictionRes.ok) {
      throw new Error(`API predictor/current loi ${predictionRes.status}`);
    }

    const predictionData = await predictionRes.json();
    const modelData = modelRes.ok ? await modelRes.json() : null;

    renderPrediction(predictionData);
    renderLeaderboard(modelData?.leaderboard || predictionData?._meta?.modelLeaderboard || []);

    const timestamp = new Date().toLocaleTimeString("vi-VN");
    setSyncState(`Updated ${timestamp}`);
  } catch (error) {
    setSyncState(`Error: ${error.message}`, true);
  }
}

function attachSSE() {
  const sse = new EventSource("/api/stream");

  sse.addEventListener("predictor", (event) => {
    try {
      const payload = JSON.parse(event.data || "null");
      if (!payload?.prediction) {
        return;
      }

      renderPrediction(payload.prediction);
      setSyncState(`Live ${new Date().toLocaleTimeString("vi-VN")}`);
    } catch {
      // Ignore event parsing errors.
    }
  });

  sse.onerror = () => {
    setSyncState("SSE dang reconnect...", true);
  };
}

el.refreshBtn.addEventListener("click", () => {
  refreshAll();
});

if (el.applyBankrollBtn) {
  el.applyBankrollBtn.addEventListener("click", () => {
    const bankroll = getBankrollValue();
    saveBankrollToStorage(bankroll);
    if (!Number.isFinite(bankroll)) {
      el.bankrollHint.textContent = "Von khong hop le. Hay nhap so lon hon 0.";
    }
    refreshAll();
  });
}

if (el.bankrollInput) {
  el.bankrollInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const bankroll = getBankrollValue();
      saveBankrollToStorage(bankroll);
      refreshAll();
    }
  });
}

setBankrollToInput(loadBankrollFromStorage());

refreshAll();
attachSSE();
setInterval(refreshAll, 8000);









