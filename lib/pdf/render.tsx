import { Font, pdf } from "@react-pdf/renderer";
import { BASE_PATH } from "@/lib/basePath";
import type { Payslip } from "@/lib/payroll";
import { PayslipDocument } from "./PayslipDocument";

let fontsRegistered = false;

function ensureFonts() {
  if (fontsRegistered) return;
  // 기기에 설치된 폰트가 아닌, 서버의 같은 폰트 파일을 PDF에 내장 → PC·모바일 결과 동일
  const base = `${window.location.origin}${BASE_PATH}/fonts`;
  Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: `${base}/NotoSansKR-Regular.woff`, fontWeight: 400 },
      { src: `${base}/NotoSansKR-Bold.woff`, fontWeight: 700 },
    ],
  });
  // 한글 단어가 하이픈으로 쪼개지지 않도록
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export async function renderPayslipPdf(slip: Payslip): Promise<Blob> {
  ensureFonts();
  return pdf(<PayslipDocument slip={slip} />).toBlob();
}
