import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Four-Faith Cloud Manager",
  description: "Industrial Gateway Device Cloud Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
