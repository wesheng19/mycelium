import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mycelium — Field Journal",
  description: "Personal second brain — capture daily learnings.",
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
