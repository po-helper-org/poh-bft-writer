#!/usr/bin/env node
/* Проверка блоков схем тем же кодом, что и редактор в карточке процесса (diagram_kit.js).
   Нужен тесту совпадения с diagram_dsl.py: node diagram-check.js УЧАСТНИКИ.json БЛОК.txt… → JSON по строке на файл. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = vm.createContext({});
for (const f of ["page_kit.js", "diagram_kit.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8") + "\n;globalThis.BPK=BPK;" + (f === "diagram_kit.js" ? "globalThis.BPD=BPD;" : ""), ctx);
const [partsFile, ...files] = process.argv.slice(2);
const parts = partsFile && partsFile !== "-" ? JSON.parse(fs.readFileSync(partsFile, "utf8")) : {};
for (const f of files) {
  const res = ctx.BPD.checkText(fs.readFileSync(f, "utf8"), parts);
  if (res.kind === "seq") ctx.BPD.seqSVG(res, parts, "t");
  if (res.kind === "idef0") { ctx.BPD.idefSVG(res, { color: "#333", title: "t" }); if (res.children.length) ctx.BPD.idefDecompSVG(res, { color: "#333" }) }
  process.stdout.write(JSON.stringify(res) + "\n");
}
