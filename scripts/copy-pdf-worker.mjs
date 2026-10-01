// pdf.js 워커를 public/ 에 복사한다 (설치된 pdfjs-dist 버전과 항상 일치하도록)
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync("public", { recursive: true });
copyFileSync(join(pkgDir, "legacy/build/pdf.worker.min.mjs"), "public/pdf.worker.min.mjs");
