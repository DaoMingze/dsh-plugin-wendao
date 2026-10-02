# 问道的 DSH 插件仓库

基于deepseek harness自我生产的插件。

## dsh-plugin-matt-skills

把 [Matt Pocock 的 Skills For Real Engineers](https://github.com/mattpocock/skills) 的 27 个工程 skill 装进每个 DeepSeek Harness 会话：11 个由模型按任务自动取用，16 个由你在输入框用 `/` 唤起。全部按需加载，不调用就不占上下文。

安装（把 `desktop` 换成你的 profile 名）：

```bash
dsh plugin --profile desktop add dsh-plugin-matt-skills
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-plugin-matt-skills
```

插件本体在 [`dsh-plugin-matt-skills/`](./dsh-plugin-matt-skills/)，完整说明见它的 [README](./dsh-plugin-matt-skills/README.md)。
