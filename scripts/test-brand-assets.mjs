import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const file = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFile(file(path));

async function load(path, dependencies = {}) {
  const code = ts.transpileModule((await read(path)).toString(), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => dependencies[name] ?? require(name),
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { BrandLogo } = await load("components/brand-logo.tsx", {
  "@/lib/utils": await load("lib/utils.ts"),
});
const renderLogo = (props) => renderToStaticMarkup(React.createElement(BrandLogo, props));

test("compact lockup renders a decorative S and one readable single-line name", () => {
  const html = renderLogo({ variant: "lockup" });
  assert.equal((html.match(/<img\b/g) ?? []).length, 1);
  assert.match(html, /alt=""/);
  assert.match(html, /src="\/logos\/sentinelgrid-mark\.svg"/);
  assert.match(html, /whitespace-nowrap text-\[18px\]/);
  assert.match(html, /Sentinel<span[^>]*>Grid<\/span>/);
  assert.doesNotMatch(html, /sentinelgrid-wordmark|Infrastructure|uppercase|border|bg-white/);
  assert.match(renderLogo({ variant: "lockup", decorative: true }), /^<span aria-hidden="true"/);
});

test("standalone asset variants retain sizing, accessible names and class overrides", () => {
  const mark = renderLogo({ className: "h-9 w-9" });
  assert.match(mark, /alt="SentinelGrid"/);
  assert.match(mark, /width="320" height="384"/);
  assert.match(mark, /class="shrink-0 object-contain h-9 w-9"/);
  const wordmark = renderLogo({ variant: "wordmark" });
  assert.match(wordmark, /src="\/logos\/sentinelgrid-wordmark\.svg"/);
  assert.match(wordmark, /width="800" height="160"/);
  assert.match(renderLogo({ decorative: true }), /alt=""/);
  assert.match(renderLogo({ variant: "lockup", preload: true }), /rel="preload"/);
});

test("navigation uses the compact lockup rather than shrinking the stacked artwork", async () => {
  for (const path of [
    "app/(web)/layout.tsx",
    "app/auth/layout.tsx",
    "components/dashboard/dashboard-sidebar.tsx",
  ]) {
    const source = (await read(path)).toString();
    assert.match(source, /<BrandLogo variant="lockup"(?:\s+className="[^"]*")?\s*\/>/, path);
    assert.doesNotMatch(source, /variant="wordmark"/, path);
  }
});

test("vector variants are self-contained and use paths, not installed fonts", async () => {
  for (const variant of ["mark", "wordmark", "logo"]) {
    const svg = (await read(`public/logos/sentinelgrid-${variant}.svg`)).toString();
    assert.match(svg, /<svg[^>]+viewBox=/);
    assert.match(svg, /<path /);
    assert.doesNotMatch(svg, /<(?:script|image|text|foreignObject)\b|\bhref=/i);
    const { channels } = await sharp(Buffer.from(svg)).metadata();
    assert.equal(channels, 4);
  }
});

test("PNG exports have the expected dimensions and transparent backgrounds", async () => {
  for (const [variant, width, height] of [
    ["mark", 512, 512],
    ["wordmark", 1600, 320],
    ["logo", 1600, 1120],
  ]) {
    const png = await read(`public/logos/sentinelgrid-${variant}.png`);
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal(metadata.hasAlpha, true);
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0);
    assert.ok(data.some((value, index) => index % 4 === 3 && value === 255));
  }
});

test("favicon and legacy URLs serve the new branding", async () => {
  const mark = await read("public/logos/sentinelgrid-mark.png");
  assert.deepEqual(await read("app/icon.png"), mark);
  assert.deepEqual(await read("public/logos/sentinelgrid_png.png"), mark);
  assert.deepEqual(await read("public/logos/sentinelgrid.png"), await read("public/logos/sentinelgrid-logo.png"));
  const apple = await sharp(await read("app/apple-icon.png")).metadata();
  assert.equal(apple.width, 180);
  assert.equal(apple.height, 180);
});

test("social card matches existing metadata and includes both blue symbol and white lettering", async () => {
  const { data, info } = await sharp(await read("public/og-image.png"))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1200);
  assert.equal(info.height, 630);
  assert.deepEqual([...data.subarray(0, 4)], [4, 12, 23, 255]);
  let blue = 0;
  let white = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 60 && data[index + 2] > 150) blue++;
    if (data[index] > 230 && data[index + 1] > 230 && data[index + 2] > 230) white++;
  }
  assert.ok(blue > 10000);
  assert.ok(white > 3000);
  assert.match((await read("app/layout.tsx")).toString(), /\/og-image\.png/);
});

test("all existing application logo surfaces use the shared component", async () => {
  for (const path of [
    "app/(web)/layout.tsx",
    "app/auth/layout.tsx",
    "app/loading.tsx",
    "app/onboarding/page.tsx",
    "app/onboarding/onboarding-submit.tsx",
    "components/dashboard/dashboard-sidebar.tsx",
  ]) {
    const source = (await read(path)).toString();
    assert.match(source, /<BrandLogo\b/, path);
    assert.doesNotMatch(source, /\/logos\/sentinelgrid_png\.png/, path);
  }
});
