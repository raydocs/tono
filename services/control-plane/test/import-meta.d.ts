interface ImportMeta {
  env: {
    DEV: boolean;
    PROD: boolean;
    MODE: string;
    [key: string]: unknown;
  };
}

declare module '*?raw' {
  const content: string;
  export default content;
}
