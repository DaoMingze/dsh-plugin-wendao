# dsh-plugin-matt-skills

把 [Matt Pocock 的 Skills For Real Engineers](https://github.com/mattpocock/skills) 作为 DeepSeek Harness 插件装进每个会话。上游原意是「小而可组合、配合任意模型、服务真实工程而非 vibe coding」，本插件只做搬运与接线，不改写任何 skill 正文。

## 装了什么

27 个 skill，逐个目录打包，按上游 `plugin.json` 的**推广集**收录（engineering 20 + productivity 7）。上游把 skill 分成两类，本插件原样保留：

**模型可自动调用（11 个）**

| Skill | 用途 |
| --- | --- |
| `tdd` | 红-绿-重构循环，一次一个纵向切片 |
| `code-review` | 从固定基点起审查 diff：规范轴 + 规格轴，两路并行子代理 |
| `codebase-design` | 深模块设计词汇：小接口、干净接缝、可测 |
| `domain-modeling` | 磨锋利领域模型，就地更新 `GLOSSARY.md` 与 ADR |
| `diagnosing-bugs` | 难 bug 与性能回退的纪律化诊断闭环 |
| `prototype` | 一次性原型回答设计问题（单页 HTML 或多种 UI 变体） |
| `research` | 对着高可信一手来源做调研，产出带引用的 Markdown |
| `pr` | PR 正文该长什么样：摘要可视化 + 前后证据 + 合并风险判定 |
| `wizard` | 生成交互式向导脚本，把只有人能做的步骤走完 |
| `grilling` | 拷问式访谈原语，被下面多个流程复用 |
| `writing-for-agents` | 写给 agent 看的文档：skill、AGENTS.md、指针文档 |

**仅由人调用（16 个）**

| Skill | 用途 |
| --- | --- |
| `ask-matt` | 路由器：不确定该用哪个 skill 时先问它 |
| `grill-me` / `grill-with-docs` | 开工前把你的方案问到没有悬空分支（后者顺带建领域模型） |
| `to-spec` / `to-tickets` | 把对话压成规格、再拆成带阻塞边的工单 |
| `implement` / `implement-spec` | 按规格或工单集动手实现，收尾跑 `code-review` |
| `wayfinder` | 规划超出单个会话容量的大块工作，落成决策工单地图 |
| `triage` | 让 issue 在分诊状态机里流转 |
| `improve-codebase-architecture` | 扫描代码库找出「加深」机会，产出可视化 HTML 报告 |
| `setup-matt-pocock-skills` | 每个仓库跑一次：配 issue tracker、分诊标签、文档位置 |
| `retro` | 复盘后按严重度提出对 agent 环境的改进 |
| `handoff` | 把当前对话压成交接文档，交给下一个 agent |
| `teach` | 多会话教学，当前目录作为有状态的学习工作区 |
| `to-questionnaire` | 把你自己答不了的决策变成一份异步问卷 |
| `wait-what` | 某条消息没听懂时立刻触发，用你项目词汇重讲一遍 |

## 安装

从 npm 安装（包名 `dsh-plugin-matt-skills`，把 `desktop` 换成你的 profile 名）：

```bash
dsh plugin --profile desktop add dsh-plugin-matt-skills
```

本地开发也可以不发布，把 target 指向本目录的绝对路径即可，改完 skill 立即生效：

```text
plugin_manager action=install_bundle target="<本目录的绝对路径>"
```

装完刷新页面即生效，无需重启。卸载：

```bash
dsh plugin --profile desktop remove dsh-plugin-matt-skills
```

GUI 里对应 `plugin_manager action=remove_bundle target=dsh-plugin-matt-skills`。

## 用法

- **仅由人调用**的 16 个：在输入框用 `/` 唤起（`/grill-me`、`/to-spec`……）。它们对模型不可见，不会被自动触发，这正是上游的设计：这些是编排入口，该由你决定何时启动。
- **模型可自动调用**的 11 个：你直接描述任务即可，模型会按 `description` 里的触发条件自己取用。
- 两种入口都用 Harness 原生的 skill 机制（`skill` 工具 + 会话 skill 目录），所以正文是**按需加载**的：不调用就不占上下文。

## 与上游的关系

上游以 **git submodule** 引用，不是复制一份进来：

```text
.gitmodules                  # url = https://github.com/mattpocock/skills, path = matt-skills
matt-skills/                 # submodule，钉在 d81f3a1（只作同步源，插件运行时从不读它）
dsh-plugin-matt-skills/      # 本插件
upstream.json                # 记录同一个 commit，外加每个 skill 的文件清单与内容摘要
```

父仓库里存的是一个 gitlink，指向上面那个确切 commit，所以「这批 vendored 内容出自哪个上游状态」是可验证的事实而非约定：`upstream.json` 的 commit 与 submodule 钉住的 commit 是同一个。

skill 正文逐字节复制，包括原有的 `disable-model-invocation` 标记；被排除的只有 `agents/`（那是 OpenAI/Codex 的清单，本 Harness 不读）。

行尾统一按 **LF** 规范化后再比较与写入。这不是洁癖：同一个仓库 blob 在 `core.autocrlf=true` 的机器上检出为 CRLF、在别的机器上是 LF，若按工作树裸字节比对，本地检出差异会被误判成漂移——这个假报警在 Windows 上真出现过（27 个 skill 全报 content differs，而 git 对象里的内容完全一致）。所以 `sync` 与 `--check` 的语义统一为「**LF 规范化后的内容是否一致**」，与机器配置无关。

### 上游更新了怎么办

```bash
git submodule update --remote matt-skills          # 把引用移到上游最新 commit
node scripts/sync-skills.mjs                       # 重新 vendor 并刷新 upstream.json
git diff --stat -- dsh-plugin-matt-skills/skills   # 先看清正文到底改了什么
```

顺序有意义：先移引用、再 vendor、最后读 diff。`upstream.json` 的摘要会随写入一起更新，所以别用它判断变化，看 `git diff`。

### 校验

```bash
node scripts/sync-skills.mjs --check   # 只比对不写盘：引用到的工作树 vs 已 vendor 的内容
npm run check                          # 语法检查 + 上述 --check
```

`--check` 就是「引用与产物是否仍然一致」的判据：submodule 被移动过却没重新 vendor，它会以退出码 1 点名是哪个 skill 漂移，适合放进 CI。

同步脚本把上游 `plugin.json` 当作权威清单，并强制三条一致性规则，任何一条不满足就拒绝写盘：

1. 每个 skill 必须有 `name` 与 `description`，且 `name` 为 kebab-case、与目录名一致（DSH 校验不过会**静默丢弃**整个 skill，所以宁可在这里失败）。
2. 禁止 `disableModelInvocation` / `modelInvocable` / `userInvocable` 这类驼峰旧键，DSH 见到会整条丢弃。
3. `disable-model-invocation` 必须与同一 skill 的 `agents/openai.yaml` 里 `allow_implicit_invocation` 语义一致；两个上游清单互相矛盾时报错，交给人判断。

## 设计要点

- **这是一个纯配置 bundle，没有一行插件代码。** `cordis.patch.yml` 直接插入官方 `@deepseek-ai/dsh-skill-filesystem` 作为行名，只给它一份隔离配置。这么做不只是「更简洁」：本插件用 `link:` 装在工作区，Node 从 `D:\AIGC\...` 出发解析不到安装目录 asar 内的 `@deepseek-ai/*` 包，任何 `import '@deepseek-ai/dsh-skill-filesystem'` 的写法都会以 `ERR_MODULE_NOT_FOUND` 让整行激活失败。把行名交给 Loader 解析，才是与官方 MCP bundle 模板一致的形态。
- **skill 目录靠 `baseUrl` 定位，不写死路径。** `bundledSkillDir` 用官方 agent preset 的同款表达式，经 `createRequire(baseUrl).resolve('dsh-plugin-matt-skills/package.json')` 反查本包目录再拼 `skills`，所以 profile 换位置、包名上 npm 都不会失效。
- **独立 provider，不动你现有的 skill 根目录。** 用 `includeDefaultRoots: false` + `bundledSkillDir` 隔离，只服务本包内的 27 个 skill。项目的 `.dsh/skills`、`.agents/skills` 与用户级 `~/.dsh/skills`、`~/.agents/skills` 仍由 Harness 自己那份实例提供，互不干扰。
- **同名时你的本地 skill 赢。** 本插件注册在全局层，而项目/用户 skill 落在你所处 agent preset 的作用域层，读取时「更近的层直接胜出」。
- **`watch: false`。** 打包内容只随升级变化，不必要的文件监视在 Windows 上反而会挡住覆盖安装。
- **不声明依赖。** 官方包由 Harness 安装目录提供，声明版本区间只会在区间不匹配时倒过来拦住安装。

## 目录结构

```text
package.json           # dsh.bundle.patch 指向下方 patch
cordis.patch.yml       # 全部逻辑：插入一行，用隔离配置挂载官方 provider
skills/<name>/         # 27 个 skill 目录包（SKILL.md + 附带文件）
scripts/sync-skills.mjs
upstream.json          # 来源与内容摘要
locale/{en,zh}.json    # 设置里显示的标题与描述
icon.svg
```

带附带文件的 skill 会一并带上并由 `resourceBase` 指向该目录，例如 `tdd/tests.md`、`tdd/mocking.md`、`codebase-design/DEEPENING.md`、`domain-modeling/GLOSSARY-FORMAT.md`、`setup-matt-pocock-skills/issue-tracker-*.md`、`diagnosing-bugs/scripts/hitl-loop.template.sh`。

## 验证状态

- `node --check scripts/sync-skills.mjs` 通过；`sync-skills.mjs --check` 报告与上游一致，可重复执行。
- 上游改以 submodule 引用、并钉在 `d81f3a1` 后再次 `--check`：仍报告一致。也就是被引用的那个 commit 能逐字节复现已交付的 27 个 skill，「产物出自哪个上游状态」已被证实。
- 用 DSH 安装目录里真实的 `yaml` 解析器，逐行复刻 `dsh-skill-filesystem` 的 frontmatter 解析逻辑跑了一遍：27/27 全部解析成功，`name`、`description`、调用策略与预期完全一致，无 legacy 驼峰键。
- 装进 desktop profile 后，`cordis_inspect_query Config.listConfigs` 能看到 `patchId: matt-skills` 的行（status `schema`，说明配置通过了官方 Config 校验）；`skill tdd` 返回正文，且 `Base directory` 指向本包的 `skills\tdd`，证明目录定位与按需加载都通。
- 调用面：`skill tdd` 成功；`skill grill-me` 返回 `is not available for model invocation`；`skill no-such-skill-xyz` 返回 `is unknown or no longer available`。两种错误不同，说明「仅人调用」的 16 个确实已注册、但对模型不可见。
- **未验证**：`/` 命令菜单里那 16 项的实际渲染。宿主侧注册已确认，渲染由 Harness 自己的 user-invocable → 人用命令机制负责；请在输入框敲 `/` 确认能看到 `grill-me`、`to-spec` 等。

## 已知限制

- 上游有两个 skill（`handoff`、`teach`）带 `argument-hint`，那是 Claude Code 的斜杠命令提示，本 Harness 不读，同步时会打出警告但保留原文。
- 上游 `docs/` 下的说明页、`ask-matt` 引用的外部流程链接、以及 `.changeset/`、`.agents/` 等仓库设施都不随插件发布。
- `misc/`、`in-progress/`、`deprecated/` 三个 bucket 上游自己也不发布，本插件遵循同一取舍。

## 许可

上游内容版权归 Matt Pocock，MIT。本移植部分同样以 MIT 提供。详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
