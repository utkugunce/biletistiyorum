// =========================================================
// ZEREN SPOR KULÜBÜ — BİLET İSTİYORUM PORTAL İSTEMCİSİ (JS)
// Kulüp personeli bilet talep sistemi (Mor - Beyaz Tema)
// =========================================================

let portalMatches = [];
let portalStaff = [];
let selectedMatch = null;
let currentTab = "tab-request";

function initApp() {
  setupNavigation();
  setupStepper();
  setupForm();
  loadInitialData();
  setupPWA();
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
      const typed = e.target.value.trim().toLowerCase();
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

  function setCount(n) {
    let val = Math.max(1, Math.min(100, parseInt(n, 10) || 1));
    countInput.value = val;
    chips.forEach((c) => {
      c.classList.toggle("active", parseInt(c.dataset.cnt, 10) === val);
    });
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

  countInput.addEventListener("input", (e) => {
    setCount(e.target.value);
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

    const submitBtn = document.getElementById("btnSubmitRequest");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="ph ph-spinner spin"></i> <span>Talebiniz İletiliyor...</span>`;

    try {
      const res = await fetch("/api/portal/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Talep kaydedilemedi");
      }

      const created = await res.json();

      // İsmi ve telefonu yerel hafızaya kaydet
      localStorage.setItem("zeren_portal_last_user", person);
      if (phone) {
        localStorage.setItem("zeren_portal_phone", phone);
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

function showSuccessModal(req) {
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
  // 1. Service Worker Kaydı
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => console.log("PWA ServiceWorker devrede:", reg.scope))
        .catch((err) => console.log("PWA ServiceWorker kayıt hatası:", err));
    });
  }

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
