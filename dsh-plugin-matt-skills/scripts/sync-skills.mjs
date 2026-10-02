#!/usr/bin/env node
/**
 * Vendor the promoted matt-skills skill bundles into this package's `skills/`
 * root, and record what was vendored in `upstream.json`.
 *
 * The upstream repository publishes two manifests that must agree: its Claude
 * Code plugin manifest (`.claude-plugin/plugin.json`) names the promoted
 * skills, and each skill's `agents/openai.yaml` states whether the model may
 * invoke it implicitly. This script treats `plugin.json` as the authoritative
 * skill list, cross-checks the invocation policy against `openai.yaml`, and
 * refuses to write when the two disagree.
 *
 * Usage:
 *   node scripts/sync-skills.mjs [--check] [--upstream <dir>]
 *
 *   --check      Compare the vendored tree with upstream and report drift
 *                without writing anything. Exits 1 when they differ.
 *   --upstream   Path to the matt-skills checkout (default: ../matt-skills).
 *
 * Skill bodies are copied byte for byte. The only paths left behind are
 * harness-specific metadata directories that DeepSeek Harness never reads.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')
const UPSTREAM_RECORD = join(PACKAGE_ROOT, 'upstream.json')
const SKILL_FILE = 'SKILL.md'
const UPSTREAM_MANIFEST = join('.claude-plugin', 'plugin.json')

/** Directories inside a skill bundle that belong to another harness. */
const EXCLUDED_TOP_LEVEL_DIRS = new Set(['agents'])

/** Frontmatter keys @deepseek-ai/dsh-skill-filesystem reads. */
const RECOGNIZED_KEYS = new Set([
  'name',
  'description',
  'whenToUse',
  'metadata',
  'disable-model-invocation',
  'user-invocable',
])

/**
 * Camel-case spellings the provider rejects outright. A rejected field drops
 * the whole skill from the catalog, so the sync must fail loudly instead.
 */
const FORBIDDEN_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
])

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BOOLEAN_WORDS = new Set(['true', 'yes', 'on', 'false', 'no', 'off', '1', '0'])

function parseArguments(argv) {
  const options = { check: false, upstream: resolve(PACKAGE_ROOT, '..', 'matt-skills') }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') options.check = true
    else if (argument === '--upstream') {
      index += 1
      if (index >= argv.length) throw new Error('--upstream needs a directory')
      options.upstream = resolve(argv[index])
    } else if (argument.startsWith('--upstream=')) options.upstream = resolve(argument.slice(11))
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

/** Split `---` delimited frontmatter from the body, as the provider does. */
function splitFrontmatter(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') throw new Error(`missing leading "---"`)
  const closing = lines.indexOf('---', 1)
  if (closing < 0) throw new Error(`missing closing "---"`)
  return lines.slice(1, closing)
}

/** Collect the top-level `key:` lines of a frontmatter block. */
function frontmatterKeys(frontmatterLines) {
  const keys = []
  for (const line of frontmatterLines) {
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/.exec(line)
    if (match) keys.push(match[1])
  }
  return keys
}

/** Read the raw scalar of a string frontmatter field, unquoted. */
function frontmatterScalar(frontmatterLines, key) {
  const pattern = new RegExp(`^${key}\\s*:\\s*(.*)$`)
  for (const line of frontmatterLines) {
    const match = pattern.exec(line)
    if (match) {
      const raw = match[1].trim()
      const quoted = /^(['"])(.*)\1$/.exec(raw)
      return quoted ? quoted[2] : raw
    }
  }
  return undefined
}

/**
 * Validate one skill's frontmatter against the provider's documented and
 * implemented rules, and resolve the invocation policy it implies.
 */
function readSkillContract(directoryName, raw) {
  const problems = []
  const warnings = []
  const frontmatterLines = splitFrontmatter(raw)
  const keys = frontmatterKeys(frontmatterLines)

  const name = frontmatterScalar(frontmatterLines, 'name')
  const description = frontmatterScalar(frontmatterLines, 'description')
  if (!name) problems.push(`frontmatter has no "name"`)
  if (!description) problems.push(`frontmatter has no "description"`)
  if (name && name !== directoryName) {
    problems.push(`frontmatter name "${name}" does not match directory "${directoryName}"`)
  }
  if (name && !KEBAB_CASE.test(name)) {
    problems.push(`name "${name}" is not kebab-case, which the provider rejects`)
  }

  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      problems.push(`"${key}" is rejected by the provider; use "${FORBIDDEN_KEYS.get(key)}"`)
    } else if (!RECOGNIZED_KEYS.has(key)) {
      warnings.push(`frontmatter key "${key}" is not read by DeepSeek Harness and is ignored`)
    }
  }

  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (!keys.includes(key)) continue
    const value = frontmatterScalar(frontmatterLines, key) ?? ''
    if (!BOOLEAN_WORDS.has(value.toLowerCase())) {
      problems.push(`"${key}: ${value}" is not a boolean the provider accepts`)
    }
  }

  const disableModelInvocation = keys.includes('disable-model-invocation')
    && ['true', 'yes', 'on', '1'].includes(
      (frontmatterScalar(frontmatterLines, 'disable-model-invocation') ?? '').toLowerCase(),
    )
  const userInvocable = !keys.includes('user-invocable')
    || ['true', 'yes', 'on', '1'].includes(
      (frontmatterScalar(frontmatterLines, 'user-invocable') ?? '').toLowerCase(),
    )

  if (!userInvocable) {
    warnings.push('"user-invocable: false" hides the skill from human commands as well')
  }

  return {
    name,
    description,
    disableModelInvocation,
    userInvocable,
    invocation: disableModelInvocation ? 'user' : 'model',
    problems,
    warnings,
  }
}

/**
 * Cross-check the invocation policy against the skill's OpenAI/Codex manifest,
 * which states the same intent for the other harness.
 */
function checkOpenAiPolicy(skillDir, contract) {
  const manifest = join(skillDir, 'agents', 'openai.yaml')
  if (!existsSync(manifest)) return []
  const implicit = /allow_implicit_invocation\s*:\s*(\S+)/.exec(readFileSync(manifest, 'utf8'))
  if (!implicit) return []
  const allowsImplicit = implicit[1].replace(/["']/g, '').toLowerCase() === 'true'
  // A model that may invoke implicitly is exactly the skill that does not opt out.
  const expectedAllowsImplicit = !contract.disableModelInvocation
  if (allowsImplicit === expectedAllowsImplicit) return []
  return [
    `agents/openai.yaml says allow_implicit_invocation: ${allowsImplicit} but ${SKILL_FILE} `
    + `${contract.disableModelInvocation ? 'sets' : 'omits'} disable-model-invocation`,
  ]
}

function execFileSyncSafe(operation) {
  try {
    return operation()
  } catch {
    return undefined
  }
}

/** Every file under a skill bundle, excluding other harnesses' metadata. */
async function collectBundleFiles(skillDir, current = skillDir, collected = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    const relativePath = relative(skillDir, absolute).split(sep).join('/')
    if (EXCLUDED_TOP_LEVEL_DIRS.has(relativePath.split('/')[0])) continue
    if (entry.isDirectory()) await collectBundleFiles(skillDir, absolute, collected)
    else if (entry.isFile()) collected.push(relativePath)
  }
  return collected.sort()
}

async function digestBundle(skillDir, files) {
  const hash = createHash('sha256')
  for (const file of files) {
    const content = await readFile(join(skillDir, file))
    hash.update(file)
    hash.update('\0')
    hash.update(createHash('sha256').update(content).digest('hex'))
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** Read the upstream skill list and validate every entry against the rules. */
async function readUpstream(upstreamDir) {
  const manifestPath = join(upstreamDir, UPSTREAM_MANIFEST)
  if (!existsSync(manifestPath)) {
    throw new Error(`no ${UPSTREAM_MANIFEST} under ${upstreamDir}; is that the matt-skills checkout?`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    throw new Error(`${UPSTREAM_MANIFEST} lists no skills`)
  }

  const skills = []
  const failures = []
  const warnings = []
  for (const entry of manifest.skills) {
    const relativePath = String(entry).replace(/^\.\//, '')
    const segments = relativePath.split('/')
    const directoryName = segments.at(-1)
    const bucket = segments.at(-2)
    const skillDir = join(upstreamDir, relativePath)
    const skillFile = join(skillDir, SKILL_FILE)
    if (!existsSync(skillFile)) {
      failures.push(`${relativePath}: no ${SKILL_FILE}`)
      continue
    }
    const raw = await readFile(skillFile, 'utf8')
    const contract = readSkillContract(directoryName, raw)
    const policyProblems = checkOpenAiPolicy(skillDir, contract)
    for (const problem of [...contract.problems, ...policyProblems]) {
      failures.push(`${relativePath}: ${problem}`)
    }
    for (const warning of contract.warnings) warnings.push(`${relativePath}: ${warning}`)
    if (contract.problems.length > 0 || policyProblems.length > 0) continue

    const files = await collectBundleFiles(skillDir)
    skills.push({
      name: contract.name,
      bucket,
      invocation: contract.invocation,
      files,
      digest: await digestBundle(skillDir, files),
      sourceDir: skillDir,
    })
  }

  if (failures.length > 0) {
    throw new Error(`upstream skills failed validation:\n  ${failures.join('\n  ')}`)
  }
  const duplicates = skills.map(skill => skill.name)
    .filter((name, index, all) => all.indexOf(name) !== index)
  if (duplicates.length > 0) {
    throw new Error(`duplicate skill names in ${UPSTREAM_MANIFEST}: ${duplicates.join(', ')}`)
  }

  skills.sort((left, right) => left.name.localeCompare(right.name))
  return { manifest, skills, warnings }
}

function readUpstreamSource(upstreamDir, manifest) {
  const commit = execFileSyncSafe(() => execFileSync(
    'git',
    ['-C', upstreamDir, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim())
  return {
    repository: manifest.repository ?? null,
    version: manifest.version ?? null,
    license: manifest.license ?? null,
    commit: commit ?? null,
    manifest: '.claude-plugin/plugin.json',
  }
}

function buildRecord(source, skills) {
  return {
    source,
    vendored: {
      excludedPaths: [...EXCLUDED_TOP_LEVEL_DIRS].map(name => `${name}/`),
      note: 'Skill files are copied byte for byte; only another harness\'s metadata is left out.',
    },
    skills: skills.map(skill => ({
      name: skill.name,
      bucket: skill.bucket,
      invocation: skill.invocation,
      files: skill.files,
      digest: skill.digest,
    })),
  }
}

async function writeVendoredSkills(skills) {
  await rm(SKILLS_DIR, { recursive: true, force: true })
  for (const skill of skills) {
    const target = join(SKILLS_DIR, skill.name)
    for (const file of skill.files) {
      const destination = join(target, file)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(join(skill.sourceDir, file), destination)
    }
  }
}

/** Compare the vendored tree and record against upstream without writing. */
async function reportDrift(skills, record) {
  const problems = []
  const recorded = existsSync(UPSTREAM_RECORD)
    ? JSON.parse(await readFile(UPSTREAM_RECORD, 'utf8'))
    : undefined
  if (recorded === undefined) problems.push('upstream.json is missing')
  else if (JSON.stringify(recorded) !== JSON.stringify(record)) {
    problems.push('upstream.json does not match upstream')
  }

  for (const skill of skills) {
    const target = join(SKILLS_DIR, skill.name)
    if (!existsSync(target)) {
      problems.push(`skills/${skill.name} is missing`)
      continue
    }
    const present = await collectBundleFiles(target)
    if (JSON.stringify(present) !== JSON.stringify(skill.files)) {
      problems.push(`skills/${skill.name} file list differs from upstream`)
      continue
    }
    const digest = await digestBundle(target, present)
    if (digest !== skill.digest) problems.push(`skills/${skill.name} content differs from upstream`)
  }

  if (existsSync(SKILLS_DIR)) {
    const expected = new Set(skills.map(skill => skill.name))
    for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !expected.has(entry.name)) {
        problems.push(`skills/${entry.name} is not in the upstream manifest`)
      }
    }
  }
  return problems
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!existsSync(options.upstream)) {
    throw new Error(`upstream checkout not found: ${options.upstream}`)
  }

  const { manifest, skills, warnings } = await readUpstream(options.upstream)
  const source = readUpstreamSource(options.upstream, manifest)
  const record = buildRecord(source, skills)
  for (const warning of warnings) console.warn(`warning: ${warning}`)

  const modelInvocable = skills.filter(skill => skill.invocation === 'model').length
  const summary = `${skills.length} skills (${modelInvocable} model-invoked, `
    + `${skills.length - modelInvocable} user-invoked) from ${source.repository ?? 'upstream'}`
    + `${source.commit ? `@${source.commit.slice(0, 7)}` : ''}`

  if (options.check) {
    const problems = await reportDrift(skills, record)
    if (problems.length > 0) {
      console.error(`vendored skills are out of date with ${options.upstream}:`)
      for (const problem of problems) console.error(`  ${problem}`)
      console.error('run: node scripts/sync-skills.mjs')
      process.exit(1)
    }
    console.log(`up to date: ${summary}`)
    return
  }

  await writeVendoredSkills(skills)
  await writeFile(UPSTREAM_RECORD, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  console.log(`vendored ${summary}`)
}

await main()
