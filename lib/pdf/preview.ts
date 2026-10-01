import { BASE_PATH } from "@/lib/basePath";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;

// 모바일(특히 안드로이드)은 iframe 안에서 PDF를 표시하지 못하므로 pdf.js로 캔버스에 그린다
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** PDF 첫 페이지를 cssWidth 너비로 canvas 에 그린다. 반환 함수로 취소 */
export function drawPdfPage(blob: Blob, canvas: HTMLCanvasElement, cssWidth: number) {
  let cancelled = false;
  let cancelRender = () => {};

  const done = (async () => {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
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
