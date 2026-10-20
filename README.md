# CL 工作台

> 一个跑在自己电脑上的「历史记录保险箱」。终端命令、AI 会话、工作笔记都实时落盘，**cmd 窗口崩溃也不会丢**。

你有没有过这种经历：命令行窗口敲了半天，一不小心关掉了，历史记录全没了；或者跟 AI 聊到一半，窗口一崩，上下文全丢。这个工具就是为了解决这件事——所有东西**边做边写进磁盘**，崩了也能翻回来。

---

## 它长什么样

浏览器打开 `http://127.0.0.1:4737`，六个页面：

| 页面 | 干什么的 |
|---|---|
| **总览** | 一眼看到今天有多少条命令、几个会话 |
| **终端历史** | 每次命令的时间、目录、成功失败，输出全文可搜 |
| **AI 对话** | 自动读取 Claude Code 的会话存档（只读展示） |
| **对话** | 在网页里直接跟 Claude 说话，刷新不丢、能接着上文聊 |
| **工作笔记** | Markdown 编辑 + 实时预览，`Ctrl + S` 保存 |
| **搜索** | `Ctrl + K` 全局搜命令、笔记、AI 会话 |

---

## 怎么跑起来

**需要**：Windows 10 / 11 + [Node.js](https://nodejs.org/) 18 或更高。

```bash
# 第一步：装依赖（只有一个，很小）
npm install

# 第二步：双击「打开工作台.cmd」
```

就这样。`.cmd` 会自己检查端口、后台启动服务、打开浏览器，不用你敲任何命令。

**停止**：双击「停止工作台.cmd」。

### 四个 .cmd 文件分别是

| 文件 | 用途 |
|---|---|
| `打开工作台.cmd` | 启动服务并打开浏览器（日常就用这个） |
| `打开记录终端.cmd` | 开一个会**实时记录**的终端，以后工作都在这里做 |
| `停止工作台.cmd` | 关掉后台服务 |
| `创建桌面快捷方式.cmd` | 在桌面放个快捷方式，图省事 |

---

## 防丢是怎么做到的

四层保险，任何一层崩了都还有下一层：

1. **命令记录**：每执行完一条命令，立刻追加写入 JSONL 文件（追加写不会破坏已有内容）。
2. **输入历史**：PowerShell 的 `SaveIncrementally`，逐条保存，崩了之后按上方向键还能翻出来。
3. **完整输出**：`Start-Transcript` 持续把屏幕输出写进日志文件。
4. **会话元数据**：正常退出补写结束时间；崩溃时留空，界面会明确标出「异常结束」，不会假装一切正常。

最多丢最后一行。

---

## 关于「对话」页（可选功能）

这一页会让网页直接调用本机的 [Claude Code](https://claude.com/claude-code) 命令行。

- **装了** Claude Code：这一页能用，多轮对话靠 `--resume` 接上下文。
- **没装**：这一页会显示一句「无法启动 claude」的提示，**其他五个页面完全不受影响**。

安全上做了两层防护：

- **来源校验**：请求的 `Host` 必须是 `127.0.0.1` 加端口（挡 DNS rebinding），`Origin` 必须存在且端口匹配（挡其他网站偷偷发请求）。不带 Origin 或来源不对，一律 403。
- **两档权限**：网页上可选「只读」模式，此时 Claude 只能看不能改；另一档权限更高，**用它等于让 AI 直接操作你的电脑，请自己判断风险**。

---

## 数据存在哪

全部在 `data/` 文件夹里，纯文本，随时可以整个复制走当备份：

```
data/
  terminals/   *.jsonl（命令）  *.log（输出）  *.meta.json（会话信息）
  psreadline/  记录终端专用的输入历史
  notes.json   工作笔记
```

> ⚠️ `data/` 已被 `.gitignore` 排除，**不会**上传到仓库——里面会有你的本机路径和命令记录。

---

## 一些说明

- **只支持 Windows**：记录终端和几个启动脚本用到了 PowerShell 的特性，macOS / Linux 上用不了。
- **只监听本机**：服务绑定 `127.0.0.1`，同一局域网里的其他设备也访问不到，别有心理负担。
- **端口冲突**：默认 4737。被占了可以用 `set PORT=5000 && node server.js` 换一个。
- **改代码后**：改了 `server.js` 要重启服务；只改 `public/` 里的页面文件，浏览器 `Ctrl + F5` 刷新即可。
- **技术栈**：纯 Node.js 原生 `http` 模块，没有框架，唯一的依赖是 `marked`（渲染 Markdown）。

---

## English quick start

A local-first workbench that keeps your terminal history, AI sessions and notes on disk **as you work**, so a crashed console window never loses anything.

**Requirements:** Windows 10/11, Node.js 18+.

```bash
npm install          # only dependency: marked
```

Then double-click **`打开工作台.cmd`** ("Open workbench") — it starts the server and opens `http://127.0.0.1:4737` for you.

The UI is in Chinese. Windows-only: the recording terminal relies on PowerShell features that have no macOS/Linux equivalent. Your data lives in `data/` (git-ignored) and never leaves your machine — the server binds to `127.0.0.1`.

---

## License

ISC