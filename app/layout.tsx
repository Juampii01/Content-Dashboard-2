import type { Metadata } from "next";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Mide, planea y produce el contenido de tu marca personal.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full">
      <head>
        {/* Las dos variantes latinas se usan en todas las pantallas: se precargan para evitar el salto de fuente. */}
        <link rel="preload" href="/fonts/f07.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/f48.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
