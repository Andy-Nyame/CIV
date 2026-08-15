import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "CIV",
  title: {
    default: "CIV — Create. Issue. Verify.",
    template: "%s | CIV",
  },
  description:
    "CIV helps individuals, businesses and organizations create, issue, store and manage professional business documents from one secure workspace.",
  creator: "CIV",
  keywords: ["CIV", "business documents", "invoices", "receipts", "quotations", "business workspace"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-page font-sans text-text">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
