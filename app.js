// =========================================================
// ZEREN SPOR — BAŞKENT VOLEYBOL SALONU BİLET DAĞITIM VE TAKİP
// Temiz, Hızlı ve Kırpılmasız Ön Yüz (Frontend) Mantığı
// =========================================================

let appState = null;
let currentView = "seating"; // "seating" | "arena"
let currentBlockId = "121";
let currentMode = "select";  // "select" | "shift"
let colorMode = "groups";    // "groups" | "classic"

// Seçili koltuklar: Set<"row-seat">
let selectedSeats = new Set();
let lastClickedSeat = null;

// Sürükleyerek seçim
let isMouseDown = false;
let dragSelectTargetState = true;

// Kaydırma (Shift/Takas) modunda kaynak koltuklar
let shiftSourceSeats = [];

// Vurgulanan kişi/grup
let highlightedLabel = null;

// Sağ panelde açık olan grup akordeon ID'si
let expandedGroupKey = null;

// Canlı Excel Verisi ve Filtreler
let activeSidebarTab = "excel"; // "excel" | "dist"
let excelData = null;
let excelBlockFilter = "ALL";
let excelSearchQuery = "";

// ---------------------------------------------------------
// BAŞLATMA VE DOĞRULAMA (YÖNETİCİ GİRİŞİ)
// ---------------------------------------------------------
let isAdminAuthenticated = false;
let liveSyncTimer = null;

// Global fetch sarmalayıcısı: localStorage'da kayıtlı admin token varsa otomatik header'a ekler
// Böylece sayfa yenilense de cookie temizlense de oturum asla düşmez
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const token = localStorage.getItem("zeren_admin_token");
  if (token && typeof url === "string" && (url.startsWith("/api/") || url.startsWith("api/"))) {
    options = options || {};
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      if (!options.headers.has("X-Admin-Token")) options.headers.set("X-Admin-Token", token);
      if (!options.headers.has("Authorization")) options.headers.set("Authorization", "Bearer " + token);
    } else if (Array.isArray(options.headers)) {
      options.headers.push(["X-Admin-Token", token]);
      options.headers.push(["Authorization", "Bearer " + token]);
    } else {
      if (!options.headers["X-Admin-Token"]) options.headers["X-Admin-Token"] = token;
      if (!options.headers["Authorization"]) options.headers["Authorization"] = "Bearer " + token;
    }
  }
  return originalFetch.call(this, url, options);
};

document.addEventListener("DOMContentLoaded", () => {
  bindUIEvents();
  setupHorizontalScroll();
  bindAuthEvents();
  checkAuthAndInit();
  initLiveSync();
});

function initLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  // Her 5 saniyede bir arka planda sessizce yeni talepleri ve dağıtım listesini güncelle
  liveSyncTimer = setInterval(async () => {
    if (isAdminAuthenticated && !document.hidden) {
      try {
        await fetchExcelSummary();
        await updateDispatchBadge();
      } catch (e) {}
    }
  }, 5000);

  // Sekmeye geri dönüldüğünde anında yenile
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && isAdminAuthenticated) {
      try {
        await fetchExcelSummary();
        await updateDispatchBadge();
      } catch (e) {}
    }
  });
}

async function checkAuthAndInit() {
  try {
    const savedToken = localStorage.getItem("zeren_admin_token");
    const headers = savedToken ? { "X-Admin-Token": savedToken, "Authorization": "Bearer " + savedToken } : {};
    const res = await fetch("/api/auth/check", { headers });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.warn("Auth check non-JSON response:", text);
    }

    if (data.authenticated) {
      isAdminAuthenticated = true;
      hideLoginOverlay();
      fetchState(true);
    } else {
      isAdminAuthenticated = false;
      showLoginOverlay();
    }
  } catch (err) {
    showLoginOverlay();
  }
}

async function fetchState(initial = false) {
  try {
    const res = await fetch("/api/state");
    if (res.status === 401) {
      isAdminAuthenticated = false;
      showLoginOverlay();
      showToast("Yönetici girişi gerekli.");
      return;
    }
    if (!res.ok) throw new Error("Durum alınamadı");
    const data = await res.json();
    updateAppState(data, initial);
  } catch (err) {
    showToast("Sunucu bağlantı hatası: " + err.message);
  }
}

function updateAppState(data, initial = false) {
  appState = data;

  if (initial) {
    let bestBlock = "121";
    let maxActive = -1;
    for (const [bId, bObj] of Object.entries(appState.blocks)) {
      const cnt = bObj.total_active || bObj.total_pdfs || 0;
      if (cnt > maxActive) {
        maxActive = cnt;
        bestBlock = bId;
      }
    }
    currentBlockId = bestBlock;
  } else if (!appState.blocks[currentBlockId]) {
    currentBlockId = "121";
  }

  renderTopBar();
  renderArenaMap();
  renderQuickBlockDropdown();
  renderActiveBlockPills();
  renderQuickGroupChips();
  renderDatalists();
  renderSeatingStage();
  renderGroupsSummary();
  updateSelectionBar();
  fetchExcelSummary();
  updateDispatchBadge();
}

function openMobileSidebar() {
  const sidebar = document.getElementById("sidebarColumn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const tabMobile = document.getElementById("tabBtnMobileSidebar");
  if (sidebar) sidebar.classList.add("mobile-open");
  if (backdrop) backdrop.classList.remove("hidden");
  if (tabMobile) tabMobile.classList.add("active");
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebarColumn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const tabMobile = document.getElementById("tabBtnMobileSidebar");
  if (sidebar) sidebar.classList.remove("mobile-open");
  if (backdrop) backdrop.classList.add("hidden");
  if (tabMobile) tabMobile.classList.remove("active");
}

function switchMainView(viewName) {
  currentView = viewName;
  closeMobileSidebar();
  document.getElementById("tabBtnSeating").classList.toggle("active", viewName === "seating");
  document.getElementById("tabBtnArena").classList.toggle("active", viewName === "arena");

  document.getElementById("viewSeating").classList.toggle("hidden", viewName !== "seating");
  document.getElementById("viewArena").classList.toggle("hidden", viewName !== "arena");
}

// ---------------------------------------------------------
// 1. ÜST NAVİGASYON VE MAÇ SEÇİCİ
// ---------------------------------------------------------
function renderTopBar() {
  const mi = appState.match_info || {};
  const matchSelect = document.getElementById("selectMatchSwitcher");
  matchSelect.innerHTML = "";

  const matches = appState.matches || [];
  matches.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.folder;
    const cleanT = (m.title || "Maç").replace(/\s*-\s*\d{3}\s+\d+\s*-\s*-?\d+$/, "");
    const dPart = m.date ? ` (${m.date})` : "";
    opt.textContent = `${cleanT}${dPart}`;
    if (m.folder.toLowerCase() === appState.folder.toLowerCase()) {
      opt.selected = true;
    }
    matchSelect.appendChild(opt);
  });

  const dateEl = document.getElementById("matchDateBadge");
  if (mi.match_date) {
    dateEl.textContent = mi.match_date;
    dateEl.classList.remove("hidden");
  } else {
    dateEl.classList.add("hidden");
  }

  document.getElementById("statTotalPdf").textContent = appState.total_tickets;
  document.getElementById("statAssignedPdf").textContent = appState.assigned_tickets;
  document.getElementById("statAvailablePdf").textContent =
    (appState.diger_tickets || 0) + (appState.unassigned_tickets || 0);

  document.getElementById("btnUndo").disabled = !appState.can_undo;
  document.getElementById("btnRedo").disabled = !appState.can_redo;
}

// ---------------------------------------------------------
// 2. BLOK SEÇİCİ VE SALON HARİTASI
// ---------------------------------------------------------
function renderQuickBlockDropdown() {
  const sel = document.getElementById("selectQuickBlock");
  sel.innerHTML = "";

  Object.values(appState.blocks).forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b.id;
    const activeCnt = b.total_active || b.total_pdfs || 0;
    opt.textContent =
      activeCnt > 0
        ? `${b.id} Blok (${b.assigned_count}/${activeCnt} Dolu)`
        : `${b.id} Blok (${b.capacity} Koltuk)`;
    if (b.id === currentBlockId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderActiveBlockPills() {
  const container = document.getElementById("activeBlocksPills");
  container.innerHTML = "";

  const activeBlocks = Object.values(appState.blocks).filter(
    (b) => (b.total_active || b.total_pdfs) > 0
  );

  // Birden fazla aktif blok varsa hızlı geçiş hapları göster
  if (activeBlocks.length > 1) {
    activeBlocks.forEach((b) => {
      const cnt = b.total_active || b.total_pdfs || 0;
      const bTitle = b.id === "SAHA" ? "Saha İçi" : b.id;
      const btn = document.createElement("button");
      btn.className = "block-pill-btn" + (b.id === currentBlockId ? " active" : "");
      btn.innerHTML = `<span>${bTitle}</span> <strong>${b.assigned_count}/${cnt}</strong>`;
      btn.addEventListener("click", () => selectBlock(b.id));
      container.appendChild(btn);
    });
  }
}

function renderArenaMap() {
  const onlyActive = document.getElementById("chkOnlyActiveBlocks").checked;
  const zones = appState.arena_zones || {};
  const closed = appState.closed_blocks || {};

  for (const [zoneKey, blockIds] of Object.entries(zones)) {
    const container = document.getElementById(`zone-${zoneKey}`);
    if (!container) continue;
    container.innerHTML = "";

    blockIds.forEach((bId) => {
      const isClosed = Boolean(closed[bId]);
      const bData = appState.blocks[bId];
      const activeCount = bData ? bData.total_active || bData.total_pdfs : 0;

      const btn = document.createElement("button");
      btn.className = "arena-block-btn";
      if (isClosed) {
        btn.classList.add("closed");
        btn.title = `${closed[bId].name} — ${closed[bId].reason}`;
        btn.innerHTML = `<span class="b-num">${bId}</span><span class="block-mini-cnt">Kapalı</span>`;
      } else {
        if (activeCount > 0) btn.classList.add("has-tickets");
        if (bId === currentBlockId) btn.classList.add("selected");
        if (onlyActive && activeCount === 0) btn.classList.add("dimmed");

        const cap = bData ? bData.capacity : "";
        btn.title = `${bId} Blok · Dolu: ${activeCount} · Kapasite: ${cap}`;
        btn.innerHTML = `
          <span class="b-num">${bId} Blok</span>
          <span class="block-mini-cnt">${activeCount > 0 ? activeCount + " Dolu" : cap + " koltuk"}</span>
        `;
        btn.addEventListener("click", () => {
          selectBlock(bId);
          switchMainView("seating");
        });
      }
      container.appendChild(btn);
    });
  }
}

function renderQuickGroupChips() {
  const container = document.getElementById("quickGroupChips");
  container.innerHTML = "";

  const chips = [];
  const saved = appState.saved_groups || [];
  const colors = appState.group_colors || {};

  saved.forEach((gItem) => {
    const gName = gItem.group;
    if (gName.toLowerCase() === "diğer" || gName.toLowerCase() === "diger") return;
    const c = colors[gName] || colors[gName.toLowerCase()] || "#8b5cf6";
    if (gItem.subgroups && gItem.subgroups.length > 0) {
      gItem.subgroups.forEach((sg) => {
        chips.push({ group: gName, subgroup: sg, label: `${gName}/${sg}`, color: c });
      });
    } else {
      chips.push({ group: gName, subgroup: "", label: gName, color: c });
    }
  });

  chips.forEach((ch) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-chip";
    btn.draggable = false;
    btn.innerHTML = `<span class="chip-dot" style="background:${ch.color};"></span><span>${ch.label}</span>`;
    btn.title = `Seçili koltukları '${ch.label}' kişisine ata`;
    btn.addEventListener("click", () => {
      assignSelectedSeats(ch.group, ch.subgroup);
    });
    container.appendChild(btn);
  });
}

function renderDatalists() {
  const dlGroups = document.getElementById("datalistGroups");
  const dlSubgroups = document.getElementById("datalistSubgroups");
  dlGroups.innerHTML = "";
  dlSubgroups.innerHTML = "";

  const saved = appState.saved_groups || [];
  const subSet = new Set();

  saved.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.group;
    dlGroups.appendChild(opt);
    (item.subgroups || []).forEach((sg) => subSet.add(sg));
  });

  subSet.forEach((sg) => {
    const opt = document.createElement("option");
    opt.value = sg;
    dlSubgroups.appendChild(opt);
  });
}

function selectBlock(blockId) {
  if (blockId && String(blockId).toLowerCase().includes("saha")) blockId = "SAHA";
  currentBlockId = blockId;
  selectedSeats.clear();
  lastClickedSeat = null;
  renderQuickBlockDropdown();
  renderArenaMap();
  renderActiveBlockPills();
  renderSeatingStage();
  updateSelectionBar();
}

// ---------------------------------------------------------
// 3. KOLTUK PLANI SAHNESİ VE TABLO ÇİZİMİ
// ---------------------------------------------------------
function renderSeatingStage() {
  const bInfo = appState.blocks[currentBlockId];
  if (!bInfo) return;

  document.getElementById("currentBlockTitle").textContent = bInfo.id === "SAHA" ? "SAHA İÇİ (VIP / PROTOKOL)" : `${bInfo.id} BLOK`;
  document.getElementById("currentBlockMetrics").textContent =
    `Kapasite: ${bInfo.capacity} · Dolu: ${bInfo.assigned_count} · Boşta/Diğer: ${bInfo.available_count} · Boş: ${bInfo.missing_count}`;

  ["Top", "Bottom", "Left", "Right"].forEach((dir) => {
    const el = document.getElementById(`courtIndicator${dir}`);
    if (el) {
      el.classList.toggle("hidden", bInfo.court_side !== dir.toLowerCase());
    }
  });

  const gridContainer = document.getElementById("seatingGridContainer");
  gridContainer.innerHTML = "";

  const ticketsMap = bInfo.tickets || {};

  bInfo.rows.forEach((rowObj) => {
    const rNum = rowObj.row;
    const rowEl = document.createElement("div");
    rowEl.className = "seat-row";

    // Sol Sıra Başlığı
    const rowLabelText = rowObj.label ? `Sıra ${rowObj.label}` : `Sıra ${rNum}`;
    const rowBtnLeft = document.createElement("button");
    rowBtnLeft.className = "row-label-btn";
    rowBtnLeft.textContent = rowLabelText;
    rowBtnLeft.title = `${rowLabelText} içindeki tüm koltukları seç veya bırak`;
    rowBtnLeft.addEventListener("click", () => toggleEntireRow(rNum, rowObj.cells));
    rowEl.appendChild(rowBtnLeft);

    rowObj.cells.forEach((seatNum) => {
      if (seatNum === null || seatNum === undefined) {
        const spacer = document.createElement("div");
        spacer.className = "seat-spacer";
        rowEl.appendChild(spacer);
        return;
      }

      const seatId = `${rNum}-${seatNum}`;
      const ticket = ticketsMap[seatId];
      const cell = document.createElement("div");
      cell.className = "seat-cell";
      cell.dataset.seatId = seatId;
      cell.dataset.row = rNum;
      cell.dataset.seat = seatNum;

      if (!ticket) {
        cell.classList.add("unloaded");
        if (selectedSeats.has(seatId)) {
          cell.classList.add("selected");
        }
        if (highlightedLabel) {
          cell.classList.add("dimmed-group");
        }
        cell.title = `${bInfo.id} Blok · Sıra ${rNum} Koltuk ${seatNum}\nDurum: Boş (Tıklayarak bir kişiye atayabilirsiniz)`;
        cell.innerHTML = `<span class="seat-num">${seatNum}</span><span class="seat-owner">Boş</span>`;
      } else {
        const isAssigned = ticket.status === "assigned";
        const isDiger = ticket.status === "diger";
        let bgColor = "#FFFFFF";
        let ownerShort = "Boşta";

        if (colorMode === "classic") {
          bgColor = isAssigned ? "#DC2626" : (isDiger ? "#D97706" : "#FFFFFF");
          ownerShort = isAssigned ? ticket.subgroup || ticket.group : isDiger ? "diğer" : "Boşta";
        } else {
          if (isAssigned) {
            bgColor = ticket.color || "#7E22CE";
            ownerShort = ticket.subgroup || ticket.group;
          } else {
            bgColor = isDiger ? "#D97706" : "#FFFFFF";
            ownerShort = isDiger ? "diğer" : "Boşta";
          }
        }

        cell.style.backgroundColor = bgColor;
        if (bgColor === "#FFFFFF") {
          cell.style.color = "#334155";
          cell.style.border = "1.5px solid #CBD5E1";
        } else {
          cell.style.color = "#FFFFFF";
          cell.style.border = "1.5px solid transparent";
        }

        if (selectedSeats.has(seatId)) {
          cell.classList.add("selected");
        }

        if (
          shiftSourceSeats.some(
            (s) => s.block === currentBlockId && s.row === rNum && s.seat === seatNum
          )
        ) {
          cell.classList.add("shift-source");
        }

        if (highlightedLabel) {
          const tLabel = ticket.label || "__UNASSIGNED__";
          const matchesHighlight =
            tLabel.toLowerCase() === highlightedLabel.toLowerCase() ||
            (ticket.group && ticket.group.toLowerCase() === highlightedLabel.toLowerCase());
          if (matchesHighlight) {
            cell.classList.add("highlighted-group");
          } else {
            cell.classList.add("dimmed-group");
          }
        }

        const pdfNote = ticket.has_pdf === false ? " (Planlandı)" : "";
        cell.title = `${bInfo.id} Blok · Sıra ${rNum} Koltuk ${seatNum}\nKişi/Grup: ${ticket.label || "Ana Klasör"}${pdfNote}`;
        cell.innerHTML = `
          <span class="seat-num">${seatNum}</span>
          <span class="seat-owner" style="${ownerShort.length > 10 ? 'font-size:7.5px;letter-spacing:-0.03em;' : ''}">${ownerShort}</span>
        `;
      }

      cell.addEventListener("mousedown", (e) => onSeatMouseDown(e, rNum, seatNum, seatId));
      cell.addEventListener("mouseenter", (e) => onSeatMouseEnter(e, rNum, seatNum, seatId));

      rowEl.appendChild(cell);
    });

    // Sağ Sıra Başlığı
    const rowBtnRight = document.createElement("button");
    rowBtnRight.className = "row-label-btn";
    rowBtnRight.textContent = `Sıra ${rNum}`;
    rowBtnRight.addEventListener("click", () => toggleEntireRow(rNum, rowObj.cells));
    rowEl.appendChild(rowBtnRight);

    gridContainer.appendChild(rowEl);
  });

  renderBlockLegend(bInfo);
}

function renderBlockLegend(bInfo) {
  const bar = document.getElementById("blockLegendBar");
  bar.innerHTML = "";

  const counts = {};
  Object.values(bInfo.tickets || {}).forEach((t) => {
    const lbl = t.group ? t.group : "Boşta";
    const col = t.status === "assigned" ? t.color : (t.status === "diger" ? "#D97706" : "#FFFFFF");
    if (!counts[lbl]) counts[lbl] = { label: lbl, color: col, count: 0 };
    counts[lbl].count += 1;
  });

  Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .forEach((item) => {
      const badge = document.createElement("span");
      badge.className = "legend-badge";
      badge.innerHTML = `
        <span class="legend-dot" style="background:${item.color}"></span>
        <span>${item.label} <strong>${item.count}</strong></span>
      `;
      badge.addEventListener("mouseenter", () => {
        highlightedLabel = item.label === "Boşta" ? "__UNASSIGNED__" : item.label;
        renderSeatingStage();
      });
      badge.addEventListener("mouseleave", () => {
        highlightedLabel = null;
        renderSeatingStage();
      });
      badge.addEventListener("click", () => {
        const targetLbl = item.label === "Boşta" ? "__UNASSIGNED__" : item.label;
        if (highlightedLabel === targetLbl) {
          highlightedLabel = null;
          selectedSeats.clear();
        } else {
          highlightedLabel = targetLbl;
          selectSeatsByGroupInCurrentBlock(item.label === "Boşta" ? "" : item.label);
        }
        renderSeatingStage();
      });
      bar.appendChild(badge);
    });
}

// ---------------------------------------------------------
// 4. KOLTUK SEÇİMİ VE KAYDIRMA
// ---------------------------------------------------------
function onSeatMouseDown(e, rNum, seatNum, seatId) {
  if (e.button !== 0) return;
  e.preventDefault();
  isMouseDown = true;

  if (currentMode === "shift") {
    handleShiftSeatClick(rNum, seatNum);
    return;
  }

  if (e.shiftKey && lastClickedSeat) {
    selectSeatRange(lastClickedSeat, { row: rNum, seat: seatNum });
  } else {
    if (selectedSeats.has(seatId)) {
      selectedSeats.delete(seatId);
      dragSelectTargetState = false;
    } else {
      selectedSeats.add(seatId);
      dragSelectTargetState = true;
    }
    lastClickedSeat = { row: rNum, seat: seatNum };
  }

  renderSeatingStage();
  updateSelectionBar();
}

function onSeatMouseEnter(e, rNum, seatNum, seatId) {
  if (!isMouseDown || currentMode !== "select") return;
  if (dragSelectTargetState) {
    selectedSeats.add(seatId);
  } else {
    selectedSeats.delete(seatId);
  }
  renderSeatingStage();
  updateSelectionBar();
}

document.addEventListener("mouseup", () => {
  isMouseDown = false;
});

function selectSeatRange(start, end) {
  const bInfo = appState.blocks[currentBlockId];
  if (!bInfo) return;

  const rMin = Math.min(start.row, end.row);
  const rMax = Math.max(start.row, end.row);
  const sMin = Math.min(start.seat, end.seat);
  const sMax = Math.max(start.seat, end.seat);

  bInfo.rows.forEach((rObj) => {
    if (rObj.row >= rMin && rObj.row <= rMax) {
      rObj.cells.forEach((sNum) => {
        if (sNum !== null && sNum >= sMin && sNum <= sMax) {
          selectedSeats.add(`${rObj.row}-${sNum}`);
        }
      });
    }
  });
}

function toggleEntireRow(rowNum, cells) {
  const rowSeatIds = cells.filter((s) => s !== null).map((s) => `${rowNum}-${s}`);
  const allSelected = rowSeatIds.every((id) => selectedSeats.has(id));
  rowSeatIds.forEach((id) => {
    if (allSelected) selectedSeats.delete(id);
    else selectedSeats.add(id);
  });

  renderSeatingStage();
  updateSelectionBar();
}

function formatSelectedSeatsPreview(seatsSet, blockId) {
  if (!seatsSet || seatsSet.size === 0) return "";
  const isSaha = String(blockId).toUpperCase() === "SAHA";
  const rowsMap = {};
  seatsSet.forEach((sid) => {
    const [rStr, sStr] = sid.split("-");
    const r = parseInt(rStr, 10);
    const s = parseInt(sStr, 10);
    if (!rowsMap[r]) rowsMap[r] = [];
    rowsMap[r].push(s);
  });

  const parts = [];
  Object.keys(rowsMap).map(Number).sort((a, b) => a - b).forEach((r) => {
    const sList = rowsMap[r].sort((a, b) => a - b);
    let rName = `Sıra ${r}`;
    if (isSaha) {
      rName = r === 1 ? "Sıra A" : r === 2 ? "Sıra B" : `Sıra ${r}`;
    }
    if (sList.length === 1) {
      parts.push(`${rName} · K.${sList[0]}`);
    } else {
      parts.push(`${rName} (K.${sList.join(", ")})`);
    }
  });

  const bPrefix = isSaha ? "Saha İçi · " : "";
  return bPrefix + parts.join("  |  ");
}

function updateSelectionBar() {
  const idleEl = document.getElementById("dockIdleState");
  const activeEl = document.getElementById("selectionActionBar");
  const count = selectedSeats.size;

  if (count === 0 || currentMode !== "select") {
    idleEl.classList.remove("hidden");
    activeEl.classList.add("hidden");
    return;
  }

  idleEl.classList.add("hidden");
  activeEl.classList.remove("hidden");

  const countTextEl = document.getElementById("selCountText");
  if (countTextEl) {
    countTextEl.textContent = `${count} Koltuk`;
  } else {
    document.getElementById("selCountBadge").textContent = `${count} Koltuk`;
  }

  const previewText = formatSelectedSeatsPreview(selectedSeats, currentBlockId);
  const prevEl = document.getElementById("selSeatsPreview");
  if (prevEl) {
    prevEl.textContent = previewText;
    prevEl.title = previewText;
  }
}

function setInteractionMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  const banner = document.getElementById("modeInfoBanner");
  if (mode === "select") {
    banner.classList.add("hidden");
    shiftSourceSeats = [];
  } else if (mode === "shift") {
    if (selectedSeats.size > 0 && shiftSourceSeats.length === 0) {
      shiftSourceSeats = Array.from(selectedSeats).map((sid) => {
        const [r, s] = sid.split("-").map(Number);
        return { block: currentBlockId, row: r, seat: s };
      });
      shiftSourceSeats.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.seat - b.seat));
      selectedSeats.clear();
    }
    updateShiftBanner();
  }

  renderSeatingStage();
  updateSelectionBar();
}

function updateShiftBanner() {
  const banner = document.getElementById("modeInfoBanner");
  banner.classList.remove("hidden");
  if (shiftSourceSeats.length === 0) {
    banner.innerHTML = `
      <span>Kaydırmak istediğiniz koltukları seçin.</span>
      <button class="btn btn-outline btn-xs" onclick="setInteractionMode('select')">İptal</button>
    `;
  } else {
    const srcText = shiftSourceSeats.map((s) => `${s.row}-${s.seat}`).join(", ");
    banner.innerHTML = `
      <span>Kaynak (${shiftSourceSeats.length} koltuk: ${srcText}) seçildi. Hedef başlangıç koltuğuna tıklayın.</span>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-outline btn-xs" onclick="shiftSourceSeats=[]; renderSeatingStage(); updateShiftBanner();">Sıfırla</button>
        <button class="btn btn-outline btn-xs" onclick="setInteractionMode('select')">Kapat</button>
      </div>
    `;
  }
}

async function handleShiftSeatClick(rNum, seatNum) {
  if (shiftSourceSeats.length === 0) {
    shiftSourceSeats.push({ block: currentBlockId, row: rNum, seat: seatNum });
    updateShiftBanner();
    renderSeatingStage();
    return;
  }

  const count = shiftSourceSeats.length;
  const targetSeats = [];

  for (let i = 0; i < count; i++) {
    targetSeats.push({ block: currentBlockId, row: rNum, seat: seatNum + i });
  }

  try {
    const res = await fetch("/api/shift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_seats: shiftSourceSeats,
        target_seats: targetSeats,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Kaydırma başarısız");
    }
    const data = await res.json();
    showToast(`${count} koltuk kaydırıldı.`);
    shiftSourceSeats = [];
    setInteractionMode("select");
    updateAppState(data);
  } catch (err) {
    showToast(err.message);
  }
}

// ---------------------------------------------------------
// 5. ATAMA İŞLEMİ
// ---------------------------------------------------------
async function assignSelectedSeats(group, subgroup) {
  if (selectedSeats.size === 0) return;
  const seatIds = Array.from(selectedSeats);
  selectedSeats.clear();

  const seatsPayload = seatIds.map((sid) => {
    const [r, s] = sid.split("-").map(Number);
    return { block: currentBlockId, row: r, seat: s };
  });

  try {
    const res = await fetch("/api/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seats: seatsPayload,
        group: group || "",
        subgroup: subgroup || "",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Atama hatası");
    }
    const data = await res.json();
    const targetName = group ? (subgroup ? `${group}/${subgroup}` : group) : "Boşa";
    showToast(`${seatsPayload.length} koltuk ${targetName} olarak atandı.`);
    updateAppState(data);
  } catch (err) {
    showToast(err.message);
  }
}

// ---------------------------------------------------------
// 6. SAĞ SÜTUN: DAĞILIM LİSTESİ (KIRPILMASIZ & TEMİZ)
// ---------------------------------------------------------
function renderGroupsSummary() {
  const container = document.getElementById("groupsSummaryList");
  const query = (document.getElementById("inputSearchGroups").value || "").trim().toLowerCase();
  container.innerHTML = "";

  const groups = appState.groups_summary || [];
  const filtered = groups.filter((g) => {
    if (!query) return true;
    if (g.display_name.toLowerCase().includes(query)) return true;
    return g.subgroups.some(
      (sg) =>
        sg.display.toLowerCase().includes(query) ||
        sg.ranges.some((r) => r.text.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:20px; color:#64748b; font-size:12px; text-align:center;">Sonuç bulunamadı.</div>`;
    return;
  }

  filtered.forEach((g) => {
    const gKey = g.group || "__UNASSIGNED__";
    const isExpanded = Boolean(query) || expandedGroupKey === gKey;

    const card = document.createElement("div");
    card.className = "group-card-item" + (isExpanded ? " expanded" : "");

    // Başlık ve Özet Satırı
    const head = document.createElement("div");
    head.className = "group-summary-head";

    const hasRealSubgroups = g.subgroups.some((s) => s.subgroup !== "");
    const subPillsHtml = hasRealSubgroups
      ? `<div class="group-subtags-row">${g.subgroups
          .map((s) => `<span class="mini-subgroup-badge">${s.subgroup || g.display_name}: ${s.count}</span>`)
          .join("")}</div>`
      : "";

    head.innerHTML = `
      <div class="group-row-top">
        <div class="group-identity">
          <span class="group-circle-color" style="background:${g.color}"></span>
          <span class="group-name-label">${g.display_name}</span>
        </div>
        <div class="group-meta-right">
          <span class="group-ticket-pill">${g.total_count}</span>
          <i class="ph ph-caret-down group-chevron-icon"></i>
        </div>
      </div>
      ${subPillsHtml}
    `;

    head.addEventListener("mouseenter", () => {
      highlightedLabel = g.is_unassigned ? "__UNASSIGNED__" : g.group;
      renderSeatingStage();
    });
    head.addEventListener("mouseleave", () => {
      highlightedLabel = null;
      renderSeatingStage();
    });
    head.addEventListener("click", () => {
      expandedGroupKey = expandedGroupKey === gKey ? null : gKey;
      renderGroupsSummary();
    });

    card.appendChild(head);

    // Açılır Detay Paneli
    const details = document.createElement("div");
    details.className = "group-expanded-details";

    const actionsGrid = document.createElement("div");
    actionsGrid.className = "group-actions-grid";

    const bSel = document.createElement("button");
    bSel.className = "action-tool-btn";
    bSel.innerHTML = `<i class="ph ph-cursor-click"></i><span>Seç</span>`;
    bSel.addEventListener("click", () => {
      closeMobileSidebar();
      selectSeatsByKeys(g.seat_keys);
    });

    const bPdf = document.createElement("button");
    bPdf.className = "action-tool-btn";
    bPdf.innerHTML = `<i class="ph ph-file-pdf"></i><span>Tek PDF</span>`;
    bPdf.addEventListener("click", () => {
      window.location.href = `/api/export-merged-pdf?group=${encodeURIComponent(g.group)}`;
    });

    const bZip = document.createElement("button");
    bZip.className = "action-tool-btn";
    bZip.innerHTML = `<i class="ph ph-file-zip"></i><span>ZIP</span>`;
    bZip.addEventListener("click", () => {
      window.location.href = `/api/export-zip?group=${encodeURIComponent(g.group)}`;
    });

    const bCopy = document.createElement("button");
    bCopy.className = "action-tool-btn";
    bCopy.innerHTML = `<i class="ph ph-copy"></i><span>Kopyala</span>`;
    bCopy.addEventListener("click", () => copyGroupSummaryText(g));

    const bRelease = document.createElement("button");
    bRelease.className = "action-tool-btn action-tool-btn-danger";
    bRelease.innerHTML = `<i class="ph ph-x-circle"></i><span>Boşa Çıkar</span>`;
    bRelease.title = `${g.display_name} grubunun tüm koltuklarını boşa çıkarır`;
    bRelease.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${g.display_name}" grubuna ait ${g.total_count} koltuk boşa çıkarılsın mı?`)) return;
      try {
        const res = await fetch("/api/groups/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group: g.group,
            seat_keys: g.seat_keys || [],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          updateAppState(data);
          fetchExcelSummary();
          showToast(`✅ "${g.display_name}" koltukları boşa çıkarıldı.`);
        } else {
          showToast("Koltuklar boşa çıkarılamadı.");
        }
      } catch (err) {
        showToast("Hata: " + err.message);
      }
    });

    actionsGrid.append(bSel, bPdf, bZip, bCopy, bRelease);
    details.appendChild(actionsGrid);

    const subList = document.createElement("div");
    subList.className = "subgroup-rows-list";

    g.subgroups.forEach((sg) => {
      const sgCard = document.createElement("div");
      sgCard.className = "subgroup-detail-card";

      sgCard.addEventListener("mouseenter", () => {
        highlightedLabel = g.is_unassigned ? "__UNASSIGNED__" : sg.display;
        renderSeatingStage();
      });
      sgCard.addEventListener("mouseleave", () => {
        highlightedLabel = null;
        renderSeatingStage();
      });

      const cardHead = document.createElement("div");
      cardHead.className = "subgroup-card-head";
      cardHead.innerHTML = `<span class="subgroup-title">${sg.display} (${sg.count})</span>`;

      const inActions = document.createElement("div");
      inActions.className = "subgroup-actions-inline";

      const btnInSel = document.createElement("button");
      btnInSel.className = "link-btn-xs";
      btnInSel.textContent = "Koltukları Seç";
      btnInSel.addEventListener("click", () => selectSeatsByKeys(sg.seat_keys));
      inActions.appendChild(btnInSel);

      if (sg.subgroup) {
        const btnInPdf = document.createElement("button");
        btnInPdf.className = "link-btn-xs";
        btnInPdf.textContent = "PDF";
        btnInPdf.addEventListener("click", () => {
          window.location.href = `/api/export-merged-pdf?group=${encodeURIComponent(
            g.group
          )}&subgroup=${encodeURIComponent(sg.subgroup)}`;
        });
        inActions.appendChild(btnInPdf);
      }

      cardHead.appendChild(inActions);
      sgCard.appendChild(cardHead);

      sg.ranges.forEach((r) => {
        const rText = document.createElement("div");
        rText.className = "range-text-item";
        rText.textContent = `• ${r.block} Blok Sıra ${r.row}: ${r.text} (${r.count})`;
        sgCard.appendChild(rText);
      });

      subList.appendChild(sgCard);
    });

    details.appendChild(subList);
    card.appendChild(details);
    container.appendChild(card);
  });
}

// ---------------------------------------------------------
// 6.B CANLI EXCEL TALEPLERİ PANELİ VE ATAMA İŞLEMLERİ
// ---------------------------------------------------------
function switchSidebarTab(tabName) {
  activeSidebarTab = tabName;
  const isExcel = tabName === "excel";
  document.getElementById("tabBtnExcel").classList.toggle("active", isExcel);
  document.getElementById("tabBtnDistribution").classList.toggle("active", !isExcel);
  document.getElementById("panelExcel").classList.toggle("hidden", !isExcel);
  document.getElementById("panelDistribution").classList.toggle("hidden", isExcel);
}

const reloadExcelSummary = fetchExcelSummary;
window.reloadExcelSummary = fetchExcelSummary;
async function fetchExcelSummary(matchName = null) {
  try {
    const url = matchName
      ? `/api/excel/summary?match_name=${encodeURIComponent(matchName)}`
      : `/api/excel/summary`;
    const res = await fetch(url);
    if (!res.ok) return;
    excelData = await res.json();
    renderExcelPanel();
  } catch (err) {
    console.error("Excel verisi yüklenemedi:", err);
  }
}

function renderExcelPanel() {
  if (!excelData || !excelData.ok) {
    const listEl = document.getElementById("excelRequestsList");
    if (listEl) {
      listEl.innerHTML = `
        <div style="padding:20px 12px; text-align:center; color:#64748b; font-size:12px;">
          <i class="ph ph-warning-circle" style="font-size:24px; display:block; margin-bottom:6px; color:#d97706;"></i>
          Excel dosyası okunamadı veya talep bulunamadı.
        </div>`;
    }
    return;
  }

  document.getElementById("excelStatRequested").textContent = excelData.total_requested || 0;
  document.getElementById("excelStatAssigned").textContent = excelData.total_assigned || 0;
  document.getElementById("excelStatPending").textContent = excelData.total_pending || 0;
  document.getElementById("badgeExcelPendingCount").textContent = excelData.pending_count || 0;
  const mobileBadge = document.getElementById("badgeMobileRequestsCount");
  if (mobileBadge) mobileBadge.textContent = excelData.pending_count || 0;

  // Dağılım rozetini de güncelle
  const distBadge = document.getElementById("badgeAssignedPeopleCount");
  if (distBadge && appState) {
    distBadge.textContent = (appState.groups_summary || []).length;
  }

  // Blok filtre seçeneklerini doldur
  const blockSel = document.getElementById("selectExcelBlockFilter");
  const currentVal = blockSel.value || "ALL";
  const blocksSet = new Set();
  let portalCount = 0;
  (excelData.requests || []).forEach((r) => {
    if (r.target_block) blocksSet.add(r.target_block);
    if (r.source === "portal") portalCount++;
  });
  blockSel.innerHTML = `
    <option value="ALL">Tüm Talepler (${excelData.requests.length})</option>
    <option value="PORTAL">🌐 Bilet İstiyorum Portalı (${portalCount})</option>
  `;
  Array.from(blocksSet).sort().forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    const count = excelData.requests.filter((r) => r.target_block === b).length;
    opt.textContent = `${b} Bloğu (${count})`;
    if (b === currentVal) opt.selected = true;
    blockSel.appendChild(opt);
  });

  // Listeyi filtrele ve çiz
  const listEl = document.getElementById("excelRequestsList");
  listEl.innerHTML = "";

  const filtered = (excelData.requests || []).filter((r) => {
    if (excelBlockFilter === "PORTAL" && r.source !== "portal") return false;
    if (excelBlockFilter !== "ALL" && excelBlockFilter !== "PORTAL" && r.target_block !== excelBlockFilter) return false;
    if (excelSearchQuery) {
      const q = excelSearchQuery.toLowerCase();
      const matchName = (r.person || "").toLowerCase().includes(q);
      const matchDesc = (r.description || "").toLowerCase().includes(q);
      const matchBlock = (r.target_block || "").toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchBlock) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding:24px 12px; text-align:center; color:#64748b; font-size:12px;">
        <i class="ph ph-magnifying-glass" style="font-size:24px; display:block; margin-bottom:6px; opacity:0.6;"></i>
        Eşleşen talep bulunamadı.
      </div>`;
    return;
  }

  filtered.forEach((r) => {
    const card = document.createElement("div");
    card.className = `excel-req-card ${r.fulfillment_status}${r.source === "portal" ? " portal-req-card" : ""}`;

    const isComp = r.fulfillment_status === "completed";
    const isCurrentBlock = r.target_block === currentBlockId;
    const isPortal = r.source === "portal";

    card.innerHTML = `
      <div class="excel-card-top">
        <div class="excel-card-person-info">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="excel-card-name">${escapeHtml(r.person)}</span>
            ${isPortal ? `<span class="portal-source-badge"><i class="ph ph-globe"></i> PORTAL</span>` : ""}
          </div>
          ${r.description ? `<span class="excel-card-sub">${escapeHtml(r.description)}</span>` : ""}
          ${r.phone ? `<span style="font-size:11px; color:#7e22ce; font-weight:700; margin-top:2px;"><i class="ph ph-phone"></i> ${escapeHtml(r.phone)}</span>` : ""}
        </div>
        <div style="display:flex; align-items:center; gap:5px;">
          <span class="excel-block-badge">${escapeHtml(r.target_block || "Blok Yok")}</span>
        </div>
      </div>

      <div class="excel-progress-wrap">
        <div class="excel-progress-meta">
          <span style="color:${r.status_color}; font-weight:700;">${r.status_badge}</span>
          <span style="color:#64748b;">${r.assigned_count} / ${r.requested_count} Adet</span>
        </div>
        <div class="excel-progress-track">
          <div class="excel-progress-fill" style="width:${r.progress_pct}%; background-color:${r.status_color};"></div>
        </div>
      </div>

      <div class="excel-card-actions">
        ${
          r.target_block && r.target_block !== currentBlockId && appState.blocks && appState.blocks[r.target_block]
            ? `<button class="excel-action-btn" data-act="jump" title="${r.target_block} bloğuna git">
                 <i class="ph ph-arrow-right"></i>
                 <span>Bloğa Git</span>
               </button>`
            : ""
        }

        ${
          !isComp
            ? `<button class="excel-action-btn excel-action-btn-primary" data-act="assign" title="Bu talebi koltuk planına ata">
                 <i class="ph ph-check-circle"></i>
                 <span>${selectedSeats.size > 0 ? `Seçiliyi Ata (${selectedSeats.size})` : `Koltuk Ata (${r.requested_count - r.assigned_count})`}</span>
               </button>`
            : ""
        }

        ${
          r.matched_seats && r.matched_seats.length > 0
            ? `<button class="excel-action-btn" data-act="highlight" title="Atanan koltukları göster">
                 <i class="ph ph-eye"></i>
                 <span>Koltuklar (${r.matched_seats.length})</span>
               </button>
               <button class="excel-action-btn excel-action-btn-whatsapp" data-act="whatsapp" title="Bu personele WhatsApp ile bilet gönder">
                 <i class="ph-bold ph-whatsapp-logo"></i>
                 <span>WhatsApp</span>
               </button>
               <button class="excel-action-btn excel-action-btn-danger" data-act="unassign-req" title="Bu talebe atanmış koltukları boşa çıkar">
                 <i class="ph ph-x-circle"></i>
                 <span>Atamayı Kaldır</span>
               </button>`
            : ""
        }

        ${
          isPortal
            ? `<button class="excel-action-btn" data-act="edit-portal" title="Bu talebi düzenle">
                 <i class="ph ph-pencil-simple"></i>
                 <span>Düzenle</span>
               </button>
               <button class="excel-action-btn excel-action-btn-danger" data-act="delete-portal" title="Bu talebi sil">
                 <i class="ph ph-trash"></i>
                 <span>Sil</span>
               </button>`
            : ""
        }
      </div>
    `;

    // Buton aksiyonları
    const btnEditPortal = card.querySelector('[data-act="edit-portal"]');
    if (btnEditPortal) {
      btnEditPortal.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditRequestModal(r);
      });
    }

    const btnDelPortal = card.querySelector('[data-act="delete-portal"]');
    if (btnDelPortal) {
      btnDelPortal.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`"${r.person}" adlı personelin talebini silmek istediğinize emin misiniz?`)) return;
        try {
          const res = await fetch(`/api/portal/request/${encodeURIComponent(r.request_id)}/delete`, { method: "POST" });
          if (res.ok) {
            showToast("Talep ve atanmış koltuklar silindi.");
            fetchExcelSummary();
            fetchState(false);
          } else {
            showToast("Talep silinemedi.");
          }
        } catch (err) {
          showToast("Hata: " + err.message);
        }
      });
    }

    const btnUnassignReq = card.querySelector('[data-act="unassign-req"]');
    if (btnUnassignReq) {
      btnUnassignReq.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`"${r.person}" için atanmış ${r.matched_seats.length} koltuk boşa çıkarılsın mı?`)) return;
        try {
          const res = await fetch("/api/groups/unassign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              group: r.person,
              request_id: r.request_id || "",
              seat_keys: r.matched_keys || [],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            updateAppState(data);
            fetchExcelSummary();
            showToast(`✅ "${r.person}" koltuk atamaları boşa çıkarıldı.`);
          } else {
            showToast("Koltuklar boşa çıkarılamadı.");
          }
        } catch (err) {
          showToast("Hata: " + err.message);
        }
      });
    }

    const btnJump = card.querySelector('[data-act="jump"]');
    if (btnJump) {
      btnJump.addEventListener("click", () => {
        closeMobileSidebar();
        selectBlock(r.target_block);
      });
    }

    const btnAssign = card.querySelector('[data-act="assign"]');
    if (btnAssign) {
      btnAssign.addEventListener("click", () => {
        closeMobileSidebar();
        handleExcelAssignClick(r);
      });
    }

    const btnHighlight = card.querySelector('[data-act="highlight"]');
    if (btnHighlight) {
      btnHighlight.addEventListener("click", () => {
        closeMobileSidebar();
        if (r.target_block && r.target_block !== currentBlockId && appState.blocks && appState.blocks[r.target_block]) {
          selectBlock(r.target_block);
        }
        highlightExcelSeats(r.matched_seats);
      });
    }

    const btnCardWhatsapp = card.querySelector('[data-act="whatsapp"]');
    if (btnCardWhatsapp) {
      btnCardWhatsapp.addEventListener("click", (e) => {
        e.stopPropagation();
        handleQuickSendWhatsAppForRequest(r);
      });
    }

    listEl.appendChild(card);
  });
}

async function handleExcelAssignClick(req) {
  const targetB = req.target_block || currentBlockId;
  if (targetB !== currentBlockId && appState.blocks && appState.blocks[targetB]) {
    selectBlock(targetB);
  }

  if (selectedSeats.size > 0) {
    const chosenList = Array.from(selectedSeats);
    const assignBlock = currentBlockId || targetB;
    selectedSeats.clear();
    try {
      const res = await fetch("/api/excel/assign-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: req.request_id,
          block_id: assignBlock,
          count: chosenList.length,
          group: req.suggested_group,
          subgroup: req.suggested_subgroup,
          seat_ids: chosenList,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Atama yapılamadı");
      }
      const data = await res.json();
      updateAppState(data);
      await fetchExcelSummary();
      showToast(`✅ ${req.person} talebine ${chosenList.length} koltuk atandı.`);
    } catch (err) {
      showToast(`Hata: ${err.message}`);
    }
  } else {
    // Koltuk seçilmemişse otomatik olarak boş koltuk bul ve ata
    const needed = req.requested_count - req.assigned_count;
    try {
      showToast(`${req.person} için ${targetB} bloğundan ${needed} koltuk tahsis ediliyor...`);
      const res = await fetch("/api/excel/assign-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: req.request_id,
          block_id: targetB,
          count: needed,
          group: req.suggested_group,
          subgroup: req.suggested_subgroup,
          seat_ids: [],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Atama yapılamadı");
      }
      const data = await res.json();
      updateAppState(data);
      await fetchExcelSummary();
      showToast(`✅ ${req.person} için ${needed} koltuk ${targetB} bloğuna atandı.`);
    } catch (err) {
      showToast(`Hata: ${err.message}`);
    }
  }
}

function highlightExcelSeats(seatList) {
  selectedSeats.clear();
  (seatList || []).forEach((sid) => selectedSeats.add(sid));
  renderSeatingStage();
  updateSelectionBar();
  showToast(`${seatList.length} koltuk tabloda vurgulandı.`);
}

async function reloadExcel() {
  try {
    showToast("Davetiye Bilet Takip.xlsx yeniden okunuyor...");
    const res = await fetch("/api/excel/reload", { method: "POST" });
    if (res.ok) {
      excelData = await res.json();
      renderExcelPanel();
      fetchState(false);
      showToast("✅ Excel talepleri başarıyla güncellendi.");
    }
  } catch (err) {
    showToast(`Excel okuma hatası: ${err.message}`);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function selectSeatsByKeys(seatKeys) {
  if (!seatKeys || seatKeys.length === 0) return;
  const firstBlock = seatKeys[0].split(":")[0];
  if (firstBlock !== currentBlockId) {
    currentBlockId = firstBlock;
  }
  switchMainView("seating");
  setInteractionMode("select");
  selectedSeats.clear();
  seatKeys.forEach((k) => {
    const [b, sid] = k.split(":");
    if (b === currentBlockId) {
      selectedSeats.add(sid);
    }
  });
  renderQuickBlockDropdown();
  renderArenaMap();
  renderActiveBlockPills();
  renderSeatingStage();
  updateSelectionBar();
}

function selectSeatsByGroupInCurrentBlock(labelStr) {
  const bInfo = appState.blocks[currentBlockId];
  if (!bInfo) return;
  selectedSeats.clear();
  Object.values(bInfo.tickets || {}).forEach((t) => {
    if (
      t.label.toLowerCase() === labelStr.toLowerCase() ||
      t.group.toLowerCase() === labelStr.toLowerCase()
    ) {
      selectedSeats.add(t.seat_id);
    }
  });
  renderSeatingStage();
  updateSelectionBar();
}

function copyGroupSummaryText(g) {
  const lines = [`${g.display_name} (${g.total_count} Bilet)`];
  g.subgroups.forEach((sg) => {
    if (sg.subgroup) {
      lines.push(`  ${sg.display} (${sg.count} Bilet):`);
    }
    sg.ranges.forEach((r) => {
      lines.push(`  ${r.block} Blok Sıra ${r.row}: ${r.text} (${r.count} adet)`);
    });
  });
  navigator.clipboard.writeText(lines.join("\n"));
  showToast(`${g.display_name} koltuk özeti kopyalandı.`);
}

// ---------------------------------------------------------
// 7. EVENT BAĞLANTILARI
// ---------------------------------------------------------
function bindUIEvents() {
  document.getElementById("tabBtnSeating").addEventListener("click", () => switchMainView("seating"));
  document.getElementById("tabBtnArena").addEventListener("click", () => switchMainView("arena"));
  document.getElementById("btnOpenArenaFromBar").addEventListener("click", () => switchMainView("arena"));

  // Sağ Sütun Sekmeleri (Excel Talepleri vs Dağılım Listesi)
  document.getElementById("tabBtnExcel").addEventListener("click", () => switchSidebarTab("excel"));
  document.getElementById("tabBtnDistribution").addEventListener("click", () => switchSidebarTab("dist"));

  // Yan Panel Aç / Kapat (Masaüstü ve Mobil)
  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        const sidebar = document.getElementById("sidebarColumn");
        const isOpen = sidebar && sidebar.classList.contains("mobile-open");
        if (isOpen) {
          closeMobileSidebar();
        } else {
          openMobileSidebar();
        }
      } else {
        const layout = document.querySelector(".main-layout");
        if (layout) {
          layout.classList.toggle("sidebar-collapsed");
          const isCollapsed = layout.classList.contains("sidebar-collapsed");
          btnToggleSidebar.classList.toggle("active", isCollapsed);
          showToast(isCollapsed ? "Yan panel gizlendi (Tam ekran koltuk planı)." : "Yan panel açıldı.");
        }
      }
    });
  }

  // Mobil Talepler Sekmesi
  const tabBtnMobileSidebar = document.getElementById("tabBtnMobileSidebar");
  if (tabBtnMobileSidebar) {
    tabBtnMobileSidebar.addEventListener("click", () => {
      openMobileSidebar();
    });
  }

  // Mobil Kapatma Butonu ve Karartma
  const btnCloseSidebarMobile = document.getElementById("btnCloseSidebarMobile");
  if (btnCloseSidebarMobile) {
    btnCloseSidebarMobile.addEventListener("click", closeMobileSidebar);
  }
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", closeMobileSidebar);
  }

  // Excel Yenile ve Filtreler
  document.getElementById("btnSyncExcel").addEventListener("click", reloadExcel);
  document.getElementById("selectExcelBlockFilter").addEventListener("change", (e) => {
    excelBlockFilter = e.target.value;
    renderExcelPanel();
  });
  document.getElementById("inputSearchExcel").addEventListener("input", (e) => {
    excelSearchQuery = e.target.value.trim().toLowerCase();
    renderExcelPanel();
  });

  // Akıllı Otomatik Dağıtım ve WhatsApp Dağıtım Butonları
  const btnAutoAll = document.getElementById("btnAutoAssignAll");
  if (btnAutoAll) btnAutoAll.addEventListener("click", handleAutoAssignAll);

  const btnOpenDisp = document.getElementById("btnOpenDispatchModal");
  if (btnOpenDisp) btnOpenDisp.addEventListener("click", openWhatsappDispatchModal);

  const btnSideDisp = document.getElementById("btnSidebarOpenDispatch");
  if (btnSideDisp) btnSideDisp.addEventListener("click", openWhatsappDispatchModal);

  const btnCloseDisp = document.getElementById("btnCloseDispatchModal");
  if (btnCloseDisp) btnCloseDisp.addEventListener("click", closeWhatsappDispatchModal);

  const btnExpDispZip = document.getElementById("btnExportDispatchZip");
  if (btnExpDispZip) {
    btnExpDispZip.addEventListener("click", () => {
      triggerDownload("/api/dispatch/export-all-zip", "ZEREN_SPOR_KUZEYBORU_Tum_Biletler.zip");
      showToast("📦 Tüm biletler kişi adlarıyla ZIP olarak indiriliyor...");
    });
  }

  // Canlı Vercel Portal Linki Kopyalama Butonları
  const copyVercelPortalUrl = () => {
    const url = "https://biletistiyorum.vercel.app";
    navigator.clipboard.writeText(url);
    showToast("🔗 biletistiyorum.vercel.app bağlantısı kopyalandı! WhatsApp'ta personele gönderebilirsiniz.");
  };
  const btnCopyPUrl = document.getElementById("btnCopyPortalUrl");
  if (btnCopyPUrl) btnCopyPUrl.addEventListener("click", copyVercelPortalUrl);
  const btnCopyPUrlDisp = document.getElementById("btnCopyPortalUrlDispatch");
  if (btnCopyPUrlDisp) btnCopyPUrlDisp.addEventListener("click", copyVercelPortalUrl);

  // Dispatch Filtre Çipleri
  const dChips = document.querySelectorAll(".dispatch-filter-chips .d-chip");
  dChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      dChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentDispatchFilter = chip.dataset.filter || "all";
      renderDispatchRecipients();
    });
  });

  // Dispatch Arama
  const inpSearchDisp = document.getElementById("inputSearchDispatch");
  if (inpSearchDisp) {
    inpSearchDisp.addEventListener("input", (e) => {
      dispatchSearchQuery = e.target.value.trim().toLowerCase();
      renderDispatchRecipients();
    });
  }

  // Biletinial Bilet Yükleme Modalı
  const btnOpenUpload = document.getElementById("btnUploadTicketsModal");
  if (btnOpenUpload) btnOpenUpload.addEventListener("click", openUploadTicketsModal);

  const btnCloseUpload = document.getElementById("btnCloseUploadTicketsModal");
  if (btnCloseUpload) btnCloseUpload.addEventListener("click", closeUploadTicketsModal);

  const dropzone = document.getElementById("ticketDropzone");
  const fileInput = document.getElementById("inputTicketFiles");
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", (e) => {
      if (e.target !== fileInput) fileInput.click();
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleTicketsUpload(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleTicketsUpload(e.target.files);
      }
    });
  }

  // Üst Maç Dropdown Değişimi
  document.getElementById("selectMatchSwitcher").addEventListener("change", async (e) => {
    const folderPath = e.target.value;
    if (!folderPath) return;
    try {
      const res = await fetch("/api/select-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
      });
      if (res.ok) {
        const data = await res.json();
        updateAppState(data, true);
        showToast("Maç değiştirildi.");
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  // Hızlı Blok Seçimi
  document.getElementById("selectQuickBlock").addEventListener("change", (e) => {
    selectBlock(e.target.value);
  });

  // Yeni Maç Modalı
  document.getElementById("btnNewMatchModal").addEventListener("click", () => {
    document.getElementById("newMatchModalBackdrop").classList.remove("hidden");
  });
  document.getElementById("btnCloseNewMatchModal").addEventListener("click", () => {
    document.getElementById("newMatchModalBackdrop").classList.add("hidden");
  });

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opp = btn.dataset.opp;
      document.getElementById("inputNewMatchName").value = `Zeren Spor - ${opp}`;
    });
  });

  document.getElementById("btnCreateEmptyOrFolderMatch").addEventListener("click", async () => {
    const name = document.getElementById("inputNewMatchName").value.trim();
    const date = document.getElementById("inputNewMatchDate").value.trim();
    const srcFolder = document.getElementById("inputNewMatchFolder").value.trim();
    if (!name) {
      showToast("Lütfen bir maç adı girin.");
      return;
    }
    try {
      const res = await fetch("/api/matches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_name: name, match_date: date, source_folder: srcFolder }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Oluşturulamadı");
      }
      const data = await res.json();
      document.getElementById("newMatchModalBackdrop").classList.add("hidden");
      document.getElementById("inputNewMatchName").value = "";
      updateAppState(data, true);
      showToast(`"${name}" maçı açıldı.`);
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("btnUploadMatchZip").addEventListener("click", async () => {
    const fileInput = document.getElementById("inputMatchZipFile");
    if (!fileInput.files || fileInput.files.length === 0) {
      showToast("Lütfen bir ZIP dosyası seçin.");
      return;
    }
    const name = document.getElementById("inputNewMatchName").value.trim();
    const date = document.getElementById("inputNewMatchDate").value.trim();

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("match_name", name);
    formData.append("match_date", date);

    try {
      showToast("ZIP yükleniyor ve biletler taranıyor...");
      const res = await fetch("/api/matches/upload-zip", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "ZIP yüklenemedi");
      }
      const data = await res.json();
      document.getElementById("newMatchModalBackdrop").classList.add("hidden");
      fileInput.value = "";
      updateAppState(data, true);
      showToast("ZIP başarıyla yüklendi.");
    } catch (err) {
      showToast(err.message);
    }
  });

  // Klasör Aç & Gözat
  document.getElementById("btnBrowseFolder").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/browse-folder", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        updateAppState(data, true);
        showToast("Maç klasörü yüklendi.");
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("btnOpenRootExplorer").addEventListener("click", () => {
    fetch("/api/open-explorer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: "", subgroup: "" }),
    });
  });

  // Undo / Redo / Refresh
  document.getElementById("btnUndo").addEventListener("click", doUndo);
  document.getElementById("btnRedo").addEventListener("click", doRedo);
  document.getElementById("btnRefresh").addEventListener("click", () => fetchState(false));
  const stageWrap = document.getElementById("seatingStageWrapper");
  if (stageWrap) {
    stageWrap.addEventListener("click", (e) => {
      if (e.target === stageWrap || e.target.classList.contains("canvas-middle-row") || e.target.id === "seatingGrid") {
        if (highlightedLabel) {
          highlightedLabel = null;
          renderSeatingStage();
        }
      }
    });
  }

  // Dışa Aktarımlar
  document.getElementById("btnExportAllZip").addEventListener("click", () => {
    window.location.href = "/api/export-zip?group=__ALL__";
  });

  document.getElementById("btnDownloadBlockPng").addEventListener("click", () => {
    showToast(`${currentBlockId} Blok koltuk planı PNG olarak indiriliyor.`);
    window.location.href = `/api/export-image/${currentBlockId}?mode=${colorMode}`;
  });

  // Modlar
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setInteractionMode(btn.dataset.mode));
  });

  document.getElementById("selectColorMode").addEventListener("change", (e) => {
    colorMode = e.target.value;
    renderSeatingStage();
  });

  document.getElementById("chkOnlyActiveBlocks").addEventListener("change", () => {
    renderArenaMap();
  });

  // Orijinal Görseller
  document.getElementById("btnPreviewOrigBlock").addEventListener("click", () => {
    openImageModal(`${currentBlockId} Blok — Orijinal Şema`, `/assets/tribun/${currentBlockId}.png`);
  });

  document.getElementById("btnOpenOriginalArena").addEventListener("click", () => {
    openImageModal("Başkent Voleybol Salonu — Genel Oturma Planı", "/assets/tribun/oturma_plani.png");
  });

  document.getElementById("btnCloseImageModal").addEventListener("click", () => {
    document.getElementById("imageModalBackdrop").classList.add("hidden");
  });

  // Alt Dock Aksiyonları
  document.getElementById("btnClearSelection").addEventListener("click", () => {
    selectedSeats.clear();
    renderSeatingStage();
    updateSelectionBar();
  });

  document.getElementById("btnApplyAssign").addEventListener("click", () => {
    const g = document.getElementById("inputAssignGroup").value.trim();
    const sg = document.getElementById("inputAssignSubgroup").value.trim();
    if (!g) {
      showToast("Kişi veya grup adı girin.");
      return;
    }
    assignSelectedSeats(g, sg);
  });

  document.getElementById("btnMoveToDiger").addEventListener("click", () => {
    assignSelectedSeats("diğer", "");
  });

  document.getElementById("btnMoveToRoot").addEventListener("click", () => {
    assignSelectedSeats("", "");
  });

  // Sağ Sütun Arama ve Kopyalama
  document.getElementById("inputSearchGroups").addEventListener("input", () => {
    renderGroupsSummary();
  });

  document.getElementById("btnCopyAllSummary").addEventListener("click", () => {
    if (!appState) return;
    const lines = [
      `${appState.match_info?.match_name || appState.folder_name}`,
      `Toplam: ${appState.total_tickets} · Dağıtılan: ${appState.assigned_tickets} · Diğer: ${appState.diger_tickets}`,
      "",
    ];
    (appState.groups_summary || []).forEach((g) => {
      lines.push(`${g.display_name} (${g.total_count} Bilet)`);
      g.subgroups.forEach((sg) => {
        const rTxt = sg.ranges.map((r) => `${r.block} Blok S.${r.row}: ${r.text}`).join(" | ");
        lines.push(`  ${sg.display} (${sg.count}): ${rTxt}`);
      });
    });
    navigator.clipboard.writeText(lines.join("\n"));
    showToast("Tüm dağılım özeti panoya kopyalandı.");
  });

  // Yeni Grup Modalı
  document.getElementById("btnNewGroupModal").addEventListener("click", () => {
    document.getElementById("newGroupModalBackdrop").classList.remove("hidden");
  });
  document.getElementById("btnCloseNewGroupModal").addEventListener("click", () => {
    document.getElementById("newGroupModalBackdrop").classList.add("hidden");
  });
  document.getElementById("btnSaveGroupTemplate").addEventListener("click", async () => {
    const g = document.getElementById("newGroupName").value.trim();
    const sg = document.getElementById("newSubgroupName").value.trim();
    const col = document.getElementById("newGroupColor").value;
    if (!g) {
      showToast("Grup adı boş olamaz.");
      return;
    }
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: g, subgroup: sg, color: col }),
    });
    if (res.ok) {
      const data = await res.json();
      updateAppState(data);
      document.getElementById("newGroupModalBackdrop").classList.add("hidden");
      document.getElementById("newGroupName").value = "";
      document.getElementById("newSubgroupName").value = "";
      showToast(`${g} eklendi.`);
    }
  });

  // Geçmiş Modalı
  document.getElementById("btnHistoryModal").addEventListener("click", () => {
    renderHistoryModal();
    document.getElementById("historyModalBackdrop").classList.remove("hidden");
  });
  document.getElementById("btnCloseHistoryModal").addEventListener("click", () => {
    document.getElementById("historyModalBackdrop").classList.add("hidden");
  });
  document.getElementById("btnSaveCurrentToHistory").addEventListener("click", async () => {
    const res = await fetch("/api/history/save", { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      appState.history = d.history;
      renderHistoryModal();
      showToast("Maç dağılımı geçmişe kaydedildi.");
    }
  });

  // Kısayollar (Ctrl+Z, Ctrl+Y, Esc)
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      doRedo();
    } else if (e.key === "Escape") {
      selectedSeats.clear();
      highlightedLabel = null;
      if (currentMode !== "select") setInteractionMode("select");
      renderSeatingStage();
      updateSelectionBar();
    }
  });

  initChipListInteractions();
}

function initChipListInteractions() {
  const container = document.getElementById("quickGroupChips");
  const btnLeft = document.getElementById("btnScrollChipsLeft");
  const btnRight = document.getElementById("btnScrollChipsRight");
  if (!container) return;

  // Ok butonları ile yumuşak kaydırma
  if (btnLeft) {
    btnLeft.addEventListener("click", (e) => {
      e.preventDefault();
      container.scrollBy({ left: -240, behavior: "smooth" });
    });
  }
  if (btnRight) {
    btnRight.addEventListener("click", (e) => {
      e.preventDefault();
      container.scrollBy({ left: 240, behavior: "smooth" });
    });
  }

  // Mouse tekerleği: Dikey tekerlek hareketini anında yatay kaydırmaya dönüştür
  container.addEventListener("wheel", (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY * 1.2;
    }
  }, { passive: false });

  // Mouse ile tıklayıp sürükleme (Drag-to-scroll)
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let hasMoved = false;

  container.addEventListener("mousedown", (e) => {
    isDown = true;
    hasMoved = false;
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  window.addEventListener("mouseup", () => {
    if (isDown) {
      isDown = false;
    }
  });

  container.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX);
    if (Math.abs(walk) > 5) {
      hasMoved = true;
    }
    container.scrollLeft = scrollLeft - walk;
  });

  // Sürükleme bittiğinde yanlışlıkla koltuk ataması yapılmasını önle
  container.addEventListener("click", (e) => {
    if (hasMoved) {
      e.stopPropagation();
      e.preventDefault();
      hasMoved = false;
    }
  }, true);
}

async function doUndo() {
  const res = await fetch("/api/undo", { method: "POST" });
  if (res.ok) {
    const data = await res.json();
    updateAppState(data);
    showToast("Son işlem geri alındı.");
  }
}

async function doRedo() {
  const res = await fetch("/api/redo", { method: "POST" });
  if (res.ok) {
    const data = await res.json();
    updateAppState(data);
    showToast("İşlem yeniden uygulandı.");
  }
}

function openImageModal(title, src) {
  document.getElementById("imageModalTitle").textContent = title;
  document.getElementById("imageModalImg").src = src;
  document.getElementById("imageModalBackdrop").classList.remove("hidden");
}

function renderHistoryModal() {
  const box = document.getElementById("historyModalContent");
  const hist = appState?.history || [];
  if (hist.length === 0) {
    box.innerHTML = `<p style="color:#64748b; font-size:12px;">Henüz arşivlenmiş maç kaydı yok.</p>`;
    return;
  }
  box.innerHTML = hist
    .map(
      (h) => `
    <div style="border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-bottom:6px; background:#f8fafc;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <strong>${h.match_name} ${h.match_date ? `(${h.match_date})` : ""}</strong>
        <span style="font-size:11px; color:#64748b;">${h.saved_at}</span>
      </div>
      <div style="font-size:11.5px; color:#475569; margin-bottom:6px;">
        Toplam: ${h.total_tickets} · Dağıtılan: ${h.assigned_tickets} · Diğer: ${h.diger_tickets}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:3px;">
        ${(h.groups || [])
          .map(
            (g) =>
              `<span style="background:#fff; border:1px solid #cbd5e1; border-radius:3px; padding:1px 6px; font-size:11px;">${g.group}: <strong>${g.total}</strong></span>`
          )
          .join("")}
      </div>
    </div>
  `
    )
    .join("");
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
}

// ---------------------------------------------------------
// YÖNETİCİ ŞİFRE & OTURUM İŞLEMLERİ
// ---------------------------------------------------------

function showLoginOverlay() {
  const overlay = document.getElementById("adminLoginOverlay");
  if (overlay) {
    overlay.classList.remove("hidden");
    const input = document.getElementById("adminPasswordInput");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 150);
    }
  }
  const errMsg = document.getElementById("loginErrorMsg");
  if (errMsg) errMsg.classList.add("hidden");
}

function hideLoginOverlay() {
  const overlay = document.getElementById("adminLoginOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
}

async function handleAdminLogin() {
  const pwdInput = document.getElementById("adminPasswordInput");
  const errMsg = document.getElementById("loginErrorMsg");
  const btnSubmit = document.getElementById("btnLoginSubmit");
  const pwd = pwdInput ? pwdInput.value : "";
  if (!pwd) return;

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="ph ph-spinner ph-spin"></i> <span>Giriş Yapılıyor...</span>`;
  errMsg.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(text && text.length < 120 ? text : "Sunucudan geçersiz yanıt alındı.");
    }
    if (res.ok && (data.success || data.authenticated)) {
      if (data.token) {
        localStorage.setItem("zeren_admin_token", data.token);
      }
      isAdminAuthenticated = true;
      hideLoginOverlay();
      showToast("Yönetici girişi başarılı!");
      fetchState(true);
    } else {
      errMsg.textContent = data.detail || "Hatalı şifre! Lütfen tekrar deneyiniz.";
      errMsg.classList.remove("hidden");
      pwdInput.classList.add("shake-anim");
      setTimeout(() => pwdInput.classList.remove("shake-anim"), 500);
      pwdInput.focus();
      pwdInput.select();
    }
  } catch (err) {
    errMsg.textContent = "Bağlantı hatası: " + err.message;
    errMsg.classList.remove("hidden");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<i class="ph-bold ph-sign-in"></i> <span>Panele Giriş Yap</span>`;
  }
}

async function handleAdminLogout() {
  if (!confirm("Yönetici oturumunu kapatmak istediğinize emin misiniz?")) return;
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {}
  localStorage.removeItem("zeren_admin_token");
  isAdminAuthenticated = false;
  showLoginOverlay();
  showToast("Oturum güvenle kapatıldı.");
}

async function handleChangePasswordSubmit() {
  const curInput = document.getElementById("inputCurrentPassword");
  const newInput = document.getElementById("inputNewPassword");
  const confInput = document.getElementById("inputNewPasswordConfirm");
  const errBox = document.getElementById("changePwdErrorMsg");
  const btnSave = document.getElementById("btnSaveNewPassword");

  const curPwd = curInput ? curInput.value : "";
  const newPwd = newInput ? newInput.value : "";
  const confPwd = confInput ? confInput.value : "";

  if (newPwd !== confPwd) {
    errBox.textContent = "Yeni şifreler birbiriyle uyuşmuyor!";
    errBox.classList.remove("hidden");
    return;
  }

  btnSave.disabled = true;
  errBox.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById("changePasswordModalBackdrop").classList.add("hidden");
      if (curInput) curInput.value = "";
      if (newInput) newInput.value = "";
      if (confInput) confInput.value = "";
      showToast("Şifreniz başarıyla güncellendi!");
    } else {
      errBox.textContent = data.detail || "Şifre değiştirilemedi.";
      errBox.classList.remove("hidden");
    }
  } catch (err) {
    errBox.textContent = "Hata: " + err.message;
    errBox.classList.remove("hidden");
  } finally {
    btnSave.disabled = false;
  }
}

function bindAuthEvents() {
  // Şifre Göster / Gizle Butonu
  const btnPeek = document.getElementById("btnToggleLoginPwd");
  const pwdInput = document.getElementById("adminPasswordInput");
  const iconPeek = document.getElementById("iconPeekPwd");
  if (btnPeek && pwdInput && iconPeek) {
    btnPeek.addEventListener("click", () => {
      if (pwdInput.type === "password") {
        pwdInput.type = "text";
        iconPeek.className = "ph ph-eye-slash";
      } else {
        pwdInput.type = "password";
        iconPeek.className = "ph ph-eye";
      }
    });
  }

  // Çıkış Yap Butonu
  const btnLogout = document.getElementById("btnLogoutAdmin");
  if (btnLogout) {
    btnLogout.addEventListener("click", handleAdminLogout);
  }

  // Şifre Değiştirme Modalı
  const btnOpenChangeModal = document.getElementById("btnOpenChangePwdModal");
  const changeModalBackdrop = document.getElementById("changePasswordModalBackdrop");
  const btnCloseChangeModal = document.getElementById("btnCloseChangePwdModal");
  const btnCancelChangePwd = document.getElementById("btnCancelChangePwd");

  if (btnOpenChangeModal && changeModalBackdrop) {
    btnOpenChangeModal.addEventListener("click", () => {
      changeModalBackdrop.classList.remove("hidden");
      const errBox = document.getElementById("changePwdErrorMsg");
      if (errBox) errBox.classList.add("hidden");
      const curInput = document.getElementById("inputCurrentPassword");
      if (curInput) {
        curInput.value = "";
        setTimeout(() => curInput.focus(), 150);
      }
    });
  }

  const closeChangeModal = () => {
    if (changeModalBackdrop) changeModalBackdrop.classList.add("hidden");
  };
  if (btnCloseChangeModal) btnCloseChangeModal.addEventListener("click", closeChangeModal);
  if (btnCancelChangePwd) btnCancelChangePwd.addEventListener("click", closeChangeModal);
}

// =========================================================
// BİLETİNİAL BİLET YÜKLEME (ZIP / PDF GÖMME)
// =========================================================
function openUploadTicketsModal() {
  const backdrop = document.getElementById("uploadTicketsModalBackdrop");
  if (backdrop) {
    const lbl = document.getElementById("uploadTargetMatchName");
    if (lbl && appState) {
      lbl.textContent = appState.match_name || "Zeren Spor - Kuzeyboru";
    }
    const box = document.getElementById("uploadStatusBox");
    if (box) box.classList.add("hidden");
    backdrop.classList.remove("hidden");
  }
}

function closeUploadTicketsModal() {
  const backdrop = document.getElementById("uploadTicketsModalBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
}

async function handleTicketsUpload(files) {
  if (!files || files.length === 0) return;
  const box = document.getElementById("uploadStatusBox");
  const txt = document.getElementById("uploadStatusText");
  if (box) box.classList.remove("hidden");
  if (txt) txt.textContent = `${files.length} dosya işleniyor ve sisteme gömülüyor...`;

  const fd = new FormData();
  for (let i = 0; i < files.length; i++) {
    fd.append("files", files[i]);
  }

  try {
    const res = await fetch("/api/matches/upload-tickets", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Yükleme başarısız");
    }
    const data = await res.json();
    closeUploadTicketsModal();
    updateAppState(data.state, true);
    await fetchExcelSummary();
    showToast(`✅ ${data.added_files} adet bilet başarıyla yüklendi! Toplam: ${data.total_tickets} bilet.`);
    updateDispatchBadge();
  } catch (err) {
    showToast(`Yükleme hatası: ${err.message}`);
    if (box) box.classList.add("hidden");
  }
}

// =========================================================
// AKILLI OTOMATİK KOLTUK DAĞITIMI (TÜMÜNÜ EŞLEŞTİR)
// =========================================================
async function handleAutoAssignAll() {
  if (!confirm("Bekleyen tüm personel talepleri mevcut boş koltuklarla (mümkünse yan yana) otomatik eşleştirilsin mi?")) {
    return;
  }
  showToast("Talepler koltuklarla eşleştiriliyor...");
  try {
    const res = await fetch("/api/matches/auto-assign-all", {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Otomatik eşleştirme yapılamadı");
    }
    const data = await res.json();
    showToast(`✅ ${data.message}`);
    await fetchState(false);
    await fetchExcelSummary();
    updateDispatchBadge();
  } catch (err) {
    showToast(`Hata: ${err.message}`);
  }
}

// =========================================================
// WHATSAPP BİLET DAĞITIM MERKEZİ (ASİSTANI)
// =========================================================
let dispatchRecipients = [];
let currentDispatchFilter = "all"; // "all" | "pending" | "sent"
let dispatchSearchQuery = "";

async function openWhatsappDispatchModal() {
  const backdrop = document.getElementById("whatsappDispatchModalBackdrop");
  if (backdrop) {
    backdrop.classList.remove("hidden");
    await loadDispatchList();
  }
}

function closeWhatsappDispatchModal() {
  const backdrop = document.getElementById("whatsappDispatchModalBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
}

async function updateDispatchBadge() {
  try {
    const res = await fetch("/api/dispatch/list");
    if (res.ok) {
      const data = await res.json();
      const badge = document.getElementById("badgeDispatchPending");
      if (badge) {
        badge.textContent = data.pending_count || 0;
        badge.style.display = data.pending_count > 0 ? "inline-flex" : "none";
      }
    }
  } catch (e) {}
}

async function loadDispatchList() {
  try {
    const res = await fetch("/api/dispatch/list");
    if (!res.ok) throw new Error("Dağıtım listesi alınamadı");
    const data = await res.json();
    dispatchRecipients = data.recipients || [];

    // Başlık ve İstatistikler
    const tTitle = document.getElementById("dispatchMatchTitle");
    if (tTitle) tTitle.textContent = `${data.match_name} (${data.match_date})`;

    const elTotalP = document.getElementById("dispatchTotalPersons");
    if (elTotalP) elTotalP.textContent = data.total_recipients;

    const elTotalT = document.getElementById("dispatchTotalTickets");
    if (elTotalT) elTotalT.textContent = data.total_tickets;

    const elSent = document.getElementById("dispatchSentCount");
    if (elSent) elSent.textContent = data.sent_count;

    const elPending = document.getElementById("dispatchPendingCount");
    if (elPending) elPending.textContent = data.pending_count;

    const elProgTxt = document.getElementById("dispatchProgressText");
    if (elProgTxt) elProgTxt.textContent = `%${data.progress_pct}`;

    const elProgFill = document.getElementById("dispatchProgressFill");
    if (elProgFill) elProgFill.style.width = `${data.progress_pct}%`;

    // Chip sayaçları
    const cAll = document.getElementById("cntAll");
    if (cAll) cAll.textContent = data.total_recipients;
    const cPending = document.getElementById("cntPending");
    if (cPending) cPending.textContent = data.pending_count;
    const cSent = document.getElementById("cntSent");
    if (cSent) cSent.textContent = data.sent_count;

    // Topbar badge
    const badge = document.getElementById("badgeDispatchPending");
    if (badge) {
      badge.textContent = data.pending_count;
      badge.style.display = data.pending_count > 0 ? "inline-flex" : "none";
    }

    renderDispatchRecipients();
  } catch (err) {
    showToast(`Hata: ${err.message}`);
  }
}

function renderDispatchRecipients() {
  const container = document.getElementById("dispatchRecipientsList");
  const emptyBox = document.getElementById("dispatchListEmpty");
  if (!container) return;

  container.innerHTML = "";

  const filtered = dispatchRecipients.filter((r) => {
    if (currentDispatchFilter === "pending" && r.whatsapp_sent) return false;
    if (currentDispatchFilter === "sent" && !r.whatsapp_sent) return false;
    if (dispatchSearchQuery) {
      const q = dispatchSearchQuery;
      const matchP = (r.person || "").toLowerCase().includes(q);
      const matchPhone = (r.phone || "").toLowerCase().includes(q);
      const matchDept = (r.department || "").toLowerCase().includes(q);
      const matchSeats = (r.seats_formatted || "").toLowerCase().includes(q);
      if (!matchP && !matchPhone && !matchDept && !matchSeats) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    if (emptyBox) emptyBox.classList.remove("hidden");
    return;
  }
  if (emptyBox) emptyBox.classList.add("hidden");

  filtered.forEach((r) => {
    const card = document.createElement("div");
    card.className = `dispatch-recipient-card ${r.whatsapp_sent ? "card-sent" : ""}`;

    card.innerHTML = `
      <div class="d-person-col">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="d-person-name">${escapeHtml(r.person)}</span>
          ${r.whatsapp_sent ? `<i class="ph-bold ph-check-circle" style="color:#10b981;" title="WhatsApp ile gönderildi"></i>` : ""}
        </div>
        <span class="d-person-dept">${escapeHtml(r.department || "Kulüp Mensubu")}</span>
      </div>

      <div class="d-phone-col">
        <input
          type="tel"
          class="d-phone-input"
          placeholder="05xx xxx xx xx"
          value="${escapeHtml(r.phone || '')}"
          data-id="${escapeHtml(r.id)}"
          data-person="${escapeHtml(r.person)}"
          title="Telefon numarasını yazıp Enter'a veya dışarı tıklayın"
        />
      </div>

      <div class="d-seats-col">
        <span class="d-seats-badge">
          <i class="ph ph-armchair"></i> ${escapeHtml(r.seats_formatted)} (${r.ticket_count} Bilet)
        </span>
        <div class="d-individual-tickets-list">
          ${(r.individual_tickets || []).map((t) => `
            <a
              href="${t.download_url}"
              download="${t.filename}"
              class="d-seat-ticket-chip ${t.has_pdf ? 'ready' : 'virtual'}"
              title="${escapeHtml(t.label)} tekil PDF biletini indir"
            >
              <i class="ph-bold ${t.has_pdf ? 'ph-file-pdf' : 'ph-armchair'}"></i>
              <span>${escapeHtml(t.label.replace('Sıra ', 'S').replace(', Koltuk ', '-K'))}</span>
            </a>
          `).join("")}
        </div>
      </div>

      <div class="d-actions-col">
        <button
          class="btn-send-whatsapp"
          data-action="send-wa"
          title="Tekil bilet PDF'lerini indir ve WhatsApp sohbetini aç"
        >
          <i class="ph-bold ph-whatsapp-logo"></i>
          <span>WhatsApp'tan Gönder</span>
        </button>

        <button
          class="d-toggle-sent-btn ${r.whatsapp_sent ? 'is-sent' : ''}"
          data-action="toggle-sent"
          title="Gönderildi durumunu değiştir"
        >
          <i class="ph-bold ${r.whatsapp_sent ? 'ph-check-square' : 'ph-square'}"></i>
          <span>${r.whatsapp_sent ? 'Gönderildi' : 'Bekliyor'}</span>
        </button>
      </div>
    `;

    // 1. Telefon Alanı Değişimi
    const phoneInput = card.querySelector(".d-phone-input");
    if (phoneInput) {
      phoneInput.addEventListener("change", async (e) => {
        const val = e.target.value.trim();
        await saveRecipientPhone(r.id, r.person, val);
      });
      phoneInput.addEventListener("click", (e) => e.stopPropagation());
    }

    // 2. WhatsApp ile Gönder Butonu
    const btnSend = card.querySelector('[data-action="send-wa"]');
    if (btnSend) {
      btnSend.addEventListener("click", () => handleDispatchSendWhatsApp(r, card));
    }

    // 3. Mesajı Kopyala Butonu
    const btnCopy = card.querySelector('[data-action="copy-msg"]');
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        navigator.clipboard.writeText(r.message_text);
        showToast(`📋 ${r.person} için WhatsApp metni kopyalandı!`);
      });
    }

    // 4. Gönderildi Durumu Değiştir Butonu
    const btnToggle = card.querySelector('[data-action="toggle-sent"]');
    if (btnToggle) {
      btnToggle.addEventListener("click", async () => {
        const nextSent = !r.whatsapp_sent;
        await setRecipientSentStatus(r.id, r.person, nextSent);
        r.whatsapp_sent = nextSent;
        renderDispatchRecipients();
      });
    }

    container.appendChild(card);
  });
}

async function saveRecipientPhone(reqId, person, phone) {
  try {
    const res = await fetch("/api/dispatch/save-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: reqId, person: person, phone: phone }),
    });
    if (res.ok) {
      showToast(`📞 ${person} için telefon kaydedildi: ${phone}`);
      const found = dispatchRecipients.find((x) => x.id === reqId || x.person === person);
      if (found) {
        found.phone = phone;
        found.clean_phone = phone.replace(/\D/g, "");
      }
    }
  } catch (err) {
    showToast("Telefon kaydedilemedi: " + err.message);
  }
}

async function setRecipientSentStatus(reqId, person, sent) {
  try {
    await fetch("/api/dispatch/mark-sent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: reqId, person: person, sent: sent }),
    });
    updateDispatchBadge();
  } catch (err) {
    console.error("Durum kaydedilemedi:", err);
  }
}

// WhatsApp Gönderim Motoru (Masaüstü ve Mobil Destekli)
async function handleDispatchSendWhatsApp(r, cardEl) {
  const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);

  // 1. Telefon Kontrolü
  let targetPhone = r.clean_phone;
  if (!targetPhone) {
    const inputEl = cardEl ? cardEl.querySelector(".d-phone-input") : null;
    const currentVal = inputEl ? inputEl.value.trim() : "";
    const promptVal = prompt(
      `Sayın ${r.person} için telefon numarası kayıtlı değil.\nLütfen WhatsApp numarasını girin (Örn: 05321234567):`,
      currentVal
    );
    if (!promptVal) return;
    await saveRecipientPhone(r.id, r.person, promptVal);
    targetPhone = promptVal.replace(/\D/g, "");
    if (targetPhone.startsWith("0") && targetPhone.length === 11) targetPhone = "90" + targetPhone.slice(1);
    else if (targetPhone.startsWith("5") && targetPhone.length === 10) targetPhone = "90" + targetPhone;
  }

  // 2. Mobil Paylaşım Denemesi (Web Share API - Her bilet ayrı dosya olarak)
  if (isMobile && navigator.canShare) {
    try {
      showToast(`${r.person} için tekil biletler hazırlanıyor...`);
      const filePromises = (r.individual_tickets || []).map(async (t) => {
        if (!t.has_pdf) return null;
        const res = await fetch(t.download_url);
        if (res.ok) {
          const blob = await res.blob();
          return new File([blob], t.filename, { type: "application/pdf" });
        }
        return null;
      });
      const files = (await Promise.all(filePromises)).filter(Boolean);

      if (files.length > 0 && navigator.canShare({ files })) {
        await navigator.share({ files: files });
        await setRecipientSentStatus(r.id, r.person, true);
        r.whatsapp_sent = true;
        renderDispatchRecipients();
        showToast(`✅ ${r.person} için ${files.length} tekil bilet paylaşıldı.`);
        return;
      }
    } catch (err) {
      console.log("Web Share iptal veya desteklenmiyor, web yönlendirmesine geçiliyor:", err);
    }
  }

  // 3. Masaüstü Akışı: Tekli bilet indirme YOK. Sadece kişinin Windows klasörü açılır, WhatsApp uygulaması açılır.
  const dlCount = (r.individual_tickets || []).length || r.seat_count || 0;

  // 1. Windows Klasörünü Oluştur ve Aç (hem doğrudan yerel port hem bulut köprüsü üzerinden tetiklenir)
  try {
    const personName = r.person || "";
    const reqId = r.request_id || r.id || "";
    const qs = `group=${encodeURIComponent(personName)}&request_id=${encodeURIComponent(reqId)}`;
    fetch(`/api/open-explorer?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: personName, request_id: reqId })
    }).catch(() => {});
    fetch(`http://127.0.0.1:8765/api/open-explorer?${qs}`, { mode: "no-cors" }).catch(() => {});
  } catch (err) {
    console.log("Explorer açma isteği:", err);
  }

  // 2. WhatsApp Windows Masaüstü Uygulamasını Doğrudan Aç (whatsapp:// protokolü)
  if (targetPhone) {
    const waAppUrl = `whatsapp://send?phone=${targetPhone}`;
    const waLink = document.createElement("a");
    waLink.href = waAppUrl;
    document.body.appendChild(waLink);
    waLink.click();
    document.body.removeChild(waLink);
  } else {
    const waLink = document.createElement("a");
    waLink.href = "whatsapp://";
    document.body.appendChild(waLink);
    waLink.click();
    document.body.removeChild(waLink);
  }

  await setRecipientSentStatus(r.id, r.person, true);
  r.whatsapp_sent = true;
  renderDispatchRecipients();

  showToast(`✅ ${r.person} için ${dlCount} bilet klasöre ayrıldı ve WhatsApp açıldı. Klasördeki biletleri sohbete sürükleyin! 📎`);
}

function handleQuickSendWhatsAppForRequest(req) {
  // Sadece BU talebe ait koltuk ve biletleri ayrıştır
  const seats = req.matched_seats || [];
  const block = req.target_block || "102";
  const isSaha = String(block).toUpperCase().includes("SAHA");
  const bLabel = isSaha ? "Saha İçi" : `${block} Blok`;
  const indTickets = (req.matched_keys || seats.map(s => `${block}:${s}`)).map(k => {
    const parts = k.split(":");
    const bId = parts[0];
    const sid = parts[1] || "";
    const [r, s] = sid.split("-");
    const rLabel = bId.toUpperCase() === "SAHA" ? (r === "1" ? "A" : "B") : r;
    return {
      block: bId,
      seat_id: sid,
      label: `${bId.toUpperCase() === "SAHA" ? "Saha İçi" : bId + " Blok"} · S.${rLabel} K.${s}`,
      filename: `ZEREN_SPOR_${bId.toUpperCase() === "SAHA" ? "SahaIci" : bId + "Blok"}_Sira${rLabel}_Koltuk${s}.pdf`,
      download_url: `/tickets/${encodeURIComponent((window.TICKET_FILES && window.TICKET_FILES[k]) || `${bId}_${sid}.pdf`)}`,
      has_pdf: true
    };
  });

  const reqRecipient = {
    id: req.request_id || req.person,
    request_id: req.request_id || "",
    person: req.person,
    department: req.department || "",
    phone: req.phone || "",
    clean_phone: (req.phone || "").replace(/\D/g, ""),
    block: block,
    seats: seats,
    seats_formatted: `${bLabel} (${seats.length} Bilet)`,
    ticket_count: seats.length,
    seat_count: seats.length,
    whatsapp_sent: req.status === "assigned" && req.whatsapp_sent,
    individual_tickets: indTickets
  };

  handleDispatchSendWhatsApp(reqRecipient, null);
}

async function triggerDownload(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);
  } catch (e) {
    console.warn('Fetch download failed, falling back to direct anchor:', e);
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}


// Modal: Talebi Düzenle & Yatay Scroll Destekleri
function openEditRequestModal(r) {
  document.getElementById("editReqId").value = r.request_id || "";
  document.getElementById("editReqPerson").value = r.person || "";
  document.getElementById("editReqPhone").value = r.phone || "";
  document.getElementById("editReqDept").value = r.department || "";
  document.getElementById("editReqCount").value = r.requested_count || 1;
  const blockSel = document.getElementById("editReqBlock");
  if (blockSel) {
    let b = String(r.target_block || "102").toUpperCase();
    if (b.includes("SAHA")) b = "SAHA";
    blockSel.value = b;
  }
  document.getElementById("editReqDesc").value = r.description || "";
  document.getElementById("editRequestModalBackdrop").classList.remove("hidden");
}

async function handleEditRequestSubmit() {
  const reqId = document.getElementById("editReqId").value;
  if (!reqId) return;
  const payload = {
    person: document.getElementById("editReqPerson").value.trim(),
    phone: document.getElementById("editReqPhone").value.trim(),
    department: document.getElementById("editReqDept").value.trim(),
    requested_count: parseInt(document.getElementById("editReqCount").value, 10) || 1,
    target_block: document.getElementById("editReqBlock").value,
    description: document.getElementById("editReqDesc").value.trim()
  };

  try {
    const res = await fetch(`/api/portal/request/${encodeURIComponent(reqId)}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast("Talep başarıyla güncellendi.");
      document.getElementById("editRequestModalBackdrop").classList.add("hidden");
      fetchExcelSummary();
      fetchState(false);
    } else {
      showToast("Talep güncellenemedi.");
    }
  } catch (err) {
    showToast("Hata: " + err.message);
  }
}

function setupHorizontalScroll() {
  ["topbar", "block-toolbar"].forEach((cls) => {
    const el = document.querySelector("." + cls);
    if (!el) return;
    el.addEventListener("wheel", (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  });

  const btnCloseEdit = document.getElementById("btnCloseEditRequestModal");
  if (btnCloseEdit) btnCloseEdit.addEventListener("click", () => {
    document.getElementById("editRequestModalBackdrop").classList.add("hidden");
  });
  const btnCancelEdit = document.getElementById("btnCancelEditRequest");
  if (btnCancelEdit) btnCancelEdit.addEventListener("click", () => {
    document.getElementById("editRequestModalBackdrop").classList.add("hidden");
  });
}
