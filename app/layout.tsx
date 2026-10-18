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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
