import { Font, pdf } from "@react-pdf/renderer";
import { BASE_PATH } from "@/lib/basePath";
import type { Payslip } from "@/lib/payroll";
import { inCommonFont } from "./fontCoverage";
import { PayslipDocument } from "./PayslipDocument";

const COMMON = "NotoSansKR";
const FULL = "NotoSansKR-Full";

let fontsRegistered = false;

function ensureFonts() {
  if (fontsRegistered) return;
  // 기기에 설치된 폰트가 아닌, 서버의 같은 폰트 파일을 PDF에 내장 → PC·모바일 결과 동일
  const base = `${window.location.origin}${BASE_PATH}/fonts`;
  // 자주 쓰는 한글 2,350자만 담은 작은 폰트(약 250KB). 실제로 쓰일 때만 내려받는다.
  Font.register({
    family: COMMON,
    fonts: [
      { src: `${base}/NotoSansKR-Common-Regular.woff`, fontWeight: 400 },
      { src: `${base}/NotoSansKR-Common-Bold.woff`, fontWeight: 700 },
    ],
  });
  // 한글 11,172자 전체(약 900KB) — 이름에 희귀 한글이 있을 때만 사용
  Font.register({
    family: FULL,
    fonts: [
      { src: `${base}/NotoSansKR-Full-Regular.woff`, fontWeight: 400 },
      { src: `${base}/NotoSansKR-Full-Bold.woff`, fontWeight: 700 },
    ],
  });
  // 한글 단어가 하이픈으로 쪼개지지 않도록
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export async function renderPayslipPdf(slip: Payslip): Promise<Blob> {
  ensureFonts();
  // 폰트 선택은 글자만으로 결정되므로 어느 기기에서나 같은 PDF가 나온다
  const fontFamily = inCommonFont(slip.name + slip.payDate) ? COMMON : FULL;
  return pdf(<PayslipDocument slip={slip} fontFamily={fontFamily} />).toBlob();
}
