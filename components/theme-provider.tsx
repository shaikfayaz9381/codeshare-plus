"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import * as React from "react";

/**
 * Theme provider (dark by default).
 *
 * The application ships dark-first: `defaultTheme="dark"` with
 * `enableSystem` off keeps rendering deterministic for screenshots and tests,
 * while the toggle still allows switching to light.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
