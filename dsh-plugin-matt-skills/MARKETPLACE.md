# dsh-plugin.org 收录提交材料

这份文件是投递 [dsh-plugin.org](https://dsh-plugin.org/zh/submit) 社区插件市场用的素材，**不随 npm 包发布**（不在 `package.json` 的 `files` 白名单里）。

下面的「Issue 标题 / 正文」已按市场固定模板填好，可直接复制粘贴；「提交前自查」的勾选状态是当前真实状态（用 GitHub API 与本地仓库核过）。

---

## 一、Issue 标题

```text
[插件提交] DaoMingze/DaoMingze — 把 Matt Pocock 的 27 个工程 skill 带进每个 DSH 会话
```

## 二、Issue 正文（复制这一段）

```markdown
### 仓库地址
https://github.com/DaoMingze/DaoMingze

### 一句话价值
装上后每个 DSH 会话立刻多出 27 个工程 skill：11 个由模型按任务自动取用（tdd、code-review、codebase-design、domain-modeling、diagnosing-bugs、prototype、research、pr、wizard、grilling、writing-for-agents），16 个由你在输入框用 / 唤起（grill-me、grill-with-docs、to-spec、to-tickets、implement、implement-spec、wayfinder、triage、improve-codebase-architecture、retro、handoff、teach、to-questionnaire、wait-what、ask-matt、setup-matt-pocock-skills）。全部按需加载，不调用就不占上下文。

### 能力分类
技能与智能体

### 安装命令
dsh plugin --profile desktop add dsh-plugin-matt-skills

（npm 包名 dsh-plugin-matt-skills，把 desktop 换成目标 profile。未发布时本地开发可用：
plugin_manager action=install_bundle target="<包目录绝对路径>"）

### 兼容与运行要求
- DSH：在 0.2.0-rc.2 上实测通过（插件行 active、skill tdd 正常返回正文）
- 平台：不限。纯 Host 插件、无原生依赖、无构建步骤、无网络请求
- 运行时：Node ^22.19.0 || >=24（package.json 的 engines）
- 依赖：Harness 自带的 @deepseek-ai/dsh-skill-filesystem，不随包发布，不声明 peerDependencies
- 不干扰用户既有 skill：以 includeDefaultRoots:false 隔离，只服务本包内 27 个 skill；项目/用户级 skills 仍由 Harness 自己那份实例提供

### 许可证
MIT。skills/ 内容版权归 Matt Pocock（上游 mattpocock/skills，MIT）；本移植部分同为 MIT。LICENSE 与 NOTICE 随包发布，upstream.json 记录上游 commit 与逐文件内容摘要。

### 截图 / 演示
下面是真实输出（本机实测，路径已用 … 省略前缀，非模拟）：

会话中取用模型可调用的 skill：

    <skill_content name="tdd">
    <skill_resources>
    Base directory for this skill: …/dsh-plugin-matt-skills/skills/tdd
    …

模型尝试取用「仅人调用」的 skill 时被拒绝（这正是上游的调用面设计）：

    Error: skill "grill-me" is not available for model invocation

上游一致性校验（CI 可跑）：

    $ node scripts/sync-skills.mjs --check
    up to date: 27 skills (11 model-invoked, 16 user-invoked) from https://github.com/mattpocock/skills@d81f3a1

### 补充说明
- 权限：只读本包内的 skill 文件；不写用户 skill 根目录、无遥测、无外部服务请求
- 设计（本包不含自己的 JS 模块；运行时 apply 来自官方包，依据见下）：
  - 按官方定义，本包就是合规的 DSH 插件包。官方 cordis-plugin-development skill 的 references/host-plugin.md 开篇即：「A bundle is a package whose package.json declares dsh.bundle.patch」——本包 package.json 声明的正是 dsh.bundle.patch。
  - 零 JS 的配置型 bundle 是官方给出的形态。同一 skill 的 templates/mcp/ 就是这样：package.json 里只有 name/version/private/type 与 dsh.bundle.patch，没有 exports/main；其 cordis.patch.yml 直接插入官方包 @deepseek-ai/dsh-mcp-client。本包结构一致，只是插入 @deepseek-ai/dsh-skill-filesystem。
  - 该行带一份隔离配置（providerName=matt-skills / includeDefaultRoots=false / bundledSkillDir=本包 skills / watch=false），因此它不接管用户既有的 skill 根目录。
  - 可复核：dsh --profile desktop --dump-config 打印的组合结果里能看到本包那一行及其 config。
- 可溯源性：上游以 git submodule 引用并钉在 d81f3a1；upstream.json 记录同一 commit 与每个 skill 的文件清单 + 内容摘要；skill 正文逐字节复制（行尾统一 LF）
- 已知限制：上游 handoff 与 teach 的 argument-hint 是 Claude Code 的斜杠命令提示，DSH 不读（保留原文）；misc/、in-progress/、deprecated/ 三个 bucket 上游自己也不发布，本插件遵循同一取舍
- 同名冲突：本插件注册在全局层，项目/用户 skill 落在更近的作用域层，因此本地同名 skill 优先

### 提交前自查
- [x] 仓库已公开（GitHub API：private=false、visibility=public）
- [ ] 已添加 GitHub topic：dsh-plugin
- [ ] README 包含安装命令
- [ ] 插件导出 apply(ctx) 模块（本包为配置型 bundle：运行时 apply 来自被插入的官方包；依据与复核方式见「补充说明」）
```

## 三、提交前必须先做完的五件事

按依赖顺序：

1. **push 代码**。GitHub 上 `DaoMingze/DaoMingze` 目前仍是旧状态（`pushed_at` 2026-07-29、`size` 17 KB、description `README`），本地两个 commit 尚未 push。市场扫的是公开仓库，不 push 等于提交空壳。
2. **把包发到 npm**。安装命令里的 `dsh-plugin-matt-skills` 必须真实存在（当前 `npm view` 404）。见 `README.md` 的发布步骤。
3. **加 GitHub topic `dsh-plugin`**：仓库页 → Settings → Topics，或从 <https://github.com/topics/dsh-plugin> 进入。当前 API 返回 `topics: []`。
4. **改仓库描述**。现在只有 `README` 一个词；市场要求「使用准确的仓库描述」。建议：`把 Matt Pocock 的 27 个工程 skill 带进每个 DeepSeek Harness 会话（DSH 插件）`。
5. **确认 README 含安装命令**。市场扫的是**仓库根** README（`/README.md`，你的那份），不是插件目录里的。根 README 需要出现这一行：

   ```bash
   dsh plugin --profile desktop add dsh-plugin-matt-skills
   ```

   插件目录内的 [README.md](./README.md) 已经有了。

可选但建议：**仓库根放一份 LICENSE**。GitHub API 报 `license: null`（本插件的 LICENSE 在子目录里，GitHub 不识别），根目录放一份会让仓库更可信。

## 四、清单第 4 条（`apply(ctx)`）：已定按方案 A 处理

市场收录要求第 4 条写「插件需导出 `apply(ctx)` 模块」。本包不含自己的 JS 模块，这条**字面上不成立**；已决定**保持设计不变**（方案 A），改在提交正文的「补充说明」里给出可复核的依据（上面那份草稿已写好）。三条依据全部出自 DSH 安装目录内的官方文档，审核方可自行核对：

1. **按官方定义，本包就是合规的 DSH 插件包。** 官方 `cordis-plugin-development` skill → `references/host-plugin.md` 开篇：「A bundle is a package whose `package.json` declares `dsh.bundle.patch`」。本包 `package.json` 声明的正是 `dsh.bundle.patch`。
2. **零 JS 的配置型 bundle 是官方形态。** 同一 skill 的 `templates/mcp/`：`package.json` 只有 `name`/`version`/`private`/`type` 与 `dsh.bundle.patch`，没有 `exports`/`main`；其 `cordis.patch.yml` 直接插入官方包 `@deepseek-ai/dsh-mcp-client`。本包结构一致，插入的是 `@deepseek-ai/dsh-skill-filesystem`。
3. **运行时确实有 `apply(ctx)`。** 执行它的是被插入的官方包，本包是它之上的 patch 层。用 `dsh --profile desktop --dump-config` 打印组合结果即可看到本包那一行及其 config。

方案 A 的残余风险：自动扫描或按清单逐条打勾的审核可能仍判不合规。若出现这种情况再退到备选——加 `index.mjs` 导出 `apply(ctx)` 并把 patch 行名指向本包；代价是该写法在 `link:` 安装下报 `ERR_MODULE_NOT_FOUND`（官方包不在 profile 的 node_modules 里），只能从 registry 或 `npm pack` 出的 tarball 安装后验证（`install_bundle target=<tgz>`）。这会改掉已验证可用的设计，故仅作备选。

## 五、收录后（可选）

把下面这行加进**仓库根** README，链接里的 slug 以收录后详情页地址为准：

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/DaoMingze/DaoMingze)
```
