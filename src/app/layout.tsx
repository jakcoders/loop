import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loop — Team Messenger",
  description:
    "Loop is one product with one backend. Sign in, join a workspace, and message your team in real time.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-512.png", apple: "/icons/icon-512.png" },
};

export const viewport = {
  themeColor: "#0B0D12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0B0D12] text-[#F5F7FA] antialiased">{children}</body>
    </html>
  );
}
