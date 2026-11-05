import { createRequire } from "module";

// package.json sits one level above both src/ (tsx) and dist/ (bundled build)
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const VERSION = pkg.version;
