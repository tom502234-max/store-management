import type { Settings, Worker } from "@/lib/payroll";

// 귀속 년월별로 근무자 목록을 브라우저(localStorage)에 보관한다.
// 같은 브라우저에서 접속하면 이전 달 목록을 다시 불러올 수 있다.
export const SAVED_LISTS_KEY = "payslip-generator:saved-lists:v1";
const MAX_LISTS = 36;

export type SavedSettings = Pick<Settings, "payMonth" | "payDate" | "hourlyWage" | "employmentInsuranceRate">;

export type SavedList = {
  /** 귀속 년월 "YYYY-MM" — 같은 달은 하나만 보관 */
  id: string;
  savedAt: string;
  settings: SavedSettings;
  workers: { name: string; hours: string }[];
};

export function readSavedLists(): SavedList[] {
  try {
    const raw = localStorage.getItem(SAVED_LISTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedList).sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

function writeSavedLists(lists: SavedList[]): SavedList[] {
  const sorted = [...lists].sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_LISTS);
  localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(sorted));
  return sorted;
}

/** 현재 목록을 귀속 년월 기준으로 저장(같은 달이 있으면 덮어씀). 저장할 근무자가 없으면 null */
export function saveList(settings: Settings, workers: Worker[]): SavedList[] | null {
  const named = workers
    .filter((w) => w.name.trim())
    .map((w) => ({ name: w.name.trim(), hours: w.hours.trim() }));
  if (!named.length) return null;
  const entry: SavedList = {
    id: settings.payMonth,
    savedAt: new Date().toISOString(),
    settings: {
      payMonth: settings.payMonth,
      payDate: settings.payDate,
      hourlyWage: settings.hourlyWage,
      employmentInsuranceRate: settings.employmentInsuranceRate,
    },
    workers: named,
  };
  return writeSavedLists([entry, ...readSavedLists().filter((l) => l.id !== entry.id)]);
}

export function deleteList(id: string): SavedList[] {
  return writeSavedLists(readSavedLists().filter((l) => l.id !== id));
}

export function formatPayMonth(payMonth: string): string {
  const [y, m] = payMonth.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${hh}:${mm}`;
}

function isSavedList(v: unknown): v is SavedList {
  const l = v as SavedList;
  return (
    !!l &&
    typeof l.id === "string" &&
    typeof l.savedAt === "string" &&
    !!l.settings &&
    typeof l.settings.payMonth === "string" &&
    Array.isArray(l.workers) &&
    l.workers.every((w) => w && typeof w.name === "string" && typeof w.hours === "string")
  );
}
