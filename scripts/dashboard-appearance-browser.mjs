import { readFileSync, writeFileSync, mkdtempSync, rmSync, rmdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import React from "react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { fixtureMocks } from "./dashboard-ui-fixtures.mjs";

const require = createRequire(import.meta.url);

export async function appearanceBrowserFixture() {
  const load = dashboardLoader(fixtureMocks());
  const Terminal = load("components\\dashboard\\devices\\device-terminal.tsx").default;
  const terminalMarkup = renderToStaticMarkup(React.createElement(Terminal, { open: true, initialShell: "powershell", device: { id: "fixture", hostname: "Fixture", display_name: null }, canManage: true, onClose() {} }));
  const terminalInput = terminalMarkup.match(/<div class="sg-input-frame[^]*?<\/div>/)?.[0];
  if (!terminalInput) throw new Error("The terminal must render its shared input frame");
  const directory = mkdtempSync(join(tmpdir(), "sentinelgrid-appearance-build-"));
  const files = [];
  function emit(name, source) {
    const path = join(directory, name);
    files.push(path);
    writeFileSync(path, source);
    return path;
  }
  try {
    const alias = {};
    for (const [name, path] of Object.entries({
      "@/lib/appearance": "lib\\appearance.ts",
      "@/lib/utils": "lib\\utils.ts",
      "@/components/ui/input": "components\\ui\\input.tsx",
      "@/components/infrastructure-search": "components\\infrastructure-search.tsx",
      "@/components/brand-logo": "components\\brand-logo.tsx",
      "@/components/dashboard/dashboard-background": "components\\dashboard\\dashboard-background.tsx",
      "@/components/ui/dropdown-menu": "components\\ui\\dropdown-menu.tsx",
      "@/components/dashboard/dashboard-badges": "components\\dashboard\\dashboard-badges.tsx",
      "@/components/dashboard/animated-selection": "components\\dashboard\\animated-selection.tsx",
      "@/components/dashboard/devices/device-tabs": "components\\dashboard\\devices\\device-tabs.tsx",
      "@/components/dashboard/dashboard-primitives": "components\\dashboard\\dashboard-primitives.tsx",
      "@/components/dashboard/appearance-provider": "components\\dashboard\\appearance-provider.tsx",
      "@/components/dashboard/appearance-settings": "components\\dashboard\\appearance-settings.tsx",
      "@/components/dashboard/dashboard-sidebar": "components\\dashboard\\dashboard-sidebar.tsx",
      "@/app/dashboard/organizations/[id]/organization-clients": "app\\dashboard\\organizations\\[id]\\organization-clients.tsx",
      "interface-fixture": "scripts\\dashboard-interface-fixture.tsx",
    })) {
      alias[name] = emit(`source-${files.length}.js`, ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText);
    }
    alias["next/navigation"] = emit("navigation.js", `export const usePathname = () => '/dashboard'; export const useRouter = () => ({ push() { throw new Error('Focus fixture cannot navigate'); } });`);
    alias["next/link"] = emit("link.js", `import React from 'react'; export default function Link({ children, ...props }) { return React.createElement('a', props, children); }`);
    alias["next/image"] = emit("image.js", `import React from 'react'; export default function Image({ preload, unoptimized, ...props }) { return React.createElement('img', props); }`);
    alias["@/lib/supabase/client"] = emit("database.js", `const client = { from() { return { select() { return this; }, limit() { return this; }, async maybeSingle() { return { data: { id: 'org-1' }, error: null }; } }; } }; export function createClient() { return client; }`);
    const entry = emit("entry.js", `
      import React from 'react';
      import { hydrateRoot } from 'react-dom/client';
      import Fixture from 'interface-fixture';
      window.appearanceHydrationErrors = [];
      hydrateRoot(document.getElementById('appearance-root'), React.createElement(Fixture, { terminalInput: ${JSON.stringify(terminalInput)} }),
        { onRecoverableError: error => window.appearanceHydrationErrors.push(error.message) });
    `);
    const { webpack } = require("next/dist/compiled/webpack/webpack");
    const bundle = join(directory, "bundle.js");
    files.push(bundle);
    const compiler = webpack({ mode: "development", devtool: false, target: "web", context: process.cwd(), entry,
      plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""' })],
      output: { path: directory, filename: "bundle.js" },
      resolve: { alias, modules: [resolve("node_modules"), "node_modules"] },
    });
    try {
      await new Promise((resolve, reject) => compiler.run((error, stats) => {
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      }));
    } finally {
      await new Promise((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve()));
    }
    const Fixture = load("scripts\\dashboard-interface-fixture.tsx").default;
    return { script: readFileSync(bundle, "utf8"), markup: renderToString(React.createElement(Fixture, { terminalInput })) };
  } finally {
    for (const file of files) if (existsSync(file)) rmSync(file);
    rmdirSync(directory);
  }
}
