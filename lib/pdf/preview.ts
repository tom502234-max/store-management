import { BASE_PATH } from "@/lib/basePath";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<{ pdfjs: PdfJs; worker: InstanceType<PdfJs["PDFWorker"]> }> | null = null;

// 모바일(특히 안드로이드)은 iframe 안에서 PDF를 표시하지 못하므로 pdf.js로 캔버스에 그린다
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;
    // 워커(약 1.2MB)는 한 번만 띄워 모든 미리보기에서 재사용한다
    return { pdfjs, worker: new pdfjs.PDFWorker() };
  });
  return pdfjsPromise;
}

/** PDF 첫 페이지를 cssWidth 너비로 canvas 에 그린다. 반환 함수로 취소 */
export function drawPdfPage(blob: Blob, canvas: HTMLCanvasElement, cssWidth: number) {
  let cancelled = false;
  let cancelRender = () => {};

  const done = (async () => {
    const { pdfjs, worker } = await loadPdfJs();
    // worker 를 직접 넘기면 문서를 닫아도 워커는 종료되지 않는다
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), worker }).promise;
    try {
      if (cancelled) return;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

      // 다른 캔버스에 먼저 그린 뒤 옮겨서 다시 그리는 동안 깜빡이지 않게 한다
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      const task = page.render({ canvas: off, canvasContext: off.getContext("2d")!, viewport });
      cancelRender = () => task.cancel();
      await task.promise;
      if (cancelled) return;

      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")!.drawImage(off, 0, 0);
    } finally {
      await doc.destroy();
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelRender();
    },
  };
}
