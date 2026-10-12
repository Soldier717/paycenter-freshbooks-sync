export const metadata = { title: "Pay Center / FreshBooks sync" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "3rem auto", maxWidth: 560, padding: "0 16px" }}>
        {children}
      </body>
    </html>
  );
}
