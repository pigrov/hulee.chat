import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "App",
  description: "Tenant communication workspace"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
