// Installing the site as an app. Chrome, Edge and Android offer a prompt we
// can trigger from a button; Safari on iPhone and iPad only installs from
// its Share menu, so there we explain the steps instead.
let deferred = null;
const listeners = new Set();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // keep it for our own button
  deferred = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((fn) => fn()); });

export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// "installed" | "ready" (a button works) | "ios" (use the Share menu) | "manual" (use the browser menu)
export function installState() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "installed";
  if (deferred) return "ready";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "manual";
}

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn());
  return outcome === "accepted";
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Offline support is unavailable:", err.message));
}
