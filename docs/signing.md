# 代码签名路线（CliFleet / U-King 通用）

> 结论：**能免费，但两条路都有门槛；而且其中一条特别适合你。**
> 现状：CliFleet 3★、U-King 1★ —— 都还没到门槛，所以现在申请会被拒。
> 这份文档是"达标就点按钮"的清单，不是现在就能提交的申请表。

---

## 一、四条路对比

| 渠道 | 价格 | 硬门槛 | 证书归属 | 适合谁 |
|---|---|---|---|---|
| **不签**（现状） | 0 | — | — | 用户能接受 SmartScreen 提示 + 会核对 SHA256 |
| **Certum 开源证书** | €329/年；**GitHub ≥1k star 可免费** | 中国国籍申请人、GitHub 托管、≥1 个 Release | **你自己**（发布者显示你的名字） | 目标明确、愿意把 star 做上去的开源项目 |
| **SignPath Foundation** | 免费 | OSI 许可、无商业双许可、无私有组件、活跃维护、**可验证声誉**、CI 可验证构建、每版人工审批、团队三角色、MFA | SignPath Foundation（他们充当发布者） | 有社区声誉的老项目 |
| **Azure Trusted Signing** | $9.99/月 | 地区（美/加/欧等）与身份验证限制，部分场景还要 Entra 授权 | 你 | 有海外主体的团队 |
| 商业 OV/EV | $200–600/年 | 企业主体身份核验 | 你 | 公司产品，要最快消警告 |

来源：[Certum 开源证书（中国区商店，€329，1k star 免费条款）](http://certumcodesign.cn/shop/product/open-source-code-signing-cloud/)、[SignPath Foundation 条款](https://signpath.org/terms)。

**关键差异一句话**：SignPath 是"借他们的证书签名，他们当发布者，看重声誉"；Certum 是"用你自己的证书签，看重 star 数"。**你两个项目都该奔 Certum 那条**——1k star 是能靠推广达成的事，而 SignPath 的"可验证声誉"是没法量化的软门槛。

---

## 二、申请前清单（两个项目都适用）

按顺序做，做完就能提交，不用返工：

- [ ] **GitHub MFA**：申请人和仓库成员都开（SignPath 硬性要求；Certum 也建议）
- [ ] **许可证**：OSI 认可。CliFleet = MIT ✅；U-King = Apache-2.0 ✅
- [ ] **无私有/商业组件**：公开仓库里不能有闭源代码（尤其"商业版才有的功能"、"Key/设备指纹/充值"这类）。SignPath 会直接拒；Certum 只要求"项目开源"，但同一份代码干净对两边都好
- [ ] **至少一个 Release**：CliFleet ✅（v0.6.0）；U-King 需要一个带产物的 Release
- [ ] **下载页/README 写清功能**：SignPath 要求"documented on download page"
- [ ] **构建在 CI、可复现**：CliFleet ✅（`.github/workflows/release.yml`，三平台原生构建）；U-King 需同样具备
- [ ] **README 加 "Code signing policy" 段**（SignPath 要求，措辞固定）：
  ```md
  ## Code signing policy
  Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).
  - Committers and reviewers: <GitHub 团队/协作者链接>
  - Approvers: <GitHub Owners 链接>
  - Privacy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
  ```
  > 这段**只在真正提交申请后才加进 README**，否则等于对外承诺了没拿到的东西。

---

## 三、CliFleet 怎么做

1. **先推广到 1k star**（这是 PROMOTION.md 那套动作的直接 KPI）。
2. 达标后申请 Certum 开源证书（€329 → 免费），拿到的是**你自己的证书**，之后所有 release 都能本地/CI 签。
3. 想提前试水：现在就可以投 SignPath，被拒成本为零，但别抱期望——仓库太新、下载量个位数。
4. 签名落地方式（拿到证书后）：
   - Certum 云签名（SimplySign）+ CI：`jsign` 或 `signtool` 走云签名接口
   - 只签 Windows 产物；macOS 仍走 $99 公证或干脆不签（README 已写明未签名）
5. 每份 Certum 云证书每月限 5000 次签名——对个人项目完全够。

---

## 四、U-King 怎么做

**能签，但有两个前置问题要先解决：**

1. **代码纯净度**：U-King 是「开源核心 + 商业云服务（虾盘云 Key / 充值 / 设备指纹）」的形态。公开仓库里如果还留有这些逻辑，SignPath 会拒（"no proprietary code / no commercial dual-licensing"）。**先把公开仓里商业相关代码剥离干净**（你之前做过一轮"去商业化"，需要复核有没有残留）。
2. **需要一个真正的开源 Release**：带产物、带下载说明，而不是只推代码。

满足后和 CliFleet 走同一条路：**1k star → Certum 免费证书**。U-King 现在 1★，先别急着申请。

---

## 五、别指望签名解决一切

- **签名 ≠ 立刻没有提示**：新证书同样要从零攒 SmartScreen 声誉，只是从"未知发布者"变成"已知但陌生"。下载量上去才会彻底安静。
- **现在就能做的廉价信任建设**（已在做）：发布 `SHA256SUMS.txt`、README 写清"源码可自建"、CI 公开可查。
- 真要砸钱买体验：商业 OV 证书（约 $200–300/年）能立刻消掉大部分提示，但个人项目不值这个价。

---

## 六、时间表建议

| 时间 | 动作 |
|---|---|
| 现在 | 两个项目跑一遍上面清单；U-King 复核商业代码剥离 |
| 推广期 | 冲 1k star（CliFleet 优先，产品更聚焦、故事更好讲） |
| 达标当天 | 提交 Certum 免费申请（中国国籍 + GitHub + Release，材料简单） |
| 拿到证书后 | 在 release.yml 里加签名步骤，重发 v0.7.0 |
