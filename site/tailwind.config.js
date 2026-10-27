/** 官网构建配置：只扫单页 index.html，产出 assets/app.css。
 *  构建命令（在仓库根目录跑）：pnpm exec tailwindcss -c site/tailwind.config.js -i site/src.css -o site/assets/app.css --minify
 */
module.exports = {
  content: ["./site/index.html"],
  theme: {
    extend: {
      colors: {
        ink: "#151517",
        paper: "#fbfbf9",
        line: "#e7e6e1",
        muted: "#6c6b66",
        accent: "#1f5eff",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: ['"SF Mono"', "ui-monospace", "Consolas", '"Cascadia Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
