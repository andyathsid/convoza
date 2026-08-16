import localFont from "next/font/local";

export const inter = localFont({
  src: [
    {
      path: "./Inter/Inter-VariableFont_opsz,wght.ttf",
      style: "normal",
    },
    {
      path: "./Inter/Inter-Italic-VariableFont_opsz,wght.ttf",
      style: "italic",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  adjustFontFallback: false,
});
