// Writes .br and .gz siblings for compressible files in dist/, so the
// McAdminWorker (tower-http ServeDir with precompressed_br/gzip) can serve
// compressed assets without compressing them on every request.
//
// Usage: bun scripts/compress.ts [dir]   (default: dist)

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const root = process.argv[2] ?? "dist";
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|map|webmanifest|xml)$/i;
// Tiny files don't benefit; ServeDir falls back to the original if no sibling exists.
const MIN_BYTES = 1024;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let files = 0;
let before = 0;
let afterBr = 0;

for await (const path of walk(root)) {
  if (!COMPRESSIBLE.test(path)) continue;
  if ((await stat(path)).size < MIN_BYTES) continue;

  const data = await readFile(path);
  const br = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  const gz = gzipSync(data, { level: 9 });
  await writeFile(`${path}.br`, br);
  await writeFile(`${path}.gz`, gz);

  files += 1;
  before += data.length;
  afterBr += br.length;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
console.log(`compressed ${files} files in ${root}/: ${kb(before)} -> ${kb(afterBr)} (brotli)`);
