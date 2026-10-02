# dsh-plugin-diagram-design

把 [Cathryn Lavery 的 Diagram Design](https://github.com/cathrynlavery/diagram-design) 作为 DeepSeek Harness 插件装进每个会话。上游是面向 Claude Code / Codex / GitHub Copilot / Factory Droid / Pi 的 Agent Skill：**42 种编辑风图表**，输出自包含 HTML + SVG，并且能把已有的 draw.io、Mermaid、Excalidraw 图**重画**进同一套设计系统（不是渲染，是重画）。

本插件只做搬运与接线，不改写上游任何正文。

## 收录内容

一个 skill，`diagram-design`：模型可按任务自动取用，你也能直接唤起。共 **243 个文件 / 3.19 MB**：

| 路径 | 文件数 | 内容 |
|---|---|---|
| `SKILL.md` | 1 | 理念、类型选择、连接件规则、出品前品味检查表 |
| `references/` | 60 | 42 个类型参考，外加语义模式、动画、导入、导出、样式指南 |
| `assets/` | 177 | 模板（minimal / dark / full / motion / terminal）、每种类型的三种变体示例、画廊、87 个图标 |
| `scripts/` | 5 | draw.io / Mermaid / Excalidraw 提取器、`self_check.py` 自检、`export_svg.py` |

## 安装

从 npm 安装（包名 `dsh-plugin-diagram-design`，把 `desktop` 换成你的 profile 名）：

```bash
dsh plugin --profile desktop add dsh-plugin-diagram-design
```

本地开发也可以不发布，把 target 指向本目录的绝对路径即可：

```text
plugin_manager action=install_bundle target="<本目录的绝对路径>"
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-plugin-diagram-design
```

## 用法

直接说人话，模型会自己挑类型、读对应的 type 参考、生成一个 `.html`：

```text
给我画一张这个应用的架构图：前端、后端、数据库、Redis 缓存。
画个象限图，把 Q2 的项目按影响 × 投入摆开。
画一个 bearer 调用的时序图，401 时刷新 token。
把这个 README 里的 Mermaid 重画成适合放进幻灯片的版本。
```

上游的导入命令也建议改成自然语言描述（见下方「未移植的部分」）。

## 与上游的关系

上游以 **git submodule** 引用，不是复制一份进来：

```text
.gitmodules                          # url = https://github.com/cathrynlavery/diagram-design
diagram-design/                      # submodule，只作同步源，插件运行时从不读它
dsh-plugin-diagram-design/           # 本插件
upstream.json                        # 记录同一个 commit + 每个文件的清单与内容摘要
```

`upstream.json` 的 commit 与 submodule 钉住的 commit 是同一个，所以「这批内容出自哪个上游状态」是可验证的事实而非约定。

skill 正文逐字节复制，行尾统一按 **LF** 规范化后再比较与写入（上游自己的 `.gitattributes` 就把 `SKILL.md` 钉成 `eol=lf`，因为它对入口文件有字节上限）。上游仓库里**没有任何路径被排除**——`references/`、`assets/`、`scripts/` 全部照搬。

### 上游更新了怎么办

```bash
git submodule update --remote diagram-design     # 把引用移到上游最新 commit
node dsh-plugin-diagram-design/scripts/sync-skills.mjs   # 重新 vendor 并刷新 upstream.json
git diff --stat -- dsh-plugin-diagram-design/skills      # 先看清正文改了什么
```

校验：

```bash
node dsh-plugin-diagram-design/scripts/sync-skills.mjs --check
```

## 同步脚本的两道门

`scripts/sync-skills.mjs` 以**上游工作树本身**为权威清单（每个 `skills/<name>/SKILL.md` 就是一个 skill；上游 manifest 里没有 skills 列表可供对照），并强制两道校验，任一道不过就拒绝写盘：

1. **frontmatter 合规**：必须有 `name` 与 `description`，`name` 为 kebab-case 且与目录名一致；禁止 `disableModelInvocation` / `modelInvocable` / `userInvocable` 这类驼峰旧键；调用面布尔值必须合法。DSH 校验不过会**静默丢弃**整个 skill 而不报错，所以宁可在这里失败。
2. **引用闭合**：`SKILL.md` 里路由到的每一个 `references/`、`assets/`、`scripts/` 相对目标都必须真的在包内（当前 **59 个目标**）。这一条证明的是「搬过来能用」，而不只是「搬过来了」。

## 设计要点

与它的兄弟插件 `dsh-plugin-matt-skills` 相同：**纯配置 bundle，没有一行插件代码**。`cordis.patch.yml` 插入官方 `@deepseek-ai/dsh-skill-filesystem` 作为行名，并给它一份隔离配置（`providerName: diagram-design`、`includeDefaultRoots: false`、`bundledSkillDir` 指向本包 `skills/`、`watch: false`）。因此：

- 项目与用户级 skill 根目录仍由 Harness 自己那份 provider 实例提供，互不干扰；
- 同名时本地 skill 优先（本插件注册在全局层，项目/用户 skill 在更近的作用域层）；
- skill 目录通过官方 preset 的同款 `createRequire(baseUrl).resolve(...)` 定位，profile 换位置或包上 npm 都不会失效。

## 运行前提（重要）

上游的 skill 正文会把工作交给它自带的 Python 工具，所以：

| 前提 | 说明 |
|---|---|
| **Python 3** | `SKILL.md` 要求跑 `python3 scripts/drawio_extract.py`、`mermaid_extract.py`、`excalidraw_extract.py`、`self_check.py`。本机 3.14.6 实测可用 |
| **PNG 导出需额外装** | `pip install playwright && playwright install chromium`。只出 HTML/SVG 则不需要 |
| **家目录写入会被沙箱拦** | 品牌配置默认存 `~/.diagram-design/profiles/`，项目标记是 `.diagram-design`。当前 `workspace-write` 模式下写家目录需要逐次批准；要么把 profile 放进工作区，要么接受这个摩擦 |

## 未移植的部分

上游为其它宿主附带 6 个斜杠命令（`/import-drawio`、`/import-mermaid`、`/import-excalidraw`、`/export-diagram`、`/profile`、`/doctor`）与 Pi 的 prompt 模板，分别在 `commands/` 与 `prompts/`。这些是宿主专属接线，**没有移植**：DSH 侧用自然语言触发即可，因为 `SKILL.md` 里写明了每个流程。真要在 DSH 里做成 `/` 命令，需要写 `apply(ctx)` 注册 `ctx.commands`——那就不是纯配置 bundle 了（见下一条）。

## 已知限制

- **没有 `apply(ctx)`**：本包是配置型 bundle。按 DSH 官方定义「A bundle is a package whose `package.json` declares `dsh.bundle.patch`」，这是合规形态；运行时执行 `apply` 的是被插入的官方包。
- **description 有 783 字节**（上游为了把 42 种类型都写进触发词）。DSH 渲染 skill 目录时会截断，所以目录里看到的可能不是全文；完整描述始终在 `SKILL.md` 里。
- **上游 frontmatter 的 `license: MIT` 不被 DSH 读取**，会被忽略（同步时会打一条 warning）。许可证信息以本包的 `LICENSE` 与 `NOTICE` 为准。

## 验证状态

已实测：

- `node --check scripts/sync-skills.mjs` 通过；`sync-skills.mjs --check` 幂等。
- 243/243 文件通过 frontmatter 校验与引用闭合校验（59 个包内目标）。
- `plugin_manager install_bundle` → `application: applied`；`Config.listConfigs` 里本行 `patchId: diagram-design`、status `schema`。
- `skill diagram-design` 返回正文，`Base directory` 指向 `dsh-plugin-diagram-design\skills\diagram-design` —— 目录定位与按需加载都通。
- 上游自带工具在本机可跑：`python scripts/self_check.py assets/example-architecture.html` 与 `example-flowchart.html` 均输出 `OK`（exit 0）；`mermaid_extract.py` 对上游 fixture 输出完整 IR（9 节点 / 7 边、类型候选、预算判定、hub 候选）。
- `npm pack --dry-run` → **252 files**，包 603.2 kB / 解包 3.4 MB。顶层的同步工具 `dsh-plugin-diagram-design/scripts/` 不在发布内容里；`skills/diagram-design/scripts/` 是上游内容，必须随包发布。

**未验证**：

- 真正按 `SKILL.md` 流程生成一张图并用浏览器渲染（这需要模型完整走一遍作图流程）。
- PNG 导出链路（本机未装 Playwright + Chromium）。
- `~/.diagram-design/profiles/` 的家目录写入在 `workspace-write` 沙箱下的实际表现。

## 许可

上游 `skills/diagram-design/` 内容版权归 Cathryn Lavery，MIT（© 2025）。本移植部分同为 MIT。详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
