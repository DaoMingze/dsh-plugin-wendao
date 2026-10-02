# 发布到 npm 与 GitHub Packages

本包同时发布到两个源：

| 源 | 包名 | registry |
| --- | --- | --- |
| npm 官方源 | `dsh-plugin-matt-skills` | `https://registry.npmjs.org` |
| GitHub Packages | `@daomingze/dsh-plugin-matt-skills` | `https://npm.pkg.github.com` |

> 依据：[GitHub 文档 — 在 npm 注册表上工作](https://docs.github.com/zh/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)

**为什么 GitHub 侧要换名字**：GitHub Packages **只支持带作用域的包**，且作用域必须等于仓库所有者。
本仓库是 `github.com/DaoMingze/dsh-plugin-wendao`，所有者是 `DaoMingze`，
因此 GitHub 侧固定为 `@daomingze/dsh-plugin-matt-skills`（文档明确要求作用域只用小写字母）。
npm 官方源那边继续用未加作用域的 `dsh-plugin-matt-skills`，用户装插件时无需改成带作用域的名字。

`scripts/publish-npm.mjs` 就是为这个差异写的：**打包一次、换名入库**，仓库里的 `package.json` 全程不改，
所以绝不会把带作用域的名字误发到 npm 官方源。

---

## 一、一次性准备

### 1. npm 官方源

用户级 `~/.npmrc` 里要有一枚 npm Access Token（Automation 或 Publish 类型）：

```
//registry.npmjs.org/:_authToken=<你的 npm token>
```

本机已配置（`npm config ls` 可见 `//registry.npmjs.org/:_authToken = (protected)`）。

### 2. GitHub Packages

在 GitHub 生成 **classic** Personal Access Token：

- 路径：GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic)
- 勾选作用域：`write:packages`（发布必需），`read:packages` 建议一并勾上，`repo` 视需要
- **注意**：GitHub Packages 只支持 classic PAT，**细粒度 token（fine-grained）不可用**，这是官方文档的明确限制

然后把 token 写进用户级 `~/.npmrc`：

```
//npm.pkg.github.com/:_authToken=<你的 GitHub classic PAT>
```

或者不落盘，每次发布时用环境变量：

```powershell
$env:GITHUB_TOKEN = "<你的 GitHub classic PAT>"
```

> 包内已有的 `.npmrc` 只做了作用域路由（`@daomingze:registry=https://npm.pkg.github.com`），
> **不含 token**，所以可以安全入库。token 永远只放用户级 `~/.npmrc` 或环境变量。

### 3. 为什么默认 registry 是 npmmirror 也不影响发布

本机 `~/.npmrc` 里 `registry=https://registry.npmmirror.com`（只读镜像）。
发布时会显式传 `--registry`，且 `package.json` 里有 `publishConfig.registry = https://registry.npmjs.org`，
两者都优先于默认 registry，因此**不会**误发到镜像站。

---

## 二、发布

先改版本号（例如 `1.0.1` → `1.0.2`），再在**本包目录**执行：

```powershell
cd D:\AIGC\dsh-plugin-wendao\dsh-plugin-matt-skills

# 两个源一起发
node scripts/publish-npm.mjs

# 只发 npm 官方源
node scripts/publish-npm.mjs --npm

# 只发 GitHub Packages
node scripts/publish-npm.mjs --github

# 演练：走完打包与校验，不真正发布
node scripts/publish-npm.mjs --dry-run

# npm 官方源要求 2FA 时
node scripts/publish-npm.mjs --otp=123456
```

脚本行为：

1. `npm pack` 打到临时目录；
2. 以 tarball 为目标发 npm 官方源（`npm publish <tarball> --registry https://registry.npmjs.org`）；
3. 解包 tarball，把 `package.json` 的 `name` 换成 `@daomingze/dsh-plugin-matt-skills`，
   写入作用域路由 `.npmrc`，重新打包后发到 GitHub Packages；
4. 清理临时目录（用 `--staging=DIR` 指定目录时由你自行清理）。

版本号已存在于某个源时该源会拒绝——这在 `--dry-run` 下也会报出来（例如
`You cannot publish over the previously published versions: 1.0.1`），改版本号即可。

### 等价的纯命令行做法（不用脚本）

如果你更想手动执行，第二步大致等价于：

```powershell
# 1) npm 官方源
npm publish --registry https://registry.npmjs.org

# 2) GitHub Packages：临时改名为带作用域的名字后发布，再改回来
#    本仓库中该操作已由 scripts/publish-npm.mjs 自动化，避免手改 package.json 出错
```

---

## 三、在 CI 里发布（可选）

在仓库根目录建 `.github/workflows/publish.yml`，用 `GITHUB_TOKEN` 直接发 GitHub Packages
（官方文档推荐：工作流里优先用 `GITHUB_TOKEN` 而不是 PAT）。要点：

- `permissions: packages: write`；
- 步骤里写 `registry-url: https://npm.pkg.github.com`（`actions/setup-node`）并设置
  `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`；
- `package.json` 的 `name` 必须是 `@daomingze/...`，或像本脚本那样发布前临时改名。

npm 官方源那一步需要 `secrets.NPM_TOKEN`（npm Automation token）。

---

## 四、从两个源安装

**从 npm 官方源装**（推荐，普通用户无需任何凭据）：

```powershell
dsh plugin --profile desktop install dsh-plugin-matt-skills
# 或在 DSH 插件市场里点安装
```

**从 GitHub Packages 装**：需要先按上文第 2 步配好 `~/.npmrc` 里的
`//npm.pkg.github.com/:_authToken`，然后：

```powershell
dsh plugin --profile desktop install @daomingze/dsh-plugin-matt-skills
```

装完**必须完全重启 DSH Desktop**：插件包的解析表是启动时在内存里一次性编译的，
新增的包需要重启进程才会被纳入（DSH 源码里对这类变更的直接判定就是
`profile resolution: ... requires a process restart`）。

---

## 五、几个容易踩的坑

1. **GitHub 侧首次发布默认是私有包**。要公开就发布后去
   `https://github.com/users/DaoMingze/packages/npm/dsh-plugin-matt-skills/settings` 改可见性。
2. **一个包只能关联一个 GitHub 仓库**。若 `dsh-plugin-matt-skills` 这个名字之前已由别的仓库发过
   GitHub Packages，会因仓库不匹配被拒——那就换个 GitHub 侧包名。
3. **tarball 上限 256 MB**（GitHub Packages 限制）。本包约 92 KB，无压力。
4. **`files` 白名单**决定打包内容。当前白名单为
   `cordis.patch.yml` / `skills/` / `locale/` / `icon.svg` / `upstream.json` / `README.md` / `NOTICE` / `LICENSE`，
   共 61 个文件、239.6 KB（未压缩）。运行时**不需要** `scripts/`；若想让发布的包里也带上它
   （便于用户侧跑 `sync`/`check`），把 `"scripts/"` 加进 `files` 即可。
5. **两个源的版本号独立**。同一个版本号可以两边都存在；但已发布过的版本不能重发，
   发版前先 `npm view dsh-plugin-matt-skills versions` 确认。
