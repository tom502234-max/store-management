import type { NextConfig } from "next";

// GitHub Pages 배포 시(워크플로에서 설정): 정적 파일로 내보내고 /<저장소명> 하위 경로에서 동작
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const staticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  ...(staticExport && { output: "export" }),
  basePath,
  turbopack: { root: __dirname },
};

export default nextConfig;
