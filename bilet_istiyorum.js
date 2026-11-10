// =========================================================
// ZEREN SPOR KULÜBÜ — BİLET İSTİYORUM PORTAL İSTEMCİSİ (JS)
// Kulüp personeli bilet talep sistemi (Mor - Beyaz Tema)
// =========================================================

let portalMatches = [];
let portalStaff = [];
let selectedMatch = null;
let currentTab = "tab-request";

const FALLBACK_PHONEBOOK = {
  "Eşref Arıcan": "0533 233 43 45",
  "Ayşe Fidan": "0536 476 97 31",
  "Neslihan Erşahin": "0533 680 17 87",
  "Ömer Özdemir": "0533 527 86 96",
  "Tansu Ünal": "0534 291 26 72",
  "Aysu Balcı": "0542 433 90 57",
  "Çağlar Oskay": "0532 548 99 11",
  "Ahmet Salih Canbaz": "0546 464 06 12",
  "Seda Canlı": "+1 (609) 724-5092",
  "Burak Eser": "0554 646 59 58",
  "Kerem Taha Solmaz": "0507 634 78 75",
  "Mehmet Antep": "0538 356 24 40",
};

function normalizePersonName(str) {
  return String(str || "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalPhoneCache() {
  try {
    const raw = localStorage.getItem("zeren_portal_phone_cache");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveLocalPhoneCache(name, phone) {
  if (!name || !phone) return;
  try {
    const cache = getLocalPhoneCache();
    cache[normalizePersonName(name)] = String(phone).trim();
    localStorage.setItem("zeren_portal_phone_cache", JSON.stringify(cache));
  } catch (e) {}
}

function lookupPhoneForPerson(personName) {
  if (!personName) return "";
  const targetNorm = normalizePersonName(personName);
  if (!targetNorm) return "";

  // 1. Cihazdaki yerel önbellek
  const localCache = getLocalPhoneCache();
  if (localCache[targetNorm]) {
    return localCache[targetNorm];
  }

  // 2. Hatırlanan son kullanıcı ise
  const lastUser = localStorage.getItem("zeren_portal_last_user");
  const lastPhone = localStorage.getItem("zeren_portal_phone");
  if (lastUser && lastPhone && normalizePersonName(lastUser) === targetNorm) {
    return lastPhone;
  }

  // 3. API'den gelen telefon rehberi (portalStaff.phones)
  const apiPhones = (portalStaff && portalStaff.phones) || {};
  for (const [k, v] of Object.entries(apiPhones)) {
    if (normalizePersonName(k) === targetNorm && v) {
      return String(v).trim();
    }
  }

  // 4. İstemci gömülü yedek rehber (FALLBACK_PHONEBOOK)
  for (const [k, v] of Object.entries(FALLBACK_PHONEBOOK)) {
    if (normalizePersonName(k) === targetNorm && v) {
      return String(v).trim();
    }
  }

  // 5. Kısmi eşleşme (örn. 'tansu' veya 'esref' yazıldığında)
  if (targetNorm.length >= 3) {
    const merged = { ...FALLBACK_PHONEBOOK, ...apiPhones, ...localCache };
    for (const [k, v] of Object.entries(merged)) {
      const kNorm = normalizePersonName(k);
      if ((kNorm.startsWith(targetNorm) || targetNorm.startsWith(kNorm)) && v) {
        return String(v).trim();
      }
    }
  }

  return "";
}

function autoFillPhoneForPerson(personName, force = false) {
  const phoneInput = document.getElementById("inputPhoneNumber");
  const hintEl = document.getElementById("phoneAutoFillHint");
  if (!phoneInput) return;

  const foundPhone = lookupPhoneForPerson(personName);
  if (foundPhone) {
    if (force || !phoneInput.value.trim() || !phoneInput.dataset.userEdited) {
      phoneInput.value = foundPhone;
      phoneInput.dataset.userEdited = "";
      phoneInput.setCustomValidity("");
      if (hintEl) {
        hintEl.style.display = "inline-flex";
        hintEl.innerHTML = `<i class="ph-bold ph-check-circle" style="font-size:14px;"></i> <span>Rehberden otomatik dolduruldu: <strong>${escapeHtml(foundPhone)}</strong></span>`;
      }
    }
  } else {
    if (hintEl) {
      hintEl.style.display = "none";
    }
  }
}

function initApp() {
  setupNavigation();
  setupStepper();
  setupForm();
  loadInitialData();
  setupMyRequestsTracking();
  document.getElementById("inputPersonName")?.addEventListener("change", event => {
    autoFillPhoneForPerson(event.target.value.trim(), false);
  });
  setupPWA();
  const access = new URLSearchParams(location.hash.slice(1)).get("talep");
  if (access) { switchTab("tab-my-requests"); document.getElementById("inputTrackQuery").value = access; searchMyRequests(access); }

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// ---------------------------------------------------------
// 1. SEKME GEÇİŞLERİ (Bilet Talep Et <-> Salon Rehberi)
// ---------------------------------------------------------
function setupNavigation() {
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetTab = btn.getAttribute("data-tab");
      if (targetTab) {
        switchTab(targetTab);
      }
    });
  });

  // Modal Başarı Kapatma Butonu
  const btnClose = document.getElementById("btnCloseSuccessModal");
  if (btnClose) {
    btnClose.addEventListener("click", () => {
      document.getElementById("modalRequestSuccess").classList.add("hidden");
      resetForm();
    });
  }

  // Formdan Salon Rehberine Hızlı Geçiş Butonu
  const btnShortcut = document.getElementById("btnShortcutArenaGuide");
  if (btnShortcut) {
    btnShortcut.addEventListener("click", () => {
      switchTab("tab-arena-guide");
      showPortalToast("Başkent Voleybol Salonu resmi oturma planını inceleyebilirsiniz.");
    });
  }
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".portal-tab-content").forEach((sec) => {
    if (sec.id === tabId) {
      sec.classList.remove("hidden");
      sec.style.display = "flex";
    } else {
      sec.classList.add("hidden");
      sec.style.display = "none";
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------
// 2. VERİ YÜKLEME (MATCHES & STAFF)
// ---------------------------------------------------------
async function loadInitialData() {
  try {
    const [matchesRes, staffRes] = await Promise.all([
      fetch("/api/portal/matches"),
      fetch("/api/portal/staff"),
    ]);

    if (matchesRes.ok) {
      portalMatches = await matchesRes.json();
      renderMatchDropdown(portalMatches);
    }

    if (staffRes.ok) {
      portalStaff = await staffRes.json();
      renderStaffAccordion(portalStaff);
    } else {
      renderStaffAccordion(null);
    }

    // Hatırlanan personel varsa doldur
    const remembered = localStorage.getItem("zeren_portal_last_user");
    if (remembered) {
      selectStaffMember(remembered);
      autoFillPhoneForPerson(remembered, false);
    }
    const rememberedPhone = localStorage.getItem("zeren_portal_phone");
    if (rememberedPhone) {
      const phoneInput = document.getElementById("inputPhoneNumber");
      if (phoneInput && !phoneInput.value) {
        phoneInput.value = rememberedPhone;
      }
    }
  } catch (err) {
    showPortalToast("Veriler yüklenirken hata oluştu: " + err.message);
  }
}

// ---------------------------------------------------------
// 3. MAÇ SEÇİMİ (DROPDOWN MENÜ)
// ---------------------------------------------------------
function renderPreferredBlocks(match) {
  if (!Array.isArray(match?.blocks)) return;
  const select = document.getElementById("selectTargetBlock");
  const previous = select.value;
  select.replaceChildren();
  for (const id of match.blocks) {
    const option = new Option(id === "SAHA" ? "Saha İçi" : `${id} Blok`, id);
    select.add(option);
  }
  select.add(new Option("Fark etmez (Müsaitliğe göre)", ""));
  select.value = match.blocks.includes(previous) ? previous : "";
}

function renderMatchDropdown(matches) {
  const selectEl = document.getElementById("selectMatchDropdown");
  const hiddenInput = document.getElementById("selectedMatchName");
  const dateText = document.getElementById("matchDateText");
  if (!selectEl) return;

  selectEl.innerHTML = "";

  if (!matches || matches.length === 0) {
    const opt = document.createElement("option");
    opt.value = "Zeren Spor Kulübü - Kuzeyboru";
    opt.textContent = "Zeren Spor Kulübü - Kuzeyboru (08.11.2026 16:00)";
    selectEl.appendChild(opt);
    if (hiddenInput) hiddenInput.value = opt.value;
    return;
  }

  matches.forEach((m, idx) => {
    const opt = document.createElement("option");
    opt.value = m.title;
    const cleanTitle = m.title.replace(/\s*-\s*\d{3}\s+\d+\s*-\s*-?\d+$/, "");
    const dStr = m.date ? ` (${m.date})` : "";
    opt.textContent = `${cleanTitle}${dStr}`;
    if (idx === 0) {
      opt.selected = true;
      selectedMatch = m;
      renderPreferredBlocks(m);
      selectEl.title = m.title;
      if (hiddenInput) hiddenInput.value = m.title;
      if (dateText && m.date) dateText.textContent = m.date;
    }
    selectEl.appendChild(opt);
  });

  selectEl.addEventListener("change", (e) => {
    const val = e.target.value;
    if (hiddenInput) hiddenInput.value = val;
    const found = matches.find((m) => m.title === val);
    if (found) {
      selectedMatch = found;
      selectEl.title = found.title;
      renderPreferredBlocks(found);
      if (dateText && found.date) {
        dateText.textContent = found.date;
      }
    }
  });
}

// ---------------------------------------------------------
// 4. PERSONEL & SPORCU SEÇİMİ (AÇILIR-KAPANIR GRUPLAR)
// ---------------------------------------------------------
let currentStaffGroups = [];
let allGroupsExpanded = false;

const FALLBACK_STAFF_GROUPS = [
  {
    group: "İdari Personel",
    icon: "ph-briefcase",
    members: [
      "Utku Günçe",
      "Tansu Ünal",
      "Aysu Balcı",
      "Çağlar Oskay",
      "Neslihan Erşahin",
      "Ayşe Fidan",
      "Eşref Arıcan",
      "Ömer Özdemir",
    ],
  },
  {
    group: "Yönetim",
    icon: "ph-crown",
    members: [
      "Mustafa Yiğit Zeren",
      "Ahmet Salih Canbaz",
      "Manolya Melek Açıkgöz",
    ],
  },
  {
    group: "Teknik Ekip",
    icon: "ph-clipboard-text",
    members: [
      "Ahmetcan Erşimşek",
      "Berk Çanakcı",
      "Enes Boztürk",
      "Seda Canlı",
      "Vladan Šaraba",
      "Teoman Topçu",
      "Lazar Ilınčıć",
      "İbrahim Erten",
      "Burak Eser",
    ],
  },
  {
    group: "Altyapı",
    icon: "ph-plant",
    members: [
      "Kerem Taha Solmaz",
      "Beyza Karatepe",
    ],
  },
  {
    group: "Sporcu",
    icon: "ph-volleyball",
    members: [
      "Anna Dodson",
      "Dicle Nur Babat",
      "Sarah Franklin",
      "Merve Biçer",
      "Fatma Yıldırım",
      "Ekaterina Pipunyrova",
      "Anna Nicoletti",
      "Hilal Kocakara",
      "Seher Aksoy",
      "Adhuoljok Malul",
      "Aslıhan Kılıç",
      "Özlem Alkan",
      "Ceren Önal",
    ],
  },
  {
    group: "Diğer",
    icon: "ph-dots-three-circle",
    members: [
      "Mehmet Antep",
    ],
  },
];

function renderStaffAccordion(staffData) {
  const container = document.getElementById("staffAccordionList");
  if (!container) return;

  let groups = FALLBACK_STAFF_GROUPS;
  if (staffData && staffData.groups && Array.isArray(staffData.groups) && staffData.groups.length > 0) {
    groups = staffData.groups;
  }
  currentStaffGroups = groups;
  const suggestions = document.getElementById("staffSuggestions");
  if (suggestions) suggestions.replaceChildren(...groups.flatMap(g => g.members).map(name => {
    const option = document.createElement("option"); option.value = name; return option;
  }));

  container.innerHTML = "";

  groups.forEach((g, idx) => {
    const card = document.createElement("div");
    card.className = "staff-group-card";
    card.dataset.groupName = g.group;

    const iconClass = g.icon || "ph-users";

    card.innerHTML = `
      <div class="staff-group-header" data-group-index="${idx}">
        <div class="group-header-left">
          <div class="group-icon-chip">
            <i class="ph-bold ${iconClass}"></i>
          </div>
          <span class="group-name-text">${g.group}</span>
          <span class="group-badge-count">${g.members.length}</span>
        </div>
        <div class="group-header-right">
          <i class="ph-bold ph-caret-down group-chevron"></i>
        </div>
      </div>
      <div class="staff-group-body">
        <div class="staff-members-grid">
          ${g.members
            .map(
              (name) => `
            <button type="button" class="staff-member-btn" data-name="${name}" data-group="${g.group}">
              <i class="ph ph-user"></i>
              <span>${name}</span>
            </button>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    // Akordeon başlığına tıklayınca daralt / genişlet
    const header = card.querySelector(".staff-group-header");
    header.addEventListener("click", () => {
      card.classList.toggle("expanded");
      updateToggleAllButtonState();
    });

    // Kişi butonuna tıklayınca seç
    const memberBtns = card.querySelectorAll(".staff-member-btn");
    memberBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectStaffMember(btn.dataset.name, btn.dataset.group);
      });
    });

    container.appendChild(card);
  });

  // Arama filtresini kur
  setupStaffSearch();

  // Ad Soyad inputu elle yazılırsa eşleşeni işaretle
  const inputName = document.getElementById("inputPersonName");
  if (inputName) {
    inputName.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      const typed = val.toLowerCase();
      let matched = false;
      document.querySelectorAll(".staff-member-btn").forEach((btn) => {
        if (typed && btn.dataset.name.toLowerCase() === typed) {
          btn.classList.add("active");
          matched = true;
          const badge = document.getElementById("selectedPersonBadge");
          const badgeText = document.getElementById("selectedPersonText");
          if (badge && badgeText) {
            badgeText.textContent = `Seçilen: ${btn.dataset.name} (${btn.dataset.group})`;
            badge.classList.remove("hidden");
          }
        } else {
          btn.classList.remove("active");
        }
      });
      if (!matched) {
        const badge = document.getElementById("selectedPersonBadge");
        if (badge) badge.classList.add("hidden");
      }
      autoFillPhoneForPerson(val, false);
    });
  }

  // Seçimi temizleme butonu
  const btnClear = document.getElementById("btnClearSelectedPerson");
  if (btnClear) {
    btnClear.addEventListener("click", clearStaffSelection);
  }

  // Tümünü Aç / Kapat butonu
  const btnToggleAll = document.getElementById("btnToggleAllGroups");
  if (btnToggleAll) {
    btnToggleAll.addEventListener("click", () => {
      const cards = document.querySelectorAll(".staff-group-card");
      allGroupsExpanded = !allGroupsExpanded;
      cards.forEach((c) => {
        if (allGroupsExpanded) {
          c.classList.add("expanded");
        } else {
          c.classList.remove("expanded");
        }
      });
      updateToggleAllButtonState();
    });
  }
}

function selectStaffMember(name, groupName = "") {
  const inputName = document.getElementById("inputPersonName");
  if (inputName) {
    inputName.value = name;
  }

  // Buton vurgularını güncelle
  const allBtns = document.querySelectorAll(".staff-member-btn");
  let foundGroup = groupName;
  allBtns.forEach((btn) => {
    if (btn.dataset.name.toLowerCase() === name.toLowerCase()) {
      btn.classList.add("active");
      if (!foundGroup && btn.dataset.group) {
        foundGroup = btn.dataset.group;
      }
      // Bulunduğu grubu genişlet
      const card = btn.closest(".staff-group-card");
      if (card) card.classList.add("expanded");
    } else {
      btn.classList.remove("active");
    }
  });

  // Seçim rozeti
  const badge = document.getElementById("selectedPersonBadge");
  const badgeText = document.getElementById("selectedPersonText");
  if (badge && badgeText) {
    if (name) {
      badgeText.textContent = foundGroup ? `Seçilen: ${name} (${foundGroup})` : `Seçilen: ${name}`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // Arka plandaki dropdown'ı senkronize et
  const staffSelect = document.getElementById("selectStaffDropdown");
  if (staffSelect) {
    staffSelect.value = name || "";
  }

  if (name) {
    autoFillPhoneForPerson(name, true);
    try {
      localStorage.setItem("zeren_portal_last_user", name);
    } catch (e) {}
  }
}

function clearStaffSelection() {
  const inputName = document.getElementById("inputPersonName");
  if (inputName) {
    inputName.value = "";
    inputName.focus();
  }
  const phoneInput = document.getElementById("inputPhoneNumber");
  if (phoneInput && !phoneInput.dataset.userEdited) {
    phoneInput.value = "";
  }
  const hintEl = document.getElementById("phoneAutoFillHint");
  if (hintEl) hintEl.style.display = "none";
  document.querySelectorAll(".staff-member-btn").forEach((btn) => btn.classList.remove("active"));
  const badge = document.getElementById("selectedPersonBadge");
  if (badge) badge.classList.add("hidden");
  const staffSelect = document.getElementById("selectStaffDropdown");
  if (staffSelect) staffSelect.value = "";
  try {
    localStorage.removeItem("zeren_portal_last_user");
  } catch (e) {}
}

function setupStaffSearch() {
  const searchInput = document.getElementById("inputStaffSearch");
  const btnClearSearch = document.getElementById("btnClearStaffSearch");
  if (!searchInput) return;

  function normTr(str) {
    return (str || "")
      .toLocaleLowerCase("tr")
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .trim();
  }

  searchInput.addEventListener("input", (e) => {
    const q = normTr(e.target.value);
    const cards = document.querySelectorAll(".staff-group-card");

    if (btnClearSearch) {
      if (q) btnClearSearch.classList.remove("hidden");
      else btnClearSearch.classList.add("hidden");
    }

    if (!q) {
      // Aramayı sıfırla
      cards.forEach((c) => {
        c.classList.remove("hidden-filter");
        c.querySelectorAll(".staff-member-btn").forEach((btn) => btn.classList.remove("hidden-filter"));
      });
      updateToggleAllButtonState();
      return;
    }

    // Arama filtreleme
    cards.forEach((card) => {
      let visibleCount = 0;
      const groupNameNorm = normTr(card.dataset.groupName);
      const isGroupMatch = groupNameNorm.includes(q);

      const btns = card.querySelectorAll(".staff-member-btn");
      btns.forEach((btn) => {
        const nameNorm = normTr(btn.dataset.name);
        if (isGroupMatch || nameNorm.includes(q)) {
          btn.classList.remove("hidden-filter");
          visibleCount++;
        } else {
          btn.classList.add("hidden-filter");
        }
      });

      if (visibleCount > 0) {
        card.classList.remove("hidden-filter");
        card.classList.add("expanded"); // Eşleşen grubu otomatik aç
      } else {
        card.classList.add("hidden-filter");
      }
    });

    updateToggleAllButtonState();
  });

  if (btnClearSearch) {
    btnClearSearch.addEventListener("click", () => {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }
}

function updateToggleAllButtonState() {
  const cards = document.querySelectorAll(".staff-group-card:not(.hidden-filter)");
  const expandedCards = document.querySelectorAll(".staff-group-card.expanded:not(.hidden-filter)");
  const textEl = document.getElementById("textToggleAll");
  const iconEl = document.getElementById("iconToggleAll");

  if (cards.length > 0 && expandedCards.length === cards.length) {
    allGroupsExpanded = true;
    if (textEl) textEl.textContent = "Tümünü Kapat";
    if (iconEl) iconEl.className = "ph-bold ph-arrows-in-line-vertical";
  } else {
    allGroupsExpanded = false;
    if (textEl) textEl.textContent = "Tümünü Aç";
    if (iconEl) iconEl.className = "ph-bold ph-arrows-out-line-vertical";
  }
}

// ---------------------------------------------------------
// 5. BİLET ADEDİ STEPPER KONTROLLERİ
// ---------------------------------------------------------
function setupStepper() {
  const countInput = document.getElementById("inputTicketCount");
  const btnMinus = document.getElementById("btnCountMinus");
  const btnPlus = document.getElementById("btnCountPlus");
  const chips = document.querySelectorAll(".cnt-chip");
  if (!countInput) return;

  function updateCountChips() {
    const val = Number(countInput.value);
    chips.forEach((c) => {
      c.classList.toggle("active", parseInt(c.dataset.cnt, 10) === val);
    });
  }

  function setCount(n) {
    const val = Math.max(1, Math.min(100, parseInt(n, 10) || 1));
    countInput.value = val;
    updateCountChips();
  }

  if (btnMinus) {
    btnMinus.addEventListener("click", () => {
      setCount(parseInt(countInput.value, 10) - 1);
    });
  }

  if (btnPlus) {
    btnPlus.addEventListener("click", () => {
      setCount(parseInt(countInput.value, 10) + 1);
    });
  }

  // Allow clearing and typing multiple digits without rewriting the input.
  countInput.addEventListener("input", updateCountChips);
  countInput.addEventListener("blur", () => {
    setCount(countInput.value);
  });

  chips.forEach((c) => {
    c.addEventListener("click", () => {
      setCount(c.dataset.cnt);
    });
  });
}

// ---------------------------------------------------------
// 6. TALEP GÖNDERME İŞLEMİ
// ---------------------------------------------------------
function setupForm() {
  const form = document.getElementById("formTicketRequest");
  if (!form) return;

  const phoneInput = document.getElementById("inputPhoneNumber");
  if (phoneInput) {
    phoneInput.required = true;
    phoneInput.addEventListener("input", () => {
      phoneInput.dataset.userEdited = "true";
      phoneInput.setCustomValidity("");
      const hintEl = document.getElementById("phoneAutoFillHint");
      if (hintEl) hintEl.style.display = "none";
      const currentName = document.getElementById("inputPersonName")?.value.trim();
      if (currentName && phoneInput.value.replace(/\D/g, "").length >= 10) {
        saveLocalPhoneCache(currentName, phoneInput.value.trim());
      }
    });
    phoneInput.addEventListener("blur", () => {
      const digits = phoneInput.value.replace(/\D/g, "");
      phoneInput.setCustomValidity(digits.length >= 10 && digits.length <= 15 ? "" : "Geçerli WhatsApp numarası giriniz.");
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const selectMatch = document.getElementById("selectMatchDropdown");
    const matchName =
      (selectMatch ? selectMatch.value : "") ||
      document.getElementById("selectedMatchName").value.trim() ||
      "Zeren Spor Kulübü - Kuzeyboru";

    const person = document.getElementById("inputPersonName").value.trim();
    const phone = document.getElementById("inputPhoneNumber") ? document.getElementById("inputPhoneNumber").value.trim() : "";
    const count = parseInt(document.getElementById("inputTicketCount").value, 10) || 1;
    const targetBlock = document.getElementById("selectTargetBlock").value;
    const description = document.getElementById("inputDescription").value.trim();

    if (!person) {
      showPortalToast("Lütfen Ad Soyad alanını doldurun veya personeli listeden seçin.");
      document.getElementById("inputPersonName").focus();
      return;
    }

    const payload = {
      match_name: matchName,
      person: person,
      phone: phone,
      requested_count: count,
      target_block: targetBlock,
      description: description,
    };

    if (!form.reportValidity()) return;
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)), b => b.toString(16).padStart(2, "0")).join("");
    let operation;
    try { operation = JSON.parse(sessionStorage.getItem("zeren_pending_request") || "null"); } catch {}
    if (!operation || operation.digest !== digest) operation = { digest, key: crypto.randomUUID() + crypto.randomUUID() };
    sessionStorage.setItem("zeren_pending_request", JSON.stringify(operation));
    const submitBtn = document.getElementById("btnSubmitRequest");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="ph ph-spinner spin"></i> <span>Talebiniz İletiliyor...</span>`;

    try {
      const res = await fetch("/api/portal/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Talep kaydedilemedi");
      }

      const created = await res.json();
      sessionStorage.removeItem("zeren_pending_request");
      if (created.tracking_token) localStorage.setItem("zeren_tracking_" + created.id, created.tracking_token);

      // İsmi ve telefonu yerel hafızaya kaydet
      localStorage.setItem("zeren_portal_last_user", person);
      if (phone) {
        localStorage.setItem("zeren_portal_phone", phone);
        saveLocalPhoneCache(person, phone);
      }

      // Başarı modalını göster
      showSuccessModal(created);
      showPortalToast(`Bilet talebiniz başarıyla iletildi: ${created.id}`);
    } catch (err) {
      showPortalToast(`Hata: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="ph-bold ph-paper-plane-tilt"></i> <span>Bilet Talebimi Gönder</span>`;
    }
  });
}

let lastCreatedRequest = null;

function showSuccessModal(req) {
  lastCreatedRequest = req;
  const trackingLink = location.origin + "/#talep=" + encodeURIComponent(req.tracking_token);
  const trackingField = document.getElementById("receiptTrackingLink");
  if (trackingField) trackingField.value = trackingLink;
  const rCode = document.getElementById("receiptCode");
  const rMatch = document.getElementById("receiptMatch");
  const rPerson = document.getElementById("receiptPerson");
  const rCount = document.getElementById("receiptCountBlock");

  if (rCode) rCode.textContent = req.id;
  if (rMatch) rMatch.textContent = req.match_name;
  if (rPerson) rPerson.textContent = req.person;
  if (rCount) rCount.textContent = `${req.requested_count} Adet · Blok ${req.target_block || "121"}`;

  const modal = document.getElementById("modalRequestSuccess");
  if (modal) modal.classList.remove("hidden");

  // Kodu Kopyala Butonu
  const btnCopy = document.getElementById("btnCopyReceiptCode");
  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(trackingLink).then(() => {
        showPortalToast(`📋 Güvenli takip bağlantısı panoya kopyalandı.`);
      }).catch(() => {
        trackingField?.focus(); trackingField?.select(); showPortalToast("Bağlantı seçildi; cihazınızın kopyalama komutunu kullanınız.");
      });
    };
  }

  // Talebimi Takip Et Butonu
  const btnTrack = document.getElementById("btnTrackMyRequest");
  if (btnTrack) {
    btnTrack.onclick = () => {
      if (modal) modal.classList.add("hidden");
      resetForm();
      switchTab("tab-my-requests");
      const trackInput = document.getElementById("inputTrackQuery");
      if (trackInput) {
        trackInput.value = req.tracking_token;
        trackInput.focus();
        searchMyRequests(req.tracking_token);
      }
    };
  }
}

function resetForm() {
  const desc = document.getElementById("inputDescription");
  if (desc) desc.value = "";
  const count = document.getElementById("inputTicketCount");
  if (count) count.value = "2";
  document.querySelectorAll(".cnt-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.cnt === "2");
  });
}

// ---------------------------------------------------------
// 7. TOAST BİLDİRİMİ (Mor - Beyaz Tema)
// ---------------------------------------------------------
function showPortalToast(msg) {
  let toast = document.getElementById("portalToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "portalToast";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #4a044e;
      color: #ffffff;
      padding: 13px 22px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 600;
      box-shadow: 0 10px 25px -5px rgba(88, 28, 135, 0.4);
      border: 1px solid #a21caf;
      z-index: 9999;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="ph-bold ph-volleyball" style="color:#f0abfc; font-size:18px;"></i> <span>${escapeHtml(msg)}</span>`;
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  clearTimeout(window._portalToastTimer);
  window._portalToastTimer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
  }, 3500);
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


// ---------------------------------------------------------
// PWA (PROGRESSIVE WEB APP) DESTEĞİ VE YÜKLEME YÖNETİMİ
// ---------------------------------------------------------
let deferredPrompt = null;

function setupPWA() {
  // Worker registration and update checks are shared in pwa-update.js.

  // 2. Zaten PWA standalone modunda çalışıyorsa banner gösterme
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) {
    return;
  }

  // 3. Banner kapatılmış mı kontrol et (24 saatlik sessizlik)
  const dismissedAt = localStorage.getItem("zeren_pwa_dismissed");
  if (dismissedAt && Date.now() - Number(dismissedAt) < 24 * 60 * 60 * 1000) {
    return;
  }

  const banner = document.getElementById("pwaInstallBanner");
  const btnInstall = document.getElementById("btnPwaInstall");
  const btnDismiss = document.getElementById("btnPwaDismiss");

  // Android / Chrome / Edge install prompt yakalama
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (banner) banner.classList.remove("hidden");
  });

  if (btnInstall) {
    btnInstall.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          showPortalToast("🎉 Bilet Portalı ana ekranınıza ekleniyor!");
        }
        deferredPrompt = null;
        if (banner) banner.classList.add("hidden");
      } else {
        showPortalToast("📲 Safari'de Paylaş (⎋) butonuna basıp 'Ana Ekrana Ekle'yi seçiniz.");
      }
    });
  }

  if (btnDismiss) {
    btnDismiss.addEventListener("click", () => {
      if (banner) banner.classList.add("hidden");
      localStorage.setItem("zeren_pwa_dismissed", String(Date.now()));
    });
  }

  // iOS Safari tespiti
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  if (isIos && !isStandalone) {
    setTimeout(() => {
      if (banner && !deferredPrompt && !localStorage.getItem("zeren_pwa_dismissed")) {
        const textSpan = banner.querySelector(".pwa-banner-texts span");
        if (textSpan) textSpan.textContent = "Paylaş butonuna basıp 'Ana Ekrana Ekle'yi seçin";
        banner.classList.remove("hidden");
      }
    }, 2500);
  }
}


// ---------------------------------------------------------
// 8. TALEPLERİMİ TAKİP ET SORGULAMA FONKSİYONLARI (U10)
// ---------------------------------------------------------
function setupMyRequestsTracking() {
  const btnSearch = document.getElementById("btnSearchMyRequests");
  const inputQuery = document.getElementById("inputTrackQuery");

  if (btnSearch && inputQuery) {
    btnSearch.addEventListener("click", () => {
      const q = inputQuery.value.trim();
      if (!q || q.length < 4) {
        showPortalToast("Talebinizin güvenli takip bağlantısını giriniz.");
        return;
      }
      searchMyRequests(q);
    });

    inputQuery.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnSearch.click();
      }
    });
  }
}

async function searchMyRequests(query) {
  const container = document.getElementById("trackResultsContainer");
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 25px; color: #7e22ce;">
      <i class="ph ph-spinner spin" style="font-size: 28px; display: block; margin-bottom: 8px;"></i>
      Talepleriniz sorgulanıyor...
    </div>
  `;

  try {
    let access = String(query).trim();
    if (access.startsWith("http")) access = new URLSearchParams(new URL(access).hash.slice(1)).get("talep") || "";
    if (!access.includes(".")) access = localStorage.getItem("zeren_tracking_" + access) || "";
    if (!access) throw new Error("Güvenli takip bağlantısı gerekli. Eski talebiniz için kulüp yönetiminden bağlantı isteyiniz.");
    const res = await fetch("/api/portal/my-requests", { headers: { "X-Tracking-Token": access } });
    if (!res.ok) {
      const error = await res.json(); throw new Error(error.detail || "Sorgu gerçekleştirilemedi");
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      container.innerHTML = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; text-align: center; color: #991b1b;">
          <i class="ph-bold ph-warning-circle" style="font-size: 28px; display: block; margin-bottom: 6px;"></i>
          <strong>Eşleşen talep bulunamadı</strong>
          <p style="font-size: 13px; margin-top: 4px; color: #b91c1c;">"${escapeHtml(query)}" için sistemde kayıtlı aktif bir bilet talebi bulunamadı. Lütfen takip kodunuzu kontrol ediniz.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    data.forEach((r) => {
      const isComp = r.fulfillment_status === "completed";
      const isPart = r.fulfillment_status === "partial";
      const statusTitle = isComp
        ? "Koltuklar Ayrıldı ✅"
        : isPart
        ? `Kısmen Ayrıldı (${r.assigned_count}/${r.requested_count}) ⚠️`
        : "Talep Beklemede ⏳";
      const statusColor = isComp ? "#059669" : isPart ? "#d97706" : "#2563eb";
      const statusBg = isComp ? "#ecfdf5" : isPart ? "#fffbeb" : "#eff6ff";

      const card = document.createElement("div");
      card.style.cssText = `
        background: #ffffff;
        border: 1.5px solid #e9d5ff;
        border-radius: 12px;
        padding: 16px 18px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: var(--font-mono); font-weight: 800; color: #7e22ce; font-size: 14px; background: #f3e8ff; padding: 3px 8px; border-radius: 6px;">${escapeHtml(r.id)}</span>
              <strong style="color: #1e1b4b; font-size: 15px;">${escapeHtml(r.person)}</strong>
            </div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">${escapeHtml(r.match_name)}</div>
          </div>
          <span style="background: ${statusBg}; color: ${statusColor}; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 20px; white-space: nowrap;">
            ${statusTitle}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; background: #faf5ff; padding: 12px; border-radius: 8px; font-size: 12.5px;">
          <div>
            <span style="color: #6b7280; display: block;">Talep Adedi:</span>
            <strong style="color: #1e1b4b;">${r.requested_count} Adet</strong>
          </div>
          <div>
            <span style="color: #6b7280; display: block;">Ayrılan Koltuk:</span>
            <strong style="color: ${r.assigned_count > 0 ? '#059669' : '#6b7280'};">${r.assigned_count} Adet</strong>
          </div>
          <div>
            <span style="color: #6b7280; display: block;">Tercih Edilen Blok:</span>
            <strong style="color: #1e1b4b;">${escapeHtml(r.target_block || "121")}</strong>
          </div>
          <div>
            <span style="color: #6b7280; display: block;">WhatsApp Durumu:</span>
            <strong style="color: ${r.whatsapp_sent ? '#059669' : '#6b7280'};">${r.whatsapp_sent ? 'Gönderildi 📬' : 'İletilmedi'}</strong>
          </div>
        </div>

        ${r.assigned_seats && r.assigned_seats.length > 0 ? `
          <div style="margin-top: 10px; font-size: 12px; color: #4b5563;">
            <span style="font-weight: 600; color: #7e22ce;">Tahsis Edilen Koltuklar:</span>
            ${r.assigned_seats.map(s => `<span style="display:inline-block; background:#ede9fe; color:#581c87; font-weight:700; font-size:11px; padding:2px 7px; border-radius:4px; margin-left:4px;">${s}</span>`).join('')}
          </div>
        ` : ''}
      `;

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; text-align: center; color: #dc2626; font-size: 13px;">
        Sorgulama hatası: ${escapeHtml(err.message)}
      </div>
    `;
  }
}
