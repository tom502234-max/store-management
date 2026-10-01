import type { Payslip } from "@/lib/payroll";

// 같은 내용의 명세서는 한 번만 만들고 재사용한다.
// 미리 만들어 두면 다운로드·공유 버튼을 누른 즉시(사용자 동작 안에서) 파일을 넘길 수 있어
// 모바일 브라우저에서 다운로드/공유가 막히지 않는다.
const pending = new Map<string, Promise<Blob>>();
const ready = new Map<string, Blob>();

// 렌더링은 한 번에 하나씩 (폰트 중복 로딩 방지, 모바일 CPU 부담 완화)
let queue: Promise<unknown> = Promise.resolve();

export const slipKey = (slip: Payslip) => JSON.stringify(slip);

export function getPdf(slip: Payslip): Promise<Blob> {
  const key = slipKey(slip);
  let p = pending.get(key);
  if (!p) {
    p = queue.then(async () => {
      const { renderPayslipPdf } = await import("./render");
      const blob = await renderPayslipPdf(slip);
      ready.set(key, blob);
      return blob;
    });
    queue = p.catch(() => undefined);
    p.catch(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

export function peekPdf(slip: Payslip): Blob | undefined {
  return ready.get(slipKey(slip));
}

/** 현재 목록에 없는 오래된 결과를 정리 */
export function prunePdfCache(keep: Set<string>) {
  for (const key of pending.keys()) {
    if (!keep.has(key) && ready.has(key)) {
      pending.delete(key);
      ready.delete(key);
    }
  }
}
