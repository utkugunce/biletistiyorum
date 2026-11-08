// Shared keyboard, focus and dialog semantics for both portal and admin.
(() => {
  function start() {
    let current = null, previousFocus = null, scheduled = false;
    const inertBefore = new Map();
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    function restoreInert() { for (const [element, value] of inertBefore) element.inert = value; inertBefore.clear(); }
    function sync() {
      scheduled = false;
      document.querySelectorAll('[role="tablist"]').forEach(list => {
        const tabs = [...list.querySelectorAll('button')].filter(visible);
        for (const tab of tabs) {
          tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
          if (!tab.dataset.keyboardTab) {
            tab.dataset.keyboardTab = 'true';
            tab.addEventListener('keydown', event => {
              if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const options = [...list.querySelectorAll('button')].filter(visible), index = options.indexOf(tab);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
              options[next]?.focus(); options[next]?.click();
            });
          }
        }
      });
      const candidates = [...document.querySelectorAll('.modal-backdrop, .portal-modal-backdrop, #adminLoginOverlay, .sidebar-column.mobile-open')];
      const active = candidates.filter(visible).at(-1) || null;
      for (const element of candidates) element.setAttribute('aria-hidden', String(!visible(element)));
      if (active === current) return;
      restoreInert();
      if (!active) { current = null; previousFocus?.focus(); return; }
      if (!current) previousFocus = document.activeElement;
      current = active;
      const dialog = active.querySelector('.modal-dialog, .portal-modal-card, .login-card') || active;
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1;
      const heading = dialog.querySelector('h2, h3');
      if (heading) { heading.id ||= 'dialog-title-' + Math.random().toString(36).slice(2); dialog.setAttribute('aria-labelledby', heading.id); }
      let node = active;
      while (node.parentElement) {
        for (const sibling of node.parentElement.children) if (sibling !== node && !inertBefore.has(sibling)) {
          inertBefore.set(sibling, sibling.inert); sibling.inert = true;
        }
        if (node.parentElement === document.body) break;
        node = node.parentElement;
      }
      const input = [...dialog.querySelectorAll('input, select, button, [tabindex="0"]')].find(visible);
      (input || dialog).focus();
    }
    document.addEventListener('keydown', event => {
      if (!current) return;
      if (event.key === 'Escape' && current.id !== 'adminLoginOverlay') {
        current.querySelector('button[id^="btnClose"], #btnCloseSidebarMobile')?.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...current.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex="0"]')].filter(visible);
      if (!controls.length) { event.preventDefault(); current.focus(); return; }
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
    });
    new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    document.querySelectorAll('#toastContainer, #portalToastContainer, #loginErrorMsg, #changePwdErrorMsg').forEach(element => {
      element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite');
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
