# CliFleet 成熟度清单（0.6.1 → 1.0）

> 这份文档回答一个问题：**「什么条件下可以对外说这是一个成熟工具」**。
> 判据只认可验证的证据，不认「应该没问题」。最后核对：2026-11-09。

## 一句话现状

功能够用了，**成熟度卡在「信任」和「回归」两件事**：首次安装被系统拦、升级靠手动、没有自动回归跑道。
这三件不解决，功能再好也只能算「好用的玩具」。

---

## 一、P0：发布信任（必须做完才能叫成熟）

| # | 项 | 现状 | 判据（做到什么才算过） | 成本 |
|---|---|---|---|---|
| 1 | **macOS 公证** | `tauri.conf.json` 里 `signingIdentity: "-"`，只 ad-hoc 签名，**未公证**；首次启动要「仍要打开」 | DMG 上传 notarytool 成功、staple 后离线首次启动无 Gatekeeper 弹窗；`spctl -a -vvv /Applications/CliFleet.app` 返回 `accepted` | Apple Developer $99/年（账号已有），CI 加 3 步 |
| 2 | **Windows 签名** | 未签，SmartScreen 报「未知发布者」 | 装包时显示发布者名称；`Get-AuthenticodeSignature` 为 Valid | 见 `docs/signing.md`：Certum 开源证书需 GitHub ≥1k star 免费，否则 €329/年 / 商业 OV $200–300/年 |
| 3 | **CI 覆盖 main** | 修好了：原 `release.yml` 的 `push.branches` 只有 `feat/minimal-terminal`，**推 main 不跑构建**（等于主干没有闸门） | 推 main 后 Actions 里 validate + 4 平台 build 全绿 | 0（本次已改） |
| 4 | **Release 可复现** | ✅ 已有：三版本号校验、`SHA256SUMS.txt`、6 个产物齐全才发、CI 公开 | 保持即可 | 0 |

### 签名/公证的落地顺序（不要跳步）

1. 先在 CI 里把 macOS 的 `codesign`（Developer ID Application）+ `notarytool submit --wait` + `stapler staple` 三步接上，密钥走 GitHub Secrets（`APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_PASSWORD` / `APPLE_CERTIFICATE` + 密码）。账号参数以项目 `AGENTS.md` / iOS 技能的 `fixed-facts.md` 为准，**不要在这份文档里复述**（会过期）。
2. Windows 先不花钱：`SHA256SUMS.txt` + README 的「源码可自建」已经在做；star 到 1k 后申请 Certum 免费证书，再在 release.yml 加 `jsign`/`signtool` 步骤。
3. 两者都完成前，README 和官网必须**如实写**「macOS 未公证 / Windows 未签名 + 首次启动怎么放行」——隐瞒比提示更伤信任。

---

## 二、P1：升级路径（用户留不留得住）

| 项 | 现状 | 建议 |
|---|---|---|
| 自动更新 | **无**。用户要自己重跑安装脚本 | 装 `tauri-plugin-updater`，端点指向 `https://u-claw.org.cn/clifleet/latest.json`（国内源，已有备案域名），发布流程里同步生成 `latest.json` + 签名 |
| 更新签名 | 无 | updater 的 minisign 私钥必须离线保管，公钥写进 `tauri.conf.json`；私钥绝不能进仓库 |
| 绿色版 | U 盘版**不能**自动更新（会破坏「不落痕迹」承诺） | 绿色版只提示「有新版本」并给下载链接，不自动覆写 exe |
| 版本节奏 | 0.6.1，随手发 | 固定：`0.x.y` 小改随时发，`0.x.0` 必须带 CHANGELOG + 3 平台实机冒烟 |

> 顺序建议：**先做「检查新版本」提示（纯读 JSON，零风险），再做自动更新**。前者一天能落地，后者要管私钥。

---

## 三、P1：自己每天用不硌手（本次已实现）

| 体验 | 之前 | 现在 | 证据 |
|---|---|---|---|
| 后台标签在等我 | 完全不知道 | 新输出 → 蓝点；BEL 响铃 → 红点 + 窗口失焦时系统注意力（dock 跳 / 任务栏闪）；点过去即清 | `useTermGroup.ts` 的 `markUnread`/`markBell`/`clearUnread` |
| 重启后标签全丢 | 每次重开 1 个空终端 | 按项目目录记住标签数与激活位置（最多 8 个），重开恢复；把最后一个标签关掉 = 明确「下次干净开始」，删记录 | `clifleet.term.tabs.v1` localStorage |
| 快捷键 | 只有字号 / 软重置 | mac：⌘T / ⌘W / ⌘⇧[ ] / ⌘1–9；Win/Linux：Ctrl+Shift+T/W、Ctrl+Tab、Ctrl+1–9；行内输入框里主动让位 | `keymap.ts::appKeyAction` + 7 个单测 |
| 中英混排重叠 | 会审定位为字体 fallback 度量问题，已修 | 具名半角 + CJK fallback 字体栈 | 上次会审（`AGENTS.md`） |
| 剪贴板临时图膨胀 | 从不清理 | 每次粘贴顺带清 >24h 旧图 | 同上 |

**还没做、但别急着做**：分屏。cmux 的核心卖点之一是分屏，但它引出焦点、尺寸、PTY resize 三倍复杂度；先把「标签 + 未读提醒」用一周，确认真的需要并排看两个输出，再做。

---

## 四、P2：回归跑道（防止改一处坏三处）

现状只有 `node --test test/*.test.mjs`（7 个纯键盘函数用例）+ CI 里 `continue-on-error` 的无头自检。**这两条都不覆盖 Rust**。

按性价比排序补齐：

- [ ] **CI 里跑 `cargo test`**（现在只在本地跑过）。`src-tauri/src/term.rs` 的 `apply_child_env` / `normalize_no_proxy` 已有单测，CI 不跑等于没有。
- [ ] CI 的 headless selftest 去掉 `continue-on-error`（或至少分成「必须过」与「平台相关可跳过」两类），否则红了你也会发版。
- [ ] 每次发版前的一页纸冒烟清单：装包 → 首次启动 → 开两个标签跑两个 CLI → 切项目再切回（PTY 仍在）→ 关闭标签无孤儿进程 → 拷贝大文件粘贴 → 中英混排截图。
- [ ] 崩溃可观测：`~/.clifleet/logs/clifleet.jsonl` 已有本地日志，但**默认不上传**（这是承诺，别改）；加一个「导出诊断包」按钮，用户报 bug 时手动给。

---

## 五、P2：定位边界（不做的事要写死）

- 不做编排（worktree / 任务队列 / 自动交接）：这条赛道 2026 年在洗牌（Bloop 关停、Crystal 停更、Conductor 并入 Meta），3MB 的壳去拼功能必输。
- 不做云、不做手机端、不内置浏览器、不内置 Key、不改用户 CLI 配置。
- 对比页 `/compare` 里**明确列出自己输的地方**（未公证、0.x、无编排）——这比自夸更能建立信任。

---

## 六、1.0 的验收定义

同时满足下面 6 条才发 `v1.0.0`：

1. macOS DMG 公证 + staple 过，Windows 装包不再报「未知发布者」；
2. 安装版能自动检查并升级（绿色版仅提示）；
3. 推 main 的 CI 全绿，含 `pnpm build` / `pnpm test` / `cargo test`；
4. 三平台各有一份真机冒烟记录（不是 CI 绿）；
5. CHANGELOG 覆盖全部公开版本，官网 `/compare`、`/changelog` 在线且事实核对过；
6. 连续自用两周无「打断我正在打字」的回归（焦点、PTY 保活、未读误报）。

---

## 附：本次改动清单（相对 0.6.1）

- `src/clifleet/term/useTermGroup.ts` — 未读/响铃、标签恢复、焦点与误报修正
- `src/clifleet/term/keymap.ts` — `appKeyAction`
- `src/clifleet/panels/TermPanel.tsx` — 未读点、快捷键监听
- `src/i18n/zh.ts` — 2 条中文
- `test/keymap.test.mjs` — 3 个平台用例（共 7 个）
- `.github/workflows/release.yml` — main 也跑 CI
- `site/` — JSON-LD / canonical / og / hreflang / twitter card、`/compare`、`robots.txt`、`sitemap.xml`
- `docs/MATURITY.md`（本文）、`docs/PROMOTION.md`（首发推广）
