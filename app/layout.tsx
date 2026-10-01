import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "임금명세서 발급",
  description: "근무자별 임금명세서를 계산하고 PDF로 내보냅니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
