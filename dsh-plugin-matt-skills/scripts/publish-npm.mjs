#!/usr/bin/env node
/**
 * 把本包发到 npm 官方源和/或 GitHub Packages（npm.pkg.github.com）。
 *
 * GitHub Packages 只接受带作用域的包名，且作用域必须等于仓库所有者：
 * 本仓库是 github.com/DaoMingze/dsh-plugin-wendao，所以 GitHub 侧的名字
 * 固定为 @daomingze/dsh-plugin-matt-skills（作用域只允许小写）。
 *
 * 做法是「打包一次、换名入库」：
 *   1. npm pack 生成 tarball（一次），先按原标题发 npm 官方源；
 *   2. 解包 tarball，只把 package.json 的 name 换成带作用域的名字，
 *      连同 .npmrc 重新打包，发到 GitHub Packages；
 *   3. 删除临时目录。仓库里的 package.json 自始至终不被修改，
 *      因此绝不会把 @daomingze 作用域误发到 npm 官方源。
 *
 * 用法（在本包目录下，即含 package.json 的目录）：
 *   node scripts/publish-npm.mjs                # 两个源都发
 *   node scripts/publish-npm.mjs --npm          # 只发 npm 官方源
 *   node scripts/publish-npm.mjs --github       # 只发 GitHub Packages
 *   node scripts/publish-npm.mjs --dry-run      # 只演练，不真正发布
 *   node scripts/publish-npm.mjs --otp=123456   # 官方源要求 2FA 时传一次性口令
 *   node scripts/publish-npm.mjs --staging=DIR  # 指定暂存目录（默认用系统临时目录，且用后自动删除）
 *
 * 需要的凭据：
 *   npm 官方源                 ~/.npmrc 里的 //registry.npmjs.org/:_authToken
 *   GitHub Packages（二选一）  ~/.npmrc 里的 //npm.pkg.github.com/:_authToken
 *                              或环境变量 GITHUB_TOKEN（需 classic PAT，含 write:packages）
 *
 * 注意：GitHub Packages 只支持 classic PAT，细粒度 token 不可用；
 * 版本号已存在于某个源时该源会拒绝，改版本号后重跑即可。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_REGISTRY = "https://npm.pkg.github.com";
const GITHUB_SCOPE = "daomingze";
const GITHUB_NAME = `@${GITHUB_SCOPE}/dsh-plugin-matt-skills`;

const packageDir = resolve(process.cwd());
const pkgPath = join(packageDir, "package.json");

if (!existsSync(pkgPath)) {
	throw new Error(`当前目录不是包目录，找不到 ${pkgPath}；请在含 package.json 的本包目录下运行`);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyGithub = args.includes("--github") && !args.includes("--npm");
const onlyNpm = args.includes("--npm") && !args.includes("--github");
const otpArg = args.find((arg) => arg.startsWith("--otp="));

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (typeof version !== "string" || version.length === 0) {
	throw new Error("package.json 缺少 version");
}
if (pkg.name.startsWith("@")) {
	throw new Error(
		`package.json 的 name 是 ${pkg.name}。本脚本假定仓库里维护的是未加作用域的官方名，` +
			`以便原样发到 npm 官方源；若你已决定改成带作用域的名字，请直接同步修改脚本里的假设。`,
	);
}

/** 找到与本进程配套的 npm CLI 入口；找不到就退回 PATH 上的 npm。 */
function npmCommand() {
	const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	return existsSync(cli) ? { command: process.execPath, prefix: [cli] } : { command: "npm", prefix: [] };
}

const npm = npmCommand();

/**
 * 统一的子进程调用：回显命令，失败即中断。
 * 走 npm-cli.js 而非 `npm`：Windows 上 npm 是 .cmd 垫片，用 shell 解析会触发
 * Node 的 DEP0190（shell + 参数拼接）并有转义风险；直接起 JS 入口可完全避开。
 * 找不到入口时才退回 `npm`，此时才需要 shell。
 */
function run(command, commandArgs, options = {}) {
	const args = command === "npm" ? [...npm.prefix, ...commandArgs] : commandArgs;
	const executable = command === "npm" ? npm.command : command;
	console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
	execFileSync(executable, args, {
		cwd: packageDir,
		stdio: "inherit",
		shell: executable === "npm" && process.platform === "win32",
		env: process.env,
		...options,
	});
}

function readUserNpmrcToken(registry) {
	const npmrcPath = join(homedir(), ".npmrc");
	if (!existsSync(npmrcPath)) return undefined;
	const escaped = registry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = new RegExp(`^//${escaped.slice("https://".length)}/:_authToken=(.+)$`, "mu").exec(
		readFileSync(npmrcPath, "utf8"),
	);
	return match?.[1]?.trim();
}

/** 官方的发布命令；--otp 只在 npm 官方源且用户显式给出时附加。 */
function publishArgs(registry, extra = []) {
	const result = ["publish", "--registry", registry, ...extra];
	if (registry === NPM_REGISTRY && otpArg !== undefined) result.push(otpArg);
	return result;
}

/**
 * 打包并按打包目录里的 .tgz 确定产物路径。
 * 刻意不通过管道读取 `npm pack` 的 stdout：部分受限执行环境禁止以管道捕获
 * 子进程输出，一旦捕获整个子进程都不会启动。改用继承终端 + 目录扫描。
 */
function packTarball(destination) {
	mkdirSync(destination, { recursive: true });
	run("npm", ["pack", "--pack-destination", destination]);
	// npm 的 tarball 名由「包名 + 版本」决定，带作用域时把 @ 和 / 换成 -。
	const expected = `${pkg.name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
	const tarballs = readdirSync(destination).filter((entry) => entry.endsWith(".tgz"));
	const found = tarballs.includes(expected) ? [expected] : [];
	if (found.length !== 1) {
		throw new Error(
			`无法确定打包产物：目录 ${destination} 中期望 ${expected}，实际 .tgz 有 ${tarballs.join(", ") || "无"}`,
		);
	}
	const tarball = join(destination, found[0]);
	if (!existsSync(tarball)) throw new Error(`打包产物不存在：${tarball}`);
	return tarball;
}

const staging = args.includes("--staging") ? resolve(args[args.indexOf("--staging") + 1]) : mkdtempSync(join(tmpdir(), "dsh-publish-"));
try {
	const tarball = packTarball(staging);
	console.log(`\n已打包 ${basename(tarball)}（${pkg.name}@${version}）`);

	if (!onlyGithub) {
		console.log("\n=== 1/2 发布到 npm 官方源 (registry.npmjs.org) ===");
		// 以 tarball 为发布目标：暂存目录里没有 package.json，不能在那里执行 publish。
		run("npm", publishArgs(NPM_REGISTRY, [tarball, ...(dryRun ? ["--dry-run"] : [])]));
	}

	if (!onlyNpm) {
		console.log("\n=== 2/2 发布到 GitHub Packages (npm.pkg.github.com) ===");
		const githubToken = process.env.GITHUB_TOKEN ?? readUserNpmrcToken(GITHUB_REGISTRY);
		if (githubToken === undefined) {
			throw new Error(
				"找不到 GitHub Packages 凭据：请在 ~/.npmrc 写入 " +
					`//npm.pkg.github.com/:_authToken=<classic PAT>，或设置 GITHUB_TOKEN 环境变量。`,
			);
		}

		const ghDir = join(staging, "github");
		mkdirSync(ghDir, { recursive: true });
		execFileSync("tar", ["-xzf", tarball, "-C", ghDir], { stdio: "inherit" });
		const extracted = join(ghDir, "package");
		if (!existsSync(extracted)) throw new Error(`tarball 解包结果缺少 package/ 目录：${tarball}`);

		const ghManifestPath = join(extracted, "package.json");
		const ghManifest = JSON.parse(readFileSync(ghManifestPath, "utf8"));
		ghManifest.name = GITHUB_NAME;
		writeFileSync(ghManifestPath, `${JSON.stringify(ghManifest, null, 2)}\n`);
		// 作用域路由写进包内 .npmrc，保证 publish 与后续 install 都走 GitHub Packages。
		writeFileSync(join(extracted, ".npmrc"), `@${GITHUB_SCOPE}:registry=${GITHUB_REGISTRY}\n`);

		run("npm", publishArgs(GITHUB_REGISTRY, dryRun ? ["--dry-run"] : []), {
			cwd: extracted,
			env: { ...process.env, NODE_AUTH_TOKEN: githubToken },
		});
	}

	console.log("\n完成。");
	if (dryRun) console.log("（--dry-run：以上均为演练，未真正发布）");
	if (!onlyGithub) {
		console.log(`npm 官方源：https://www.npmjs.com/package/${pkg.name}/v/${version}`);
	}
	if (!onlyNpm) {
		console.log(
			`GitHub Packages：https://github.com/${GITHUB_SCOPE}?tab=packages&repo_name=${basename(
				join(packageDir, ".."),
			)}`,
		);
	}
} finally {
	// 只清理本脚本自己创建的临时目录；--staging 指定的目录由调用方负责。
	if (!args.includes("--staging")) rmSync(staging, { recursive: true, force: true });
}
