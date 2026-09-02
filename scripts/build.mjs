import * as esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const outfileBootstrap = "theme/assets/disclosure-bootstrap.js";
const outfileUi = "theme/assets/disclosure-ui.js";

async function build() {
  await esbuild.build({
    entryPoints: ["src/bootstrap.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: outfileBootstrap,
    legalComments: "none",
  });
  await esbuild.build({
    entryPoints: ["src/ui.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: outfileUi,
    legalComments: "none",
  });
}

const beforeBootstrap = await readFile(outfileBootstrap, "utf8").catch(() => "");
const beforeUi = await readFile(outfileUi, "utf8").catch(() => "");
await build();
if (process.argv.includes("--check")) {
  const afterBootstrap = await readFile(outfileBootstrap, "utf8");
  const afterUi = await readFile(outfileUi, "utf8");
  if (afterBootstrap !== beforeBootstrap || afterUi !== beforeUi) {
    await writeFile(outfileBootstrap, beforeBootstrap);
    await writeFile(outfileUi, beforeUi);
    console.error("Built assets differ from the committed files. Run npm run build.");
    process.exit(1);
  }
}
