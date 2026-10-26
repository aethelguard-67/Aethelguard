"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

type Theme = "light" | "dark"
const THEME_STORAGE_KEY = "aethelguard-theme"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark")

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.classList.toggle("dark", savedTheme === "dark")
      setTheme(savedTheme)
      return
    }
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light")
  }, [])

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark"
    document.documentElement.classList.toggle("dark", nextTheme === "dark")
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    setTheme(nextTheme)
  }

  const isDark = theme === "dark"
  const Icon = isDark ? Sun : Moon

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="gap-2 border-border bg-transparent text-foreground hover:bg-secondary"
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{isDark ? "Light mode" : "Dark mode"}</span>
    </Button>
  )
}
