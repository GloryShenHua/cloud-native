/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 构建期后端地址，缺省为同源 /api。 */
  readonly VITE_API_BASE_URL?: string;
  /** 仅开发期使用：Vite 代理的后端地址。 */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 容器启动时由 40-runtime-config.sh 生成的运行时配置。 */
  __APP_CONFIG__?: {
    apiBaseUrl?: string;
  };
}
