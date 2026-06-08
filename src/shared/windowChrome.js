export const TITLEBAR_HEIGHT = 40;

export const WINDOW_CHROME = {
  light: {
    backgroundColor: "#f3f3f3",
    titleBarOverlay: {
      color: "#f3f3f3",
      symbolColor: "#141414",
      height: TITLEBAR_HEIGHT,
    },
  },
  dark: {
    backgroundColor: "#141414",
    titleBarOverlay: {
      color: "#141414",
      symbolColor: "#e4e4e4",
      height: TITLEBAR_HEIGHT,
    },
  },
};

export function resolveWindowChrome(colorScheme) {
  return colorScheme === "dark" ? WINDOW_CHROME.dark : WINDOW_CHROME.light;
}
