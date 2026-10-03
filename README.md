# 璺道的 DSH 插件仓库

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

## dsh-plugin-diagram-design

把 [Cathryn Lavery 的 Diagram Design](https://github.com/cathrynlavery/diagram-design) 装进每个 DeepSeek Harness 会话：**42 种编辑风图表**，输出自包含 HTML + SVG，并且能把已有的 draw.io、Mermaid、Excalidraw 图**重画**进同一套设计系统（是重画，不是渲染）。模型按任务自动取用，不调用就不占上下文。

安装（把 `desktop` 换成你的 profile 名）：

```bash
dsh plugin --profile desktop add dsh-plugin-diagram-design
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-plugin-diagram-design
```

运行前提：出图走它自带的 Python 工具，需要 **Python 3**；要导出 PNG 另需 `pip install playwright && playwright install chromium`。只出 HTML / SVG 则不需要。

插件本体在 [`dsh-plugin-diagram-design/`](./dsh-plugin-diagram-design/)，完整说明见它的 [README](./dsh-plugin-diagram-design/README.md)。
