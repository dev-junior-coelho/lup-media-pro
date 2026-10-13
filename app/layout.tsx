import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LUP Media Pro • Gestão de Instagram",
  description:
    "Planeje, organize e publique conteúdo com a integração oficial do Instagram.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
