// Runs before paint so the saved theme and text sizes apply without a flash.
const root = document.documentElement;
try {
  const t = localStorage.getItem("theme");
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "dark" : "light";
  const text = localStorage.getItem("textSize");
  const chatText = localStorage.getItem("chatTextSize");
  const palette = localStorage.getItem("palette");
  if (palette) root.dataset.palette = palette;
  if (text) root.dataset.text = text;
  if (chatText) root.dataset.chatText = chatText;
} catch {
  root.dataset.theme = "light";
}
