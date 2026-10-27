# CliFleet 官网（site/）

单页、双语（EN / 中文）、纯静态，部署在 Vercel。没有框架、没有运行时依赖。

## 结构

```
site/
├── index.html          # 整个页面（内容 + 内联 style + 语言切换脚本）
├── src.css             # Tailwind 输入
├── tailwind.config.js  # 只扫 index.html，主题色在此
└── assets/
    ├── app.css         # Tailwind 产物（已提交，Vercel 不需要构建）
    └── banner.png      # 首屏配图（等于 docs/banner.png）
```

## 改完文案后重新生成 CSS

```bash
# 在仓库根目录跑
pnpm exec tailwindcss -c site/tailwind.config.js -i site/src.css -o site/assets/app.css --minify
```

只改 HTML 里已有的 class 组合时可以不重建；**新增/改动 class 名必须重建**，否则样式不生效。

## 本地预览

```bash
# 任选其一
pnpm exec serve site            # 或
python -m http.server 4173 --directory site
```

打开 `http://127.0.0.1:4173/`；语言也能用 query 指定：`?lang=en` / `?lang=zh`。

## 部署（Vercel）

```bash
vercel login                        # 浏览器点一下授权（只需一次）
vercel deploy site --prod --yes     # 从仓库根目录跑，发布到生产环境
```

首次部署会让你选 scope / 项目名（建议 `clifleet`），之后每次发版重跑第二条即可。
