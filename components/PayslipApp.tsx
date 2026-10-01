"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DEFAULT_FILE_NAME_TEMPLATE,
  DEFAULT_ZIP_NAME_TEMPLATE,
  FILE_NAME_TOKENS,
  applyTemplate,
  defaultSettings,
  formatHours,
  formatWon,
  newWorker,
  parseHours,
  parsePastedRows,
  uniqueNames,
  workerStatus,
  type Payslip,
  type Settings,
  type Worker,
} from "@/lib/payroll";
import { downloadBlob, sleep } from "@/lib/download";
import { getPdf, peekPdf, prefetchPdfs, prunePdfCache, slipKey } from "@/lib/pdf/cache";
import {
  SAVED_LISTS_KEY,
  deleteList,
  formatPayMonth,
  formatSavedAt,
  readSavedLists,
  saveList,
  type SavedList,
} from "@/lib/savedLists";

const STORAGE_KEY = "payslip-generator:v1";

type Stored = { settings: Settings; workers: Worker[] };
type ExportItem = { id: string; slip: Payslip; fileName: string };

function loadStored(): Stored {
  const fallback = { settings: defaultSettings(), workers: [newWorker()] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      settings: { ...fallback.settings, ...parsed.settings },
      workers: parsed.workers?.length ? parsed.workers : fallback.workers,
    };
  } catch {
    return fallback;
  }
}

export default function PayslipApp() {
  const [state, setState] = useState<Stored | null>(null);

  useEffect(() => {
    setState(loadStored());
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 저장소를 쓸 수 없는 환경에서는 저장만 건너뛴다
    }
  }, [state]);

  if (!state) return <Skeleton />;
  return <Editor state={state} setState={setState} />;
}

function PageHeader() {
  return (
    <header className="mb-5 sm:mb-8">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">임금명세서 발급</h1>
      <p className="mt-1 text-sm text-neutral-500">근무시간을 입력하면 근무자별 임금명세서 PDF를 만들어 줍니다.</p>
    </header>
  );
}

// 저장된 입력값을 읽기 전(스크립트 실행 전)에 정적 HTML로 바로 보이는 뼈대
function Skeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:pt-10" aria-busy="true">
      <PageHeader />
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        <div className="card h-64 animate-pulse lg:col-start-1" />
        <div className="card h-96 animate-pulse lg:col-start-1" />
        <div className="card hidden aspect-[3/4] animate-pulse lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block" />
      </div>
    </main>
  );
}

function Editor({ state, setState }: { state: Stored; setState: (fn: (prev: Stored | null) => Stored | null) => void }) {
  const { settings, workers } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; before: Stored; after: Stored } | null>(null);

  const setSettings = (patch: Partial<Settings>) =>
    setState((prev) => prev && { ...prev, settings: { ...prev.settings, ...patch } });
  const setWorkers = (fn: (prev: Worker[]) => Worker[]) =>
    setState((prev) => prev && { ...prev, workers: fn(prev.workers) });

  const statuses = useMemo(() => workers.map((w) => workerStatus(w, settings)), [workers, settings]);

  // 내보낼 명세서 목록 + 중복을 피한 파일명
  const exports: ExportItem[] = useMemo(() => {
    const items = workers.flatMap((w, i) => {
      const s = statuses[i];
      return s.kind === "ok" ? [{ id: w.id, slip: s.slip }] : [];
    });
    const names = uniqueNames(items.map((x) => applyTemplate(settings.fileNameTemplate, settings, x.slip.name, DEFAULT_FILE_NAME_TEMPLATE)));
    return items.map((x, i) => ({ ...x, fileName: `${names[i]}.pdf` }));
  }, [workers, statuses, settings]);

  const invalidCount = statuses.filter((s) => s.kind === "invalid").length;
  const totals = exports.reduce(
    (acc, { slip }) => ({ hours: acc.hours + slip.hours, pay: acc.pay + slip.totalPay, net: acc.net + slip.netPay }),
    { hours: 0, pay: 0, net: 0 },
  );
  const previewItem = exports.find((e) => e.id === selectedId) ?? exports[0] ?? null;

  // 입력이 멈추면 브라우저가 한가할 때 명세서를 미리 만들어 둔다 (버튼을 누르면 바로 저장되도록)
  const exportKeys = exports.map((e) => slipKey(e.slip)).join("\n");
  useEffect(() => {
    const timer = setTimeout(() => {
      prunePdfCache(new Set(exportKeys.split("\n")));
      void prefetchPdfs(exports.map((e) => e.slip));
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKeys]);

  useEffect(() => {
    try {
      const probe = new File([new Blob(["%PDF-"])], "probe.pdf", { type: "application/pdf" });
      const touch = window.matchMedia("(pointer: coarse)").matches;
      setCanShareFiles(touch && !!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!focusKey) return;
    inputRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  // 저장된 목록: 처음 한 번 읽고, 다른 탭에서 바뀌면 다시 읽는다
  useEffect(() => {
    setSavedLists(readSavedLists());
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_LISTS_KEY) setSavedLists(readSavedLists());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!listNotice) return;
    const timer = setTimeout(() => setListNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [listNotice]);

  // 불러온 뒤 내용을 고치기 시작하면 '되돌리기'는 사라진다 (입력한 시간을 실수로 날리지 않도록)
  useEffect(() => {
    if (undo && state !== undo.after) setUndo(null);
  }, [state, undo]);

  const storeCurrentList = (manual: boolean) => {
    try {
      const next = saveList(settings, workers);
      if (!next) {
        if (manual) setListNotice("저장할 근무자가 없습니다.");
        return;
      }
      setSavedLists(next);
      if (manual) setListNotice(`${formatPayMonth(settings.payMonth)} 목록을 저장했습니다.`);
    } catch {
      if (manual) setListNotice("브라우저 저장소에 저장하지 못했습니다.");
    }
  };

  const loadList = (list: SavedList, mode: "names" | "all") => {
    const after: Stored = {
      settings: mode === "all" ? { ...settings, ...list.settings } : settings,
      workers: list.workers.map((w) => newWorker(w.name, mode === "all" ? w.hours : "")),
    };
    setUndo({
      label: `${formatPayMonth(list.id)} 목록을 ${mode === "all" ? "근무시간·발급 정보까지" : "이름만"} 불러왔습니다.`,
      before: state,
      after,
    });
    setState(() => after);
    setSelectedId(null);
    setShowSaved(false);
  };

  const removeSavedList = (list: SavedList) => {
    if (!confirm(`저장된 ${formatPayMonth(list.id)} 목록을 삭제할까요?`)) return;
    try {
      setSavedLists(deleteList(list.id));
    } catch {
      setListNotice("브라우저 저장소에서 삭제하지 못했습니다.");
    }
  };

  const bindInput = (key: string) => (el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };

  const updateWorker = (id: string, patch: Partial<Worker>) =>
    setWorkers((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const addWorker = (afterIndex = workers.length - 1) => {
    const w = newWorker();
    setWorkers((prev) => [...prev.slice(0, afterIndex + 1), w, ...prev.slice(afterIndex + 1)]);
    setFocusKey(`${w.id}:name`);
  };

  const removeWorker = (id: string) =>
    setWorkers((prev) => {
      const next = prev.filter((w) => w.id !== id);
      return next.length ? next : [newWorker()];
    });

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>, w: Worker) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    setFocusKey(`${w.id}:hours`);
  };

  const onHoursKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const next = workers[index + 1];
    if (next) setFocusKey(`${next.id}:name`);
    else addWorker(index);
  };

  // 엑셀에서 여러 행을 복사해 이름 칸에 붙여넣으면 행 단위로 펼친다
  const onNamePaste = (e: ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return;
    const rows = parsePastedRows(text);
    if (!rows.length) return;
    e.preventDefault();
    setWorkers((prev) => {
      const current = prev[index];
      const replace = !current.name.trim() && !current.hours.trim();
      return [...prev.slice(0, replace ? index : index + 1), ...rows, ...prev.slice(index + 1)];
    });
  };

  const insertToken = (token: string) => {
    const input = templateRef.current;
    const value = settings.fileNameTemplate;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    setSettings({ fileNameTemplate: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function run(task: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      console.error(err);
      setError("PDF를 만드는 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  const downloadOne = (item: ExportItem) => {
    storeCurrentList(false);
    // 이미 만들어 둔 파일은 탭한 순간 바로 저장 (모바일 브라우저 차단 방지)
    const cached = peekPdf(item.slip);
    if (cached) return downloadBlob(cached, item.fileName);
    void run(async () => {
      setBusy(`${item.slip.name} PDF 생성 중…`);
      downloadBlob(await getPdf(item.slip), item.fileName);
    });
  };

  const downloadAll = () =>
    run(async () => {
      storeCurrentList(false);
      for (const [i, item] of exports.entries()) {
        setBusy(`PDF 다운로드 중… (${i + 1}/${exports.length})`);
        downloadBlob(await getPdf(item.slip), item.fileName);
        // 연속 다운로드가 브라우저에서 누락되지 않도록 간격을 둔다
        await sleep(400);
      }
    });

  const downloadZip = () =>
    run(async () => {
      storeCurrentList(false);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const [i, item] of exports.entries()) {
        setBusy(`PDF 생성 중… (${i + 1}/${exports.length})`);
        zip.file(item.fileName, await getPdf(item.slip));
      }
      setBusy("ZIP 압축 중…");
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${applyTemplate(settings.zipNameTemplate, settings, "", DEFAULT_ZIP_NAME_TEMPLATE)}.zip`);
    });

  const shareAll = async () => {
    setError(null);
    setNotice(null);
    storeCurrentList(false);
    const toFiles = (blobs: Blob[]) =>
      blobs.map((b, i) => new File([b], exports[i].fileName, { type: "application/pdf" }));
    const cached = exports.map((e) => peekPdf(e.slip));
    let files: File[];
    if (cached.every((b): b is Blob => !!b)) {
      files = toFiles(cached);
    } else {
      setBusy("파일 준비 중…");
      try {
        files = toFiles(await Promise.all(exports.map((e) => getPdf(e.slip))));
      } catch (err) {
        console.error(err);
        setError("PDF를 만드는 중 오류가 발생했습니다. 다시 시도해 주세요.");
        return;
      } finally {
        setBusy(null);
      }
    }
    try {
      await navigator.share({ files });
    } catch (err) {
      const name = (err as DOMException | undefined)?.name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        setNotice("파일이 준비됐습니다. ‘공유 · 저장’을 한 번 더 눌러주세요.");
        return;
      }
      console.error(err);
      setError("공유하지 못했습니다. ‘ZIP으로 받기’를 이용해 주세요.");
    }
  };

  const resetHours = () => setWorkers((prev) => prev.map((w) => ({ ...w, hours: "" })));
  const clearAll = () => {
    if (confirm("근무자 목록을 모두 지울까요?")) setWorkers(() => [newWorker()]);
  };

  const [year, month] = settings.payMonth.split("-");
  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set([thisYear - 2, thisYear - 1, thisYear, thisYear + 1, Number(year)])).sort();
  const sampleName = previewItem?.slip.name ?? "홍길동";
  const disabled = !exports.length || !!busy;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:pt-10">
      <PageHeader />

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        {/* 1. 발급 정보 */}
        <Section step={1} title="발급 정보" desc="모든 명세서에 공통으로 들어가는 내용입니다." className="lg:col-start-1">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            <Field label="귀속 년월" className="col-span-2 md:col-span-1">
              <div className="flex gap-2">
                <select
                  className="input min-w-0 flex-[3]"
                  aria-label="귀속 연도"
                  value={Number(year)}
                  onChange={(e) => setSettings({ payMonth: `${e.target.value}-${month}` })}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
                <select
                  className="input min-w-0 flex-[2]"
                  aria-label="귀속 월"
                  value={month}
                  onChange={(e) => setSettings({ payMonth: `${year}-${e.target.value}` })}
                >
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                    <option key={m} value={m}>
                      {Number(m)}월
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="지급일" className="col-span-2 md:col-span-1">
              <input
                type="date"
                className="input"
                value={settings.payDate}
                onChange={(e) => setSettings({ payDate: e.target.value })}
              />
            </Field>
            <Field label="시급 (원)">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={10}
                className="input text-right tabular-nums"
                value={settings.hourlyWage}
                onChange={(e) => setSettings({ hourlyWage: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="고용보험 요율 (%)">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                className="input text-right tabular-nums"
                value={settings.employmentInsuranceRate}
                onChange={(e) => setSettings({ employmentInsuranceRate: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            기본급 = 근무시간 × 시급 · 고용보험 = 기본급 × 요율 (10원 미만 절사)
          </p>
        </Section>

        {/* 2. 근무자 */}
        <Section
          step={2}
          title="근무자"
          desc="엑셀에서 이름·시간 열을 복사해 이름 칸에 붙여넣으면 여러 명이 한 번에 추가됩니다."
          className="lg:col-start-1"
          actions={
            <div className="flex shrink-0 gap-1">
              <button type="button" className="btn-ghost" onClick={resetHours}>
                시간 초기화
              </button>
              <button type="button" className="btn-ghost" onClick={clearAll}>
                전체 삭제
              </button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-soft"
              aria-expanded={showSaved}
              aria-controls="saved-lists"
              onClick={() => setShowSaved((v) => !v)}
            >
              <FolderIcon />
              목록 불러오기
              {savedLists.length > 0 && (
                <span className="rounded-full bg-neutral-900 px-1.5 text-[11px] leading-[18px] text-white">
                  {savedLists.length}
                </span>
              )}
            </button>
            <button type="button" className="btn-soft" onClick={() => storeCurrentList(true)}>
              <SaveIcon />
              현재 목록 저장
            </button>
            {listNotice && (
              <span role="status" className="text-xs text-blue-700">
                {listNotice}
              </span>
            )}
          </div>

          {showSaved && (
            <SavedListsPanel
              lists={savedLists}
              currentMonth={settings.payMonth}
              onLoad={loadList}
              onDelete={removeSavedList}
            />
          )}

          {undo && (
            <div
              role="status"
              className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900"
            >
              <span>{undo.label}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="min-h-8 rounded px-2 font-semibold hover:bg-blue-100"
                  onClick={() => {
                    setState(() => undo.before);
                    setUndo(null);
                  }}
                >
                  되돌리기
                </button>
                <button
                  type="button"
                  className="min-h-8 rounded px-2 text-blue-900/60 hover:bg-blue-100"
                  aria-label="알림 닫기"
                  onClick={() => setUndo(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className="@container">
          <div className="worker-grid hidden border-b border-neutral-200 px-2 pb-2 text-xs font-medium text-neutral-500 @2xl:grid">
            <span>#</span>
            <span>이름</span>
            <span>근무시간</span>
            <span className="text-right">기본급</span>
            <span className="text-right">고용보험</span>
            <span className="text-right">실지급액</span>
            <span />
          </div>

          <ul className="divide-y divide-neutral-100">
            {workers.map((w, i) => {
              const status = statuses[i];
              const slip = status.kind === "ok" ? status.slip : null;
              const item = exports.find((x) => x.id === w.id);
              const selected = previewItem?.id === w.id;
              const select = () => slip && setSelectedId(w.id);
              return (
                <li
                  key={w.id}
                  onClick={select}
                  className={`worker-grid rounded-lg px-2 py-2.5 @2xl:py-1.5 ${selected ? "bg-blue-50/80" : ""}`}
                >
                  <span className="hidden text-xs tabular-nums text-neutral-400 @2xl:block">{i + 1}</span>
                  <input
                    ref={bindInput(`${w.id}:name`)}
                    className="input"
                    placeholder="이름"
                    aria-label={`${i + 1}번 근무자 이름`}
                    enterKeyHint="next"
                    autoComplete="off"
                    value={w.name}
                    onFocus={select}
                    onChange={(e) => updateWorker(w.id, { name: e.target.value })}
                    onKeyDown={(e) => onNameKeyDown(e, w)}
                    onPaste={(e) => onNamePaste(e, i)}
                  />
                  <div className="relative">
                    <input
                      ref={bindInput(`${w.id}:hours`)}
                      className={`input pr-10 text-right tabular-nums ${
                        status.kind === "invalid" && w.name.trim() ? "input-error" : ""
                      }`}
                      inputMode="decimal"
                      enterKeyHint="next"
                      autoComplete="off"
                      placeholder="0"
                      aria-label={`${i + 1}번 근무자 근무시간`}
                      value={w.hours}
                      title={status.kind === "invalid" ? status.reason : undefined}
                      onFocus={select}
                      onChange={(e) => updateWorker(w.id, { hours: e.target.value })}
                      onKeyDown={(e) => onHoursKeyDown(e, i)}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                      시간
                    </span>
                  </div>
                  <span className="hidden text-right text-sm tabular-nums @2xl:block">
                    {slip ? formatWon(slip.basePay) : "–"}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums text-neutral-500 @2xl:block">
                    {slip ? formatWon(slip.employmentInsurance) : "–"}
                  </span>
                  <span className="hidden text-right text-sm font-medium tabular-nums @2xl:block">
                    {slip ? formatWon(slip.netPay) : "–"}
                  </span>
                  <div className="flex justify-end gap-0.5">
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={!item || !!busy}
                      title={item ? `${item.fileName} 다운로드` : "이름과 근무시간을 입력하세요"}
                      aria-label={item ? `${item.fileName} 다운로드` : "PDF 다운로드"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item) downloadOne(item);
                      }}
                    >
                      <DownloadIcon />
                    </button>
                    <button
                      type="button"
                      className="btn-icon text-neutral-400 hover:text-red-600"
                      title="행 삭제"
                      aria-label={`${w.name || `${i + 1}번`} 행 삭제`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWorker(w.id);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {/* 모바일: 계산 결과를 한 줄로 */}
                  <p className="col-span-3 flex flex-wrap justify-between gap-x-3 px-1 text-xs tabular-nums text-neutral-500 @2xl:hidden">
                    {slip ? (
                      <>
                        <span>
                          기본급 {formatWon(slip.basePay)} · 고용보험 {formatWon(slip.employmentInsurance)}
                        </span>
                        <span className="whitespace-nowrap font-semibold text-neutral-900">
                          실지급 {formatWon(slip.netPay)}원
                        </span>
                      </>
                    ) : status.kind === "invalid" && w.name.trim() ? (
                      <span className="text-red-600">{status.reason}</span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-neutral-200 px-2 pt-3 text-sm">
            <span className="text-neutral-500">
              {exports.length}명 · {formatHours(totals.hours)}시간 · 지급 {formatWon(totals.pay)}원
            </span>
            <span className="font-semibold tabular-nums">실지급 합계 {formatWon(totals.net)}원</span>
          </div>
          <button type="button" className="btn-secondary mt-4 w-full sm:w-auto" onClick={() => addWorker()}>
            + 근무자 추가
          </button>
        </Section>

        {/* 미리보기: 모바일은 근무자 아래, PC는 오른쪽 고정 */}
        <aside className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="lg:sticky lg:top-6">
            <Preview
              items={exports}
              item={previewItem}
              onSelect={setSelectedId}
              onDownload={downloadOne}
              busy={!!busy}
            />
          </div>
        </aside>

        {/* 3. 파일명 · 내보내기 */}
        <Section step={3} title="파일명 · 내보내기" className="lg:col-start-1">
          <div className="space-y-4">
            <Field label="PDF 파일명 형식">
              <div className="flex items-center gap-2">
                <input
                  ref={templateRef}
                  className="input font-mono"
                  value={settings.fileNameTemplate}
                  placeholder={DEFAULT_FILE_NAME_TEMPLATE}
                  onChange={(e) => setSettings({ fileNameTemplate: e.target.value })}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <span className="shrink-0 text-sm text-neutral-400">.pdf</span>
                {settings.fileNameTemplate !== DEFAULT_FILE_NAME_TEMPLATE && (
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={() => setSettings({ fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE })}
                  >
                    기본값
                  </button>
                )}
              </div>
            </Field>
            {settings.fileNameTemplate.trim() && !settings.fileNameTemplate.includes("{이름}") && (
              <p className="text-xs text-amber-700">
                파일명에 {"{이름}"}이 없으면 모든 근무자의 파일명이 같아져 뒤에 (2), (3)이 붙습니다.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-xs text-neutral-500 sm:w-auto">변수 넣기</span>
              {FILE_NAME_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  className="chip"
                  title={`예: ${t.example(settings, sampleName)}`}
                  onClick={() => insertToken(t.token)}
                >
                  <span className="font-mono">{t.token}</span>
                  <span className="text-neutral-400">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="rounded-lg bg-neutral-50 px-3 py-2.5 text-sm">
              <span className="text-neutral-500">미리보기 </span>
              <span className="break-all font-medium">
                {applyTemplate(settings.fileNameTemplate, settings, sampleName, DEFAULT_FILE_NAME_TEMPLATE)}.pdf
              </span>
            </div>

            <div className="grid gap-2 border-t border-neutral-100 pt-4 sm:flex sm:flex-wrap sm:items-center">
              {canShareFiles && (
                <button type="button" className="btn-primary" disabled={disabled} onClick={shareAll}>
                  공유 · 저장 ({exports.length}개)
                </button>
              )}
              <button
                type="button"
                className={canShareFiles ? "btn-secondary" : "btn-primary"}
                disabled={disabled}
                onClick={downloadAll}
              >
                PDF 전체 다운로드 ({exports.length}개)
              </button>
              <button type="button" className="btn-secondary" disabled={disabled} onClick={downloadZip}>
                ZIP으로 받기
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="shrink-0">ZIP 파일명</span>
              <input
                className="input font-mono sm:max-w-64"
                value={settings.zipNameTemplate}
                onChange={(e) => setSettings({ zipNameTemplate: e.target.value })}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className="shrink-0 text-neutral-400">.zip</span>
            </label>
            <div aria-live="polite" className="space-y-1 text-xs leading-relaxed">
              {busy && <p className="text-blue-700">{busy}</p>}
              {notice && <p className="text-blue-700">{notice}</p>}
              {error && <p className="text-red-600">{error}</p>}
              {invalidCount > 0 && (
                <p className="text-amber-700">입력이 불완전한 {invalidCount}명은 내보내기에서 제외됩니다.</p>
              )}
              <p className="text-neutral-400">
                {canShareFiles
                  ? "‘공유 · 저장’에서 ‘파일에 저장’을 고르면 모든 PDF를 한 번에 저장할 수 있습니다."
                  : "전체 다운로드 시 브라우저가 ‘여러 파일 다운로드’ 허용을 물으면 허용을 선택하세요."}
              </p>
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}

function SavedListsPanel({
  lists,
  currentMonth,
  onLoad,
  onDelete,
}: {
  lists: SavedList[];
  currentMonth: string;
  onLoad: (list: SavedList, mode: "names" | "all") => void;
  onDelete: (list: SavedList) => void;
}) {
  return (
    <div id="saved-lists" className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      {lists.length === 0 ? (
        <p className="text-xs leading-relaxed text-neutral-500">
          아직 저장된 목록이 없습니다. ‘현재 목록 저장’을 누르거나 PDF를 내보내면 귀속 년월별로 이 브라우저에 저장됩니다.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {lists.map((l) => {
              const names = l.workers.map((w) => w.name);
              const hours = l.workers.reduce((sum, w) => sum + (parseHours(w.hours) ?? 0), 0);
              return (
                <li key={l.id} className="rounded-md border border-neutral-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {formatPayMonth(l.id)}
                        {l.id === currentMonth && (
                          <span className="rounded bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700">
                            현재 귀속월
                          </span>
                        )}
                      </p>
                      <p className="text-xs tabular-nums text-neutral-500">
                        {l.workers.length}명 · {formatHours(hours)}시간 · {formatSavedAt(l.savedAt)} 저장
                      </p>
                      <p className="mt-1 truncate text-xs text-neutral-600">
                        {names.slice(0, 4).join(", ")}
                        {names.length > 4 ? ` 외 ${names.length - 4}명` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" className="btn-soft" onClick={() => onLoad(l, "names")}>
                        이름만
                      </button>
                      <button type="button" className="btn-soft" onClick={() => onLoad(l, "all")}>
                        전체
                      </button>
                      <button
                        type="button"
                        className="btn-icon text-neutral-400 hover:text-red-600"
                        aria-label={`${formatPayMonth(l.id)} 저장 목록 삭제`}
                        title="삭제"
                        onClick={() => onDelete(l)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            <b className="font-medium text-neutral-700">이름만</b> 새 달 입력용 — 근무시간은 비워 둡니다 ·{" "}
            <b className="font-medium text-neutral-700">전체</b> 재발급용 — 근무시간과 귀속 년월·지급일·시급까지 그대로
            불러옵니다
          </p>
        </>
      )}
    </div>
  );
}

function Preview({
  items,
  item,
  onSelect,
  onDownload,
  busy,
}: {
  items: ExportItem[];
  item: ExportItem | null;
  onSelect: (id: string) => void;
  onDownload: (item: ExportItem) => void;
  busy: boolean;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const visible = useInView(sectionRef);
  const key = item ? slipKey(item.slip) : "";

  useEffect(() => {
    if (!item) {
      setBlob(null);
      return;
    }
    // 모바일처럼 미리보기가 화면 밖에 있으면 그리지 않는다 (pdf.js 로딩도 미룸)
    if (!visible) return;
    const cached = peekPdf(item.slip);
    if (cached) {
      setBlob(cached);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getPdf(item.slip).then(
        (b) => {
          if (cancelled) return;
          setBlob(b);
          setFailed(false);
        },
        () => !cancelled && setFailed(true),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);

  const stale = !!item && !!blob && peekPdf(item.slip) !== blob;

  return (
    <section ref={sectionRef} className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="shrink-0 text-sm font-semibold">미리보기</h2>
        {items.length > 0 && item ? (
          <select
            className="input ml-auto w-auto min-w-0 py-1.5"
            aria-label="미리볼 근무자"
            value={item.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.slip.name}
              </option>
            ))}
          </select>
        ) : null}
        {item && (
          <button
            type="button"
            className="btn-icon shrink-0 border border-neutral-200"
            disabled={busy}
            title={`${item.fileName} 다운로드`}
            aria-label={`${item.fileName} 다운로드`}
            onClick={() => onDownload(item)}
          >
            <DownloadIcon />
          </button>
        )}
      </div>
      <PdfCanvas blob={item ? blob : null} dimmed={stale}>
        {failed ? (
          <span className="text-red-600">미리보기를 만들 수 없습니다.</span>
        ) : item ? (
          "미리보기 생성 중…"
        ) : (
          "이름과 근무시간을 입력하면\n명세서가 여기에 표시됩니다."
        )}
      </PdfCanvas>
      {item && <p className="mt-2 truncate text-xs text-neutral-500">{item.fileName}</p>}
    </section>
  );
}

function PdfCanvas({ blob, dimmed, children }: { blob: Blob | null; dimmed: boolean; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drawnBlob, setDrawnBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!blob || !width || !canvas) return;
    let alive = true;
    // 미리보기 전용 모듈(pdf.js)은 필요할 때만 불러온다
    const jobPromise = import("@/lib/pdf/preview").then(({ drawPdfPage }) => {
      const job = drawPdfPage(blob, canvas, width);
      job.done.then(
        () => alive && setDrawnBlob(blob),
        (err) => {
          if ((err as Error)?.name !== "RenderingCancelledException") console.error(err);
        },
      );
      return job;
    });
    return () => {
      alive = false;
      void jobPromise.then((job) => job.cancel());
    };
  }, [blob, width]);

  const visible = !!blob && !!drawnBlob;
  return (
    <div
      ref={wrapRef}
      className="relative aspect-[210/297] w-full overflow-hidden rounded-md border border-neutral-200 bg-white"
    >
      <canvas
        ref={canvasRef}
        className={`h-full w-full transition-opacity ${visible ? "" : "invisible"} ${dimmed ? "opacity-60" : ""}`}
      />
      {!visible && (
        <div className="absolute inset-0 flex items-center justify-center whitespace-pre-line bg-neutral-50 p-6 text-center text-sm text-neutral-400">
          {children}
        </div>
      )}
    </div>
  );
}

function useInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function Section({
  step,
  title,
  desc,
  actions,
  className = "",
  children,
}: {
  step: number;
  title: string;
  desc?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card p-4 sm:p-6 ${className}`}>
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">
              {step}
            </span>
            {title}
          </h2>
          {actions}
        </div>
        {desc && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-[18px]" aria-hidden>
      <path d="M10 3v9.5m0 0L6.5 9M10 12.5 13.5 9M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-4" aria-hidden>
      <path d="M3 6a1 1 0 0 1 1-1h3.6l1.6 1.8H16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-4" aria-hidden>
      <path d="M4 4h9.5L16 6.5V16H4V4Z M7 4v4h6V4 M7 16v-4.5h6V16" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-[18px]" aria-hidden>
      <path d="M4 6h12M8 6V4.5A.5.5 0 0 1 8.5 4h3a.5.5 0 0 1 .5.5V6m-6 0 .7 9.1a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
