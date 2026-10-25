import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

// Geist (SIL OFL), autoalojada: el paquete trae los archivos y next/font los sirve desde la app.

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Mide, planea y produce el contenido de tu marca personal.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`h-full ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
