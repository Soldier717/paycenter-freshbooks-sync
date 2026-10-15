import "./globals.css";

export const metadata = { title: "Priority Pay Center Sync", description: "FreshBooks ↔ Priority Pay Center invoice and payment sync by Priority Business Solutions" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
