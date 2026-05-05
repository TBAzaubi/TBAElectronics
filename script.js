(() => {
  "use strict";

  // ============================================================
  // DOM REFERENCES
  // ============================================================
  const dom = {
    appContainer: document.getElementById("app-container"),
    breadboardZone: document.getElementById("breadboard-zone"),
    breadboardCanvas: document.getElementById("breadboard-canvas"),
    schematicCanvas: document.getElementById("schematic-canvas"),
    placementError: document.getElementById("placement-error"),
    auditPanel: document.getElementById("audit-panel"),
    auditList: document.getElementById("audit-list"),
    auditCount: document.getElementById("audit-count"),
    statusMessage: document.getElementById("status-message"),
    historyList: document.getElementById("history-list"),
    historyCount: document.getElementById("history-count"),
    signature: document.getElementById("az-signature"),
    levelSelect: document.getElementById("level-select"),
    loadLevelBtn: document.getElementById("load-level-btn"),
    modeToggleBtn: document.getElementById("mode-toggle-btn"),
    checkBtn: document.getElementById("check-btn"),
    clearBtn: document.getElementById("clear-btn"),
    undoBtn: document.getElementById("undo-btn"),
    splashOverlay: document.getElementById("splash-overlay"),
    studentSelect: document.getElementById("student-select"),
    splashPassword: document.getElementById("splash-password"),
    splashError: document.getElementById("splash-error"),
    enterSimulatorBtn: document.getElementById("enter-simulator-btn"),
    currentStudentName: document.getElementById("current-student-name"),
    endSessionBtn: document.getElementById("end-session-btn"),
    toolButtons: Array.from(document.querySelectorAll("[data-tool]")),
  };

  const bbCtx = dom.breadboardCanvas.getContext("2d");
  const schematicCtx = dom.schematicCanvas.getContext("2d");

  // ============================================================
  // CONSTANTS
  // ============================================================
  const SPACING = 25;
  const MARGIN_X = 60;
  const BOARD_VERTICAL_OFFSET = 60;
  const ROWS_PER_SIDE = 5;
  const TOTAL_ROWS = 10;
  const TOTAL_COLUMNS = 66;
  const TRENCH_GAP_PX = SPACING * 2;
  const CLICK_TOLERANCE = 12;
  const RAIL_TOP_RED_Y = 15;
  const RAIL_TOP_BLUE_Y = 40;
  const RAIL_BOTTOM_RED_Y = 400;
  const RAIL_BOTTOM_BLUE_Y = 425;
  const FIRST_HOLE_X = MARGIN_X - 25;
  const FIRST_HOLE_Y = 90;
  const BREAKOUT_START_COL_INDEX = 43;
  const BODY_RADIUS_BY_TYPE = {
    BUZZER: 48,
    SWITCH: 38,
    SLIDE_SWITCH: 25,
    POT: 50,           // large dial body — see getPOTBodyCenter for offset logic
  };
  const POT_BODY_RADIUS  = SPACING * 2;              // 50px — outer bezel radius
  const POT_LEAD_LEN     = 14;                       // px from wiper pin hole to body edge
  const POT_BODY_OFFSET  = POT_BODY_RADIUS + POT_LEAD_LEN; // 64px → short parallel leads

  const SPARKFUN_PINS = [
    "GND", "GND", "3V3", "0", "1", "2", "3", "4", "5", "6", "7",
    "8", "9", "10", "11", "12", "13", "14", "15", "16", "19", "20",
  ];

  const POWER_SOURCES = ["RAIL_TOP_RED", "RAIL_BOT_RED", "MCU_3V3"];
  const GROUND_SOURCES = ["RAIL_TOP_BLUE", "RAIL_BOT_BLUE", "MCU_GND"];
  const TWO_PIN_PARTS = ["LED", "RESISTOR", "BUZZER", "SWITCH"];
  const THREE_PIN_PARTS = ["SLIDE_SWITCH", "POT"];
  const NON_POLARIZED_TYPES = new Set(["RESISTOR", "SWITCH", "SLIDE_SWITCH", "POT"]);
  const LIVE_PLACEMENT_ERROR_TYPES = new Set(["Bodies Overlapping", "Space Occupied", "Invalid Footprint"]);

  const COMPONENT_TYPES = {
    WIRE: { name: "Wire" },
    LED: { name: "LED" },
    RESISTOR: { name: "Resistor" },
    BUZZER: { name: "Buzzer" },
    SWITCH: { name: "Switch" },
    SLIDE_SWITCH: { name: "Slide Switch" },
    POT: { name: "POT" },
  };

  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxOA7knJHCd7uej4SlUpB8_vVQ7J7EUe9h1rfB0F_7IMJjNJtHK0jwcGTcq07Oj1gI/exec";

  const SPLASH_PASSWORD = "ilovezaubi";
  const MASTER_BYPASS_PASSWORD = "0712";
  const MASTER_BYPASS_NAME = "Master/Test Mode";
  const GUEST_BYPASS_PASSWORD = "guest123";
  const GUEST_BYPASS_NAME = "Guest Student";
  const STUDENT_NAME_OPTIONS = [
    "Zaubi Test",
  ];
  const TAB_SESSION_KEY = "az_circuit_simulator_tab_session_v1";
  const TAB_ACTIVE_KEY = "az_circuit_simulator_tab_active_v1";
  const BOARD_STATE_KEY = "az_circuit_simulator_board_v1";

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    difficultyMode: "NORMAL",
    currentTool: null,
    currentRotation: "HORIZONTAL",
    ghostHole: null,
    startHole: null,
    wires: [],
    placedComponents: [],
    actionHistory: [],
    currentLevelGoal: null,
    sessionID: createSessionID(),
    studentName: "",
    isGuestMode: false,
    levelStartedAt: Date.now(),
    checkAttemptCount: 0,
    nextComponentID: 1,
    activePlacementError: null,
    activeAuditErrors: [],
    archivedAuditErrors: [],
    pendingSessionRows: [],
    lastSuccessExportRows: [],
    lastExportSignature: "",
    eventHistory: [],
    isUnlocked: false,
    challengeInstanceID: null,
    level3Tier: 1,
    level3CorrectStreak: 0,
    level4Tier: 1,
    level4CorrectStreak: 0,
    level4LastPinKey: null,   // "P1" | "CENTER" | "P2" — avoids back-to-back repeats in Tier 1
    level5ComponentCount: 4,
    level5CorrectStreak: 0,
  };

  // ============================================================
  // INITIALIZATION
  // ============================================================
  function init() {
    bindEvents();
    populateStudentOptions(STUDENT_NAME_OPTIONS);
    resizeCanvases();
    resetLevelSessionState();

    if (!restoreTabSessionIfPresent()) {
      lockSimulator();
    } else {
      const boardRestored = restoreBoardStateIfPresent();
      if (boardRestored) {
        renderActiveAuditStack();
        renderHistory();
        updateCheckButtonState();
      }
    }

    updateStatus(state.currentLevelGoal ? state.currentLevelGoal.instructions : "LOAD a challenge to begin");
    drawEverything();
    drawSchematic();
    fetchRosterFromScript();
  }

  function bindEvents() {
    window.addEventListener("resize", resizeCanvases);

    dom.toolButtons.forEach((button) => {
      button.addEventListener("click", () => selectTool(button.dataset.tool));
    });

    dom.loadLevelBtn.addEventListener("click", () => {
      const levelNumber = parseInt(dom.levelSelect.value, 10);
      startLevel(levelNumber);
    });

    dom.modeToggleBtn.addEventListener("click", toggleMode);
    dom.checkBtn.addEventListener("click", checkCircuit);
    dom.clearBtn.addEventListener("click", () => clearBoard(true));
    dom.undoBtn.addEventListener("click", undoLastAction);
    dom.endSessionBtn.addEventListener("click", handleEndSession);
    dom.enterSimulatorBtn.addEventListener("click", handleSplashSubmit);
    dom.splashPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSplashSubmit();
      }
    });
    dom.studentSelect.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSplashSubmit();
      }
    });

    dom.breadboardCanvas.addEventListener(
      "mousedown",
      (event) => {
        event.preventDefault();
        if (event.button === 2) return;
        handleBreadboardClick(event);
      },
      { passive: false }
    );

    dom.breadboardCanvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const rotatableTools = ["BUZZER", "SWITCH", "SLIDE_SWITCH", "POT"];
      if (rotatableTools.includes(state.currentTool)) {
        state.currentRotation = state.currentRotation === "HORIZONTAL" ? "VERTICAL" : "HORIZONTAL";
        updateStatus(`Rotation: ${state.currentRotation}`);
        drawEverything();
      }
    });

    // Ghost preview: track hover hole for fixed-footprint tools
    const GHOST_TOOLS = ["BUZZER", "SWITCH", "SLIDE_SWITCH", "POT"];
    let ghostRafPending = false;
    dom.breadboardCanvas.addEventListener("mousemove", (event) => {
      if (!state.isUnlocked || !GHOST_TOOLS.includes(state.currentTool)) {
        if (state.ghostHole !== null) { state.ghostHole = null; drawEverything(); }
        return;
      }
      state.ghostHole = findNearestHole(event.clientX, event.clientY);
      if (!ghostRafPending) {
        ghostRafPending = true;
        requestAnimationFrame(() => { ghostRafPending = false; drawEverything(); });
      }
    });
    dom.breadboardCanvas.addEventListener("mouseleave", () => {
      if (state.ghostHole !== null) { state.ghostHole = null; drawEverything(); }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveBoardState();
    });
    window.addEventListener("pagehide", saveBoardState);
  }

  // ============================================================
  // UI HELPERS / FEEDBACK STACK
  // ============================================================
  function createSessionID() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function saveTabSession() {
    try {
      if (!state.isUnlocked || !state.studentName) {
        localStorage.removeItem(TAB_SESSION_KEY);
        sessionStorage.removeItem(TAB_ACTIVE_KEY);
        return;
      }

      localStorage.setItem(TAB_SESSION_KEY, JSON.stringify({
        sessionID: state.sessionID,
        studentName: state.studentName,
      }));
      sessionStorage.setItem(TAB_ACTIVE_KEY, "1");
    } catch (err) {
      // ignore storage issues
    }
  }

  function clearTabSession() {
    try {
      localStorage.removeItem(TAB_SESSION_KEY);
      sessionStorage.removeItem(TAB_ACTIVE_KEY);
    } catch (err) {
      // ignore storage issues
    }
  }

  function restoreTabSessionIfPresent() {
    try {
      if (!sessionStorage.getItem(TAB_ACTIVE_KEY)) return false;

      const raw = localStorage.getItem(TAB_SESSION_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.sessionID || !parsed.studentName) {
        clearTabSession();
        return false;
      }

      state.sessionID = parsed.sessionID;
      unlockSimulator(parsed.studentName);
      if (dom.studentSelect) dom.studentSelect.value = parsed.studentName;
      return true;
    } catch (err) {
      clearTabSession();
      return false;
    }
  }

  function saveBoardState() {
    if (!state.isUnlocked || !state.currentLevelGoal) {
      clearBoardState();
      return;
    }
    try {
      localStorage.setItem(BOARD_STATE_KEY, JSON.stringify({
        sessionID: state.sessionID,
        currentLevelGoal: state.currentLevelGoal,
        wires: state.wires,
        placedComponents: state.placedComponents,
        checkAttemptCount: state.checkAttemptCount,
        levelStartedAt: state.levelStartedAt,
        challengeInstanceID: state.challengeInstanceID,
        nextComponentID: state.nextComponentID,
        activeAuditErrors: state.activeAuditErrors,
        archivedAuditErrors: state.archivedAuditErrors,
        actionHistory: state.actionHistory,
        level3Tier: state.level3Tier,
        level3CorrectStreak: state.level3CorrectStreak,
        level4Tier: state.level4Tier,
        level4CorrectStreak: state.level4CorrectStreak,
        level5ComponentCount: state.level5ComponentCount,
        level5CorrectStreak: state.level5CorrectStreak,
      }));
    } catch (err) {}
  }

  function clearBoardState() {
    try {
      localStorage.removeItem(BOARD_STATE_KEY);
    } catch (err) {}
  }

  function restoreBoardStateIfPresent() {
    try {
      const raw = localStorage.getItem(BOARD_STATE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || saved.sessionID !== state.sessionID) {
        clearBoardState();
        return false;
      }
      state.currentLevelGoal      = saved.currentLevelGoal;
      state.wires                  = saved.wires                || [];
      state.placedComponents       = saved.placedComponents      || [];
      state.checkAttemptCount      = saved.checkAttemptCount     || 0;
      state.levelStartedAt         = saved.levelStartedAt        || Date.now();
      state.challengeInstanceID    = saved.challengeInstanceID   || null;
      state.nextComponentID        = saved.nextComponentID       || 1;
      state.activeAuditErrors      = saved.activeAuditErrors     || [];
      state.archivedAuditErrors    = saved.archivedAuditErrors   || [];
      state.actionHistory          = saved.actionHistory         || [];
      state.level3Tier             = saved.level3Tier             || 1;
      state.level3CorrectStreak    = saved.level3CorrectStreak   || 0;
      state.level4Tier             = saved.level4Tier             || 1;
      state.level4CorrectStreak    = saved.level4CorrectStreak   || 0;
      state.level5ComponentCount   = saved.level5ComponentCount  || 4;
      state.level5CorrectStreak    = saved.level5CorrectStreak   || 0;
      return true;
    } catch (err) {
      clearBoardState();
      return false;
    }
  }

  function resetSimulatorForEndedSession() {
    state.difficultyMode = "NORMAL";
    state.currentTool = null;
    state.currentRotation = "HORIZONTAL";
    state.startHole = null;
    state.wires = [];
    state.placedComponents = [];
    state.actionHistory = [];
    state.currentLevelGoal = null;
    state.levelStartedAt = Date.now();
    state.checkAttemptCount = 0;
    state.nextComponentID = 1;
    state.activePlacementError = null;
    state.activeAuditErrors = [];
    state.archivedAuditErrors = [];
    state.pendingSessionRows = [];
    state.lastSuccessExportRows = [];
    state.lastExportSignature = "";
    state.eventHistory = [];
    state.challengeInstanceID = null;
    setSignatureVisible(false);
    clearPlacementError();
    clearActiveAuditStack();
    renderHistory();
    dom.toolButtons.forEach((button) => button.classList.remove("active"));
    if (dom.modeToggleBtn) dom.modeToggleBtn.textContent = "Mode: Normal";
    if (dom.levelSelect) dom.levelSelect.value = "1";
    drawEverything();
    drawSchematic();
  }

  function populateStudentOptions(names) {
    if (!dom.studentSelect) return;
    dom.studentSelect.innerHTML = '<option value="">Select your name</option>';
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      dom.studentSelect.appendChild(option);
    });
  }

  function fetchRosterFromScript() {
    const url = `${GOOGLE_SCRIPT_URL}?action=getStudents&_t=${Date.now()}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.students) && data.students.length > 0) {
          populateStudentOptions(data.students);
        }
      })
      .catch(() => {
        // Silently keep the hardcoded fallback already populated
      });
  }

  function setCurrentStudentName(name) {
    if (!dom.currentStudentName) return;
    dom.currentStudentName.textContent = name || "Not signed in";
  }

  function lockSimulator() {
    state.isUnlocked = false;
    state.studentName = "";
    state.isGuestMode = false;
    clearTabSession();
    clearBoardState();
    if (dom.appContainer) dom.appContainer.classList.add("is-locked");
    if (dom.splashOverlay) {
      dom.splashOverlay.classList.remove("is-hidden");
      dom.splashOverlay.setAttribute("aria-hidden", "false");
    }
    if (dom.splashError) dom.splashError.textContent = "";
    setCurrentStudentName("");

    window.setTimeout(() => {
      try { dom.studentSelect.focus(); } catch (err) {}
    }, 0);
  }

  function unlockSimulator(studentName) {
    state.isUnlocked = true;
    state.studentName = studentName;
    if (dom.appContainer) dom.appContainer.classList.remove("is-locked");
    if (dom.splashOverlay) {
      dom.splashOverlay.classList.add("is-hidden");
      dom.splashOverlay.setAttribute("aria-hidden", "true");
    }
    if (dom.splashError) dom.splashError.textContent = "";
    if (dom.splashPassword) dom.splashPassword.value = "";
    setCurrentStudentName(studentName);
    saveTabSession();
    updateStatus(`Welcome, ${studentName}. LOAD a challenge to begin!`);
  }

  function handleSplashSubmit() {
    const selectedStudent = dom.studentSelect.value.trim();
    const enteredPassword = dom.splashPassword.value;
    const isMasterBypass = Boolean(MASTER_BYPASS_PASSWORD) && enteredPassword === MASTER_BYPASS_PASSWORD;
    const isGuestBypass  = Boolean(GUEST_BYPASS_PASSWORD)  && enteredPassword === GUEST_BYPASS_PASSWORD;

    if (!isMasterBypass && !isGuestBypass && !selectedStudent) {
      dom.splashError.textContent = "Select a student name before entering the simulator.";
      dom.studentSelect.focus();
      return;
    }

    if (!isMasterBypass && !isGuestBypass && SPLASH_PASSWORD && enteredPassword !== SPLASH_PASSWORD) {
      dom.splashError.textContent = "Incorrect password.";
      dom.splashPassword.select();
      return;
    }

    state.isGuestMode = isGuestBypass;
    state.sessionID = createSessionID();
    state.level3Tier = 1;
    state.level3CorrectStreak = 0;
    state.level4Tier = 1;
    state.level4CorrectStreak = 0;
    state.level5ComponentCount = 4;
    state.level5CorrectStreak = 0;
    unlockSimulator(isMasterBypass ? MASTER_BYPASS_NAME : isGuestBypass ? GUEST_BYPASS_NAME : selectedStudent);
    saveBoardState(); // persist tier/streak reset immediately so a reload won't restore stale values
  }

  function handleEndSession() {
    if (!state.isUnlocked) return;

    const confirmed = window.confirm("End this session and return to the login screen?");
    if (!confirmed) return;

    resetSimulatorForEndedSession();
    if (dom.studentSelect) dom.studentSelect.value = "";
    if (dom.splashPassword) dom.splashPassword.value = "";
    state.sessionID = createSessionID();
    updateStatus("LOAD a challenge to begin");
    lockSimulator();
  }

  function createChallengeInstanceID() {
    return `chal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getCurrentLevelID() {
    return state.currentLevelGoal ? state.currentLevelGoal.id : null;
  }

  function getCurrentCircuitLogic() {
    return JSON.stringify(state.currentLevelGoal ? state.currentLevelGoal.required_nets : []);
  }

  function isNonPolarizedType(type) {
    return NON_POLARIZED_TYPES.has(type);
  }

  function isThreePinType(type) {
    return THREE_PIN_PARTS.includes(type);
  }

  function getCenterPinLabel(type) {
    if (type === "SLIDE_SWITCH") return "Common";
    if (type === "POT") return "Wiper";
    return "mid";
  }

  function resetLevelSessionState() {
    state.levelStartedAt = Date.now();
    state.checkAttemptCount = 0;
    state.activePlacementError = null;
    state.activeAuditErrors = [];
    state.archivedAuditErrors = [];
    state.lastSuccessExportRows = [];
    state.lastExportSignature = "";
    state.eventHistory = [];
    clearPlacementError();
    renderActiveAuditStack();
    renderHistory();
    updateCheckButtonState();
  }

  function logSessionEvent(eventType, details = {}) {
    state.eventHistory.push({
      timestamp: new Date().toISOString(),
      sessionID: state.sessionID,
      levelID: getCurrentLevelID(),
      eventType,
      ...details,
    });
  }

  function makeAuditEntry(errorType, errorDetail, details = {}) {
    return {
      timestamp: new Date().toISOString(),
      sessionID: state.sessionID,
      studentName: state.studentName,
      levelID: getCurrentLevelID(),
      errorType,
      attemptNumber: state.checkAttemptCount,
      timeSpent: Date.now() - state.levelStartedAt,
      errorDetail,
      circuitLogic: getCurrentCircuitLogic(),
      challengeInstanceID: state.challengeInstanceID,
      ...details,
    };
  }

  function queueSessionExportRow(errorType, errorDetail, overrides = {}) {
    state.pendingSessionRows.push({
      Timestamp: new Date().toISOString(),
      Session_ID: state.sessionID,
      Student_Name: state.studentName,
      Level_ID: getCurrentLevelID(),
      Error_Type: errorType,
      Attempt_Number: 0,
      Time_Spent: 0,
      Error_Detail: errorDetail,
      Circuit_Logic: getCurrentCircuitLogic(),
      ...overrides,
    });
  }

  function buildSuccessExportRows() {
    return [{
      Timestamp: new Date().toISOString(),
      Session_ID: state.sessionID,
      Student_Name: state.studentName,
      Level_ID: getCurrentLevelID(),
      Error_Type: "NONE",
      Attempt_Number: state.checkAttemptCount,
      Time_Spent: Date.now() - state.levelStartedAt,
      Error_Detail: "Completed successfully.",
      Circuit_Logic: getCurrentCircuitLogic(),
      Challenge_Instance_ID: state.challengeInstanceID,
    }];
  }

  function buildCheckPayload(resultLabel) {
    return {
      sessionID: state.sessionID,
      name: state.studentName,
      level: getCurrentLevelID(),
      eventType: "CHECK",
      attempt: state.checkAttemptCount,
      timeSpent: Date.now() - state.levelStartedAt,
      errorDetail: state.archivedAuditErrors.map((entry) => `${entry.errorType}: ${entry.errorDetail}`).join(" | "),
      circuitLogic: getCurrentCircuitLogic(),
      result: resultLabel,
    };
  }

  function mapExportRowToScriptParams(row) {
    return {
      sessionID: row.Session_ID,
      name: row.Student_Name,
      level: row.Level_ID,
      errorType: row.Error_Type,
      attempt: row.Attempt_Number,
      timeSpent: row.Time_Spent,
      errorDetail: row.Error_Detail,
      circuitLogic: row.Circuit_Logic,
      challengeInstanceID: row.Challenge_Instance_ID || "",
    };
  }

  function buildBatchExportRows(rows) {
    return rows.map((row) => mapExportRowToScriptParams(row));
  }

  function buildBatchExportUrl(rows) {
    const params = new URLSearchParams({
      rows: JSON.stringify(buildBatchExportRows(rows)),
      _t: String(Date.now()),
    });
    return `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
  }

  function openExportPopupShell() {
    try {
      const popupName = `circuitLoggerExport_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const popup = window.open("about:blank", popupName, "popup=yes,width=420,height=240");
      if (popup && !popup.closed) {
        try {
          popup.document.title = "Sending audit log...";
          popup.document.body.style.fontFamily = "Arial, sans-serif";
          popup.document.body.style.padding = "16px";
          popup.document.body.textContent = "Sending audit log...";
        } catch (err) {
          // ignore cross-origin or timing issues
        }
      }
      return popup;
    } catch (err) {
      return null;
    }
  }

  function closeExportPopupShell(popup) {
    try {
      if (popup && !popup.closed) popup.close();
    } catch (err) {
      // ignore
    }
  }

  function beaconExportRow(row) {
    if (state.isGuestMode) return;
    try {
      const params = new URLSearchParams({
        rows: JSON.stringify([mapExportRowToScriptParams(row)]),
        _t: String(Date.now()),
      });
      const img = new Image();
      img.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    } catch (err) {
      logSessionEvent("BEACON_ERROR", { message: String(err) });
    }
  }

  function beaconExportRows(rows) {
    if (state.isGuestMode) return;
    try {
      const params = new URLSearchParams({
        rows: JSON.stringify(buildBatchExportRows(rows)),
        _t: String(Date.now()),
      });
      const img = new Image();
      img.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    } catch (err) {
      logSessionEvent("BEACON_ERROR", { message: String(err) });
    }
  }

  function auditIssuesToExportRows(issues) {
    return issues.map((entry) => ({
      Timestamp: entry.timestamp,
      Session_ID: entry.sessionID,
      Student_Name: entry.studentName,
      Level_ID: entry.levelID,
      Error_Type: entry.errorType,
      Attempt_Number: entry.attemptNumber,
      Time_Spent: entry.timeSpent,
      Error_Detail: entry.errorDetail,
      Circuit_Logic: entry.circuitLogic,
      Challenge_Instance_ID: entry.challengeInstanceID || "",
    }));
  }

  function exportSuccessRowsToGoogleScript(rows, popup) {
    if (!Array.isArray(rows) || rows.length === 0) return false;

    const signature = JSON.stringify(rows);
    if (signature === state.lastExportSignature) return false;

    if (!popup || popup.closed) {
      logSessionEvent("EXPORT_BLOCKED", {
        exportRowCount: rows.length,
      });
      return false;
    }

    try {
      popup.location.href = buildBatchExportUrl(rows);
      window.setTimeout(() => {
        closeExportPopupShell(popup);
      }, 3000);
      state.lastExportSignature = signature;
      state.pendingSessionRows = [];

      logSessionEvent("EXPORT_SENT", {
        exportRowCount: rows.length,
      });

      return true;
    } catch (err) {
      logSessionEvent("EXPORT_ERROR", {
        message: String(err),
      });
      closeExportPopupShell(popup);
      return false;
    }
  }


  

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatHistoryTimestamp(isoString) {
    const date = new Date(isoString);
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatAuditEntry(entry) {
    return `${entry.errorType}: ${entry.errorDetail}`;
  }

  function getActiveAuditSummary(entry) {
    switch (entry.errorType) {
      case "Missing Element":
        return "A required element is missing from your circuit.";
      case "Wrong Connection":
        return "One of your connections uses the wrong element or the wrong node.";
      case "Missed Connection":
        return "A required connection is still open.";
      case "Extra Connection":
        return "One of your required nodes has extra connections.";
      case "Extra Connection: Pin Hijacked!":
        return "A breakout pin row is being used for an unrelated connection.";
      case "Short Circuit":
        return "One of your elements is shorted because both leads are electrically common.";
      case "Wrong Pin":
        return "A required element is connected to the wrong breakout pin.";
      default:
        return entry.errorDetail;
    }
  }

  function renderHistory() {
    if (!dom.historyList || !dom.historyCount) return;

    dom.historyCount.textContent = String(state.archivedAuditErrors.length);

    if (state.archivedAuditErrors.length === 0) {
      dom.historyList.innerHTML = '<li class="history-empty">No archived audit results yet.</li>';
      return;
    }

    const recentEntries = state.archivedAuditErrors.slice(-6).reverse();
    dom.historyList.innerHTML = recentEntries
      .map((entry) => (
        `<li class="history-entry">` +
          `<span class="history-entry-time">${formatHistoryTimestamp(entry.timestamp)}</span>` +
          `<span class="history-entry-text">${escapeHtml(getActiveAuditSummary(entry))}</span>` +
        `</li>`
      ))
      .join("");
  }

  function renderActiveAuditStack() {
    if (!dom.auditPanel || !dom.auditList || !dom.auditCount) return;

    dom.auditCount.textContent = String(state.activeAuditErrors.length);

    if (state.activeAuditErrors.length === 0) {
      dom.auditPanel.classList.remove("is-visible");
      dom.auditPanel.setAttribute("aria-hidden", "true");
      dom.auditList.innerHTML = '<li class="audit-empty">No active audit results.</li>';
      return;
    }

    dom.auditPanel.classList.add("is-visible");
    dom.auditPanel.setAttribute("aria-hidden", "false");
    dom.auditList.innerHTML = state.activeAuditErrors
      .map((entry) => (
        `<li class="audit-entry">` +
          `<span class="audit-entry-type">${escapeHtml(entry.errorType)}</span>` +
          `<span class="audit-entry-text">${escapeHtml(getActiveAuditSummary(entry))}</span>` +
        `</li>`
      ))
      .join("");
  }

  function setStatusMessage(message, type = "default") {
    dom.statusMessage.textContent = message;
    dom.statusMessage.classList.toggle("status-success", type === "success");

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function composePlacementMessage(errorType, errorDetail = "") {
    return errorDetail ? `${errorType}: ${errorDetail}` : errorType;
  }

  function updateCheckButtonState() {
    dom.checkBtn.disabled = Boolean(state.activePlacementError);
    dom.checkBtn.title = state.activePlacementError
      ? "Clear placement errors before checking the circuit."
      : "Run the circuit audit.";
  }

  function setPlacementError(errorType, errorDetail = "") {
    state.activePlacementError = { errorType, errorDetail };
    dom.placementError.textContent = composePlacementMessage(errorType, errorDetail);
    dom.placementError.classList.add("is-visible");
    dom.placementError.setAttribute("aria-hidden", "false");
    updateCheckButtonState();
  }

  function clearPlacementError() {
    state.activePlacementError = null;
    dom.placementError.textContent = "";
    dom.placementError.classList.remove("is-visible");
    dom.placementError.setAttribute("aria-hidden", "true");
    updateCheckButtonState();
  }

  function archiveActiveAuditErrors() {
    if (state.activeAuditErrors.length > 0) {
      state.archivedAuditErrors.push(...state.activeAuditErrors);
      state.activeAuditErrors = [];
      renderHistory();
      renderActiveAuditStack();
    }
  }

  function clearActiveAuditStack() {
    state.activeAuditErrors = [];
    renderActiveAuditStack();
  }

  function setActiveAuditErrors(errors) {
    state.activeAuditErrors = errors.map((entry) => ({ ...entry }));
    renderActiveAuditStack();
  }

  function updateStatus(message, type = "default") {
    if (type === "success") {
      setStatusMessage(message, "success");
      return;
    }

    setStatusMessage(message, "default");
  }

  function setSignatureVisible(isVisible) {
    dom.signature.style.opacity = isVisible ? "0.6" : "0";
  }

  function selectTool(tool) {
    if (!state.isUnlocked) return;
    clearPlacementError();

    if (state.currentTool === tool) {
      state.currentTool = null;
      state.startHole = null;
      state.ghostHole = null;
      updateStatus("LOAD a challenge to begin");
    } else {
      state.currentTool = tool;
      state.startHole = null;
      state.ghostHole = null;

      switch (tool) {
        case "WIRE":
          updateStatus("Wire: Click a hole to start the connection");
          break;
        case "LED":
          updateStatus("LED: Click a hole to place the Anode (+)");
          break;
        case "RESISTOR":
          updateStatus("Resistor: Click a hole to place the first lead");
          break;
        case "BUZZER":
        case "SWITCH":
          updateStatus(`${COMPONENT_TYPES[tool].name}: Left click to place, right click to rotate`);
          break;
        case "SLIDE_SWITCH":
        case "POT":
          updateStatus(`${COMPONENT_TYPES[tool].name}: Click the center pin hole — right-click to rotate`);
          break;
        case "TRASH":
          updateStatus("Trash: Click a component or wire to remove it");
          break;
        default:
          updateStatus(`${tool} selected`);
      }
    }

    dom.toolButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === state.currentTool);
    });

    drawEverything();
  }

  function toggleMode() {
    if (!state.isUnlocked) return;
    clearPlacementError();
    state.difficultyMode = state.difficultyMode === "NORMAL" ? "PRO" : "NORMAL";
    dom.modeToggleBtn.textContent = `Mode: ${state.difficultyMode === "NORMAL" ? "Normal" : "Pro"}`;
    updateStatus(`Difficulty: ${state.difficultyMode}`);
    drawEverything();
  }

  // ============================================================
  // STATE MUTATION / UNDO
  // ============================================================
  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function recordAction(action) {
    state.actionHistory.push(cloneData(action));
  }

  function addWire(wire) {
    state.wires.push(wire);
    recordAction({ type: "ADD_WIRE", wire });
  }

  function addComponent(component) {
    const componentToAdd = {
      id: component.id ?? `cmp-${state.nextComponentID++}`,
      ...component,
    };
    state.placedComponents.push(componentToAdd);
    recordAction({ type: "ADD_COMPONENT", component: componentToAdd });
  }

  function removeWireAtIndex(index) {
    const [removed] = state.wires.splice(index, 1);
    if (removed) recordAction({ type: "REMOVE_WIRE", wire: removed, index });
    return removed;
  }

  function removeComponentAtIndex(index) {
    const [removed] = state.placedComponents.splice(index, 1);
    if (removed) recordAction({ type: "REMOVE_COMPONENT", component: removed, index });
    return removed;
  }

  function clearBoard(showPrompt = true, forLevelLoad = false) {
    if (!state.isUnlocked) return;
    if (showPrompt && !window.confirm("Are you sure you want to clear your circuit?")) {
      return;
    }

    if (state.wires.length === 0 && state.placedComponents.length === 0) {
      if (!forLevelLoad) updateStatus("Board is already clear.");
      return;
    }

    recordAction({
      type: "CLEAR_BOARD",
      wires: state.wires,
      components: state.placedComponents,
    });

    state.wires = [];
    state.placedComponents = [];
    state.startHole = null;
    setSignatureVisible(false);
    clearPlacementError();
    drawEverything();

    if (!forLevelLoad) {
      updateStatus("Board cleared.");
    }
  }

  function undoLastAction() {
    if (!state.isUnlocked) return;
    const action = state.actionHistory.pop();
    if (!action) {
      updateStatus("Nothing to undo!");
      return;
    }

    switch (action.type) {
      case "ADD_WIRE": {
        const lastIndex = state.wires.findIndex((wire) => areConnectionsEqual(wire, action.wire));
        if (lastIndex >= 0) state.wires.splice(lastIndex, 1);
        break;
      }
      case "ADD_COMPONENT": {
        const lastIndex = state.placedComponents.findIndex(
          (component) => areConnectionsEqual(component, action.component) && component.type === action.component.type
        );
        if (lastIndex >= 0) state.placedComponents.splice(lastIndex, 1);
        break;
      }
      case "REMOVE_WIRE":
        state.wires.splice(Math.min(action.index, state.wires.length), 0, action.wire);
        break;
      case "REMOVE_COMPONENT":
        state.placedComponents.splice(Math.min(action.index, state.placedComponents.length), 0, action.component);
        break;
      case "CLEAR_BOARD":
        state.wires = action.wires;
        state.placedComponents = action.components;
        break;
      default:
        break;
    }

    setSignatureVisible(false);
    clearPlacementError();
    updateStatus("Last action undone.");
    drawEverything();
  }

  function areConnectionsEqual(a, b) {
    return (
      a.from.netID === b.from.netID &&
      a.to.netID === b.to.netID &&
      a.from.x === b.from.x &&
      a.from.y === b.from.y &&
      a.to.x === b.to.x &&
      a.to.y === b.to.y
    );
  }

  // ============================================================
  // BOARD GEOMETRY
  // ============================================================
  function getBoardHeight() {
    return ROWS_PER_SIDE * 2 * SPACING + 200;
  }

  function getHoleXByColIndex(colIndex) {
    return FIRST_HOLE_X + colIndex * SPACING;
  }

  function getHoleYByRowIndex(rowIndex) {
    const trenchOffset = rowIndex >= 5 ? TRENCH_GAP_PX : 0;
    return FIRST_HOLE_Y + rowIndex * SPACING + trenchOffset;
  }

  function getRowLabelByIndex(rowIndex) {
    return ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][rowIndex];
  }

  function getRowIndexByLabel(rowLabel) {
    return ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].indexOf(rowLabel);
  }

  function createStandardHole(colIndex, rowIndex) {
    const rowLabel = getRowLabelByIndex(rowIndex);
    const bank = rowIndex < 5 ? "TOP" : "BOTTOM";
    const isMCU = rowIndex === 0 && colIndex >= BREAKOUT_START_COL_INDEX && colIndex < BREAKOUT_START_COL_INDEX + SPARKFUN_PINS.length;
    const pinLabel = isMCU ? SPARKFUN_PINS[colIndex - BREAKOUT_START_COL_INDEX] : null;

    return {
      x: getHoleXByColIndex(colIndex),
      y: getHoleYByRowIndex(rowIndex),
      col: colIndex + 1,
      rowLabel,
      isMCU,
      isRail: false,
      netID: isMCU ? `MCU_${pinLabel}` : `BB_${bank}_COL_${colIndex + 1}`,
    };
  }

  function createRailHole(colIndex, netID, y) {
    return {
      x: getHoleXByColIndex(colIndex),
      y,
      col: colIndex + 1,
      rowLabel: null,
      isMCU: false,
      isRail: true,
      netID,
    };
  }

  function findNearestHole(clientX, clientY) {
    const rect = dom.breadboardCanvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const boardY = mouseY - BOARD_VERTICAL_OFFSET;

    const colIndex = Math.round((mouseX - FIRST_HOLE_X) / SPACING);
    if (colIndex < 0 || colIndex >= TOTAL_COLUMNS) return null;

    const snappedX = getHoleXByColIndex(colIndex);

    if (Math.abs(boardY - RAIL_TOP_RED_Y) <= CLICK_TOLERANCE) {
      return createRailHole(colIndex, "RAIL_TOP_RED", RAIL_TOP_RED_Y);
    }
    if (Math.abs(boardY - RAIL_TOP_BLUE_Y) <= CLICK_TOLERANCE) {
      return createRailHole(colIndex, "RAIL_TOP_BLUE", RAIL_TOP_BLUE_Y);
    }
    if (Math.abs(boardY - RAIL_BOTTOM_RED_Y) <= CLICK_TOLERANCE) {
      return createRailHole(colIndex, "RAIL_BOT_RED", RAIL_BOTTOM_RED_Y);
    }
    if (Math.abs(boardY - RAIL_BOTTOM_BLUE_Y) <= CLICK_TOLERANCE) {
      return createRailHole(colIndex, "RAIL_BOT_BLUE", RAIL_BOTTOM_BLUE_Y);
    }

    for (let rowIndex = 0; rowIndex < TOTAL_ROWS; rowIndex += 1) {
      const holeY = getHoleYByRowIndex(rowIndex);
      if (Math.abs(boardY - holeY) <= CLICK_TOLERANCE) {
        return createStandardHole(colIndex, rowIndex);
      }
    }

    return null;
  }

  function isHoleOccupied(hole) {
    if (!hole) return false;

    const occupiedByWire = state.wires.some((wire) => sameHole(wire.from, hole) || sameHole(wire.to, hole));
    if (occupiedByWire) return true;

    return state.placedComponents.some((component) => {
      // Exact pin match (always checked for all component types)
      if (sameHole(component.from, hole) || sameHole(component.to, hole)) return true;
      if (component.mid && sameHole(component.mid, hole)) return true;

      // POT: block any hole that falls inside the dial body (body is offset from mid pin)
      if (component.type === "POT" && component.mid) {
        const bc = getPOTBodyCenter(component);
        if (bc && Math.hypot(hole.x - bc.x, hole.y - bc.y) < bc.r) return true;
      }

      return false;
    });
  }

  // Returns the body-circle centre and radius for a placed POT.
  // The body is offset away from the pin column/row so that pins land at the body edge.
  function getPOTBodyCenter(comp) {
    if (!comp || !comp.mid) return null;
    const isVert = comp.from && comp.to && Math.abs(comp.from.x - comp.to.x) < 1;
    if (isVert) {
      return { x: comp.mid.x - POT_BODY_OFFSET, y: comp.mid.y, r: POT_BODY_RADIUS };
    } else {
      return { x: comp.mid.x, y: comp.mid.y - POT_BODY_OFFSET, r: POT_BODY_RADIUS };
    }
  }

  function sameHole(a, b) {
    return a.netID === b.netID && a.x === b.x && a.y === b.y;
  }

  function getDistanceToSegment(px, py, x1, y1, x2, y2) {
    const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);

    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const projectedX = x1 + t * (x2 - x1);
    const projectedY = y1 + t * (y2 - y1);
    return Math.hypot(px - projectedX, py - projectedY);
  }

  // ============================================================
  // PLACEMENT LOGIC
  // ============================================================
  function handleBreadboardClick(event) {
    if (!state.isUnlocked) return;
    if (!state.currentTool) return;

    if (state.currentTool === "TRASH") {
      handleTrashClick(event);
      return;
    }

    const hole = findNearestHole(event.clientX, event.clientY);
    if (!hole) return;

    if (state.currentTool === "BUZZER" || state.currentTool === "SWITCH") {
      handleLargeComponentPlacement(hole);
      return;
    }

    if (state.currentTool === "SLIDE_SWITCH" || state.currentTool === "POT") {
      handleThreePinPlacement(hole);
      return;
    }

    handleTwoClickPlacement(hole);
  }

  function getComponentTrashDistance(component, mouseX, mouseY) {
    const from = component.from;
    const to = component.to;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    // Small two-pin bodies: make the visible body clickable, not just the holes
    if (component.type === "LED" || component.type === "RESISTOR") {
      const lineDistance = getDistanceToSegment(mouseX, mouseY, from.x, from.y, to.x, to.y);
      const centerDistance = Math.hypot(mouseX - midX, mouseY - midY);

      // Treat the body as a small oval around the middle of the component
      const clickedBody = lineDistance <= 9 && centerDistance <= 20;
      return clickedBody ? centerDistance : Infinity;
    }

    // Larger bodies can still use the old logic
    return Math.min(
      Math.hypot(mouseX - from.x, mouseY - from.y),
      Math.hypot(mouseX - to.x, mouseY - to.y),
      Math.hypot(mouseX - midX, mouseY - midY)
    );
  }

  function handleTrashClick(event) {
    const rect = dom.breadboardCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top - BOARD_VERTICAL_OFFSET;

    let bestWire = null;
    let bestWireDistance = Infinity;
    state.wires.forEach((wire, index) => {
      const distance = getDistanceToSegment(mouseX, mouseY, wire.from.x, wire.from.y, wire.to.x, wire.to.y);
      if (distance < bestWireDistance) {
        bestWireDistance = distance;
        bestWire = { index, distance };
      }
    });

    let bestComponent = null;
    let bestComponentDistance = Infinity;

    state.placedComponents.forEach((component, index) => {
      const from = component.from;
      const to = component.to;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;

      let distance;

      if (component.type === "LED" || component.type === "RESISTOR") {
        const lineDistance = getDistanceToSegment(mouseX, mouseY, from.x, from.y, to.x, to.y);
        const centerDistance = Math.hypot(mouseX - midX, mouseY - midY);
        const clickedBody = lineDistance <= 9 && centerDistance <= 20;
        distance = clickedBody ? centerDistance : Infinity;
      } else if (component.type === "POT") {
        // Hit-test the dial body (offset from mid pin) as well as the pin holes
        const bc = getPOTBodyCenter(component);
        const bodyDist = bc ? Math.hypot(mouseX - bc.x, mouseY - bc.y) : Infinity;
        const pinDist  = Math.min(
          Math.hypot(mouseX - from.x, mouseY - from.y),
          Math.hypot(mouseX - to.x,   mouseY - to.y),
          Math.hypot(mouseX - midX,   mouseY - midY)
        );
        // Accept body click if inside bezel; pin holes use standard threshold
        distance = bodyDist <= bc.r ? bodyDist : pinDist;
      } else {
        distance = Math.min(
          Math.hypot(mouseX - from.x, mouseY - from.y),
          Math.hypot(mouseX - to.x, mouseY - to.y),
          Math.hypot(mouseX - midX, mouseY - midY)
        );
      }

      if (distance < bestComponentDistance) {
        bestComponentDistance = distance;
        bestComponent = { index, distance };
      }
    });

    const canDeleteWire = bestWire && bestWire.distance <= 20;
    const canDeleteComponent = bestComponent && bestComponent.distance <= 25;

    if (!canDeleteWire && !canDeleteComponent) return;

    if (canDeleteComponent && (!canDeleteWire || bestComponent.distance <= bestWire.distance)) {
      removeComponentAtIndex(bestComponent.index);
      updateStatus("Component removed.");
    } else {
      removeWireAtIndex(bestWire.index);
      updateStatus("Wire removed.");
    }

    clearPlacementError();
    state.startHole = null;
    setSignatureVisible(false);
    drawEverything();
  }

  function handleLargeComponentPlacement(startHole) {
    if (isHoleOccupied(startHole)) {
      setPlacementError("Space Occupied", "Choose a different landing hole.");
      drawEverything();
      drawOccupiedHoleIndicator(startHole);
      return;
    }

    const targetHole = findLargeComponentTargetHole(startHole, state.currentTool, state.currentRotation);
    if (!targetHole) {
      setPlacementError("Invalid Footprint", "No room for that component footprint in the current orientation.");
      return;
    }

    if (isHoleOccupied(targetHole)) {
      setPlacementError("Space Occupied", "Choose a different landing hole.");
      drawEverything();
      drawOccupiedHoleIndicator(targetHole);
      return;
    }

    const overlap = detectBodyOverlap(startHole, targetHole, state.currentTool);
    if (overlap) {
      setPlacementError("Bodies Overlapping", "Move the component so its body clears the existing part.");
      drawEverything();
      drawBodyOverlapIndicator(startHole, targetHole, state.currentTool);
      return;
    }

    clearPlacementError();
    addComponent({
      type: state.currentTool,
      from: startHole,
      to: targetHole,
      rotation: state.currentRotation,
    });

    state.startHole = null;
    setSignatureVisible(false);
    updateStatus(`${COMPONENT_TYPES[state.currentTool].name} placed.`);
    drawEverything();
  }

  function handleTwoClickPlacement(hole) {
    if (!state.startHole) {
      if (isHoleOccupied(hole)) {
        setPlacementError("Space Occupied", "Choose a different landing hole.");
        drawEverything();
        drawOccupiedHoleIndicator(hole);
        return;
      }

      clearPlacementError();
      state.startHole = hole;
      updateStatus(`${COMPONENT_TYPES[state.currentTool].name}: Click the second hole`);
      drawEverything();
      return;
    }

    if (sameHole(state.startHole, hole)) {
      state.startHole = null;
      clearPlacementError();
      updateStatus("Cancelled.");
      drawEverything();
      return;
    }

    if (isHoleOccupied(hole)) {
      state.startHole = null;
      setPlacementError("Space Occupied", "Choose a different landing hole.");
      drawEverything();
      drawOccupiedHoleIndicator(hole);
      return;
    }

    clearPlacementError();
    if (state.currentTool === "WIRE") {
      addWire({ from: state.startHole, to: hole });
    } else {
      addComponent({
        type: state.currentTool,
        from: state.startHole,
        to: hole,
        rotation: "HORIZONTAL",
      });
    }

    state.startHole = null;
    setSignatureVisible(false);
    updateStatus("Success! Component placed.");
    drawEverything();
  }

  function handleThreePinPlacement(hole) {
    if (!hole) return;

    // 3-pin components can only land on standard board rows, not rails
    if (hole.isRail || !hole.rowLabel) {
      setPlacementError("Invalid Footprint", "3-pin components must be placed on board rows, not power rails.");
      return;
    }

    const rotation = state.currentRotation;
    const colIndex = hole.col - 1; // col is 1-based
    const rowIndex = getRowIndexByLabel(hole.rowLabel);

    // The clicked hole becomes the CENTER (mid) pin.
    // P1 (from) and P2 (to) are placed one step behind and ahead respectively.
    let fromHole, midHole, toHole;

    if (rotation === "HORIZONTAL") {
      if (colIndex < 1 || colIndex + 1 >= TOTAL_COLUMNS) {
        setPlacementError("Invalid Footprint", "Not enough room — click a hole at least one column from each edge.");
        return;
      }
      fromHole = createStandardHole(colIndex - 1, rowIndex);
      midHole  = hole;
      toHole   = createStandardHole(colIndex + 1, rowIndex);
    } else {
      // VERTICAL: P1 one row above the clicked hole, P2 one row below
      if (rowIndex < 1 || rowIndex + 1 >= TOTAL_ROWS) {
        setPlacementError("Invalid Footprint", "Not enough room — click a hole at least one row from each edge.");
        return;
      }
      // Guard: P1 and P2 must be in the same board half (no crossing the center trench)
      const fromHalf = (rowIndex - 1) <= 4 ? 0 : 1;
      const toHalf   = (rowIndex + 1) <= 4 ? 0 : 1;
      if (fromHalf !== toHalf) {
        setPlacementError("Crosses Trench", "This placement would span the center trench — move one row up or down.");
        return;
      }
      fromHole = createStandardHole(colIndex, rowIndex - 1);
      midHole  = hole;
      toHole   = createStandardHole(colIndex, rowIndex + 1);
    }

    if (!fromHole || !toHole) {
      setPlacementError("Invalid Footprint", "Could not compute pin positions — try a different hole.");
      return;
    }

    if (isHoleOccupied(fromHole)) {
      setPlacementError("Space Occupied", "The P1 hole is already occupied.");
      drawEverything(); drawOccupiedHoleIndicator(fromHole); return;
    }
    if (isHoleOccupied(midHole)) {
      setPlacementError("Space Occupied", "The center hole is already occupied.");
      drawEverything(); drawOccupiedHoleIndicator(midHole); return;
    }
    if (isHoleOccupied(toHole)) {
      setPlacementError("Space Occupied", "The P2 hole is already occupied.");
      drawEverything(); drawOccupiedHoleIndicator(toHole); return;
    }

    clearPlacementError();
    addComponent({
      type: state.currentTool,
      from: fromHole,
      mid:  midHole,
      to:   toHole,
      rotation,
    });

    setSignatureVisible(false);
    updateStatus(`${COMPONENT_TYPES[state.currentTool].name} placed.`);
    drawEverything();
  }

  function findLargeComponentTargetHole(startHole, tool, rotation) {
    const startRowIndex = getRowIndexByLabel(startHole.rowLabel);
    const startColIndex = startHole.col - 1;

    if (startRowIndex < 0 || startColIndex < 0) return null;

    if (rotation === "HORIZONTAL") {
      const colOffset = tool === "BUZZER" ? 3 : 2;
      const targetColIndex = startColIndex + colOffset;
      if (targetColIndex >= TOTAL_COLUMNS) return null;
      return createStandardHole(targetColIndex, startRowIndex);
    }

    let targetRowIndex = null;

    if (tool === "SWITCH") {
      if (startRowIndex === 4) {
        targetRowIndex = 2;
      } else if (startRowIndex === 5) {
        targetRowIndex = 7;
      } else if (startRowIndex <= 4) {
        targetRowIndex = startRowIndex + 2 <= 4 ? startRowIndex + 2 : startRowIndex - 2;
      } else {
        targetRowIndex = startRowIndex - 2 >= 5 ? startRowIndex - 2 : startRowIndex + 2;
      }
    } else if (tool === "BUZZER") {
      if (startRowIndex === 4) {
        targetRowIndex = 5;
      } else if (startRowIndex === 5) {
        targetRowIndex = 4;
      } else if (startRowIndex <= 4) {
        targetRowIndex = startRowIndex + 3 <= 4 ? startRowIndex + 3 : startRowIndex - 3;
      } else {
        targetRowIndex = startRowIndex - 3 >= 5 ? startRowIndex - 3 : startRowIndex + 3;
      }
    }

    if (targetRowIndex === null || targetRowIndex < 0 || targetRowIndex >= TOTAL_ROWS) {
      return null;
    }

    return createStandardHole(startColIndex, targetRowIndex);
  }

  function detectBodyOverlap(fromHole, toHole, type) {
    const newCenterX = (fromHole.x + toHole.x) / 2;
    const newCenterY = (fromHole.y + toHole.y) / 2;
    const newRadius = BODY_RADIUS_BY_TYPE[type] || 12;

    return state.placedComponents.some((component) => {
      const existingCenterX = (component.from.x + component.to.x) / 2;
      const existingCenterY = (component.from.y + component.to.y) / 2;
      const existingRadius = BODY_RADIUS_BY_TYPE[component.type] || 12;
      return Math.hypot(newCenterX - existingCenterX, newCenterY - existingCenterY) < newRadius + existingRadius;
    });
  }

  // ============================================================
  // DRAWING
  // ============================================================
  function resizeCanvases() {
    const rect = dom.breadboardZone.getBoundingClientRect();
    dom.breadboardCanvas.width = rect.width;
    dom.breadboardCanvas.height = rect.height;
    drawEverything();
    drawSchematic();
  }

  function drawEverything() {
    bbCtx.clearRect(0, 0, dom.breadboardCanvas.width, dom.breadboardCanvas.height);
    bbCtx.save();
    bbCtx.translate(0, BOARD_VERTICAL_OFFSET);

    drawBreadboard();
    drawWires();
    drawComponents();
    drawStartHoleIndicator();
    drawGhostComponent();

    bbCtx.restore();
  }

  function drawBreadboard() {
    const boardHeight = getBoardHeight();
    const boardBodyX = MARGIN_X - 50;
    const boardBodyY = -10;
    const boardBodyWidth = dom.breadboardCanvas.width - MARGIN_X * 2 + 100;
    const breakoutWidth = SPARKFUN_PINS.length * SPACING;
    const breakoutX = getHoleXByColIndex(BREAKOUT_START_COL_INDEX) - 10;

    bbCtx.fillStyle = "#e6e0ff";
    bbCtx.shadowColor = "rgba(0,0,0,0.15)";
    bbCtx.shadowBlur = 12;
    bbCtx.shadowOffsetY = 6;
    roundRect(bbCtx, boardBodyX, boardBodyY, boardBodyWidth, boardHeight + 20, 15, true, false);
    bbCtx.shadowBlur = 0;
    bbCtx.shadowOffsetY = 0;

    bbCtx.fillStyle = "#a61d24";
    bbCtx.shadowColor = "rgba(0,0,0,0.35)";
    bbCtx.shadowBlur = 8;
    bbCtx.shadowOffsetY = 4;
    roundRect(bbCtx, breakoutX, 5, breakoutWidth + 20, 75, 5, true, false);
    bbCtx.shadowBlur = 0;
    bbCtx.shadowOffsetY = 0;

    bbCtx.fillStyle = "#111";
    bbCtx.fillRect(breakoutX, 75, breakoutWidth + 20, 30);

    drawPowerRail(RAIL_TOP_RED_Y, "+", "red");
    drawPowerRail(RAIL_TOP_BLUE_Y, "−", "blue");
    drawPowerRail(RAIL_BOTTOM_RED_Y, "+", "red");
    drawPowerRail(RAIL_BOTTOM_BLUE_Y, "−", "blue");

    for (let colIndex = 0; colIndex < TOTAL_COLUMNS; colIndex += 1) {
      const x = getHoleXByColIndex(colIndex);

      for (let rowIndex = 0; rowIndex < TOTAL_ROWS; rowIndex += 1) {
        const y = getHoleYByRowIndex(rowIndex);
        const isBreakoutPin = rowIndex === 0 && colIndex >= BREAKOUT_START_COL_INDEX && colIndex < BREAKOUT_START_COL_INDEX + SPARKFUN_PINS.length;

        if (isBreakoutPin) {
          drawHole(x, y, 4);
          bbCtx.fillStyle = "white";
          bbCtx.font = "bold 9px Arial";
          bbCtx.textAlign = "center";
          bbCtx.fillText(SPARKFUN_PINS[colIndex - BREAKOUT_START_COL_INDEX], x, 94);
        } else {
          drawHole(x, y, 3);
        }
      }

      bbCtx.fillStyle = "#666";
      bbCtx.font = "11px Arial";
      bbCtx.textAlign = "center";

      if (state.difficultyMode === "NORMAL") {
        if (colIndex % 2 === 0) bbCtx.fillText(String(colIndex + 1), x, 78);
        if (colIndex % 2 === 1) bbCtx.fillText(String(colIndex + 1), x, boardHeight - 68);
      } else if ((colIndex + 1) % 5 === 0) {
        bbCtx.fillText(String(colIndex + 1), x, 78);
        bbCtx.fillText(String(colIndex + 1), x, boardHeight - 68);
      }
    }

    bbCtx.fillStyle = "#555";
    bbCtx.font = "12px Arial";
    for (let rowIndex = 0; rowIndex < TOTAL_ROWS; rowIndex += 1) {
      const label = getRowLabelByIndex(rowIndex);
      const y = getHoleYByRowIndex(rowIndex) + 4;
      bbCtx.textAlign = "right";
      bbCtx.fillText(label, FIRST_HOLE_X - 20, y);
      bbCtx.textAlign = "left";
      bbCtx.fillText(label, getHoleXByColIndex(TOTAL_COLUMNS - 1) + 20, y);
    }
  }

  function drawPowerRail(y, sign, color) {
    bbCtx.save();
    const startX = getHoleXByColIndex(0);
    const endX = getHoleXByColIndex(TOTAL_COLUMNS - 1);

    bbCtx.strokeStyle = color;
    bbCtx.lineWidth = 1;
    bbCtx.beginPath();
    bbCtx.moveTo(startX, y);
    bbCtx.lineTo(endX, y);
    bbCtx.stroke();

    bbCtx.fillStyle = color;
    bbCtx.font = "bold 14px Arial";
    bbCtx.textAlign = "center";
    bbCtx.fillText(sign, startX - 15, y + 5);
    bbCtx.fillText(sign, endX + 15, y + 5);

    for (let colIndex = 0; colIndex < TOTAL_COLUMNS; colIndex += 1) {
      drawHole(getHoleXByColIndex(colIndex), y, 3);
    }
    bbCtx.restore();
  }

  function drawHole(x, y, radius) {
    bbCtx.beginPath();
    bbCtx.fillStyle = "#333";
    bbCtx.arc(x, y, radius, 0, Math.PI * 2);
    bbCtx.fill();
  }

  function drawWires() {
    state.wires.forEach((wire) => {
      bbCtx.beginPath();
      bbCtx.strokeStyle = "#1a73e8";
      bbCtx.lineWidth = 4;
      bbCtx.lineCap = "round";
      bbCtx.moveTo(wire.from.x, wire.from.y);
      bbCtx.lineTo(wire.to.x, wire.to.y);
      bbCtx.stroke();
    });
  }

  function drawComponents() {
    state.placedComponents.forEach((component) => {
      const from = { x: component.from.x, y: component.from.y };
      const to = { x: component.to.x, y: component.to.y };

      switch (component.type) {
        case "LED":
          drawLED(bbCtx, from, to);
          break;
        case "RESISTOR":
          drawResistor(bbCtx, from, to);
          break;
        case "BUZZER":
          drawBuzzer(bbCtx, from, to);
          break;
        case "SWITCH":
          drawSwitch(bbCtx, from, to);
          break;
        case "SLIDE_SWITCH":
          drawSlideSwitch(bbCtx, from, { x: component.mid.x, y: component.mid.y }, to, component.rotation);
          break;
        case "POT":
          drawPOT(bbCtx, from, { x: component.mid.x, y: component.mid.y }, to, component.rotation);
          break;
        default:
          break;
      }
    });
  }

  // Returns placement geometry for ghost preview — pure, no side effects.
  function computeGhostPlacement(tool, rotation, hole) {
    if (!hole || hole.isRail || !hole.rowLabel) return null;
    const colIndex = hole.col - 1;
    const rowIndex = getRowIndexByLabel(hole.rowLabel);

    if (tool === "BUZZER" || tool === "SWITCH") {
      const toHole = findLargeComponentTargetHole(hole, tool, rotation);
      return { valid: toHole !== null, from: hole, to: toHole || hole };
    }

    // SLIDE_SWITCH / POT — clicked hole is mid pin
    if (rotation === "HORIZONTAL") {
      if (colIndex < 1 || colIndex + 1 >= TOTAL_COLUMNS)
        return { valid: false, from: hole, mid: hole, to: hole };
      return {
        valid: true,
        from: createStandardHole(colIndex - 1, rowIndex),
        mid:  hole,
        to:   createStandardHole(colIndex + 1, rowIndex),
      };
    } else {
      if (rowIndex < 1 || rowIndex + 1 >= TOTAL_ROWS)
        return { valid: false, from: hole, mid: hole, to: hole };
      const fromHalf = (rowIndex - 1) <= 4 ? 0 : 1;
      const toHalf   = (rowIndex + 1) <= 4 ? 0 : 1;
      if (fromHalf !== toHalf)
        return { valid: false, from: hole, mid: hole, to: hole };
      return {
        valid: true,
        from: createStandardHole(colIndex, rowIndex - 1),
        mid:  hole,
        to:   createStandardHole(colIndex, rowIndex + 1),
      };
    }
  }

  function drawGhostComponent() {
    const GHOST_TOOLS = ["BUZZER", "SWITCH", "SLIDE_SWITCH", "POT"];
    if (!GHOST_TOOLS.includes(state.currentTool) || !state.ghostHole) return;

    const placement = computeGhostPlacement(state.currentTool, state.currentRotation, state.ghostHole);
    if (!placement) return;

    const f = { x: placement.from.x, y: placement.from.y };
    const t = { x: placement.to.x,   y: placement.to.y };
    const m = placement.mid ? { x: placement.mid.x, y: placement.mid.y } : null;

    bbCtx.save();
    bbCtx.globalAlpha = placement.valid ? 0.45 : 0.2;

    switch (state.currentTool) {
      case "BUZZER":      drawBuzzer(bbCtx, f, t);                                   break;
      case "SWITCH":      drawSwitch(bbCtx, f, t);                                   break;
      case "SLIDE_SWITCH": drawSlideSwitch(bbCtx, f, m, t, state.currentRotation);  break;
      case "POT":         drawPOT(bbCtx, f, m, t, state.currentRotation);           break;
    }

    bbCtx.restore();
  }

  function drawStartHoleIndicator() {
    if (!state.startHole) return;
    bbCtx.fillStyle = "rgba(0, 255, 0, 0.45)";
    bbCtx.beginPath();
    bbCtx.arc(state.startHole.x, state.startHole.y, 8, 0, Math.PI * 2);
    bbCtx.fill();
  }

  function drawOccupiedHoleIndicator(hole) {
    bbCtx.save();
    bbCtx.translate(0, BOARD_VERTICAL_OFFSET);
    bbCtx.fillStyle = "rgba(255, 0, 0, 0.7)";
    bbCtx.beginPath();
    bbCtx.arc(hole.x, hole.y, 8, 0, Math.PI * 2);
    bbCtx.fill();
    bbCtx.restore();
  }

  function drawBodyOverlapIndicator(fromHole, toHole, type) {
    const centerX = (fromHole.x + toHole.x) / 2;
    const centerY = (fromHole.y + toHole.y) / 2;
    const radius = BODY_RADIUS_BY_TYPE[type] || 12;

    bbCtx.save();
    bbCtx.translate(0, BOARD_VERTICAL_OFFSET);
    bbCtx.strokeStyle = "rgba(255, 0, 0, 0.85)";
    bbCtx.lineWidth = 3;
    bbCtx.beginPath();
    bbCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    bbCtx.stroke();
    bbCtx.restore();
  }

  function drawLED(ctx, from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    ctx.beginPath();
    ctx.strokeStyle = "#b0b0b0";
    ctx.lineWidth = 1.5;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 30, 30, 0.85)";
    ctx.arc(0, 0, 12, 0.25 * Math.PI, 1.75 * Math.PI);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(-4, -4, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawResistor(ctx, from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    ctx.beginPath();
    ctx.strokeStyle = "#b0b0b0";
    ctx.lineWidth = 1.2;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);

    ctx.fillStyle = "#4db6ac";
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    roundRect(ctx, -14, -6, 28, 12, 4, true, false);

    ctx.fillStyle = "#8b4513";
    ctx.fillRect(-8, -6, 3, 12);
    ctx.fillStyle = "#000000";
    ctx.fillRect(-2, -6, 3, 12);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(4, -6, 3, 12);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(10, -6, 2, 12);

    ctx.restore();
  }

  function drawBuzzer(ctx, from, to) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const radius = BODY_RADIUS_BY_TYPE.BUZZER;

    ctx.save();
    ctx.fillStyle = "#1a1a1a";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(midX, midY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(midX, midY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const plusX = midX + (from.x - midX) * 0.7;
    const plusY = midY + (from.y - midY) * 0.7;
    ctx.fillText("+", plusX, plusY);

    ctx.fillStyle = "#bdc3c7";
    ctx.beginPath();
    ctx.arc(from.x, from.y, 4, 0, Math.PI * 2);
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawSwitch(ctx, from, to) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const bodySize = SPACING * 2.3;

    ctx.save();
    ctx.translate(midX, midY);

    ctx.fillStyle = "#333";
    ctx.shadowBlur = 5;
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.fillRect(-bodySize / 2, -bodySize / 2, bodySize, bodySize);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#bdc3c7";
    ctx.beginPath();
    ctx.arc(0, 0, bodySize / 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#7f8c8d";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    [from, to].forEach((hole) => {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#2c3e50";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function drawSlideSwitch(ctx, from, mid, to, rotation = "HORIZONTAL") {
    // Body spans all 3 holes; center at the mid hole.
    // For VERTICAL placement the body is rotated 90° so the slide track runs vertically.
    const bodyW = SPACING * 2.4;  // long axis (along the slide direction)
    const bodyH = SPACING * 1.4;  // short axis
    const cx = mid.x;
    const cy = mid.y;

    ctx.save();
    ctx.translate(cx, cy);
    if (rotation === "VERTICAL") ctx.rotate(Math.PI / 2);

    // Body
    ctx.fillStyle = "#2c3e50";
    ctx.shadowBlur = 4;
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, 4, true, false);
    ctx.shadowBlur = 0;

    // Slider actuator
    ctx.fillStyle = "#95a5a6";
    roundRect(ctx, -8, -bodyH / 2 + 3, 16, bodyH - 6, 3, true, false);

    // Slide track line
    ctx.strokeStyle = "#1a252f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bodyW / 2 + 6, 0);
    ctx.lineTo(bodyW / 2 - 6, 0);
    ctx.stroke();

    ctx.restore();

    // Pin dots (always drawn at the actual hole positions, unaffected by rotation)
    [from, mid, to].forEach((hole) => {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#2c3e50";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function drawPOT(ctx, from, mid, to, rotation = "HORIZONTAL") {
    const outerR   = POT_BODY_RADIUS;         // 50px — dark bezel
    const innerR   = outerR - 7;              // 43px — blue dial face
    const tickR    = innerR - 4;              // 39px — outer tick radius
    const tickInR  = tickR - 8;              // 31px — inner tick radius
    const numTicks = 25;

    // Detect actual orientation from pin positions (same column = vertical)
    const isVert = Math.abs(from.x - to.x) < 1;

    // Body centre: offset away from the pin column/row
    const bodyCX = isVert ? mid.x - POT_BODY_OFFSET : mid.x;
    const bodyCY = isVert ? mid.y                    : mid.y - POT_BODY_OFFSET;

    // ── Leads: parallel lines from each pin to the body-circle edge ──
    // All leads run in the same axis (horizontal for VERTICAL orientation, vertical for HORIZONTAL).
    // The endpoint is the exact circle-intersection so leads terminate flush at the bezel.
    ctx.strokeStyle = "#7f8c8d";
    ctx.lineWidth   = 4;
    ctx.lineCap     = "round";
    [from, mid, to].forEach((pin) => {
      ctx.beginPath();
      ctx.moveTo(pin.x, pin.y);
      if (isVert) {
        // Horizontal lead: compute x where the horizontal line y=pin.y meets the body circle
        const dy   = pin.y - bodyCY;
        const disc = outerR * outerR - dy * dy;
        if (disc >= 0) {
          const edgeX = bodyCX + Math.sqrt(disc);   // rightmost intersection
          ctx.lineTo(edgeX, pin.y);
        }
      } else {
        // Vertical lead: compute y where the vertical line x=pin.x meets the body circle
        const dx   = pin.x - bodyCX;
        const disc = outerR * outerR - dx * dx;
        if (disc >= 0) {
          const edgeY = bodyCY + Math.sqrt(disc);   // bottom intersection
          ctx.lineTo(pin.x, edgeY);
        }
      }
      ctx.stroke();
    });
    ctx.lineCap = "butt";

    // ── Body ──
    ctx.save();
    ctx.translate(bodyCX, bodyCY);

    // Drop shadow
    ctx.shadowBlur  = 10;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.fillStyle   = "#1c2833";
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Bezel highlight ring
    ctx.strokeStyle = "#4d5f6e";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, outerR - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Inner bezel recess (dark groove between bezel edge and face)
    ctx.strokeStyle = "#111820";
    ctx.lineWidth   = 4;
    ctx.beginPath();
    ctx.arc(0, 0, innerR + 3, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dial face — radial gradient
    const faceGrad = ctx.createRadialGradient(0, -innerR * 0.25, innerR * 0.05, 0, 0, innerR);
    faceGrad.addColorStop(0, "#5b9ec9");
    faceGrad.addColorStop(1, "#1a5276");
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fill();

    // Tick marks: 270° sweep clockwise from lower-left (135°) to lower-right (45°), gap at bottom
    // Canvas 0°=right; 135° = lower-left, sweeping CW through top.
    const startAng = (3 * Math.PI) / 4;   // 135°
    const sweepAng = (3 * Math.PI) / 2;   // 270°
    ctx.strokeStyle = "#a9cce3";
    for (let i = 0; i < numTicks; i++) {
      const angle   = startAng + (sweepAng / (numTicks - 1)) * i;
      const isMajor = i % 6 === 0;
      const innerR2 = isMajor ? tickInR - 3 : tickInR;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * innerR2, Math.sin(angle) * innerR2);
      ctx.lineTo(Math.cos(angle) * tickR,   Math.sin(angle) * tickR);
      ctx.stroke();
    }

    // Wiper pointer — dark wedge pointing straight up (noon = -π/2 canvas)
    const pAngle    = -Math.PI / 2;
    const pLen      = innerR - 5;
    const pBase     = 6;
    const pCos      = Math.cos(pAngle);
    const pSin      = Math.sin(pAngle);
    const pPerpCos  = Math.cos(pAngle + Math.PI / 2);
    const pPerpSin  = Math.sin(pAngle + Math.PI / 2);
    ctx.fillStyle   = "#1c2833";
    ctx.beginPath();
    ctx.moveTo( pCos * pLen,         pSin * pLen);
    ctx.lineTo( pPerpCos * pBase,    pPerpSin * pBase);
    ctx.lineTo(-pPerpCos * pBase,   -pPerpSin * pBase);
    ctx.closePath();
    ctx.fill();

    // Centre hub
    ctx.fillStyle = "#85929e";
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Pin holes drawn on top of everything at their actual breadboard positions ──
    [from, mid, to].forEach((hole) => {
      ctx.fillStyle   = "#0e141b";
      ctx.strokeStyle = "#7f8c8d";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    const r = typeof radius === "number"
      ? { tl: radius, tr: radius, br: radius, bl: radius }
      : radius;

    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + width - r.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
    ctx.lineTo(x + width, y + height - r.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
    ctx.lineTo(x + r.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  // ============================================================
  // SCHEMATIC DRAWING
  // ============================================================
  function drawSchematic() {
    schematicCtx.clearRect(0, 0, dom.schematicCanvas.width, dom.schematicCanvas.height);

    schematicCtx.fillStyle = "#1f2937";
    schematicCtx.font = "bold 14px Arial";
    schematicCtx.textAlign = "left";
    schematicCtx.fillText("Challenge", 16, 22);

    if (!state.currentLevelGoal) {
      schematicCtx.font = "13px Arial";
      schematicCtx.fillStyle = "#374151";
      schematicCtx.fillText("Load a level to view the target connection.", 16, 48);
      return;
    }

    if (state.currentLevelGoal.schematicStyle === "closed_loop_parallel") {
      drawClosedLoopParallelSchematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "open_parallel_star") {
      drawOpenParallelStarSchematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "open_parallel_branch") {
      drawOpenParallelBranchSchematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "open_parallel_cascade") {
      drawOpenParallelCascadeSchematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "open_parallel_fork3") {
      drawOpenParallelFork3Schematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "three_pin_tier1") {
      drawThreePinTier1Schematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "three_pin_tier2") {
      drawThreePinTier2Schematic(state.currentLevelGoal);
      return;
    }
    if (state.currentLevelGoal.schematicStyle === "three_pin_tier3") {
      drawThreePinTier3Schematic(state.currentLevelGoal);
      return;
    }

    schematicCtx.font = "12px Arial";
    schematicCtx.fillStyle = "#374151";
    schematicCtx.fillText(state.currentLevelGoal.instructions, 16, 44);

    if (state.currentLevelGoal.schematicStyle === "open_series_path") {
      drawOpenSeriesPathSchematic(state.currentLevelGoal);
      return;
    }

    const requirements = state.currentLevelGoal.required_nets;
    const startY = requirements.length > 2 ? 76 : 95;
    const rowGap = requirements.length > 2 ? 46 : 60;

    requirements.forEach((requirement, index) => {
      const y = startY + index * rowGap;
      drawRequirementRow(requirement, y);
    });
  }

  // Returns the shared label prefix for a component type.
  // SLIDE_SWITCH shares "S" with SWITCH; POT shares "R" with RESISTOR.
  function getSchematicPrefix(type) {
    const map = { RESISTOR: "R", POT: "R", LED: "L", BUZZER: "BZ", SWITCH: "S", SLIDE_SWITCH: "S" };
    return map[type] || type;
  }

  function getSchematicTypeLabel(type, index = 1) {
    return `${getSchematicPrefix(type)}${index}`;
  }

  // Returns true if the element's connected pin is the "entry" (Anode / Positive / P1) side.
  // Used by 3-pin schematic renderers to orient 2-pin element symbols correctly.
  function isEntryPin(element) {
    if (element.type === "LED")    return element.pin === "Anode";
    if (element.type === "BUZZER") return element.pin === "Positive";
    return true; // RESISTOR, SWITCH — non-polarized, treat P1 as entry
  }

  function getSeriesChainPinsForType(type) {
    if (type === "LED") return { entryPin: "Anode", exitPin: "Cathode" };
    if (type === "BUZZER") return { entryPin: "Positive", exitPin: "Negative" };
    return { entryPin: "P1", exitPin: "P2" };
  }

  function isPositiveRailNet(netID) {
    return netID === "RAIL_TOP_RED" || netID === "RAIL_BOT_RED" || netID === "MCU_3V3";
  }

  function buildLevel2SeriesElements(totalCount, includeBattery) {
    const componentCount = totalCount - (includeBattery ? 1 : 0);
    const counts = new Map();
    const typeIndices = new Map();
    const components = [];

    for (let index = 0; index < componentCount; index += 1) {
      const candidates = TWO_PIN_PARTS.filter((type) => (counts.get(type) || 0) < 2);
      const type = randomItem(candidates);
      counts.set(type, (counts.get(type) || 0) + 1);
      typeIndices.set(type, (typeIndices.get(type) || 0) + 1);
      const instanceIndex = typeIndices.get(type);
      components.push({
        kind: "component",
        type,
        instanceKey: `${type}_${instanceIndex}`,
        label: getSchematicTypeLabel(type, instanceIndex),
      });
    }

    if (!includeBattery) return components;

    const batteryElement = {
      kind: "rail",
      netID: randomItem(["RAIL_TOP_RED", "RAIL_BOT_RED", "RAIL_TOP_BLUE", "RAIL_BOT_BLUE"]),
      label: "",
    };

    return Math.random() < 0.5 ? [batteryElement, ...components] : [...components, batteryElement];
  }

  function buildLevel2RequiredNetsFromElements(elements) {
    const requirements = [];
    for (let index = 0; index < elements.length - 1; index += 1) {
      const current = elements[index];
      const next = elements[index + 1];
      const fromDescriptor = current.kind === "rail"
        ? current.netID
        : `${current.instanceKey}:${getSeriesChainPinsForType(current.type).exitPin}`;
      const toDescriptor = next.kind === "rail"
        ? next.netID
        : `${next.instanceKey}:${getSeriesChainPinsForType(next.type).entryPin}`;
      requirements.push({ from: fromDescriptor, to: toDescriptor });
    }
    return requirements;
  }

  function pickLevel2SchematicLayout(elements) {
    const batteryAtStart = elements[0] && elements[0].kind === "rail";
    const batteryAtEnd = elements[elements.length - 1] && elements[elements.length - 1].kind === "rail";
    const candidates = ["straight"];
    if (batteryAtStart || elements.length >= 4) candidates.push("elbow-left");
    if (batteryAtEnd || elements.length >= 4) candidates.push("elbow-right");
    return randomItem(candidates);
  }

  function getLevel2Polyline(layoutKind) {
    switch (layoutKind) {
      case "elbow-left":
        return [{ x: 80, y: 72 }, { x: 80, y: 158 }, { x: 374, y: 158 }];
      case "elbow-right":
        return [{ x: 48, y: 92 }, { x: 324, y: 92 }, { x: 324, y: 184 }];
      case "straight":
      default:
        return [{ x: 48, y: 122 }, { x: 374, y: 122 }];
    }
  }

  function getSymbolHalfLengthForElement(element) {
    if (element.kind === "rail") return 22;
    if (element.type === "BUZZER") return 24;
    return 22;
  }

  function getPolylineTotalLength(points) {
    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      total += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
    }
    return total;
  }

  function getPointAlongPolyline(points, distance) {
    let remaining = distance;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const segmentLength = Math.hypot(dx, dy);
      if (remaining <= segmentLength || index === points.length - 2) {
        const t = segmentLength === 0 ? 0 : Math.max(0, Math.min(1, remaining / segmentLength));
        return { x: start.x + dx * t, y: start.y + dy * t, angle: Math.atan2(dy, dx), segmentIndex: index };
      }
      remaining -= segmentLength;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x), segmentIndex: points.length - 2 };
  }

  function projectTerminal(point, angle, offset) {
    return { x: point.x + Math.cos(angle) * offset, y: point.y + Math.sin(angle) * offset };
  }

  function getPolylineSlice(points, startDistance, endDistance) {
    const startPoint = getPointAlongPolyline(points, startDistance);
    const endPoint = getPointAlongPolyline(points, endDistance);
    const result = [{ x: startPoint.x, y: startPoint.y }];

    let traversed = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const segmentLength = Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
      const segmentStart = traversed;
      const segmentEnd = traversed + segmentLength;
      if (segmentEnd <= startDistance) {
        traversed += segmentLength;
        continue;
      }
      if (segmentStart >= endDistance) break;
      if (segmentStart > startDistance && segmentStart < endDistance) result.push({ x: points[index].x, y: points[index].y });
      if (segmentEnd > startDistance && segmentEnd < endDistance) result.push({ x: points[index + 1].x, y: points[index + 1].y });
      traversed += segmentLength;
    }

    result.push({ x: endPoint.x, y: endPoint.y });
    return result.filter((point, index, array) => index === 0 || point.x !== array[index - 1].x || point.y !== array[index - 1].y);
  }

  function drawSchematicPolyline(points) {
    if (points.length < 2) return;
    schematicCtx.beginPath();
    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 3;
    schematicCtx.lineCap = "round";
    schematicCtx.lineJoin = "round";
    schematicCtx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      schematicCtx.lineTo(points[index].x, points[index].y);
    }
    schematicCtx.stroke();
  }

  function drawOpenSeriesPathSchematic(levelGoal) {
    const elements = levelGoal.schematicElements || [];
    if (elements.length === 0) return;

    const polyline = getLevel2Polyline(levelGoal.schematicLayout || "straight");
    const totalLength = getPolylineTotalLength(polyline);
    const margin = 34;
    const usableLength = Math.max(40, totalLength - margin * 2);
    const step = elements.length === 1 ? 0 : usableLength / (elements.length - 1);

    const placements = elements.map((element, index) => {
      const centerDistance = margin + step * index;
      const point = getPointAlongPolyline(polyline, centerDistance);
      const halfLength = getSymbolHalfLengthForElement(element);
      return { element, centerDistance, point, halfLength };
    });

    drawSchematicPolyline(getPolylineSlice(polyline, 0, placements[0].centerDistance - placements[0].halfLength));
    for (let index = 0; index < placements.length - 1; index += 1) {
      drawSchematicPolyline(getPolylineSlice(polyline, placements[index].centerDistance + placements[index].halfLength, placements[index + 1].centerDistance - placements[index + 1].halfLength));
    }
    drawSchematicPolyline(getPolylineSlice(polyline, placements[placements.length - 1].centerDistance + placements[placements.length - 1].halfLength, totalLength));

    placements.forEach((placement, index) => {
      if (placement.element.kind === "rail") {
        const connectedSide = index === 0 ? "end" : "start";
        drawBatterySymbolAt(placement.point.x, placement.point.y, placement.point.angle, placement.element.netID, connectedSide);
      } else {
        drawSeriesSymbolAt(placement.element, placement.point.x, placement.point.y, placement.point.angle);
      }
    });
  }

  function drawSeriesSymbolAt(element, x, y, angle) {
    // The entry/Positive pin is always at local-left (-x). After canvas rotation the entry
    // end visually lands on the junction side regardless of angle, so positiveOnStart is
    // unconditionally true — rotation handles the flip automatically.
    const positiveOnStart = true;
    const isMostlyHorizontal = Math.abs(Math.cos(angle)) > 0.5;
    schematicCtx.save();
    schematicCtx.translate(x, y);
    schematicCtx.rotate(angle);
    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 3;
    schematicCtx.lineCap = "round";
    schematicCtx.lineJoin = "round";

    if (element.type === "RESISTOR") {
      schematicCtx.beginPath();
      schematicCtx.moveTo(-22, 0); schematicCtx.lineTo(-18, 0);
      schematicCtx.lineTo(-13, -10); schematicCtx.lineTo(-5, 10);
      schematicCtx.lineTo(3, -10); schematicCtx.lineTo(11, 10);
      schematicCtx.lineTo(18, -10); schematicCtx.lineTo(22, 0);
      schematicCtx.stroke();
    } else if (element.type === "LED") {
      schematicCtx.beginPath();
      schematicCtx.moveTo(-22, 0); schematicCtx.lineTo(-10, 0);
      schematicCtx.moveTo(10, 0); schematicCtx.lineTo(22, 0);
      schematicCtx.stroke();
      schematicCtx.beginPath();
      schematicCtx.moveTo(-10, -12); schematicCtx.lineTo(8, 0); schematicCtx.lineTo(-10, 12);
      schematicCtx.closePath();
      schematicCtx.stroke();
      schematicCtx.beginPath();
      schematicCtx.moveTo(8, -12); schematicCtx.lineTo(8, 12);
      schematicCtx.stroke();
      schematicCtx.lineWidth = 2;
      schematicCtx.beginPath();
      schematicCtx.moveTo(2, -16); schematicCtx.lineTo(12, -26);
      schematicCtx.moveTo(8, -10); schematicCtx.lineTo(18, -20);
      schematicCtx.stroke();
      drawArrowHead(12, -26, 8, -23);
      drawArrowHead(18, -20, 14, -17);
    } else if (element.type === "BUZZER") {
      schematicCtx.beginPath();
      schematicCtx.moveTo(-24, 0); schematicCtx.lineTo(-12, 0);
      schematicCtx.moveTo(12, 0); schematicCtx.lineTo(24, 0);
      schematicCtx.stroke();

      schematicCtx.beginPath();
      schematicCtx.arc(0, 2, 12, Math.PI, 0);
      schematicCtx.stroke();

      schematicCtx.beginPath();
      schematicCtx.moveTo(-12, 2);
      schematicCtx.lineTo(-12, 9);
      schematicCtx.lineTo(12, 9);
      schematicCtx.lineTo(12, 2);
      schematicCtx.stroke();

      const positiveX = positiveOnStart ? -16 : 16;
      const plusY = isMostlyHorizontal ? -4 : -8;
      schematicCtx.fillStyle = "#e74c3c";
      schematicCtx.font = "bold 11px Arial";
      schematicCtx.textAlign = "center";
      schematicCtx.fillText("+", positiveX, plusY);
    } else if (element.type === "SWITCH") {
      // Lead wires
      schematicCtx.beginPath();
      schematicCtx.moveTo(-22, 0); schematicCtx.lineTo(-10, 0);
      schematicCtx.moveTo(10, 0); schematicCtx.lineTo(22, 0);
      schematicCtx.stroke();
      // Open contact circles (stroke only — not filled)
      schematicCtx.lineWidth = 2;
      schematicCtx.beginPath();
      schematicCtx.arc(-10, 0, 3, 0, Math.PI * 2);
      schematicCtx.stroke();
      schematicCtx.beginPath();
      schematicCtx.arc(10, 0, 3, 0, Math.PI * 2);
      schematicCtx.stroke();
      schematicCtx.lineWidth = 3;
      // Actuator cap: wider horizontal bar, floating above the open contacts
      schematicCtx.beginPath();
      schematicCtx.moveTo(-9, -9); schematicCtx.lineTo(9, -9);
      schematicCtx.stroke();
      // Center stem: rises from the middle of the cap upward
      schematicCtx.beginPath();
      schematicCtx.moveTo(0, -9); schematicCtx.lineTo(0, -16);
      schematicCtx.stroke();
      // Narrow top bar: ~half the cap width, sits on top of the stem
      schematicCtx.beginPath();
      schematicCtx.moveTo(-5, -16); schematicCtx.lineTo(5, -16);
      schematicCtx.stroke();
    }

    schematicCtx.restore();

    let labelOffsetX = isMostlyHorizontal ? 0 : 18;
    let labelOffsetY = isMostlyHorizontal ? -28 : 0;
    if (element.type === "BUZZER") {
      labelOffsetX = isMostlyHorizontal ? 0 : 30;
      labelOffsetY = isMostlyHorizontal ? -24 : -4;
    }
    if (element.type === "SWITCH") {
      // T-post reaches y=-12; push label higher to avoid overlap
      labelOffsetX = isMostlyHorizontal ? 0 : 30;
      labelOffsetY = isMostlyHorizontal ? -30 : -6;
    }
    schematicCtx.fillStyle = "#111827";
    schematicCtx.font = "bold 14px Arial";
    schematicCtx.textAlign = "center";
    schematicCtx.fillText(element.label, x + labelOffsetX, y + labelOffsetY);
  }

  function drawArrowHead(x, y, backX, backY) {
    const angle = Math.atan2(y - backY, x - backX);
    schematicCtx.save();
    schematicCtx.translate(x, y);
    schematicCtx.rotate(angle);
    schematicCtx.beginPath();
    schematicCtx.moveTo(0, 0);
    schematicCtx.lineTo(-6, -3);
    schematicCtx.lineTo(-6, 3);
    schematicCtx.closePath();
    schematicCtx.fillStyle = "#2c3e50";
    schematicCtx.fill();
    schematicCtx.restore();
  }

  function drawBatterySymbolAt(x, y, angle, netID, connectedSide) {
    const connectedPolarity = isPositiveRailNet(netID) ? "positive" : "negative";
    const positiveSide = connectedPolarity === "positive" ? connectedSide : (connectedSide === "start" ? "end" : "start");

    schematicCtx.save();
    schematicCtx.translate(x, y);
    schematicCtx.rotate(angle);
    schematicCtx.strokeStyle = "#000";
    schematicCtx.lineWidth = 3;
    schematicCtx.lineCap = "round";
    schematicCtx.lineJoin = "round";

    const leadStart = -24;
    const leadEnd = 24;
    const plateXs = [-10, -3, 4, 11];
    const plateHalfHeights = positiveSide === "start"
      ? [18, 10, 18, 10]
      : [10, 18, 10, 18];
    const leftOuterPlateX = plateXs[0];
    const rightOuterPlateX = plateXs[plateXs.length - 1];
    const connectedTerminalX = connectedSide === "start" ? leadStart : leadEnd;
    const openTerminalX = connectedSide === "start" ? leadEnd : leadStart;

    schematicCtx.beginPath();
    schematicCtx.moveTo(connectedTerminalX, 0);
    schematicCtx.lineTo(connectedSide === "start" ? leftOuterPlateX : rightOuterPlateX, 0);
    schematicCtx.moveTo(openTerminalX, 0);
    schematicCtx.lineTo(connectedSide === "start" ? rightOuterPlateX : leftOuterPlateX, 0);
    schematicCtx.stroke();

    schematicCtx.beginPath();
    plateXs.forEach((plateX, index) => {
      const h = plateHalfHeights[index];
      schematicCtx.moveTo(plateX, -h);
      schematicCtx.lineTo(plateX, h);
    });
    schematicCtx.stroke();

    schematicCtx.restore();
  }

  function drawSchematicLine(x1, y1, x2, y2) {
    schematicCtx.save();
    schematicCtx.beginPath();
    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 3;
    schematicCtx.lineCap = "round";
    schematicCtx.moveTo(x1, y1);
    schematicCtx.lineTo(x2, y2);
    schematicCtx.stroke();
    schematicCtx.restore();
  }

  function drawJunctionDot(x, y) {
    schematicCtx.save();
    schematicCtx.beginPath();
    schematicCtx.fillStyle = "#2c3e50";
    schematicCtx.arc(x, y, 4, 0, Math.PI * 2);
    schematicCtx.fill();
    schematicCtx.restore();
  }

  function drawBatteryVertical(x, topY, bottomY) {
    const centerY = (topY + bottomY) / 2;
    const plateYs = [centerY - 10, centerY - 3, centerY + 4, centerY + 11];
    const plateHalfWidths = [18, 10, 18, 10]; // wider plate = positive (top)

    schematicCtx.save();
    schematicCtx.strokeStyle = "#000";
    schematicCtx.lineWidth = 3;
    schematicCtx.lineCap = "round";

    schematicCtx.beginPath();
    schematicCtx.moveTo(x, topY);
    schematicCtx.lineTo(x, plateYs[0]);
    schematicCtx.stroke();

    schematicCtx.beginPath();
    schematicCtx.moveTo(x, plateYs[plateYs.length - 1]);
    schematicCtx.lineTo(x, bottomY);
    schematicCtx.stroke();

    schematicCtx.beginPath();
    plateYs.forEach((py, idx) => {
      schematicCtx.moveTo(x - plateHalfWidths[idx], py);
      schematicCtx.lineTo(x + plateHalfWidths[idx], py);
    });
    schematicCtx.stroke();

    schematicCtx.fillStyle = "#e74c3c";
    schematicCtx.font = "bold 11px Arial";
    schematicCtx.textAlign = "left";
    schematicCtx.fillText("+", x + 22, centerY - 14);

    schematicCtx.restore();
  }

  function drawRailComponentsHorizontal(components, fromX, toX, y, reverseOrder = false) {
    if (components.length === 0) {
      drawSchematicLine(fromX, y, toX, y);
      return;
    }
    const displayComps = reverseOrder ? [...components].reverse() : components;
    const spacing = (toX - fromX) / (displayComps.length + 1);
    const positions = displayComps.map((_, i) => fromX + spacing * (i + 1));
    const halfLens = displayComps.map(c => getSymbolHalfLengthForElement(c));

    drawSchematicLine(fromX, y, positions[0] - halfLens[0], y);
    displayComps.forEach((comp, i) => {
      drawSeriesSymbolAt(comp, positions[i], y, 0);
      if (i < displayComps.length - 1) {
        drawSchematicLine(positions[i] + halfLens[i], y, positions[i + 1] - halfLens[i + 1], y);
      }
    });
    drawSchematicLine(positions[positions.length - 1] + halfLens[halfLens.length - 1], y, toX, y);
  }

  function drawBranchComponentsVertical(branch, bx, topY, bottomY) {
    const midY = (topY + bottomY) / 2;
    let positions;
    if (branch.length === 1) {
      positions = [midY];
    } else {
      const maxHalf = Math.max(...branch.map(c => getSymbolHalfLengthForElement(c)));
      const spacing = maxHalf * 2 + 8;
      positions = [midY - spacing / 2, midY + spacing / 2];
    }
    const halfLens = branch.map(c => getSymbolHalfLengthForElement(c));

    drawSchematicLine(bx, topY, bx, positions[0] - halfLens[0]);
    branch.forEach((comp, i) => {
      drawSeriesSymbolAt(comp, bx, positions[i], Math.PI / 2);
      if (i < branch.length - 1) {
        drawSchematicLine(bx, positions[i] + halfLens[i], bx, positions[i + 1] - halfLens[i + 1]);
      }
    });
    drawSchematicLine(bx, positions[positions.length - 1] + halfLens[halfLens.length - 1], bx, bottomY);
  }

  function drawClosedLoopParallelSchematic(levelGoal) {
    const { topRail, botRail, branches } = levelGoal.schematicData;
    const branchCount = branches.length;

    schematicCtx.font = "12px Arial";
    schematicCtx.fillStyle = "#374151";
    schematicCtx.textAlign = "left";
    schematicCtx.fillText(levelGoal.instructions, 16, 44);

    const BL = 45, BR = 482, T = 88, B = 250;
    const splitXTable = [60, 100, 195];
    const topSplitX = BL + splitXTable[Math.min(topRail.length, 2)];
    const botSplitX = BL + splitXTable[Math.min(botRail.length, 2)];
    const junctionX = Math.max(topSplitX, botSplitX);

    const branchAreaWidth = BR - junctionX;
    const branchXs = Array.from({ length: branchCount }, (_, i) =>
      junctionX + branchAreaWidth * (i + 1) / (branchCount + 1)
    );
    const lastBranchX = branchXs[branchXs.length - 1];

    drawBatteryVertical(BL, T, B);

    drawRailComponentsHorizontal(topRail, BL, topSplitX, T);
    drawSchematicLine(topSplitX, T, lastBranchX, T);

    drawRailComponentsHorizontal(botRail, BL, botSplitX, B, true);
    drawSchematicLine(botSplitX, B, lastBranchX, B);

    branches.forEach((branch, i) => drawBranchComponentsVertical(branch, branchXs[i], T, B));

    for (let i = 0; i < branchCount - 1; i++) {
      drawJunctionDot(branchXs[i], T);
      drawJunctionDot(branchXs[i], B);
    }
  }

  function drawRequirementRow(requirement, y) {
    const leftX = 80;
    const rightX = 335;
    const centerX = (leftX + rightX) / 2;

    drawSchematicEndpoint(leftX, y, requirement.from, "left");
    drawSchematicEndpoint(rightX, y, requirement.to, "right");

    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 3;
    schematicCtx.beginPath();
    schematicCtx.moveTo(leftX + 48, y);
    schematicCtx.lineTo(rightX - 48, y);
    schematicCtx.stroke();

    schematicCtx.beginPath();
    schematicCtx.fillStyle = "#e74c3c";
    schematicCtx.arc(centerX, y, 6, 0, Math.PI * 2);
    schematicCtx.fill();
    schematicCtx.strokeStyle = "#c0392b";
    schematicCtx.lineWidth = 1;
    schematicCtx.stroke();
  }

  function drawSchematicEndpoint(x, y, descriptor, side) {
    if (!descriptor.includes(":")) {
      drawNetLabel(x, y, formatNetLabel(descriptor), side);
      return;
    }

    const [type, pin] = descriptor.split(":");
    const flip = shouldFlipSymbol(type, pin, side);
    drawSymbol(schematicCtx, x, y, type, flip);
  }

  function shouldFlipSymbol(type, pin, side) {
    if (side === "left") {
      return (type === "LED" && pin === "Anode") || (type === "BUZZER" && pin === "Positive");
    }
    if (side === "right") {
      return (type === "LED" && pin === "Cathode") || (type === "BUZZER" && pin === "Negative");
    }
    return false;
  }

  function drawNetLabel(x, y, label, side) {
    const width = 72;
    const height = 22;
    const boxX = side === "left" ? x - width / 2 : x - width / 2;
    const boxY = y - height / 2;

    schematicCtx.fillStyle = "#eef2ff";
    schematicCtx.strokeStyle = "#4f46e5";
    schematicCtx.lineWidth = 1.5;
    roundRect(schematicCtx, boxX, boxY, width, height, 6, true, true);

    schematicCtx.fillStyle = "#1f2937";
    schematicCtx.font = "bold 11px Arial";
    schematicCtx.textAlign = "center";
    schematicCtx.fillText(label, x, y + 4);
  }

  function formatNetLabel(netID) {
    const labels = {
      RAIL_TOP_RED: "+ Rail",
      RAIL_BOT_RED: "+ Rail",
      RAIL_TOP_BLUE: "− Rail",
      RAIL_BOT_BLUE: "− Rail",
      MCU_3V3: "3V3",
      MCU_GND: "GND",
    };
    return labels[netID] || netID.replace(/^MCU_/, "");
  }

  function drawSymbol(ctx, x, y, type, isFlipped = false) {
    ctx.save();
    ctx.translate(x, y);
    if (isFlipped) ctx.scale(-1, 1);

    ctx.strokeStyle = "#2c3e50";
    ctx.lineWidth = 3;

    if (type === "RESISTOR") {
      ctx.beginPath();
      ctx.moveTo(-45, 0); ctx.lineTo(-30, 0);
      ctx.lineTo(-25, -12); ctx.lineTo(-15, 12);
      ctx.lineTo(-5, -12); ctx.lineTo(5, 12);
      ctx.lineTo(15, -12); ctx.lineTo(25, 12);
      ctx.lineTo(30, 0); ctx.lineTo(45, 0);
      ctx.stroke();

      ctx.save();
      if (isFlipped) ctx.scale(-1, 1);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("R1", 0, -25);
      ctx.restore();
    } else if (type === "LED") {
      ctx.beginPath();
      ctx.moveTo(-45, 0); ctx.lineTo(-15, 0);
      ctx.moveTo(15, 0); ctx.lineTo(45, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-15, -15); ctx.lineTo(15, 0); ctx.lineTo(-15, 15);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(15, -15); ctx.lineTo(15, 15);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -18); ctx.lineTo(10, -28);
      ctx.lineTo(5, -27); ctx.moveTo(10, -28); ctx.lineTo(11, -23);
      ctx.moveTo(8, -12); ctx.lineTo(18, -22);
      ctx.lineTo(13, -21); ctx.moveTo(18, -22); ctx.lineTo(19, -17);
      ctx.stroke();

      ctx.save();
      if (isFlipped) ctx.scale(-1, 1);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("L1", 0, -28);
      ctx.restore();
    } else if (type === "BUZZER") {
      ctx.beginPath();
      ctx.moveTo(-45, 0); ctx.lineTo(-15, 0);
      ctx.moveTo(15, 0); ctx.lineTo(45, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 15, Math.PI, 0);
      ctx.lineTo(15, 10);
      ctx.lineTo(-15, 10);
      ctx.closePath();
      ctx.stroke();

      ctx.save();
      if (isFlipped) ctx.scale(-1, 1);
      ctx.fillStyle = "#e74c3c";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("+", isFlipped ? 20 : -25, -5);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px Arial";
      ctx.fillText("BZ1", 0, -20);
      ctx.restore();
    } else if (type === "SWITCH") {
      // Lead wires
      ctx.beginPath();
      ctx.moveTo(-45, 0); ctx.lineTo(-15, 0);
      ctx.moveTo(15, 0); ctx.lineTo(45, 0);
      ctx.stroke();
      // Open contact circles (stroke only)
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-15, 0, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(15, 0, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      // Actuator cap
      ctx.beginPath();
      ctx.moveTo(-13, -9); ctx.lineTo(13, -9);
      ctx.stroke();
      // Center stem
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, -18);
      ctx.stroke();
      // Narrow top bar
      ctx.beginPath();
      ctx.moveTo(-7, -18); ctx.lineTo(7, -18);
      ctx.stroke();

      ctx.save();
      if (isFlipped) ctx.scale(-1, 1);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("S1", 0, -32);
      ctx.restore();
    }

    ctx.restore();
  }

  // ============================================================
  // CIRCUIT AUDITOR
  // ============================================================
  function getElectricalGroup(startNet) {
    const group = new Set([startNet]);
    let added = true;

    while (added) {
      added = false;
      state.wires.forEach((wire) => {
        if (group.has(wire.from.netID) && !group.has(wire.to.netID)) {
          group.add(wire.to.netID);
          added = true;
        } else if (group.has(wire.to.netID) && !group.has(wire.from.netID)) {
          group.add(wire.from.netID);
          added = true;
        }
      });
    }

    return group;
  }

  function getElectricalGroupCachedFactory() {
    const cache = new Map();
    return function getGroup(netID) {
      if (!cache.has(netID)) {
        cache.set(netID, getElectricalGroup(netID));
      }
      return cache.get(netID);
    };
  }

  function parseComponentDescriptor(baseDescriptor) {
    // Match a trailing _N (digits only) as the instance index; everything before it is the type.
    // This correctly handles multi-word types like SLIDE_SWITCH_1 → type=SLIDE_SWITCH, index=1.
    const match = /^(.+?)_(\d+)$/.exec(baseDescriptor);
    if (match) {
      return {
        type: match[1],
        instanceKey: baseDescriptor,
        instanceIndex: Number(match[2]),
      };
    }
    // No trailing _N: treat whole string as type with implicit index 1
    return { type: baseDescriptor, instanceKey: baseDescriptor, instanceIndex: 1 };
  }

  function parseEndpoint(descriptor) {
    if (!descriptor.includes(":")) {
      return { kind: "net", netID: descriptor };
    }

    const [baseDescriptor, pin] = descriptor.split(":");
    const parsed = parseComponentDescriptor(baseDescriptor);
    return {
      kind: "component",
      type: parsed.type,
      instanceKey: parsed.instanceKey,
      instanceIndex: parsed.instanceIndex,
      pin,
    };
  }

  function collectExpectedComponentInstances(requiredNets) {
    const instances = new Map();
    requiredNets.forEach((requirement) => {
      [requirement.from, requirement.to].forEach((descriptor) => {
        const endpoint = parseEndpoint(descriptor);
        if (endpoint.kind !== "component") return;
        if (!instances.has(endpoint.instanceKey)) {
          instances.set(endpoint.instanceKey, {
            instanceKey: endpoint.instanceKey,
            type: endpoint.type,
            instanceIndex: endpoint.instanceIndex,
          });
        }
      });
    });
    return Array.from(instances.values());
  }

  function getPlacedComponentsByType() {
    const map = new Map();
    state.placedComponents.forEach((component) => {
      if (!map.has(component.type)) map.set(component.type, []);
      map.get(component.type).push(component);
    });
    return map;
  }

  function getLeadNet(component, pinLabel, config) {
    if (component.type === "LED") {
      return pinLabel === "Anode" || pinLabel === "P1" ? component.from.netID : component.to.netID;
    }

    if (component.type === "BUZZER") {
      return pinLabel === "Positive" || pinLabel === "P1" ? component.from.netID : component.to.netID;
    }

    if (isNonPolarizedType(component.type)) {
      // 3-pin types: center pin (Common / Wiper) always maps to component.mid
      if (component.mid) {
        const centerLabel = getCenterPinLabel(component.type);
        if (pinLabel === centerLabel) return component.mid.netID;
      }

      const flipped = Boolean(config.orientationByComponentID[component.id]);
      const map = flipped
        ? { P1: component.to.netID, P2: component.from.netID }
        : { P1: component.from.netID, P2: component.to.netID };

      if (pinLabel === "ANY") {
        const nets = [map.P1, map.P2];
        if (component.mid) nets.push(component.mid.netID);
        return nets;
      }
      return map[pinLabel];
    }

    if (pinLabel === "ANY") return [component.from.netID, component.to.netID];
    return pinLabel === "P1" ? component.from.netID : component.to.netID;
  }

  function getTokenLabelForPin(type, pin) {
    if (type === "LED") {
      return pin === "P1" ? "Anode" : pin === "P2" ? "Cathode" : pin;
    }
    if (type === "BUZZER") {
      return pin === "P1" ? "Positive" : pin === "P2" ? "Negative" : pin;
    }
    // 3-pin types: center pin label passes through; outer pins stay as P1/P2
    return pin;
  }

  function getLogicalPinLabelForLead(component, leadSide, config) {
    // 3-pin types: center lead ("mid") is always the type's center pin label
    if (isThreePinType(component.type) && leadSide === "mid") {
      return getCenterPinLabel(component.type);
    }

    if (isNonPolarizedType(component.type)) {
      const flipped = Boolean(config.orientationByComponentID[component.id]);
      if (!flipped) return leadSide === "from" ? "P1" : "P2";
      return leadSide === "from" ? "P2" : "P1";
    }

    if (component.type === "LED") return leadSide === "from" ? "Anode" : "Cathode";
    if (component.type === "BUZZER") return leadSide === "from" ? "Positive" : "Negative";
    return leadSide === "from" ? "P1" : "P2";
  }

  function buildComponentLeadToken(component, logicalPin) {
    return `${component.type}#${component.id}:${getTokenLabelForPin(component.type, logicalPin)}`;
  }

  function getEquivalentNetIDs(netID) {
    switch (netID) {
      case "RAIL_TOP_RED":
      case "RAIL_BOT_RED":
        return ["RAIL_TOP_RED", "RAIL_BOT_RED"];
      case "RAIL_TOP_BLUE":
      case "RAIL_BOT_BLUE":
        return ["RAIL_TOP_BLUE", "RAIL_BOT_BLUE"];
      default:
        return [netID];
    }
  }

  function resolveDescriptorRefs(descriptor, config) {
    if (!descriptor.includes(":")) {
      return getEquivalentNetIDs(descriptor).map((netID) => ({ kind: "net", descriptor, token: netID, netID }));
    }

    const endpoint = parseEndpoint(descriptor);
    const component = config.componentByInstanceKey[endpoint.instanceKey];
    if (!component) return [];

    if (endpoint.pin === "ANY") {
      const pins = ["P1", "P2"];
      // 3-pin components: also expand the center pin
      if (isThreePinType(component.type)) {
        pins.push(getCenterPinLabel(component.type));
      }
      return pins.map((logicalPin) => ({
        kind: "component",
        descriptor,
        component,
        logicalPin,
        token: buildComponentLeadToken(component, logicalPin),
        netID: getLeadNet(component, logicalPin, config),
      }));
    }

    return [{
      kind: "component",
      descriptor,
      component,
      logicalPin: endpoint.pin,
      token: buildComponentLeadToken(component, endpoint.pin),
      netID: getLeadNet(component, endpoint.pin, config),
    }];
  }

  function enumerateConfigs(expectedInstances, placedByType) {
    const configs = [];

    function chooseComponents(index, componentByInstanceKey, usedComponentIDs) {
      if (index >= expectedInstances.length) {
        const selectedComponents = Object.values(componentByInstanceKey).filter(Boolean);
        const nonPolarized = selectedComponents.filter((component) => isNonPolarizedType(component.type));

        function chooseOrientations(orientationIndex, orientationByComponentID) {
          if (orientationIndex >= nonPolarized.length) {
            configs.push({
              componentByInstanceKey: { ...componentByInstanceKey },
              orientationByComponentID: { ...orientationByComponentID },
              selectedComponentIDs: new Set(selectedComponents.map((component) => component.id)),
            });
            return;
          }

          const component = nonPolarized[orientationIndex];
          orientationByComponentID[component.id] = false;
          chooseOrientations(orientationIndex + 1, orientationByComponentID);
          orientationByComponentID[component.id] = true;
          chooseOrientations(orientationIndex + 1, orientationByComponentID);
          delete orientationByComponentID[component.id];
        }

        chooseOrientations(0, {});
        return;
      }

      const expected = expectedInstances[index];
      const candidates = (placedByType.get(expected.type) || []).filter((component) => !usedComponentIDs.has(component.id));

      if (candidates.length === 0) {
        componentByInstanceKey[expected.instanceKey] = null;
        chooseComponents(index + 1, componentByInstanceKey, usedComponentIDs);
        delete componentByInstanceKey[expected.instanceKey];
        return;
      }

      candidates.forEach((component) => {
        componentByInstanceKey[expected.instanceKey] = component;
        usedComponentIDs.add(component.id);
        chooseComponents(index + 1, componentByInstanceKey, usedComponentIDs);
        usedComponentIDs.delete(component.id);
      });
      delete componentByInstanceKey[expected.instanceKey];
    }

    chooseComponents(0, {}, new Set());
    return configs.length > 0 ? configs : [{ componentByInstanceKey: {}, orientationByComponentID: {}, selectedComponentIDs: new Set() }];
  }

  function getGroupParticipants(group, config) {
    const tokens = new Set();
    const netSources = [];
    const components = [];

    Array.from(group).forEach((netID) => {
      if (netID.startsWith("RAIL_") || netID.startsWith("MCU_")) {
        tokens.add(netID);
        netSources.push(netID);
      }
    });

    state.placedComponents.forEach((component) => {
      const logicalPinsInGroup = [];
      if (group.has(component.from.netID)) {
        logicalPinsInGroup.push(getLogicalPinLabelForLead(component, "from", config));
      }
      if (group.has(component.to.netID)) {
        logicalPinsInGroup.push(getLogicalPinLabelForLead(component, "to", config));
      }
      // 3-pin support: check the center (mid) lead
      if (component.mid && group.has(component.mid.netID)) {
        logicalPinsInGroup.push(getLogicalPinLabelForLead(component, "mid", config));
      }

      if (logicalPinsInGroup.length === 0) return;

      logicalPinsInGroup.forEach((logicalPin) => {
        tokens.add(buildComponentLeadToken(component, logicalPin));
      });

      components.push({
        component,
        type: component.type,
        selected: config.selectedComponentIDs.has(component.id),
        logicalPinsInGroup,
      });
    });

    return { tokens, netSources, components };
  }

  function evaluateRequirement(requirement, config, getGroup) {
    const refsA = resolveDescriptorRefs(requirement.from, config);
    const refsB = resolveDescriptorRefs(requirement.to, config);

    for (const refA of refsA) {
      const group = getGroup(refA.netID);
      for (const refB of refsB) {
        if (group.has(refB.netID)) {
          return { matched: true, requirement, refA, refB, group };
        }
      }
    }

    return { matched: false, requirement, refsA, refsB };
  }

  function scoreConfig(config, evaluatedRequirements) {
    const matchedCount = evaluatedRequirements.filter((result) => result.matched).length;
    const exactMatchBonus = evaluatedRequirements.reduce((count, result) => count + (result.matched ? 1 : 0), 0);
    return matchedCount * 100 + exactMatchBonus;
  }

  function buildExpectedNodeMap(requiredNets) {
    const parent = new Map();

    function find(key) {
      if (!parent.has(key)) parent.set(key, key);
      if (parent.get(key) !== key) {
        parent.set(key, find(parent.get(key)));
      }
      return parent.get(key);
    }

    function union(a, b) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
    }

    requiredNets.forEach((requirement) => {
      union(requirement.from, requirement.to);
    });

    const rootToNodeID = new Map();
    const nodesByID = new Map();
    const descriptorToNodeID = new Map();
    let index = 0;

    Array.from(parent.keys()).forEach((descriptor) => {
      const root = find(descriptor);
      if (!rootToNodeID.has(root)) {
        const nodeID = `node-${index++}`;
        rootToNodeID.set(root, nodeID);
        nodesByID.set(nodeID, new Set());
      }
      const nodeID = rootToNodeID.get(root);
      nodesByID.get(nodeID).add(descriptor);
      descriptorToNodeID.set(descriptor, nodeID);
    });

    return { nodesByID, descriptorToNodeID };
  }

  function buildChosenTokenMap(bestConfig, bestResults) {
    const chosenTokens = new Map();
    bestResults.forEach((result) => {
      if (!result.matched) return;
      chosenTokens.set(result.refA.descriptor, result.refA.token);
      chosenTokens.set(result.refB.descriptor, result.refB.token);
    });
    return chosenTokens;
  }

  function buildExpectedTokensForNode(descriptors, config, chosenTokens) {
    const expectedTokens = new Set();

    descriptors.forEach((descriptor) => {
      if (!descriptor.includes(":")) {
        getEquivalentNetIDs(descriptor).forEach((netID) => expectedTokens.add(netID));
        return;
      }

      if (chosenTokens.has(descriptor)) {
        expectedTokens.add(chosenTokens.get(descriptor));
        return;
      }

      const refs = resolveDescriptorRefs(descriptor, config);
      if (refs.length === 1) {
        expectedTokens.add(refs[0].token);
      }
    });

    return expectedTokens;
  }

  function detectShortCircuitIssues(config, getGroup) {
    const issues = [];
    state.placedComponents.forEach((component) => {
      const fromGroup = getGroup(component.from.netID);

      if (component.mid) {
        // 3-pin: a short exists if any two of the three pins are in the same electrical group
        const fromToShorted = fromGroup.has(component.to.netID);
        const fromMidShorted = fromGroup.has(component.mid.netID);
        const midToShorted = getGroup(component.mid.netID).has(component.to.netID);

        if (fromToShorted || fromMidShorted || midToShorted) {
          issues.push(makeAuditEntry(
            "Short Circuit",
            `${component.type} is shorted — multiple pins share the same electrical node.`
          ));
        }
      } else {
        if (fromGroup.has(component.to.netID)) {
          issues.push(makeAuditEntry(
            "Short Circuit",
            `${component.type} is shorted because both leads are electrically common.`
          ));
        }
      }
    });
    return issues;
  }

  function detectMissingElementIssues(expectedInstances, config) {
    const missingCounts = new Map();
    expectedInstances.forEach((expected) => {
      if (!config.componentByInstanceKey[expected.instanceKey]) {
        missingCounts.set(expected.type, (missingCounts.get(expected.type) || 0) + 1);
      }
    });

    if (missingCounts.size === 0) return [];

    const parts = Array.from(missingCounts.entries()).map(([type, count]) => count > 1 ? `${type} x${count}` : type);
    return [makeAuditEntry("Missing Element", `Add the missing element(s): ${parts.join(", ")}.`)];
  }

  function detectWrongPinIssue(requirement, config, getGroup) {
    const endpoints = [parseEndpoint(requirement.from), parseEndpoint(requirement.to)];
    const mcuEndpoint = endpoints.find((endpoint) => endpoint.kind === "net" && endpoint.netID.startsWith("MCU_"));
    const componentEndpoint = endpoints.find((endpoint) => endpoint.kind === "component");
    if (!mcuEndpoint || !componentEndpoint) return null;

    const component = config.componentByInstanceKey[componentEndpoint.instanceKey];
    if (!component) return null;

    const groupsToCheck = [getGroup(component.from.netID), getGroup(component.to.netID)];
    if (component.mid) groupsToCheck.push(getGroup(component.mid.netID));
    const wrongPins = new Set();
    groupsToCheck.forEach((group) => {
      Array.from(group)
        .filter((netID) => netID.startsWith("MCU_") && netID !== mcuEndpoint.netID)
        .forEach((netID) => wrongPins.add(netID));
    });

    if (wrongPins.size === 0) return null;

    const actual = Array.from(wrongPins).map((netID) => formatNetLabel(netID)).join(", ");
    return makeAuditEntry(
      "Wrong Pin",
      `${componentEndpoint.type} is tied to ${actual} instead of ${formatNetLabel(mcuEndpoint.netID)}.`
    );
  }

  function diagnoseRequirementFailure(requirement, config, placedByType, getGroup) {
    const endpointA = parseEndpoint(requirement.from);
    const endpointB = parseEndpoint(requirement.to);

    const missingEndpoint = [endpointA, endpointB].find((endpoint) => endpoint.kind === "component" && !config.componentByInstanceKey[endpoint.instanceKey]);
    if (missingEndpoint) return null;

    const wrongPinIssue = detectWrongPinIssue(requirement, config, getGroup);
    if (wrongPinIssue) return wrongPinIssue;

    const refsA = resolveDescriptorRefs(requirement.from, config);
    const groupsA = refsA.map((ref) => ({ ref, group: getGroup(ref.netID), participants: getGroupParticipants(getGroup(ref.netID), config) }));

    const expectedNetID = endpointB.kind === "net" ? endpointB.netID : null;
    const expectedType = endpointB.kind === "component" ? endpointB.type : null;
    const fromNetIDs = new Set(refsA.map((ref) => ref.netID));

    // For multi-way nodes (e.g. Tier-1 star), multiple requirements share the same
    // "from" descriptor. Other expected components are legitimately co-located at that
    // node, so they must not be counted as "wrong type." Collect every component type
    // that any requirement places at the same node as requirement.from.
    const allExpectedTypesAtNode = new Set([endpointA.type, expectedType].filter(Boolean));
    if (state.currentLevelGoal && state.currentLevelGoal.required_nets) {
      state.currentLevelGoal.required_nets.forEach((req) => {
        if (req.from === requirement.from) {
          const ep = parseEndpoint(req.to);
          if (ep.kind === "component") allExpectedTypesAtNode.add(ep.type);
        }
        if (req.to === requirement.from) {
          const ep = parseEndpoint(req.from);
          if (ep.kind === "component") allExpectedTypesAtNode.add(ep.type);
        }
      });
    }

    let touchedWrongThing = false;

    for (const groupInfo of groupsA) {
      if (endpointB.kind === "net") {
        if (Array.from(groupInfo.group).some((netID) => netID.startsWith("MCU_") && netID !== expectedNetID)) {
          return makeAuditEntry(
            "Wrong Pin",
            `${requirement.from} is tied to ${Array.from(groupInfo.group).filter((netID) => netID.startsWith("MCU_") && netID !== expectedNetID).map((netID) => formatNetLabel(netID)).join(", ")} instead of ${formatNetLabel(expectedNetID)}.`
          );
        }

        if (groupInfo.participants.netSources.some((netID) => netID !== expectedNetID) || groupInfo.participants.components.length > 1) {
          touchedWrongThing = true;
        }
      } else {
        // hasExpectedTypeAnyPin: the specific required instance is at this node but via
        // the wrong pin (e.g. LED_2 is here but via Cathode, not Anode). Comparing by
        // component identity rather than just type prevents false positives when a *different*
        // instance of the same type (LED_1) is correctly at the same star node.
        const expectedComponentForB = endpointB.kind === "component"
          ? config.componentByInstanceKey[endpointB.instanceKey]
          : null;
        const hasExpectedTypeAnyPin = expectedComponentForB != null &&
          groupInfo.participants.components.some((entry) => entry.component === expectedComponentForB);
        const hasWrongType = groupInfo.participants.components.some((entry) => !allExpectedTypesAtNode.has(entry.type));
        const hasExtraNet = groupInfo.participants.netSources.some((netID) => !fromNetIDs.has(netID));

        if (hasExpectedTypeAnyPin || hasWrongType || hasExtraNet) {
          touchedWrongThing = true;
        }
      }
    }

    if (touchedWrongThing) {
      return makeAuditEntry(
        "Wrong Connection",
        `${requirement.from} is not connected to the required target ${requirement.to}.`
      );
    }

    return makeAuditEntry(
      "Missed Connection",
      `${requirement.from} and ${requirement.to} are not electrically connected.`
    );
  }

  function detectExtraConnectionIssues(bestConfig, bestResults, getGroup) {
    const issues = [];
    const seen = new Set();
    const { nodesByID, descriptorToNodeID } = buildExpectedNodeMap(state.currentLevelGoal.required_nets);
    const chosenTokens = buildChosenTokenMap(bestConfig, bestResults);

    // Tokens belonging to shorted components should not generate Extra Connection errors —
    // the Short Circuit error already covers them.
    const shortedLeadTokens = new Set();
    state.placedComponents.forEach((component) => {
      const fromGroup = getGroup(component.from.netID);
      const isShorted = component.mid
        ? (fromGroup.has(component.to.netID) ||
           fromGroup.has(component.mid.netID) ||
           getGroup(component.mid.netID).has(component.to.netID))
        : fromGroup.has(component.to.netID);

      if (isShorted) {
        shortedLeadTokens.add(buildComponentLeadToken(component, getLogicalPinLabelForLead(component, "from", bestConfig)));
        shortedLeadTokens.add(buildComponentLeadToken(component, getLogicalPinLabelForLead(component, "to", bestConfig)));
        if (component.mid) {
          shortedLeadTokens.add(buildComponentLeadToken(component, getLogicalPinLabelForLead(component, "mid", bestConfig)));
        }
      }
    });

    bestResults.forEach((result) => {
      if (!result.matched) return;
      const nodeID = descriptorToNodeID.get(result.refA.descriptor);
      if (!nodeID || seen.has(nodeID)) return;
      seen.add(nodeID);

      const descriptors = Array.from(nodesByID.get(nodeID) || []);
      const expectedTokens = buildExpectedTokensForNode(descriptors, bestConfig, chosenTokens);
      const participants = getGroupParticipants(result.group, bestConfig);
      const nonShortedActual = Array.from(participants.tokens).filter((token) => !shortedLeadTokens.has(token));
      const extraTokens = nonShortedActual.filter((token) => !expectedTokens.has(token));
      // Only flag Extra Connection when the actual connection count exceeds the expected
      // count. A mis-wired token (wrong pin at the right node) is caught by Wrong Connection;
      // Extra Connection should only fire when there are literally more connections than the
      // challenge calls for at this node (e.g. 4 things at a 3-way junction).
      if (extraTokens.length === 0 || nonShortedActual.length <= expectedTokens.size) return;

      const containsMCU = participants.netSources.some((netID) => netID.startsWith("MCU_"));
      issues.push(makeAuditEntry(
        containsMCU ? "Extra Connection: Pin Hijacked!" : "Extra Connection",
        containsMCU
          ? `A breakout pin node includes unrelated connections: ${extraTokens.join(", ")}.`
          : `This node contains extra connections not shown in the challenge: ${extraTokens.join(", ")}.`
      ));
    });

    const expectedMCUNets = new Set(state.currentLevelGoal.required_nets.flatMap((requirement) => [requirement.from, requirement.to]).filter((descriptor) => descriptor.startsWith("MCU_")));
    const inspectedUnexpectedMCUNets = new Set();
    state.placedComponents.forEach((component) => {
      const netIDsToCheck = [component.from.netID, component.to.netID];
      if (component.mid) netIDsToCheck.push(component.mid.netID);
      netIDsToCheck.forEach((netID) => {
        if (!netID.startsWith("MCU_") || expectedMCUNets.has(netID) || inspectedUnexpectedMCUNets.has(netID)) return;
        const group = getGroup(netID);
        const participants = getGroupParticipants(group, bestConfig);
        if (participants.components.length > 0 || participants.netSources.length > 1) {
          inspectedUnexpectedMCUNets.add(netID);
          issues.push(makeAuditEntry(
            "Extra Connection: Pin Hijacked!",
            `${formatNetLabel(netID)} is being used by an unrelated part of the circuit.`
          ));
        }
      });
    });

    return dedupeAuditIssues(issues);
  }

  function dedupeAuditIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
      const key = `${issue.errorType}::${issue.errorDetail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function auditCircuit() {
    const requiredNets = state.currentLevelGoal.required_nets;
    const expectedInstances = collectExpectedComponentInstances(requiredNets);
    const placedByType = getPlacedComponentsByType();
    const configs = enumerateConfigs(expectedInstances, placedByType);
    const getGroup = getElectricalGroupCachedFactory();

    let bestConfig = configs[0];
    let bestResults = requiredNets.map((requirement) => evaluateRequirement(requirement, bestConfig, getGroup));
    let bestScore = scoreConfig(bestConfig, bestResults);

    configs.forEach((config) => {
      const results = requiredNets.map((requirement) => evaluateRequirement(requirement, config, getGroup));
      const score = scoreConfig(config, results);
      if (score > bestScore) {
        bestScore = score;
        bestConfig = config;
        bestResults = results;
      }
    });

    const issues = [];
    issues.push(...detectShortCircuitIssues(bestConfig, getGroup));
    issues.push(...detectMissingElementIssues(expectedInstances, bestConfig));

    const handledRequirementKeys = new Set();
    bestResults.forEach((result) => {
      if (result.matched) return;
      const issue = diagnoseRequirementFailure(result.requirement, bestConfig, placedByType, getGroup);
      if (!issue) return;
      const key = `${issue.errorType}::${issue.errorDetail}`;
      if (!handledRequirementKeys.has(key)) {
        handledRequirementKeys.add(key);
        issues.push(issue);
      }
    });

    issues.push(...detectExtraConnectionIssues(bestConfig, bestResults, getGroup));

    return {
      issues: dedupeAuditIssues(issues),
      isSuccess: dedupeAuditIssues(issues).length === 0,
      bestConfig,
      bestResults,
    };
  }

  function checkCircuit() {
    if (!state.isUnlocked) return;
    if (!state.currentLevelGoal) {
      updateStatus("Load a level first.");
      return;
    }

    if (state.activePlacementError) {
      updateStatus("Clear the placement error before running Check.");
      return;
    }

    archiveActiveAuditErrors();
    state.checkAttemptCount += 1;

    const audit = auditCircuit();

    if (audit.isSuccess) {
      // Only count this as a "perfect run" if it was the student's very first Check
      // attempt on this challenge (checkAttemptCount was incremented above, so === 1
      // means no prior failed checks). A pass after any failed attempt does not advance
      // the streak — it just leaves the streak where the failure reset left it (0).
      const firstTrySuccess = state.checkAttemptCount === 1;

      if (getCurrentLevelID() === 3) {
        if (firstTrySuccess) {
          state.level3CorrectStreak += 1;
          if (state.level3CorrectStreak >= 2 && state.level3Tier < 3) {
            state.level3Tier += 1;
            state.level3CorrectStreak = 0;
          }
        } else {
          state.level3CorrectStreak = 0;
        }
      }
      if (getCurrentLevelID() === 4) {
        if (firstTrySuccess) {
          state.level4CorrectStreak += 1;
          if (state.level4CorrectStreak >= 2 && state.level4Tier < 3) {
            state.level4Tier += 1;
            state.level4CorrectStreak = 0;
          }
        } else {
          state.level4CorrectStreak = 0;
        }
      }
      if (getCurrentLevelID() === 5) {
        if (firstTrySuccess) {
          state.level5CorrectStreak += 1;
          if (state.level5CorrectStreak >= 2 && state.level5ComponentCount < 8) {
            state.level5ComponentCount += 1;
            state.level5CorrectStreak = 0;
          }
        } else {
          state.level5CorrectStreak = 0;
        }
      }

      setSignatureVisible(true);
      clearActiveAuditStack();
      state.lastSuccessExportRows = buildSuccessExportRows();

      const exportWindow = state.isGuestMode ? null : openExportPopupShell();
      const exported = state.isGuestMode ? false : exportSuccessRowsToGoogleScript(
        state.lastSuccessExportRows,
        exportWindow
      );

      if (!exported) {
        closeExportPopupShell(exportWindow);
      }

      logSessionEvent("SUCCESS", {
        attempt: state.checkAttemptCount,
        exportRowCount: state.lastSuccessExportRows.length,
        exportTriggered: exported,
      });

      updateStatus(
        exported
          ? "Success! Signature acquired. Audit log sent."
          : "Success! Signature acquired.",
        "success"
      );

      state.checkAttemptCount = 0;
      return;
    }

    beaconExportRows(auditIssuesToExportRows(audit.issues));

    // Any failed check breaks the "perfect run" streak — the student must
    // complete consecutive challenges with zero audit errors from the first try.
    if (getCurrentLevelID() === 3) state.level3CorrectStreak = 0;
    if (getCurrentLevelID() === 4) state.level4CorrectStreak = 0;
    if (getCurrentLevelID() === 5) state.level5CorrectStreak = 0;
    saveBoardState(); // persist the reset streak so a reload can't resurrect it

    setSignatureVisible(false);
    setActiveAuditErrors(audit.issues);

    logSessionEvent("CHECK_FAILED", {
      attempt: state.checkAttemptCount,
      auditErrors: audit.issues.map((entry) => ({ errorType: entry.errorType, errorDetail: entry.errorDetail })),
    });
    updateStatus(`Check complete: ${audit.issues.length} audit issue${audit.issues.length === 1 ? "" : "s"} found.`);
  }

  // ============================================================
  // LEVEL GENERATION
  // ============================================================
  function startLevel(levelNumber) {
    if (!state.isUnlocked) return;
    clearBoardState();
    if (state.wires.length || state.placedComponents.length) {
      clearBoard(false, true);
    }
    state.actionHistory = [];
    state.startHole = null;
    clearPlacementError();
    clearActiveAuditStack();
    setSignatureVisible(false);
    state.currentLevelGoal = generateLevel(levelNumber);
    state.challengeInstanceID = createChallengeInstanceID();
    resetLevelSessionState();
    updateStatus(state.currentLevelGoal.instructions);
    logSessionEvent("LEVEL_LOAD", {
      instructions: state.currentLevelGoal.instructions,
      circuitLogic: getCurrentCircuitLogic(),
    });
    beaconExportRow({
      Session_ID: state.sessionID,
      Student_Name: state.studentName,
      Level_ID: getCurrentLevelID(),
      Error_Type: "LEVEL_LOAD",
      Attempt_Number: 0,
      Time_Spent: 0,
      Error_Detail: `Challenge loaded: ${state.currentLevelGoal.instructions}`,
      Circuit_Logic: getCurrentCircuitLogic(),
      Challenge_Instance_ID: state.challengeInstanceID,
    });
    drawEverything();
    drawSchematic();
  }

  function generateLevel(levelNumber) {
    switch (levelNumber) {
      case 1:
        return generateSingleBridge(levelNumber);
      case 2:
        return generateSeriesChain(levelNumber);
      case 3:
        return generateLevel3(levelNumber);
      case 4:
        return generateLevel4(levelNumber);
      case 5:
        return generateLevel5(levelNumber);
      case 6:
        return generateLevel6Placeholder(levelNumber);
      case 7:
      default:
        return generateLevel7Placeholder(levelNumber);
    }
  }

  // ============================================================
  // LEVEL 4 — 3-PIN COMPONENTS (TIER-BASED)
  // ============================================================
  function generateLevel4(levelNumber) {
    const tier = state.level4Tier;
    if (tier === 1) return generateLevel4Tier1(levelNumber);
    if (tier === 2) return generateLevel4Tier2(levelNumber);
    return generateLevel4Tier3(levelNumber);
  }

  // Tier 1: Place the 3-pin component and connect ONE of its three pins to a 2-pin element.
  // Any of the 3 pins can be chosen; if an outer pin (P1/P2) is chosen, either outer pin
  // is accepted by the checker (non-polarized outer pins are already reversible).
  function generateLevel4Tier1(levelNumber) {
    const threePcType  = randomItem(THREE_PIN_PARTS);
    const centerPin    = getCenterPinLabel(threePcType);

    // Shared prefix counter — SLIDE_SWITCH & SWITCH both use "S"; POT & RESISTOR both use "R"
    const prefixCount = {};
    function nextLabel(type) {
      const prefix = getSchematicPrefix(type);
      prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
      const idx = prefixCount[prefix];
      return { label: `${prefix}${idx}`, idx };
    }

    const { label: label3pc, idx: idx3pc } = nextLabel(threePcType);
    const threePcKey = `${threePcType}_${idx3pc}`;

    // Pick which pin of the 3-pin component this challenge uses.
    // Normalize to "P1" | "CENTER" | "P2" to avoid repeating the same position
    // two challenges in a row, regardless of whether it's Common vs Wiper.
    const pinKeys  = ["P1", "CENTER", "P2"];
    const lastKey  = state.level4LastPinKey;
    const available = lastKey ? pinKeys.filter(k => k !== lastKey) : pinKeys;
    const chosenKey = randomItem(available);
    state.level4LastPinKey = chosenKey;
    const connectedPin = chosenKey === "CENTER" ? centerPin : chosenKey;

    function pick2pin() {
      const type = randomItem(TWO_PIN_PARTS);
      const { label, idx } = nextLabel(type);
      const pin = getRandomPinForPart(type);
      return { type, instanceKey: `${type}_${idx}`, label, pin };
    }

    const other = pick2pin();

    // Human-readable pin description for the instruction text
    const pinLabel = connectedPin === centerPin ? `center pin (${centerPin})` : `pin ${connectedPin}`;

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Connect the ${label3pc}'s ${pinLabel} to ${formatInstructionEndpoint(other.type, other.pin)}.`,
      required_nets: [
        { from: `${threePcKey}:${connectedPin}`, to: `${other.instanceKey}:${other.pin}` },
      ],
      schematicStyle: "three_pin_tier1",
      schematicData: {
        threePc: { type: threePcType, instanceKey: threePcKey, label: label3pc, centerPin },
        connectedPin,
        other,
      },
    };
  }

  // Tier 2: All 3 pins of the 3-pin component each connect to a different 2-pin element.
  function generateLevel4Tier2(levelNumber) {
    const threePcType = randomItem(THREE_PIN_PARTS);
    const centerPin   = getCenterPinLabel(threePcType);

    const prefixCount = {};
    function nextLabel(type) {
      const prefix = getSchematicPrefix(type);
      prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
      const idx = prefixCount[prefix];
      return { label: `${prefix}${idx}`, idx };
    }

    const { label: label3pc, idx: idx3pc } = nextLabel(threePcType);
    const threePcKey = `${threePcType}_${idx3pc}`;

    function pick2pin() {
      const type = randomItem(TWO_PIN_PARTS);
      const { label, idx } = nextLabel(type);
      const pin = getRandomPinForPart(type);
      return { type, instanceKey: `${type}_${idx}`, label, pin };
    }

    const compLeft   = pick2pin(); // connects to P1
    const compCenter = pick2pin(); // connects to Common / Wiper
    const compRight  = pick2pin(); // connects to P2

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Connect all three pins of the ${label3pc} to separate elements.`,
      required_nets: [
        { from: `${threePcKey}:P1`,        to: `${compLeft.instanceKey}:${compLeft.pin}` },
        { from: `${threePcKey}:${centerPin}`, to: `${compCenter.instanceKey}:${compCenter.pin}` },
        { from: `${threePcKey}:P2`,        to: `${compRight.instanceKey}:${compRight.pin}` },
      ],
      schematicStyle: "three_pin_tier2",
      schematicData: {
        threePc: { type: threePcType, instanceKey: threePcKey, label: label3pc, centerPin },
        compLeft,
        compCenter,
        compRight,
      },
    };
  }

  // Tier 3: Closed loop.  Two topologies are chosen at random with equal probability.
  //
  //  "p1center" — two pins used, P2 floats:
  //    VCC → chain-top → 3PC:P1 → 3PC:center → chain-right → GND
  //
  //  "allpins"  — all three pins used (Y-junction):
  //    VCC → chain-top → 3PC:Common
  //    3PC:P1 → chain-P1 → GND
  //    3PC:P2 → chain-P2 → GND
  //
  function generateLevel4Tier3(levelNumber) {
    const threePcType = randomItem(THREE_PIN_PARTS);
    const centerPin   = getCenterPinLabel(threePcType);

    const prefixCount = {};
    function nextLabel(type) {
      const prefix = getSchematicPrefix(type);
      prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
      const idx = prefixCount[prefix];
      return { label: `${prefix}${idx}`, idx };
    }

    const { label: label3pc, idx: idx3pc } = nextLabel(threePcType);
    const threePcKey = `${threePcType}_${idx3pc}`;

    function pick2pin() {
      const type = randomItem(TWO_PIN_PARTS);
      const { label, idx } = nextLabel(type);
      const { entryPin, exitPin } = getSeriesChainPinsForType(type);
      return { type, instanceKey: `${type}_${idx}`, label, entryPin, exitPin };
    }

    const topology = Math.random() < 0.5 ? "allpins" : "p1center";

    if (topology === "allpins") {
      // All three pins used.  P1 and P2 legs each get exactly one component so they
      // fit in the available canvas space; the top chain absorbs the extra variety.
      const totalTwoPins = randomItem([3, 4, 5]);   // 4-6 total components
      const topCount = totalTwoPins - 2;             // at least 1 (total ≥ 3)

      const compChainTop = Array.from({ length: topCount }, () => pick2pin());
      const compChainP1  = [pick2pin()];
      const compChainP2  = [pick2pin()];

      const nets = [];
      nets.push({ from: "RAIL_TOP_RED", to: `${compChainTop[0].instanceKey}:${compChainTop[0].entryPin}` });
      for (let i = 0; i < topCount - 1; i++) {
        nets.push({ from: `${compChainTop[i].instanceKey}:${compChainTop[i].exitPin}`, to: `${compChainTop[i + 1].instanceKey}:${compChainTop[i + 1].entryPin}` });
      }
      nets.push({ from: `${compChainTop[topCount - 1].instanceKey}:${compChainTop[topCount - 1].exitPin}`, to: `${threePcKey}:${centerPin}` });

      nets.push({ from: `${threePcKey}:P1`, to: `${compChainP1[0].instanceKey}:${compChainP1[0].entryPin}` });
      nets.push({ from: `${compChainP1[0].instanceKey}:${compChainP1[0].exitPin}`, to: "RAIL_TOP_BLUE" });

      nets.push({ from: `${threePcKey}:P2`, to: `${compChainP2[0].instanceKey}:${compChainP2[0].entryPin}` });
      nets.push({ from: `${compChainP2[0].instanceKey}:${compChainP2[0].exitPin}`, to: "RAIL_TOP_BLUE" });

      return {
        id: levelNumber,
        instructions: `Level ${levelNumber}: Build the closed-loop circuit shown.`,
        required_nets: nets,
        schematicStyle: "three_pin_tier3",
        schematicData: {
          topology,
          threePc: { type: threePcType, instanceKey: threePcKey, label: label3pc, centerPin },
          compChainTop,
          compChainP1,
          compChainP2,
        },
      };
    }

    // topology === "p1center"
    // Randomly split 3-5 two-pin components across the top rail and the right leg.
    const totalTwoPins = randomItem([3, 4, 5]);
    const topMax  = Math.min(3, totalTwoPins - 1);
    const topMin  = Math.max(1, totalTwoPins - 2);  // cap rightCount ≤ 2
    const topCount   = topMin + Math.floor(Math.random() * (topMax - topMin + 1));
    const rightCount = totalTwoPins - topCount;

    const compChainTop   = Array.from({ length: topCount   }, () => pick2pin());
    const compChainRight = Array.from({ length: rightCount }, () => pick2pin());

    const nets = [];
    nets.push({ from: "RAIL_TOP_RED", to: `${compChainTop[0].instanceKey}:${compChainTop[0].entryPin}` });
    for (let i = 0; i < topCount - 1; i++) {
      nets.push({ from: `${compChainTop[i].instanceKey}:${compChainTop[i].exitPin}`, to: `${compChainTop[i + 1].instanceKey}:${compChainTop[i + 1].entryPin}` });
    }
    nets.push({ from: `${compChainTop[topCount - 1].instanceKey}:${compChainTop[topCount - 1].exitPin}`, to: `${threePcKey}:P1` });

    nets.push({ from: `${threePcKey}:${centerPin}`, to: `${compChainRight[0].instanceKey}:${compChainRight[0].entryPin}` });
    for (let i = 0; i < rightCount - 1; i++) {
      nets.push({ from: `${compChainRight[i].instanceKey}:${compChainRight[i].exitPin}`, to: `${compChainRight[i + 1].instanceKey}:${compChainRight[i + 1].entryPin}` });
    }
    nets.push({ from: `${compChainRight[rightCount - 1].instanceKey}:${compChainRight[rightCount - 1].exitPin}`, to: "RAIL_TOP_BLUE" });

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Build the closed-loop circuit shown. (P2 is not used.)`,
      required_nets: nets,
      schematicStyle: "three_pin_tier3",
      schematicData: {
        topology,
        threePc: { type: threePcType, instanceKey: threePcKey, label: label3pc, centerPin },
        compChainTop,
        compChainRight,
      },
    };
  }

  function generateLevel6Placeholder(levelNumber) {
    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Coming soon.`,
      required_nets: [],
    };
  }

  function generateLevel7Placeholder(levelNumber) {
    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Coming soon.`,
      required_nets: [],
    };
  }

  function randomPart() {
    return TWO_PIN_PARTS[Math.floor(Math.random() * TWO_PIN_PARTS.length)];
  }

  function randomDistinctParts(count) {
    const pool = [...TWO_PIN_PARTS];
    const result = [];
    while (result.length < count && pool.length > 0) {
      const index = Math.floor(Math.random() * pool.length);
      result.push(pool.splice(index, 1)[0]);
    }
    return result;
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function getRandomPinForPart(type) {
    if (type === "LED") return Math.random() > 0.5 ? "Anode" : "Cathode";
    if (type === "BUZZER") return Math.random() > 0.5 ? "Positive" : "Negative";
    return "ANY";
  }

  function formatInstructionEndpoint(type, pin) {
    if (pin === "ANY") return type;
    return `${type} (${pin})`;
  }

  function generateSingleBridge(levelNumber) {
    const [partA, partB] = randomDistinctParts(2);

    const pinA = getRandomPinForPart(partA);
    const pinB = getRandomPinForPart(partB);

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Connect ${formatInstructionEndpoint(partA, pinA)} to ${formatInstructionEndpoint(partB, pinB)}`,
      required_nets: [{ from: `${partA}:${pinA}`, to: `${partB}:${pinB}` }],
    };
  }

  function generateSeriesChain(levelNumber) {
    const totalElements = randomItem([3, 4]);
    const includeBattery = Math.random() < 0.5;
    const schematicElements = buildLevel2SeriesElements(totalElements, includeBattery);

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Build the open series circuit shown.`,
      required_nets: buildLevel2RequiredNetsFromElements(schematicElements),
      schematicStyle: "open_series_path",
      schematicElements,
      schematicLayout: pickLevel2SchematicLayout(schematicElements),
    };
  }

  // ============================================================
  // LEVEL 3 — OPEN PARALLEL (TIER-BASED)
  // ============================================================
  function generateLevel3(levelNumber) {
    const tier = state.level3Tier;
    if (tier === 1) return generateLevel3Tier1(levelNumber);
    if (tier === 2) return generateLevel3Tier2(levelNumber);
    return generateLevel3Tier3(levelNumber);
  }

  // --- Tier 1: Star topology (3 components, shared node, no rail requirement) ---
  // Three components meet at a single node. The student creates the node on the
  // breadboard by placing all three entry pins in the same electrically-connected hole group.
  function generateLevel3Tier1(levelNumber) {
    const typeCount = {};
    function pickComp() {
      const type = randomItem(TWO_PIN_PARTS);
      typeCount[type] = (typeCount[type] || 0) + 1;
      const idx = typeCount[type];
      const { entryPin, exitPin } = getSeriesChainPinsForType(type);
      return { type, instanceKey: `${type}_${idx}`, entryPin, exitPin, label: getSchematicTypeLabel(type, idx) };
    }

    const starComps = [pickComp(), pickComp(), pickComp()];
    const anchor = `${starComps[0].instanceKey}:${starComps[0].entryPin}`;

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Build the open parallel circuit shown.`,
      required_nets: [
        { from: anchor, to: `${starComps[1].instanceKey}:${starComps[1].entryPin}` },
        { from: anchor, to: `${starComps[2].instanceKey}:${starComps[2].entryPin}` },
      ],
      schematicStyle: "open_parallel_star",
      schematicData: { starComps },
    };
  }

  // --- Tier 2: Single split, 2–3 branches, 4 components total (battery always present) ---
  function generateLevel3Tier2(levelNumber) {
    const typeCount = {};
    function pickComp(polarOK = true) {
      const pool = polarOK ? TWO_PIN_PARTS : ["RESISTOR", "SWITCH"];
      const type = randomItem(pool);
      typeCount[type] = (typeCount[type] || 0) + 1;
      const idx = typeCount[type];
      const { entryPin, exitPin } = getSeriesChainPinsForType(type);
      return { type, instanceKey: `${type}_${idx}`, entryPin, exitPin, label: getSchematicTypeLabel(type, idx) };
    }

    // Pick layout: seriesCount (0–2) and branches such that total = 4
    const layouts = [
      { seriesCount: 0, branchLengths: [2, 2] },
      { seriesCount: 0, branchLengths: [1, 2, 1] },
      { seriesCount: 1, branchLengths: [1, 2] },
      { seriesCount: 1, branchLengths: [2, 1] },
      { seriesCount: 1, branchLengths: [1, 1, 1] },
      { seriesCount: 2, branchLengths: [1, 1] },
    ];
    const layout = randomItem(layouts);

    const seriesHead = Array.from({ length: layout.seriesCount }, () => pickComp());
    const branches = layout.branchLengths.map(len =>
      Array.from({ length: len }, () => pickComp())
    );

    const nets = [];
    const vcc = "RAIL_TOP_RED";

    // Series chain from Vcc to split point
    if (seriesHead.length === 0) {
      // split point IS Vcc
      const splitNode = vcc;
      for (const branch of branches) {
        nets.push({ from: splitNode, to: `${branch[0].instanceKey}:${branch[0].entryPin}` });
        for (let i = 0; i < branch.length - 1; i++) {
          nets.push({ from: `${branch[i].instanceKey}:${branch[i].exitPin}`, to: `${branch[i + 1].instanceKey}:${branch[i + 1].entryPin}` });
        }
      }
    } else {
      nets.push({ from: vcc, to: `${seriesHead[0].instanceKey}:${seriesHead[0].entryPin}` });
      for (let i = 0; i < seriesHead.length - 1; i++) {
        nets.push({ from: `${seriesHead[i].instanceKey}:${seriesHead[i].exitPin}`, to: `${seriesHead[i + 1].instanceKey}:${seriesHead[i + 1].entryPin}` });
      }
      const splitNode = `${seriesHead[seriesHead.length - 1].instanceKey}:${seriesHead[seriesHead.length - 1].exitPin}`;
      for (const branch of branches) {
        nets.push({ from: splitNode, to: `${branch[0].instanceKey}:${branch[0].entryPin}` });
        for (let i = 0; i < branch.length - 1; i++) {
          nets.push({ from: `${branch[i].instanceKey}:${branch[i].exitPin}`, to: `${branch[i + 1].instanceKey}:${branch[i + 1].entryPin}` });
        }
      }
    }

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Build the open parallel circuit shown.`,
      required_nets: nets,
      schematicStyle: "open_parallel_branch",
      schematicData: { seriesHead, branches },
    };
  }

  // --- Tier 3: Two split nodes, 5 components (battery always present) ---
  function generateLevel3Tier3(levelNumber) {
    const typeCount = {};
    function pickComp(polarOK = true) {
      const pool = polarOK ? TWO_PIN_PARTS : ["RESISTOR", "SWITCH"];
      const type = randomItem(pool);
      typeCount[type] = (typeCount[type] || 0) + 1;
      const idx = typeCount[type];
      const { entryPin, exitPin } = getSeriesChainPinsForType(type);
      return { type, instanceKey: `${type}_${idx}`, entryPin, exitPin, label: getSchematicTypeLabel(type, idx) };
    }

    const vcc = "RAIL_TOP_RED";
    const usesCascade = Math.random() < 0.5;

    if (usesCascade) {
      // Cascade: battery → A(series) → j1[B(branch), C(spine) → j2[D, E]]
      const compA = pickComp();
      const compB = pickComp();
      const compC = pickComp();
      const compD = pickComp();
      const compE = pickComp();

      const nets = [
        { from: vcc, to: `${compA.instanceKey}:${compA.entryPin}` },
        { from: `${compA.instanceKey}:${compA.exitPin}`, to: `${compB.instanceKey}:${compB.entryPin}` },
        { from: `${compA.instanceKey}:${compA.exitPin}`, to: `${compC.instanceKey}:${compC.entryPin}` },
        { from: `${compC.instanceKey}:${compC.exitPin}`, to: `${compD.instanceKey}:${compD.entryPin}` },
        { from: `${compC.instanceKey}:${compC.exitPin}`, to: `${compE.instanceKey}:${compE.entryPin}` },
      ];

      return {
        id: levelNumber,
        instructions: `Level ${levelNumber}: Build the open parallel circuit shown.`,
        required_nets: nets,
        schematicStyle: "open_parallel_cascade",
        schematicData: { compA, compB, compC, compD, compE },
      };
    } else {
      // Fork-3: battery → j1[A(branch), B(branch), C(spine) → j2[D, E]]
      const compA = pickComp();
      const compB = pickComp();
      const compC = pickComp();
      const compD = pickComp();
      const compE = pickComp();

      const nets = [
        { from: vcc, to: `${compA.instanceKey}:${compA.entryPin}` },
        { from: vcc, to: `${compB.instanceKey}:${compB.entryPin}` },
        { from: vcc, to: `${compC.instanceKey}:${compC.entryPin}` },
        { from: `${compC.instanceKey}:${compC.exitPin}`, to: `${compD.instanceKey}:${compD.entryPin}` },
        { from: `${compC.instanceKey}:${compC.exitPin}`, to: `${compE.instanceKey}:${compE.entryPin}` },
      ];

      return {
        id: levelNumber,
        instructions: `Level ${levelNumber}: Build the open parallel circuit shown.`,
        required_nets: nets,
        schematicStyle: "open_parallel_fork3",
        schematicData: { compA, compB, compC, compD, compE },
      };
    }
  }

  // ============================================================
  // LEVEL 3 SCHEMATIC RENDERERS
  // ============================================================

  // Instructions are shown once in the status-message panel (not on the schematic canvas).
  // This function is intentionally a no-op; it exists only so existing call sites compile.
  function drawInstructionText(_text) { /* intentional no-op */ }

  // --- Tier 1 renderer: Star topology ---
  // Central junction with three arms: LEFT, RIGHT, and UP.
  // Each arm's entry pin (anode/positive/P1) is at the central node.
  //   LEFT arm  → angle=π   (symbol flipped, so entry is at the RIGHT end = node)
  //   RIGHT arm → angle=0   (entry naturally at LEFT end = node)
  //   UP arm    → angle=−π/2 (entry at BOTTOM = node)
  function drawOpenParallelStarSchematic(levelGoal) {
    const { starComps } = levelGoal.schematicData;
    const [compLeft, compRight, compUp] = starComps;
    drawInstructionText(levelGoal.instructions);

    const cx = 250, cy = 169;
    const leftEnd = 55, rightEnd = 445, topStub = 95;

    const halfL = getSymbolHalfLengthForElement(compLeft);
    const halfR = getSymbolHalfLengthForElement(compRight);
    const halfU = getSymbolHalfLengthForElement(compUp);

    const leftCX  = (leftEnd + cx) / 2;   // centre of left component
    const rightCX = (cx + rightEnd) / 2;  // centre of right component
    // angle=−π/2: entry at (cx, upCY + halfU) → set upCY = cy − halfU so entry = cy
    const upCY = cy - halfU;

    // LEFT arm (angle=π → entry at right end = node)
    drawSchematicLine(leftEnd, cy, leftCX - halfL, cy);
    drawSeriesSymbolAt(compLeft, leftCX, cy, Math.PI);
    drawSchematicLine(leftCX + halfL, cy, cx, cy);

    // RIGHT arm (angle=0 → entry at left end = node)
    drawSchematicLine(cx, cy, rightCX - halfR, cy);
    drawSeriesSymbolAt(compRight, rightCX, cy, 0);
    drawSchematicLine(rightCX + halfR, cy, rightEnd, cy);

    // UP arm (angle=−π/2 → entry at bottom = node)
    drawSchematicLine(cx, topStub, cx, upCY - halfU);
    drawSeriesSymbolAt(compUp, cx, upCY, -Math.PI / 2);
    // no wire between entry end and node — entry IS at cy

    // Central junction dot
    drawJunctionDot(cx, cy);
  }

  // --- Tier 2 renderer: Single split, open branches ---
  function drawOpenParallelBranchSchematic(levelGoal) {
    const { seriesHead, branches } = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    const BL = 45, BR = 482, T = 88, B = 250;
    const splitXTable = [60, 100, 195];
    const junctionX = BL + splitXTable[Math.min(seriesHead.length, 2)];

    const branchCount = branches.length;
    const branchAreaWidth = BR - junctionX;
    const branchXs = Array.from({ length: branchCount }, (_, i) =>
      junctionX + branchAreaWidth * (i + 1) / (branchCount + 1)
    );
    const lastBranchX = branchXs[branchXs.length - 1];

    // Battery
    drawBatteryVertical(BL, T, B);

    // Top rail with series components
    drawRailComponentsHorizontal(seriesHead, BL, junctionX, T);
    drawSchematicLine(junctionX, T, lastBranchX, T);

    // Open branches (no bottom wire)
    branches.forEach((branch, i) => {
      drawBranchComponentsVertical(branch, branchXs[i], T, B);
    });

    // Junction dots at all non-rightmost branches
    for (let i = 0; i < branchCount - 1; i++) {
      drawJunctionDot(branchXs[i], T);
    }
  }

  // --- Tier 3 cascade renderer: battery → A → j1[B, C → j2[D, E]] ---
  function drawOpenParallelCascadeSchematic(levelGoal) {
    const { compA, compB, compC, compD, compE } = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    const BL = 45, T = 88, B = 250;
    // Top spine: BL → [A] → j1X → [C] → j2X → rightEnd
    const j1X = 165;
    const j2X = 310;
    const rightEnd = 395;
    // Branch B at j1X, branches D and E centered around j2X
    const dX = j2X;
    const eX = j2X + 55;

    drawBatteryVertical(BL, T, B);
    drawRailComponentsHorizontal([compA], BL, j1X, T);
    drawRailComponentsHorizontal([compC], j1X, j2X, T);
    drawSchematicLine(j2X, T, rightEnd, T);

    drawBranchComponentsVertical([compB], j1X, T, B);
    drawBranchComponentsVertical([compD], dX, T, B);
    drawBranchComponentsVertical([compE], eX, T, B);

    drawJunctionDot(j1X, T);
    drawJunctionDot(j2X, T);
  }

  // --- Tier 3 fork-3 renderer: battery → j1[A, B, C → j2[D, E]] ---
  function drawOpenParallelFork3Schematic(levelGoal) {
    const { compA, compB, compC, compD, compE } = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    const BL = 45, BR = 482, T = 88, B = 250;
    const junctionX = BL + 60;
    // 3 main branches: A, B, C spread between junctionX and BR
    const branchAreaW = BR - junctionX;
    const aX = junctionX + branchAreaW * 1 / 4;
    const bX = junctionX + branchAreaW * 2 / 4;
    const cX = junctionX + branchAreaW * 3 / 4;

    // Sub-branches D and E hang from midpoint of C branch
    const subOffset = 32;
    const j2Y = T + (B - T) * 0.42;
    const dX = cX - subOffset;
    const eX = cX + subOffset;
    const subBottom = B;

    drawBatteryVertical(BL, T, B);
    drawSchematicLine(BL, T, cX, T);

    // Main branches A and B (full height, open)
    drawBranchComponentsVertical([compA], aX, T, B);
    drawBranchComponentsVertical([compB], bX, T, B);

    // C branch: from T down to j2Y (includes component), then horizontal to D/E
    const cHalf = getSymbolHalfLengthForElement(compC);
    const cCenter = T + (j2Y - T) / 2;
    drawSchematicLine(cX, T, cX, cCenter - cHalf);
    drawSeriesSymbolAt(compC, cX, cCenter, Math.PI / 2);
    drawSchematicLine(cX, cCenter + cHalf, cX, j2Y);

    // j2 node: horizontal wire to D and E
    drawSchematicLine(dX, j2Y, eX, j2Y);
    drawJunctionDot(cX, j2Y);

    // Sub-branches D and E from j2
    const dHalf = getSymbolHalfLengthForElement(compD);
    const dCenter = j2Y + (subBottom - j2Y) / 2;
    drawSchematicLine(dX, j2Y, dX, dCenter - dHalf);
    drawSeriesSymbolAt(compD, dX, dCenter, Math.PI / 2);
    drawSchematicLine(dX, dCenter + dHalf, dX, subBottom);

    const eHalf = getSymbolHalfLengthForElement(compE);
    const eCenter = j2Y + (subBottom - j2Y) / 2;
    drawSchematicLine(eX, j2Y, eX, eCenter - eHalf);
    drawSeriesSymbolAt(compE, eX, eCenter, Math.PI / 2);
    drawSchematicLine(eX, eCenter + eHalf, eX, subBottom);

    // Junction dots at A and B on top rail (C is rightmost so no dot at cX top)
    drawJunctionDot(aX, T);
    drawJunctionDot(bX, T);
  }

  // ============================================================
  // LEVEL 4 SCHEMATIC RENDERERS
  // ============================================================

  // Draw the 3-pin component as a labeled box with three named terminals.
  // cx, cy = center of the box.
  // Returns an object with the pixel positions of each terminal lead end:
  //   { p1: {x, y}, center: {x, y}, p2: {x, y} }
  // termDir controls which sides the leads exit: "bottom" = all leads exit downward,
  // "sides" = P1 exits left, P2 exits right, center exits upward.
  // Dispatches to the type-specific schematic symbol for 3-pin components.
  // Returns { p1End, centerEnd, p2End } — the pixel positions of each terminal lead end.
  // (termDir is kept as a parameter for call-site compatibility but ignored; each symbol
  //  uses its own canonical orientation: P1 exits left, center/wiper exits up, P2 exits right.)
  function drawThreePinSymbol(comp, cx, cy, termDir = "sides") {
    if (comp.type === "POT") return drawPOTSchematicSymbol(comp, cx, cy);
    return drawSlideSwitchSchematicSymbol(comp, cx, cy);
  }

  // POT: horizontal zigzag resistor body with a wiper arrow exiting upward from the center.
  // P1 ←—[ZZZZ]—→ P2        (exits left / right at body level)
  //         ↑  wiper lead exits upward; arrowhead tip points down into body
  function drawPOTSchematicSymbol(comp, cx, cy) {
    const { label, centerPin } = comp;
    const zigHalf   = 22;  // half-width of zigzag body (same as RESISTOR symbol)
    const outLead   = 18;  // length of P1 / P2 external lead stubs
    const wiperGap  = 4;   // gap between body centre and arrow tip
    const arrowH    = 8;   // height of the filled arrowhead
    const wiperShaft = 12; // shaft length between arrowhead base and external lead

    const arrowTipY  = cy - wiperGap;
    const arrowBaseY = arrowTipY - arrowH;
    const centerEndY = arrowBaseY - wiperShaft - outLead;

    schematicCtx.save();
    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 2;
    schematicCtx.lineCap = "round";
    schematicCtx.lineJoin = "round";

    // P1 external lead (exits left)
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx - zigHalf - outLead, cy);
    schematicCtx.lineTo(cx - zigHalf, cy);
    schematicCtx.stroke();

    // Zigzag resistor body (identical shape to the RESISTOR symbol in drawSeriesSymbolAt)
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx - 22, cy); schematicCtx.lineTo(cx - 18, cy);
    schematicCtx.lineTo(cx - 13, cy - 10); schematicCtx.lineTo(cx - 5,  cy + 10);
    schematicCtx.lineTo(cx + 3,  cy - 10); schematicCtx.lineTo(cx + 11, cy + 10);
    schematicCtx.lineTo(cx + 18, cy - 10); schematicCtx.lineTo(cx + 22, cy);
    schematicCtx.stroke();

    // P2 external lead (exits right)
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx + zigHalf, cy);
    schematicCtx.lineTo(cx + zigHalf + outLead, cy);
    schematicCtx.stroke();

    // Wiper external lead (exits upward, above the arrowhead)
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx, centerEndY);
    schematicCtx.lineTo(cx, arrowBaseY);
    schematicCtx.stroke();

    // Filled arrowhead: tip pointing DOWN into the body, base above
    schematicCtx.fillStyle = "#2c3e50";
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx, arrowTipY);          // tip
    schematicCtx.lineTo(cx - 5, arrowBaseY);     // left flange
    schematicCtx.lineTo(cx + 5, arrowBaseY);     // right flange
    schematicCtx.closePath();
    schematicCtx.fill();

    // Component label: to the right of the symbol, vertically between the wiper
    // terminal and the resistor body so it never overlaps any wire or connection.
    schematicCtx.fillStyle = "#111827";
    schematicCtx.font = "bold 12px Arial";
    schematicCtx.textAlign = "left";
    const potLabelX = cx + zigHalf + outLead + 6;
    const potLabelY = Math.round((centerEndY + cy) / 2) + 4;
    schematicCtx.fillText(label, potLabelX, potLabelY);

    schematicCtx.restore();

    return {
      p1End:     { x: cx - zigHalf - outLead, y: cy },
      centerEnd: { x: cx,                     y: centerEndY },
      p2End:     { x: cx + zigHalf + outLead, y: cy },
    };
  }

  // SLIDE_SWITCH (SPDT): all three leads are vertical and parallel.
  // Common exits upward from the pivot (open circle).
  // A solid diagonal arm runs from the pivot to the P2 throw contact (open circle) —
  // showing the "connected" position.
  // The P1 throw contact (open circle) is standalone — no arm — showing the open position.
  // Both P1 and P2 leads exit straight downward, parallel to the common lead.
  //
  //      | (common, exits UP)
  //      O  ← pivot (open circle)
  //       \
  //   O    O  ← throw contacts (open circles)
  //   |    |
  //  P1   P2  (exits DOWN, parallel to common)
  function drawSlideSwitchSchematicSymbol(comp, cx, cy) {
    const { label, centerPin } = comp;
    const comLead   = 20;  // common wire length above pivot
    const outLead   = 20;  // P1/P2 lead length below contacts
    const pivotR    = 4;   // pivot open-circle radius
    const contactR  = 4;   // throw-contact open-circle radius
    const contactDX = 20;  // horizontal distance from pivot to each throw contact
    const armDY     = 22;  // vertical distance from pivot centre down to contact centres

    const pivotX    = cx,  pivotY = cy;
    const centerEndY = pivotY - comLead;

    const p1X = cx - contactDX,  p1Y = cy + armDY;
    const p2X = cx + contactDX,  p2Y = cy + armDY;

    schematicCtx.save();
    schematicCtx.strokeStyle = "#2c3e50";
    schematicCtx.lineWidth = 2;
    schematicCtx.lineCap = "round";
    schematicCtx.lineJoin = "round";

    // Common wire: terminal → top of pivot circle (vertical)
    schematicCtx.beginPath();
    schematicCtx.moveTo(cx, centerEndY);
    schematicCtx.lineTo(cx, pivotY - pivotR);
    schematicCtx.stroke();

    // Pivot open circle
    schematicCtx.beginPath();
    schematicCtx.arc(pivotX, pivotY, pivotR, 0, Math.PI * 2);
    schematicCtx.stroke();

    // Switch arm: bottom of pivot → top of P2 contact (solid diagonal)
    schematicCtx.beginPath();
    schematicCtx.moveTo(pivotX, pivotY + pivotR);
    schematicCtx.lineTo(p2X, p2Y - contactR);
    schematicCtx.stroke();

    // P2 throw-contact circle (the "connected" position)
    schematicCtx.beginPath();
    schematicCtx.arc(p2X, p2Y, contactR, 0, Math.PI * 2);
    schematicCtx.stroke();

    // P1 throw-contact circle (the open / unconnected position — no arm)
    schematicCtx.beginPath();
    schematicCtx.arc(p1X, p1Y, contactR, 0, Math.PI * 2);
    schematicCtx.stroke();

    // P1 lead: downward from P1 contact (parallel to common)
    schematicCtx.beginPath();
    schematicCtx.moveTo(p1X, p1Y + contactR);
    schematicCtx.lineTo(p1X, p1Y + contactR + outLead);
    schematicCtx.stroke();

    // P2 lead: downward from P2 contact (parallel to common)
    schematicCtx.beginPath();
    schematicCtx.moveTo(p2X, p2Y + contactR);
    schematicCtx.lineTo(p2X, p2Y + contactR + outLead);
    schematicCtx.stroke();

    // Component label: to the right of the symbol, vertically between the common
    // terminal and the throw contacts so it never overlaps any wire or connection.
    schematicCtx.fillStyle = "#111827";
    schematicCtx.font = "bold 12px Arial";
    schematicCtx.textAlign = "left";
    const labelX = p2X + contactR + 6;
    const labelY = Math.round((centerEndY + p2Y) / 2) + 4;   // midpoint between exits
    schematicCtx.fillText(label, labelX, labelY);

    schematicCtx.restore();

    const p1EndY = p1Y + contactR + outLead;
    const p2EndY = p2Y + contactR + outLead;
    return {
      p1End:     { x: p1X, y: p1EndY },
      centerEnd: { x: cx,  y: centerEndY },
      p2End:     { x: p2X, y: p2EndY },
    };
  }

  // Draw a small open circle to mark a floating / unconnected terminal end
  function drawFloatingTerminal(x, y) {
    schematicCtx.save();
    schematicCtx.strokeStyle = "#9ca3af";
    schematicCtx.lineWidth = 1.5;
    schematicCtx.beginPath();
    schematicCtx.arc(x, y, 4, 0, Math.PI * 2);
    schematicCtx.stroke();
    schematicCtx.restore();
  }

  // Tier 1: 3-pin component centred on canvas; one terminal wires to a 2-pin element.
  // The element is placed in the direction the connected pin exits.
  // The other two terminals float (open circles).
  function drawThreePinTier1Schematic(levelGoal) {
    const { threePc, connectedPin, other } = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    // 3-pin symbol: centred — same position as Tier 2 so the layout looks consistent
    const symCX = 240, symCY = 175;
    const { p1End, centerEnd, p2End } = drawThreePinSymbol(threePc, symCX, symCY, "sides");

    const centerPinName = threePc.centerPin;
    const endByPin = { P1: p1End, [centerPinName]: centerEnd, P2: p2End };

    // Float the two pins that are NOT connected
    ["P1", centerPinName, "P2"].forEach(pin => {
      if (pin !== connectedPin) drawFloatingTerminal(endByPin[pin].x, endByPin[pin].y);
    });

    const ws      = endByPin[connectedPin]; // wire-start position
    const halfLen = getSymbolHalfLengthForElement(other);
    const margin  = 18; // gap between wire-start and element body

    if (connectedPin === "P2") {
      // P2 exits RIGHT → element placed to the right
      const elemX = ws.x + margin + halfLen;
      const elemY = ws.y;
      const angle = isEntryPin(other) ? 0 : Math.PI;
      drawSchematicLine(ws.x, ws.y, elemX - halfLen, elemY);
      drawSeriesSymbolAt(other, elemX, elemY, angle);
      const floatX = elemX + halfLen + margin;
      drawSchematicLine(elemX + halfLen, elemY, floatX, elemY);
      drawFloatingTerminal(floatX, elemY);

    } else if (connectedPin === "P1") {
      // P1 exits LEFT → element placed to the left
      const elemX = ws.x - margin - halfLen;
      const elemY = ws.y;
      // Wire from 3PC comes from the right side of this element, so entry side faces RIGHT
      const angle = isEntryPin(other) ? Math.PI : 0;
      drawSchematicLine(ws.x, ws.y, elemX + halfLen, elemY);
      drawSeriesSymbolAt(other, elemX, elemY, angle);
      const floatX = elemX - halfLen - margin;
      drawSchematicLine(elemX - halfLen, elemY, floatX, elemY);
      drawFloatingTerminal(floatX, elemY);

    } else {
      // Common / Wiper exits UP → element placed above
      const elemX = ws.x;
      const elemY = ws.y - margin - halfLen;
      // Wire comes from below the element, so entry side should face DOWN
      const angle = isEntryPin(other) ? -Math.PI / 2 : Math.PI / 2;
      drawSchematicLine(ws.x, ws.y, elemX, elemY + halfLen);
      drawSeriesSymbolAt(other, elemX, elemY, angle);
      const floatY = elemY - halfLen - margin;
      drawSchematicLine(elemX, elemY - halfLen, elemX, floatY);
      drawFloatingTerminal(elemX, floatY);
    }
  }

  // Tier 2: 3-pin component in center with all 3 pins wired to separate elements.
  // P1 → element LEFT, center → element UP, P2 → element RIGHT.
  function drawThreePinTier2Schematic(levelGoal) {
    const { threePc, compLeft, compCenter, compRight } = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    // 3-pin symbol: box centered in middle of canvas, leads exiting sides + top
    const symCX = 240, symCY = 175;
    const { p1End, centerEnd, p2End } = drawThreePinSymbol(threePc, symCX, symCY, "sides");

    // LEFT element (P1 exits LEFT from box → wire runs left → element is to the left).
    // The 3PC connection point is on the RIGHT side of the element run.
    // angle=π → entry pin on the RIGHT = entry pin faces the 3PC. Use when entry pin is wired to 3PC.
    // angle=0 → entry pin on the LEFT = exit pin faces the 3PC. Use when exit pin is wired to 3PC.
    const leftHalf  = getSymbolHalfLengthForElement(compLeft);
    const leftAngle = isEntryPin(compLeft) ? Math.PI : 0;
    const leftElemX = 80;
    drawSchematicLine(p1End.x, p1End.y, leftElemX + leftHalf, p1End.y);
    drawSeriesSymbolAt(compLeft, leftElemX, p1End.y, leftAngle);
    drawSchematicLine(leftElemX - leftHalf, p1End.y, 35, p1End.y);
    drawFloatingTerminal(35, p1End.y);

    // UP element (center pin exits UPWARD from box → 3PC connection is at the BOTTOM of the element run).
    // angle=-π/2 → entry pin at BOTTOM = entry pin faces the 3PC. Use when entry pin is wired to 3PC.
    // angle=+π/2 → entry pin at TOP   = exit pin faces the 3PC. Use when exit pin is wired to 3PC.
    const upHalf  = getSymbolHalfLengthForElement(compCenter);
    const upAngle = isEntryPin(compCenter) ? -Math.PI / 2 : Math.PI / 2;
    const upElemY = 60;
    drawSchematicLine(centerEnd.x, centerEnd.y, centerEnd.x, upElemY + upHalf);
    drawSeriesSymbolAt(compCenter, centerEnd.x, upElemY, upAngle);
    drawSchematicLine(centerEnd.x, upElemY - upHalf, centerEnd.x, 20);
    drawFloatingTerminal(centerEnd.x, 20);

    // RIGHT element (P2 exits RIGHT from box → 3PC connection is on the LEFT side of the element run).
    // angle=0 → entry pin on the LEFT = entry pin faces the 3PC. Use when entry pin is wired to 3PC.
    // angle=π → entry pin on the RIGHT = exit pin faces the 3PC. Use when exit pin is wired to 3PC.
    const rightHalf  = getSymbolHalfLengthForElement(compRight);
    const rightAngle = isEntryPin(compRight) ? 0 : Math.PI;
    const rightElemX = 400;
    drawSchematicLine(p2End.x, p2End.y, rightElemX - rightHalf, p2End.y);
    drawSeriesSymbolAt(compRight, rightElemX, p2End.y, rightAngle);
    drawSchematicLine(rightElemX + rightHalf, p2End.y, 455, p2End.y);
    drawFloatingTerminal(455, p2End.y);
  }

  // Draw N components evenly spaced in series along a straight line segment.
  // angle=0 → horizontal (left-to-right), angle=π/2 → vertical (top-to-bottom).
  function drawChainOnSegment(comps, x1, y1, x2, y2, angle) {
    const n   = comps.length;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let prevX = x1, prevY = y1;
    for (let i = 0; i < n; i++) {
      const t    = (i + 1) / (n + 1);
      const cx   = x1 + (x2 - x1) * t;
      const cy   = y1 + (y2 - y1) * t;
      const half = getSymbolHalfLengthForElement(comps[i]);
      drawSchematicLine(prevX, prevY, cx - cos * half, cy - sin * half);
      drawSeriesSymbolAt(comps[i], cx, cy, angle);
      prevX = cx + cos * half;
      prevY = cy + sin * half;
    }
    drawSchematicLine(prevX, prevY, x2, y2);
  }

  // Tier 3 renderer — dispatches on topology stored in schematicData.
  function drawThreePinTier3Schematic(levelGoal) {
    const sd = levelGoal.schematicData;
    drawInstructionText(levelGoal.instructions);

    if (sd.topology === "allpins") {
      drawTier3AllPins(sd);
    } else {
      // "p1center" + legacy fallback (compA/compB keys)
      const compChainTop   = sd.compChainTop   || [sd.compA];
      const compChainRight = sd.compChainRight || [sd.compB];
      drawTier3P1Center(sd.threePc, compChainTop, compChainRight);
    }
  }

  // "p1center": VCC → chain-top → 3PC:P1 … 3PC:center → chain-right → GND.  P2 floats.
  function drawTier3P1Center(threePc, compChainTop, compChainRight) {
    const BL = 45, BR = 455, T = 60, B = 268;

    drawBatteryVertical(BL, T, B);

    // Draw symbol first so we know p1End.x — chain then runs BL → p1End.x (maximises width)
    const symCX = 300, symCY = T + 70;  // 130px — gives right leg ~158px (SS) / ~180px (POT)
    const { p1End, centerEnd, p2End } = drawThreePinSymbol(threePc, symCX, symCY, "sides");

    // Top chain: runs from BL toward P1, then drops to P1.
    // SLIDE_SWITCH P1 exits downward, so jog left to avoid overdrawing the lead.
    // POT P1 exits horizontally, so a direct vertical drop is clean.
    if (threePc.type === "SLIDE_SWITCH") {
      const jog = 30;
      drawChainOnSegment(compChainTop, BL, T, p1End.x - jog, T, 0);
      drawSchematicLine(p1End.x - jog, T, p1End.x - jog, p1End.y);
      drawSchematicLine(p1End.x - jog, p1End.y, p1End.x, p1End.y);
    } else {
      drawChainOnSegment(compChainTop, BL, T, p1End.x, T, 0);
      drawSchematicLine(p1End.x, T, p1End.x, p1End.y);
    }

    drawFloatingTerminal(p2End.x, p2End.y);

    const bX = Math.round((centerEnd.x + BR) / 2);
    drawSchematicLine(centerEnd.x, centerEnd.y, bX, centerEnd.y);
    drawChainOnSegment(compChainRight, bX, centerEnd.y, bX, B, Math.PI / 2);
    drawSchematicLine(bX, B, BL, B);
  }

  // "allpins": VCC → chain-top → 3PC:Common; 3PC:P1 → chain-P1 → GND; 3PC:P2 → chain-P2 → GND.
  // P1 jogs left and P2 jogs right before dropping, giving visual separation between the two legs.
  function drawTier3AllPins(sd) {
    const { threePc, compChainTop, compChainP1, compChainP2 } = sd;
    const BL = 45, T = 60, B = 268;
    const JOG = 40;   // px each terminal steps outward before descending

    drawBatteryVertical(BL, T, B);

    const symCX = 270, symCY = (T + B) / 2;
    const { p1End, centerEnd, p2End } = drawThreePinSymbol(threePc, symCX, symCY, "sides");

    // Top rail: BL → chain → centerEnd.x, then vertical stub down to centerEnd
    drawChainOnSegment(compChainTop, BL, T, centerEnd.x, T, 0);
    drawSchematicLine(centerEnd.x, T, centerEnd.x, centerEnd.y);

    // P1 leg: jog left, then drop vertically to GND
    const p1X = p1End.x - JOG;
    drawSchematicLine(p1End.x, p1End.y, p1X, p1End.y);
    drawChainOnSegment(compChainP1, p1X, p1End.y, p1X, B, Math.PI / 2);

    // P2 leg: jog right, then drop vertically to GND
    const p2X = p2End.x + JOG;
    drawSchematicLine(p2End.x, p2End.y, p2X, p2End.y);
    drawChainOnSegment(compChainP2, p2X, p2End.y, p2X, B, Math.PI / 2);

    // Bottom GND rail
    drawSchematicLine(BL, B, p2X, B);
  }

  function generateLevel5(levelNumber) {
    const vcc = "RAIL_TOP_RED";
    const gnd = "RAIL_TOP_BLUE";

    const targetCount = state.level5ComponentCount;
    const branchCount = randomItem([2, 2, 3]);
    const branchLengths = Array(branchCount).fill(1);

    let remaining = targetCount - branchCount;
    let topRailCount = 0;
    let botRailCount = 0;

    while (remaining > 0) {
      const opts = [];
      if (topRailCount < 2) opts.push("top");
      if (botRailCount < 2) opts.push("bot");
      branchLengths.forEach((len, i) => { if (len < 2) opts.push(i); });
      if (opts.length === 0) break;
      const choice = randomItem(opts);
      if (choice === "top") topRailCount++;
      else if (choice === "bot") botRailCount++;
      else branchLengths[choice]++;
      remaining--;
    }

    const typeCount = {};
    function pickSlot(polarOK = true) {
      const pool = polarOK ? TWO_PIN_PARTS : ["RESISTOR", "SWITCH"];
      const type = randomItem(pool);
      typeCount[type] = (typeCount[type] || 0) + 1;
      const idx = typeCount[type];
      const { entryPin, exitPin } = getSeriesChainPinsForType(type);
      return { type, instanceKey: `${type}_${idx}`, entryPin, exitPin, label: getSchematicTypeLabel(type, idx) };
    }

    const topRail = Array.from({ length: topRailCount }, () => pickSlot(true));
    const botRail = Array.from({ length: botRailCount }, () => pickSlot(false));
    const branches = branchLengths.map(len => Array.from({ length: len }, () => pickSlot(true)));

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Build the closed-loop circuit shown.`,
      required_nets: buildLevel5RequiredNets(topRail, botRail, branches, vcc, gnd),
      schematicStyle: "closed_loop_parallel",
      schematicData: { topRail, botRail, branches, vcc, gnd },
    };
  }

  function buildLevel5RequiredNets(topRail, botRail, branches, vcc, gnd) {
    const nets = [];

    let splitAnchor;
    if (topRail.length === 0) {
      splitAnchor = vcc;
    } else {
      nets.push({ from: vcc, to: `${topRail[0].instanceKey}:${topRail[0].entryPin}` });
      for (let i = 0; i < topRail.length - 1; i++) {
        nets.push({ from: `${topRail[i].instanceKey}:${topRail[i].exitPin}`, to: `${topRail[i + 1].instanceKey}:${topRail[i + 1].entryPin}` });
      }
      splitAnchor = `${topRail[topRail.length - 1].instanceKey}:${topRail[topRail.length - 1].exitPin}`;
    }

    let joinAnchor;
    if (botRail.length === 0) {
      joinAnchor = gnd;
    } else {
      for (let i = 0; i < botRail.length - 1; i++) {
        nets.push({ from: `${botRail[i].instanceKey}:${botRail[i].exitPin}`, to: `${botRail[i + 1].instanceKey}:${botRail[i + 1].entryPin}` });
      }
      nets.push({ from: `${botRail[botRail.length - 1].instanceKey}:${botRail[botRail.length - 1].exitPin}`, to: gnd });
      joinAnchor = `${botRail[0].instanceKey}:${botRail[0].entryPin}`;
    }

    for (const branch of branches) {
      nets.push({ from: splitAnchor, to: `${branch[0].instanceKey}:${branch[0].entryPin}` });
      for (let i = 0; i < branch.length - 1; i++) {
        nets.push({ from: `${branch[i].instanceKey}:${branch[i].exitPin}`, to: `${branch[i + 1].instanceKey}:${branch[i + 1].entryPin}` });
      }
      nets.push({ from: `${branch[branch.length - 1].instanceKey}:${branch[branch.length - 1].exitPin}`, to: joinAnchor });
    }

    return nets;
  }

  function generateParallelMatch(levelNumber) {
    const [mainPart, branchPart] = randomDistinctParts(2);

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Place ${branchPart} in parallel with ${mainPart}`,
      required_nets: [
        { from: `${mainPart}:P1`, to: `${branchPart}:P1` },
        { from: `${mainPart}:P2`, to: `${branchPart}:P2` },
      ],
    };
  }

  function generateSourceToComponent(levelNumber) {
    const source = randomItem(POWER_SOURCES);
    const part = randomItem(["LED", "BUZZER", "RESISTOR", "SWITCH"]);
    const pin = part === "LED" ? "Anode" : part === "BUZZER" ? "Positive" : "ANY";

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Connect ${formatNetLabel(source)} to ${formatInstructionEndpoint(part, pin)}`,
      required_nets: [{ from: source, to: `${part}:${pin}` }],
    };
  }

  function generateSourceBridge(levelNumber) {
    const source = randomItem(POWER_SOURCES);
    const [partA, partB] = randomDistinctParts(2);

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Bridge ${formatNetLabel(source)} into ${partA} and ${partB}`,
      required_nets: [
        { from: source, to: `${partA}:P1` },
        { from: `${partA}:P2`, to: `${partB}:P1` },
      ],
    };
  }

  function generateThreeNodeChallenge(levelNumber) {
    const source = randomItem(POWER_SOURCES);
    const ground = randomItem(GROUND_SOURCES);
    const [partA, partB] = randomDistinctParts(2);

    return {
      id: levelNumber,
      instructions: `Level ${levelNumber}: Route ${formatNetLabel(source)} through ${partA} to ${partB}, then tie ${partB} to ${formatNetLabel(ground)}`,
      required_nets: [
        { from: source, to: `${partA}:P1` },
        { from: `${partA}:P2`, to: `${partB}:P1` },
        { from: `${partB}:P2`, to: ground },
      ],
    };
  }

  window.CircuitSimulatorDebug = {
    getSessionState() {
      return JSON.parse(JSON.stringify({
        sessionID: state.sessionID,
        studentName: state.studentName,
        levelID: getCurrentLevelID(),
        startedAt: state.levelStartedAt,
        checkAttemptCount: state.checkAttemptCount,
        activePlacementError: state.activePlacementError,
        activeAuditErrors: state.activeAuditErrors,
        archivedAuditErrors: state.archivedAuditErrors,
        eventHistory: state.eventHistory,
        lastSuccessExportRows: state.lastSuccessExportRows,
        lastExportSignature: state.lastExportSignature,
        requiredNets: state.currentLevelGoal ? state.currentLevelGoal.required_nets : [],
      }));
    },
    buildCheckPayloadPreview(resultLabel = "PREVIEW") {
      return buildCheckPayload(resultLabel);
    },
    buildSuccessExportRowsPreview() {
      return buildSuccessExportRows();
    },
    buildBatchExportUrlPreview() {
      const rows = buildSuccessExportRows();
      return buildBatchExportUrl(rows);
    },
    exportSuccessRowsPreview() {
      const rows = buildSuccessExportRows();
      return rows.map((row) => `${GOOGLE_SCRIPT_URL}?${new URLSearchParams(mapExportRowToScriptParams(row)).toString()}`);
    },
  };

  init();
})();
