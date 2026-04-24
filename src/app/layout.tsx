import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mycelium — Field Journal",
  description: "Personal second brain — capture daily learnings.",
  applicationName: "Mycelium",
  appleWebApp: {
    capable: true,
    title: "Mycelium",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f3ede1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body data-threads="on" data-grain="on" data-accent="rust">
        {children}
      </body>
    </html>
  );
}
