#!/usr/bin/env node
// Читает исходник одного экрана .wireloom из stdin, пишет SVG в stdout.
// Один вызов — один экран (ограничение самого wireloom: "exactly one window
// per source"); раскадровку из нескольких экранов собирает вызывающий питон.
import wireloom from "wireloom";

let source = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) source += chunk;

try {
  const { svg } = await wireloom.render("frame", source);
  process.stdout.write(svg);
} catch (err) {
  process.stderr.write(String(err && err.message ? err.message : err));
  process.exit(1);
}
