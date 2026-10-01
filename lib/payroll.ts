export type Worker = {
  id: string;
  name: string;
  /** 입력 그대로 보관 (예: "27.5") */
  hours: string;
};

export type Settings = {
  /** 귀속 년월, "YYYY-MM" */
  payMonth: string;
  /** 지급일, "YYYY-MM-DD" */
  payDate: string;
  hourlyWage: number;
  /** 고용보험 근로자 부담률(%) */
  employmentInsuranceRate: number;
  fileNameTemplate: string;
  zipNameTemplate: string;
};

export type Payslip = {
  name: string;
  payDate: string;
  hours: number;
  hourlyWage: number;
  basePay: number;
  employmentInsurance: number;
  totalPay: number;
  totalDeduction: number;
  netPay: number;
};

export const DEDUCTION_ITEMS = ["근로소득세", "국민연금", "건강보험", "장기요양보험", "고용보험"] as const;

export const DEFAULT_FILE_NAME_TEMPLATE = "임금명세서_{년월}_{이름}";
export const DEFAULT_ZIP_NAME_TEMPLATE = "임금명세서_{년월}";

export function defaultSettings(today = new Date()): Settings {
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return {
    payMonth: `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`,
    payDate: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-05`,
    hourlyWage: 11000,
    employmentInsuranceRate: 0.9,
    fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
    zipNameTemplate: DEFAULT_ZIP_NAME_TEMPLATE,
  };
}

export function newWorker(name = "", hours = ""): Worker {
  // crypto.randomUUID 는 HTTPS 에서만 동작하므로 (휴대폰에서 http://PC-IP 접속 시) 직접 생성
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 10), name, hours };
}

/** 유효한 시간이면 숫자, 아니면 null */
export function parseHours(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function calcPayslip(name: string, hours: number, settings: Settings): Payslip {
  const basePay = Math.round(hours * settings.hourlyWage);
  // 엑셀 ROUNDDOWN(기본급 * 요율, -1) 과 동일 — 10원 미만 절사
  const raw = Math.round(((basePay * settings.employmentInsuranceRate) / 100) * 1e6) / 1e6;
  const employmentInsurance = Math.floor(raw / 10) * 10;
  const totalPay = basePay;
  const totalDeduction = employmentInsurance;
  return {
    name: name.trim(),
    payDate: settings.payDate,
    hours,
    hourlyWage: settings.hourlyWage,
    basePay,
    employmentInsurance,
    totalPay,
    totalDeduction,
    netPay: totalPay - totalDeduction,
  };
}

export type WorkerStatus =
  | { kind: "empty" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; slip: Payslip };

export function workerStatus(worker: Worker, settings: Settings): WorkerStatus {
  const name = worker.name.trim();
  const hasHours = worker.hours.trim() !== "";
  if (!name && !hasHours) return { kind: "empty" };
  if (!name) return { kind: "invalid", reason: "이름을 입력하세요" };
  const hours = parseHours(worker.hours);
  if (hours === null) return { kind: "invalid", reason: hasHours ? "근무시간이 올바르지 않습니다" : "근무시간을 입력하세요" };
  return { kind: "ok", slip: calcPayslip(name, hours, settings) };
}

/** 기기 로케일과 무관하게 항상 같은 결과가 나오도록 직접 천 단위 구분 */
export function formatWon(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export const FILE_NAME_TOKENS = [
  { token: "{이름}", label: "근무자명", example: (s: Settings, name: string) => name },
  { token: "{년월}", label: "년월 (YYMM)", example: (s: Settings) => monthParts(s.payMonth).yymm },
  { token: "{연도}", label: "연도 (YYYY)", example: (s: Settings) => monthParts(s.payMonth).yyyy },
  { token: "{월}", label: "월 (MM)", example: (s: Settings) => monthParts(s.payMonth).mm },
] as const;

function monthParts(payMonth: string) {
  const [yyyy = "", mm = ""] = payMonth.split("-");
  return { yyyy, mm, yymm: yyyy.slice(2) + mm };
}

/** 형식이 비어 있으면 fallback 형식을 쓴다 */
export function applyTemplate(template: string, settings: Settings, name: string, fallback = template): string {
  let out = template.trim() || fallback;
  for (const t of FILE_NAME_TOKENS) out = out.split(t.token).join(t.example(settings, name.trim()));
  return sanitizeFileName(out);
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || "임금명세서";
}

/** 같은 이름이 여러 번 나오면 " (2)", " (3)" 을 붙여 덮어쓰기를 막는다 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

/** 엑셀에서 복사한 여러 줄(이름, …, 시간)을 근무자 목록으로 변환 */
export function parsePastedRows(text: string): Worker[] {
  const rows: Worker[] = [];
  for (const line of text.split(/\r?\n/)) {
    // 엑셀 복사본은 탭 구분, 직접 입력은 쉼표/공백 구분
    const cells = line
      .split(line.includes("\t") ? "\t" : /[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const isNumber = (c: string) => parseHours(c.replace(/,/g, "")) !== null;
    const name = cells.find((c) => !isNumber(c));
    if (!name) continue;
    // 이름 뒤의 마지막 숫자를 근무시간으로 사용 (예: 이름 | 급여 | 시간)
    const numbers = cells.filter(isNumber);
    rows.push(newWorker(name, numbers.length ? numbers[numbers.length - 1].replace(/,/g, "") : ""));
  }
  return rows;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
