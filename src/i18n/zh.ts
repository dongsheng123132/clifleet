/**
 * 中文字典 —— `{英文原文: 中文译文}`。
 * 键是组件里 `t("...")` 的英文原文（英文即 key）；未收录的串回退英文，可增量补。
 */

export const ZH: Record<string, string> = {
  // —— 主区 / 空态引导（OpenCodex）——
  "Open a folder to get started": "打开一个文件夹，开始干活",
  "Pick a folder — it becomes a project, and the main area is a real terminal\nwhere you can run claude / codex / any CLI.":
    "选一个文件夹作为项目 —— 主区是真实终端，直接跑 claude / codex 等任意 CLI。",
  "Select a project folder": "选择项目文件夹",

  // —— 会话栏（SessionList）——
  "Projects": "项目",
  "Collapse project bar (give the space to the terminal)": "收起项目栏（把空间让给终端）",
  "Expand project bar": "展开项目栏",
  "Open folder…": "打开文件夹…",
  "No projects yet.": "还没有项目。",
  'Click "Open folder…" to add one.': '点「打开文件夹…」添加一个。',
  "Double-click to rename": "双击可重命名",
  "Close project (ends its terminal sessions; the folder on disk is untouched)":
    "关闭项目（会结束其中的终端会话；磁盘上的文件夹不动）",
  "OpenCodex version": "OpenCodex 版本",

  // —— 终端面板（TermPanel）——
  "Click again to confirm close": "再点一次确认关闭",
  "Close this terminal": "关闭此终端",
  "New terminal tab": "新建终端标签",
  "Decrease font size (Ctrl -)": "减小字体（Ctrl -）",
  "Increase font size (Ctrl +)": "增大字体（Ctrl +）",
  "Current font size": "当前字号",
  "Reset terminal (Ctrl+Shift+R): clears mouse garbage, screen artifacts, and lost-cursor states left behind when claude/codex-style TUIs crash":
    "重置终端（Ctrl+Shift+R）：清掉 claude/codex 这类 TUI 崩溃后残留的鼠标垃圾、屏幕残影和光标丢失",
  "Run in terminal: {cmd}": "在终端中运行: {cmd}",
  "Run in terminal: {cmd} (right-click to remove)": "在终端中运行: {cmd}（右键可删除）",
  "Click again to remove this quick command": "再点一次确认删除该快捷词",
  "Add a quick command": "添加快捷词",
  "Name (e.g. claude)": "名字（如 claude）",
  "Command (e.g. claude --continue)": "命令（如 claude --continue）",
  "Save": "保存",
  "Cancel": "取消",

  // —— 项目顶栏（ProjectView）——
  "Click to copy the folder path": "点击复制文件夹路径",
  "Copied!": "已复制！",
  "Open folder in file explorer": "在资源管理器中打开文件夹",
};
