// Runs before paint so the saved theme and text sizes apply without a flash.
const root = document.documentElement;
try {
  const t = localStorage.getItem("theme");
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "dark" : "light";
  const text = localStorage.getItem("textSize");
  const chatText = localStorage.getItem("chatTextSize");
  // Moon Cell is the default; Paper is saved only when chosen.
  const palette = localStorage.getItem("palette") ?? "moon";
  if (palette !== "paper") root.dataset.palette = palette;
  if (text) root.dataset.text = text;
  if (chatText) root.dataset.chatText = chatText;
  const chatFont = localStorage.getItem("chatFont");
  if (chatFont) root.dataset.chatFont = chatFont;
  const chatActions = localStorage.getItem("chatActions");
  if (chatActions) root.dataset.chatActions = chatActions;
  const chatPic = localStorage.getItem("chatPic");
  if (chatPic) root.dataset.chatPic = chatPic;
} catch {
  root.dataset.theme = "light";
  root.dataset.palette = "moon";
}
