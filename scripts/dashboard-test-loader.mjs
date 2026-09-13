import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function dashboardLoader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const absolute = resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loadedModule = { exports: {} };
    cache.set(absolute, loadedModule);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", code)((name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? join(root, ...name.slice(2).split("/")) : resolve(dirname(absolute), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
        if (!resolved) throw new Error(`Unresolved dashboard test import: ${name}`);
        return load(resolved);
      }
      return require(name);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}
