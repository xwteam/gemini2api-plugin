// manifest / 仓库结构守卫：版本与 CHANGELOG 对齐、不新增权限、Chrome 能加载（除 _locales 外无 _ 开头路径）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));

test("manifest 版本与 CHANGELOG 顶部条目一致", () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
  const top = changelog.match(/^## v(\d+\.\d+\.\d+)/m);
  assert.ok(top, "CHANGELOG 里找不到版本标题");
  assert.equal(top[1], manifest.version);
});

test("不新增权限（cookies / tabs / storage / alarms / sidePanel 原本就有，不加 <all_urls>）", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["alarms", "cookies", "sidePanel", "storage", "tabs"]);
  assert.deepEqual(manifest.host_permissions, ["*://*.google.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["*://*/*"]);
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
});

test("除 _locales 外没有以 _ 开头的文件或目录（否则 Chrome 拒绝加载扩展）", () => {
  const bad = [];
  const walk = (dir, rel = "") => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const path = rel + ent.name;
      if (ent.name.startsWith("_") && path !== "_locales") bad.push(path);
      if (ent.isDirectory()) walk(new URL(ent.name + "/", dir), path + "/");
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
});
