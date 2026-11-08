// Check the installed worker on both the admin and staff pages. An update
// takes effect on the next navigation; never discard an in-progress form.
(() => {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  let registration;
  const check = () => registration?.update().catch(() => {});
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await registration.update();
    } catch { /* The page remains usable when worker installation is unavailable. */ }
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();
