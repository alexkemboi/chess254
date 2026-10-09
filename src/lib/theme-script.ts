export const THEME_STORAGE_KEY = "chess254-theme";

/**
 * Inline script for <head>: applies the saved theme before first paint so there
 * is no flash of the wrong theme. Light is the default (matches chess254.vercel.app). Storage access is
 * wrapped because it can throw in private windows or with blocked site data.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"){var d=document.documentElement;d.classList.remove("light");d.classList.add("dark");}}catch(e){}})();`;
