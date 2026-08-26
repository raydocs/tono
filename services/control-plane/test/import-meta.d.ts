interface ImportMeta {
  env: {
    DEV: boolean;
    PROD: boolean;
    MODE: string;
    [key: string]: unknown;
  };
}
