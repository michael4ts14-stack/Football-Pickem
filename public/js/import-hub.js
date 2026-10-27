// ============================================================================
// EMAIL / SPREADSHEET AUTOMATION MODAL (CONFIRMATION EMAILS & STANDINGS)
// ============================================================================

var ACTIVE_IMPORT_HUB_TAB = "bot";

function openUnifiedImportModal(defaultTab) {
  ensureWatchlistDefaults();
  ACTIVE_IMPORT_HUB_TAB = defaultTab || "bot";
  var savedUrl = state.gasWebAppUrl || "";
  var activeWk = state.weekLabel || (state.currentWeek ? ("Week " + state.currentWeek) : "Week 8");
  var activeFile = state.lastScrapedFile || ("College Pick'em '26 - " + activeWk + ".xlsx");
  var participantCount = (state.poolMembers && state.poolMembers.length) ? state.poolMembers.length : 89;
  var cloudStatusMsg = (document.getElementById("cloud-status-text") && document.getElementById("cloud-status-text").textContent) || "Connected to Firebase (`football-pickem-46206`)";

  document.getElementById("modal-team-title").textContent = "📥 Data Import, Gmail Bot & Cloud Hub";
  document.getElementById("modal-team-body").innerHTML =
    '<div class="hub-tabs">' +
      '<button id="hub-btn-bot" class="hub-tab-btn" onclick="switchImportHubTab(\'bot\')">🤖 Gmail .XLSX Bot</button>' +
      '<button id="hub-btn-csv" class="hub-tab-btn" onclick="switchImportHubTab(\'csv\')">📊 CSV / Excel</button>' +
      '<button id="hub-btn-pdf" class="hub-tab-btn" onclick="switchImportHubTab(\'pdf\')">📄 PDF Slate</button>' +
      '<button id="hub-btn-email" class="hub-tab-btn" onclick="switchImportHubTab(\'email\')">📧 Email / Standings</button>' +
      '<button id="hub-btn-cloud" class="hub-tab-btn" onclick="switchImportHubTab(\'cloud\')">⚙️ Cloud & Reset</button>' +
    '</div>' +

    '<!-- TAB 1: GMAIL BOT -->' +
    '<div id="hub-pane-bot" class="hidden">' +
      '<div style="background:rgba(16,185,129,0.12);border:1px solid #10b981;border-radius:8px;padding:10px;margin-bottom:10px;font-size:0.75rem;">' +
        '<div id="gas-modal-dynamic-title" style="font-weight:800;color:#34d399;margin-bottom:4px;">✅ ' + activeWk + ' Email Attachment Auto-Scraped & Pre-Loaded!</div>' +
        '<div id="gas-modal-dynamic-desc" style="color:#e2e8f0;">Active file: <strong><code>' + activeFile + '</code></strong> — all <strong>' + participantCount + ' participants</strong>, their 26 picks, Prior Season Points, and Tiebreakers are loaded!</div>' +
        '<button class="btn-sm" style="margin-top:8px;background:var(--green);color:#000;font-weight:800;width:100%;padding:7px;" onclick="syncCurrentLoadedSheetToFirebase()">⚡ Sync All ' + participantCount + ' ' + activeWk + ' Picks + Michael & Kinyion to Firebase Now</button>' +
      '</div>' +
      '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px;">' +
        '<strong>🔗 Deployed Google Apps Script Web App URL</strong> (triggers <code>runMasterPickemEmailBot()</code> live):' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
        '<input type="text" id="gas-webapp-url-input" class="search-input" style="font-size:0.73rem;padding:6px 9px;" placeholder="https://script.google.com/macros/s/.../exec" value="' + savedUrl + '" />' +
        '<button class="btn-sm" style="background:var(--accent);color:#000;font-weight:800;" onclick="triggerAppsScriptGmailScraper()">🔄 Run Gmail Bot</button>' +
      '</div>' +
      '<div id="gas-bot-status" style="font-size:0.74rem;color:var(--green);margin-bottom:8px;font-weight:700;"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">' +
        '<span style="font-size:0.74rem;font-weight:800;color:#fff;">📜 Upgraded <code>Code.gs</code> for Google Apps Script:</span>' +
        '<button class="btn-sm" style="background:var(--amber);color:#000;font-weight:800;" onclick="copyUpgradedCodeGs()">📋 Copy Code.gs</button>' +
      '</div>' +
      '<textarea id="gas-code-preview" readonly rows="7" class="search-input" style="width:100%;font-family:monospace;font-size:0.68rem;color:#93c5fd;"></textarea>' +
    '</div>' +

    '<!-- TAB 2: MASTER CSV / EXCEL -->' +
    '<div id="hub-pane-csv" class="hidden">' +
      '<div class="csv-dropzone" onclick="document.getElementById(\'csv-master-file-input\').click()">' +
        '<div style="font-size:1.05rem;font-weight:800;color:#34d399;margin-bottom:4px;">📂 Upload Pool Master CSV / TSV File</div>' +
        '<div style="font-size:0.73rem;color:var(--muted);">Select a <code>.csv</code> or <code>.tsv</code> export from Excel / Google Sheets. Auto-detects Game #1–26 columns, Prior Season Points, Tiebreakers, and standardizes Michael A & Kinyion C.</div>' +
        '<input type="file" id="csv-master-file-input" accept=".csv,.tsv,.txt" style="display:none;" onchange="handleMasterCsvFileUpload(this.files[0])" />' +
      '</div>' +
      '<div id="csv-import-status" style="font-size:0.76rem;color:var(--green);margin-bottom:8px;font-weight:700;"></div>' +
      '<textarea id="csv-raw-paste-area" rows="7" class="search-input" style="width:100%;margin-bottom:10px;font-family:monospace;font-size:0.72rem;" placeholder="Or paste raw CSV / Excel cells here (Header row + Participant rows)..."></textarea>' +
      '<button class="btn-sm" style="background:var(--green);color:#000;font-weight:800;width:100%;padding:8px;" onclick="parseAndStoreMasterPoolCsv()">⚡ Parse & Sync Full Pool to Firebase</button>' +
    '</div>' +

    '<!-- TAB 3: PDF SLATE -->' +
    '<div id="hub-pane-pdf" class="hidden">' +
      '<div class="pdf-dropzone" onclick="triggerFileInputClick()">' +
        '<div style="font-size:1.1rem;font-weight:800;color:var(--accent);margin-bottom:4px;">📄 Upload Separated at Turf Weekly PDF</div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Extracts all 23 games, spreads, and multipliers in-browser via PDF.js, crawls ESPN schedules, and saves the new week to Firebase.</div>' +
        '<input type="file" id="pdf-file-input" accept="application/pdf" style="display:none;" onchange="handlePdfFileSelect(this.files[0])" />' +
      '</div>' +
      '<div id="pdf-parse-status" style="font-size:0.78rem;color:var(--green);margin-bottom:8px;font-weight:700;"></div>' +
      '<textarea id="raw-sheet-text" rows="6" class="search-input" style="width:100%;margin-bottom:10px;font-family:monospace;font-size:0.73rem;" placeholder="Upload a PDF above or paste form text here..."></textarea>' +
      '<button class="btn-sm" style="background:var(--green);color:#000;font-weight:800;width:100%;padding:8px;" onclick="importStrictSheetText()">⚡ Build Sheet + Sync to Firebase Cloud</button>' +
    '</div>' +

    '<!-- TAB 4: EMAIL / STANDINGS -->' +
    '<div id="hub-pane-email" class="hidden">' +
      '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px;">' +
        'Paste a <strong>Google Form Confirmation Email</strong> (to auto-fill picks for Michael, Kinyion, or a Watchlist Rival) OR paste <strong>Weekly Pool Standings</strong> rows:' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">' +
        '<label style="font-size:0.74rem;font-weight:700;color:#fff;">Target Profile for Pick Import:</label>' +
        '<select id="email-import-target" class="search-input" style="max-width:240px;padding:5px 8px;">' +
          getAllUserProfiles().map(function(pf) {
            return '<option value="' + pf.key + '"' + (pf.key === activeProfile ? ' selected' : '') + '>' + pf.icon + ' ' + pf.name + '</option>';
          }).join('') +
          '<option value="w0">👀 Watchlist #1 (' + state.watchlist[0].name + ')</option>' +
          '<option value="w1">👀 Watchlist #2 (' + state.watchlist[1].name + ')</option>' +
          '<option value="w2">👀 Watchlist #3 (' + state.watchlist[2].name + ')</option>' +
        '</select>' +
      '</div>' +
      '<textarea id="email-automation-text" rows="7" class="search-input" style="width:100%;margin-bottom:10px;font-family:monospace;font-size:0.73rem;" placeholder="Paste confirmation email picks (e.g. Ohio State, Texas, LSU...) OR standings lines (e.g. 58. Michael A - 96 pts)..."></textarea>' +
      '<div id="email-import-status" style="font-size:0.75rem;color:var(--green);margin-bottom:8px;font-weight:700;"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '<button class="btn-sm" style="background:var(--accent);color:#000;font-weight:800;padding:8px;" onclick="parseConfirmationEmailPicks()">⚡ Import 23 Picks</button>' +
        '<button class="btn-sm" style="background:var(--green);color:#000;font-weight:800;padding:8px;" onclick="parseStandingsEmailText()">🏆 Import Standings</button>' +
      '</div>' +
    '</div>' +

    '<!-- TAB 5: CLOUD & RESET -->' +
    '<div id="hub-pane-cloud" class="hidden">' +
      '<div style="background:var(--panel-alt);border:1px solid var(--border-muted);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.76rem;">' +
        '<div style="font-weight:800;color:var(--accent);margin-bottom:4px;">☁️ Cloud Firestore Status (`football-pickem-46206`)</div>' +
        '<div style="color:#e2e8f0;margin-bottom:10px;">' + cloudStatusMsg + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          '<button class="btn-sm" style="background:#0284c7;color:#fff;border:none;font-weight:800;padding:8px;" onclick="pullFromFirebaseCloud(); closeOppModal();">☁️ Force Firebase Pull</button>' +
          '<button class="btn-sm" style="background:rgba(239,68,68,0.2);border-color:#ef4444;color:#fca5a5;font-weight:800;padding:8px;" onclick="hardResetToDefaults(); closeOppModal();">🔄 Reset Optimal Picks</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById("opp-modal-backdrop").style.display = "flex";
  var ta = document.getElementById("gas-code-preview");
  if (ta) ta.value = UPGRADED_CODE_GS_SOURCE;
  switchImportHubTab(ACTIVE_IMPORT_HUB_TAB);
}

function switchImportHubTab(tabName) {
  ACTIVE_IMPORT_HUB_TAB = tabName;
  var tabs = ["bot", "csv", "pdf", "email", "cloud"];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var btn = document.getElementById("hub-btn-" + t);
    var pane = document.getElementById("hub-pane-" + t);
    if (btn) btn.className = "hub-tab-btn" + (t === tabName ? " active" : "");
    if (pane) pane.classList.toggle("hidden", t !== tabName);
  }
}

function openEmailImportModal() {
  openUnifiedImportModal("email");
}

function isSafeClientSubstrMatch(hayNorm, needleNorm) {
  if (!hayNorm || !needleNorm) return false;
  if (hayNorm === needleNorm) return true;
  if (needleNorm.length < 4 || hayNorm.length < 4) return false;
  var idx = hayNorm.indexOf(needleNorm);
  if (idx === -1) return false;
  var prefix = hayNorm.slice(0, idx);
  var suffix = hayNorm.slice(idx + needleNorm.length);
  var blockedPrefixes = /(west|south|north|east|central|middle|coastal|western|eastern|northern|southern)$/;
  var blockedSuffixes = /^(state|st|tech|am|oh|ohio|fl|christian|southern|northern|eastern|western|international|atlantic|college)/;
  if (prefix && blockedPrefixes.test(prefix)) return false;
  if (suffix && blockedSuffixes.test(suffix)) return false;
  return true;
}

function parseConfirmationEmailPicks() {
  var raw = (document.getElementById("email-automation-text").value || "").trim();
  if (!raw) return;
  var target = document.getElementById("email-import-target").value;
  var lines = raw.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  var matchedCount = 0;
  var targetPicks = {};
  var usedLineIdx = {};

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var aKey = normalizeTeamKey(g.away);
    var hKey = normalizeTeamKey(g.home);
    var aCode = normalizeTeamKey(g.awayCode);
    var hCode = normalizeTeamKey(g.homeCode);

    for (var j = 0; j < lines.length; j++) {
      if (usedLineIdx[j]) continue;
      var rawLine = lines[j];
      var numPrefix = rawLine.match(/^#?(\d{1,2})[.):\s-]+(.+)$/);
      if (numPrefix && parseInt(numPrefix[1], 10) !== Number(g.id)) continue;
      var cleanCandidate = numPrefix ? numPrefix[2] : rawLine;
      var lineNorm = normalizeTeamKey(cleanCandidate.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, ""));
      if (!lineNorm) continue;
      // Avoid matching the matchup header line that contains BOTH teams or substring collisions (e.g. Michigan vs Michigan State)
      var hasAway = (lineNorm === aKey || lineNorm === aCode || isSafeClientSubstrMatch(lineNorm, aKey));
      var hasHome = (lineNorm === hKey || lineNorm === hCode || isSafeClientSubstrMatch(lineNorm, hKey));
      if (hasAway && !hasHome) {
        targetPicks[g.id] = g.away;
        usedLineIdx[j] = true;
        matchedCount++;
        break;
      } else if (hasHome && !hasAway) {
        targetPicks[g.id] = g.home;
        usedLineIdx[j] = true;
        matchedCount++;
        break;
      }
    }
  }

  // Also check for a tiebreaker pattern like 28-24
  var tbMatch = raw.match(/\b(\d{2}\s*-\s*\d{2})\b/);

  if (target.indexOf("w") === 0) {
    var wIdx = parseInt(target.slice(1), 10);
    if (state.watchlist[wIdx]) {
      for (var wk in targetPicks) state.watchlist[wIdx].picks[wk] = targetPicks[wk];
      pushWatchlistOrStandingsToFirebase();
    }
  } else {
    if (!state[target]) state[target] = { picks: {}, tiebreaker: "28-24", target: 20 };
    if (!state[target].picks) state[target].picks = {};
    for (var k in targetPicks) state[target].picks[k] = targetPicks[k];
    if (tbMatch) state[target].tiebreaker = tbMatch[1].replace(/\s+/g, "");
    saveCurrentState(target);
  }

  document.getElementById("email-import-status").textContent = "✓ Matched & imported " + matchedCount + " picks into " + target.toUpperCase() + " and synced to Firebase!";
  renderAll();
}

function parseStandingsTextBlock(raw) {
  var text = String(raw || "");
  var overallIdx = text.toLowerCase().indexOf("overall standings");
  var sliceText = overallIdx !== -1 ? text.slice(overallIdx) : text;
  var lines = sliceText.split(/\r?\n/).map(function(l) { return l.replace(/\*/g, "").trim(); }).filter(Boolean);
  var newBoard = [];
  var currentRank = "1";

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^(overall standings|week\s*\d+|congratulations|we have a brand|trying to stay)/i.test(line)) {
      if (newBoard.length >= 15 && /^(we have a brand|trying to stay)/i.test(line)) break;
      continue;
    }
    // 1. Ranked line: e.g. "1 Raukeese L 124", "T-58. Michael A - 96", "2\tSteve M\t123"
    var mRanked = line.match(/^(T?-?\d+)[.)\s\t-]+([A-Za-z0-9_ .,']+?)[\s\t:-]+(\d{1,3})(?:\s*pts|\s*points)?$/i);
    if (mRanked) {
      currentRank = mRanked[1].trim();
      var stdN = standardizeParticipantName(mRanked[2].trim());
      newBoard.push({
        rank: currentRank,
        name: stdN,
        priorPts: parseInt(mRanked[3], 10),
        note: stdN === "Michael A" ? "Active Profile (You)" : (stdN === "Kinyion C" ? "Active Profile (H2H)" : "Imported from Standings Email")
      });
      continue;
    }
    // 2. Tied continuation line directly under a ranked line: e.g. "F.F.F. 123", "Kinyon C 112", "Michael A 111" (supports >= 0 pts for Weeks 1-2!)
    if (newBoard.length > 0 && newBoard.length < 150) {
      var mTied = line.match(/^([A-Za-z][A-Za-z0-9_ .,']+?)[\s\t:-]+(\d{1,3})(?:\s*pts|\s*points)?$/i);
      if (mTied && !/^(week|game|saturday|sunday|friday|thursday)\b/i.test(mTied[1].trim())) {
        var prevRow = newBoard[newBoard.length - 1];
        var ptsVal = parseInt(mTied[2], 10);
        if (ptsVal <= prevRow.priorPts && ptsVal >= 0) {
          var stdTied = standardizeParticipantName(mTied[1].trim());
          var tieRank = (ptsVal === prevRow.priorPts)
            ? (currentRank.indexOf("T-") === 0 ? currentRank : ("T-" + currentRank))
            : String(newBoard.length + 1);
          if (ptsVal === prevRow.priorPts) prevRow.rank = tieRank;
          else currentRank = tieRank;
          newBoard.push({
            rank: tieRank,
            name: stdTied,
            priorPts: ptsVal,
            note: stdTied === "Michael A" ? "Active Profile (You)" : (stdTied === "Kinyion C" ? "Active Profile (H2H)" : "Imported from Standings Email")
          });
        }
      }
    }
  }
  return newBoard;
}

function parseStandingsEmailText() {
  var raw = (document.getElementById("email-automation-text").value || "").trim();
  if (!raw) return;
  var newBoard = parseStandingsTextBlock(raw);

  if (newBoard.length > 0) {
    state.leaderboard = newBoard;
    var ptsMap = {}, rkMap = {};
    for (var b = 0; b < newBoard.length; b++) {
      var k = standardizeParticipantName(newBoard[b].name).toLowerCase();
      ptsMap[k] = newBoard[b].priorPts;
      rkMap[k] = newBoard[b].rank;
    }
    if (!state.poolMembers || !Array.isArray(state.poolMembers)) state.poolMembers = [];
    var seenPm = {};
    for (var p = 0; p < state.poolMembers.length; p++) {
      var pName = standardizeParticipantName(state.poolMembers[p].name);
      state.poolMembers[p].name = pName;
      var pk = pName.toLowerCase();
      seenPm[pk] = true;
      if (ptsMap[pk] !== undefined) state.poolMembers[p].priorPts = ptsMap[pk];
      if (rkMap[pk] !== undefined) state.poolMembers[p].priorRank = rkMap[pk];
    }
    for (var b2 = 0; b2 < newBoard.length; b2++) {
      var nName = standardizeParticipantName(newBoard[b2].name);
      var nk = nName.toLowerCase();
      if (!seenPm[nk]) {
        state.poolMembers.push({
          name: nName,
          priorPts: newBoard[b2].priorPts,
          priorRank: newBoard[b2].rank,
          tiebreaker: "—",
          picks: {},
          livePts: 0,
          inProgressPts: 0,
          finalPts: 0
        });
      }
    }
    regradeAllPoolMembersLive();
    pushWatchlistOrStandingsToFirebase();
    document.getElementById("email-import-status").textContent = "✓ Imported all " + newBoard.length + " leaderboard rows (including tied ranks), updated Pool Members & synced to Firebase!";
    renderAll();
    switchMainView("standings");
  } else {
    document.getElementById("email-import-status").textContent = "⚠️ Format tip: Paste the Overall Standings section or lines like '1 Raukeese L 124'";
  }
}

