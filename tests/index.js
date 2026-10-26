// tests/index.js —— 让 `node --test tests/` 能跑到全部测试。
//
// 本机 Node 24 实测：`node --test tests/` 不会递归找 *.test.mjs，而是把目录当成模块入口加载
// （按 CommonJS 规则解析到 tests/index.js）；没有这个文件就直接 MODULE_NOT_FOUND。
// 这里把同目录的 *.test.mjs 按文件名顺序逐个导入，于是三种写法都能跑：
//   node --test tests/            → 经过本文件，所有测试在同一进程里跑
//   node --test                   → 默认匹配 **/*.test.mjs，每个文件单独一个进程（不匹配本文件）
//   node --test tests/*.test.mjs  → 同上
// 因为第一种写法共享进程，测试文件之间不能依赖进程隔离（全局 stub 要在用例结束时还原）。
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const name of readdirSync(here).filter((n) => n.endsWith(".test.mjs")).sort()) {
  await import(pathToFileURL(join(here, name)).href);
}
