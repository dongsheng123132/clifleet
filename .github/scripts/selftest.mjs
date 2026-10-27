// 构建后的无头自检：只调 release 产物的 --term-test / --term-kill-test（不起 GUI），
// 任一项不符合预期 → 退出码 1。CI 每个 PR 在 Windows / macOS arm64 + Intel / Linux 上跑；
// 本地 `pnpm tauri build` 之后也能跑：node .github/scripts/selftest.mjs
// （CLIFLEET_BIN 可指定别的产物路径；macOS 上要求指向 .app 内的可执行文件。）
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const platform = process.platform; // win32 | darwin | linux
const rel = "src-tauri/target/release";
let failed = 0;

const section = (t) => console.log(`\n===== ${t} =====`);
const tail = (s) => s.trim().slice(-400);
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`   ↳ ${detail.replace(/\n/g, "\n     ")}`);
  }
}
function run(cmd, args, { env = {}, unset = [], timeout = 60_000 } = {}) {
  const e = { ...process.env, ...env };
  for (const k of unset) delete e[k];
  const r = spawnSync(cmd, args, { env: e, encoding: "utf8", timeout });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

// ---------- 找产物 ----------
let app = null;
let bin = process.env.CLIFLEET_BIN;
if (!bin && platform === "darwin") {
  const dir = join(rel, "bundle/macos");
  const name = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".app")) : undefined;
  if (name) {
    app = join(dir, name);
    const exeDir = join(app, "Contents/MacOS");
    bin = join(exeDir, readdirSync(exeDir)[0]);
  } else {
    // --bundles dmg 只出 dmg 时 bundle/macos 可能不存在，退回裸二进制
    bin = join(rel, "clifleet");
  }
} else if (!bin) {
  bin = join(rel, platform === "win32" ? "clifleet.exe" : "clifleet");
}
if (platform === "darwin" && bin && !app) {
  const m = bin.match(/^(.*\.app)\/Contents\/MacOS\//);
  app = m ? m[1] : null;
}
if (!bin || !existsSync(bin)) {
  console.error(`找不到产物 ${bin ?? rel}（先 pnpm tauri build）`);
  process.exit(1);
}
console.log(`产物: ${bin}`);

// ---------- 1. PTY + PATH ----------
section("PTY + PATH（--term-test \"node --version\"）");
let r = run(bin, ["--term-test", "node --version"]);
console.log(tail(r.out));
check("终端里能跑 node", r.code === 0 && /v\d+\.\d+/.test(r.out), `退出码 ${r.code}`);

// ---------- 2. 关会话杀整棵进程树 ----------
section("关会话杀整棵进程树（--term-kill-test）");
r = run(bin, ["--term-kill-test"], { timeout: 120_000 });
console.log(r.out.trim());
check("kill-test B 组 PASS（退出码 0）", r.code === 0, `退出码 ${r.code} ${r.error ?? ""}`);
if (platform !== "win32") {
  const left = run("pgrep", ["-lf", "sleep 100[12]"]);
  check("没有残留的测试进程（sleep 1001/1002）", left.code !== 0, left.out.trim());
}

// ---------- 3. unix：SHELL 回落 ----------
if (platform !== "win32") {
  section("SHELL 回落（$SHELL → passwd 登录 shell → /bin/sh）");
  const probe = 'echo "CF_ARGV0=[$0]"';
  const cases = [
    ["正常", {}],
    ["未设", { unset: ["SHELL"] }],
    ["指向不存在的路径", { env: { SHELL: "/nonexistent" } }],
  ];
  for (const [label, opt] of cases) {
    r = run(bin, ["--term-test", probe], opt);
    const m = r.out.match(/CF_ARGV0=\[(-[^\]\s]+)\]/); // argv0 带 "-" 前缀 = login shell
    check(`SHELL ${label} → 起了 login shell${m ? `（${m[1]}）` : ""}`, r.code === 0 && !!m, tail(r.out));
  }
}

// ---------- 4. macOS：签名 + UTF-8 locale ----------
if (platform === "darwin") {
  section("macOS 签名");
  const pick = (s) =>
    s.split("\n").filter((l) => /^(Signature|CodeDirectory|Sealed|Identifier|TeamIdentifier)|flags=/.test(l)).join("\n");
  const raw = join(rel, "clifleet");
  if (existsSync(raw)) console.log(`对照 · cargo 直出的裸二进制:\n${pick(run("codesign", ["-dv", "--verbose=4", raw]).out)}`);
  if (!app) {
    check("找到 .app", false, "CLIFLEET_BIN 不在 .app 里，跳过签名与 Finder 式启动");
  } else {
    const sig = run("codesign", ["-dv", "--verbose=4", app]);
    console.log(`.app:\n${pick(sig.out)}`);
    check(".app 是 ad-hoc 签名", /Signature=adhoc/.test(sig.out), tail(sig.out));
    check(".app 资源已封印（不只是 linker-signed）", /Sealed Resources version=/.test(sig.out) && !/linker-signed/.test(sig.out));
    const v = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    console.log(v.out.trim());
    check("codesign --verify --deep --strict 通过", v.code === 0);
  }

  section("macOS UTF-8 locale");
  const dir = "/tmp/cf测试 目录";
  mkdirSync(dir, { recursive: true });
  const noLocale = { unset: ["LANG", "LC_ALL", "LC_CTYPE"] };
  const probe = 'echo "CF_LANG=[$LANG]"; ls -d /tmp/cf测试*';
  const utf8 = /CF_LANG=\[[A-Za-z_]+\.UTF-8\]/;
  // 对照：不经 CliFleet 的裸 login zsh。若 profile 自己设了 LANG，下面两项就测不出 CliFleet 的效果
  const ctl = run("/bin/zsh", ["-lc", 'echo "CF_LANG=[$LANG]"'], noLocale);
  const profileSetsLang = !/CF_LANG=\[\]/.test(ctl.out);
  console.log(`对照 · 裸 zsh（去掉 LANG/LC_*）: ${ctl.out.trim()}`);
  if (profileSetsLang) {
    console.log("⚠️ 本机 shell profile 自己设了 LANG，跳过「补 LANG」与「不覆盖用户 LANG」两项");
  } else {
    r = run(bin, ["--term-test", probe], noLocale);
    console.log(tail(r.out));
    check("去掉 LANG/LC_* 后补上 UTF-8 LANG", utf8.test(r.out));
    check("中文目录名原样显示", r.out.includes("cf测试 目录"));
    r = run(bin, ["--term-test", 'echo "CF_LANG=[$LANG]"'], { env: { LANG: "fr_FR.UTF-8" } });
    check("用户自己设的 LANG 原样不动", r.out.includes("CF_LANG=[fr_FR.UTF-8]"), tail(r.out));
  }

  if (app) {
    section("LaunchServices 启动（等价 Finder 双击，环境由 launchd 给）");
    const outF = "/tmp/cf-open.out";
    const errF = "/tmp/cf-open.err";
    rmSync(outF, { force: true });
    rmSync(errF, { force: true });
    const o = run("open", ["-W", "-n", "--stdout", outF, "--stderr", errF, app, "--args", "--term-test", probe]);
    const got = existsSync(outF) ? readFileSync(outF, "utf8") : "";
    if (o.code !== 0 || !got) {
      console.log(`⚠️ open 没跑起来（无图形会话时正常），跳过：退出码 ${o.code} ${tail(o.out)} ${o.error ?? ""}`);
    } else {
      console.log(tail(got));
      check("Finder 式启动拿到 UTF-8 LANG", utf8.test(got));
      check("Finder 式启动中文目录名原样显示", got.includes("cf测试 目录"));
    }
    rmSync(outF, { force: true });
    rmSync(errF, { force: true });
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${failed ? `❌ ${failed} 项不符合预期` : "✅ 全部通过"}`);
process.exit(failed ? 1 : 0);
