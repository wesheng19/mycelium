import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mycelium",
  description: "Personal second brain — capture daily learnings.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          margin: 0,
          background: "#fafafa",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
