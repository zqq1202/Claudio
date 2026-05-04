import { useState, useEffect, useCallback } from "react";
import { resetColors } from "../utils/colorExtractor";

type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("claudio-theme");
    if (stored === "light" || stored === "dark") return stored;
    return "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("claudio-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    resetColors(); // clear dynamic color overrides so theme CSS takes effect
    document.documentElement.classList.add("theme-transitioning");
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      // Apply theme immediately so CSS variables take effect this frame
      document.documentElement.dataset.theme = next;
      localStorage.setItem("claudio-theme", next);
      return next;
    });
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 500);
  }, []);

  return { theme, toggleTheme, isDark: theme === "dark" };
}
