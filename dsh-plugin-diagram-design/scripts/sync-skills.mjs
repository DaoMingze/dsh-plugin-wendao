#!/usr/bin/env node
/**
 * Vendor the skill bundles an upstream Agent Skills repository ships into this
 * package's `skills/` root, and record what was vendored in `upstream.json`.
 *
 * The upstream working tree is the authoritative list: every
 * `<upstream>/skills/<name>/SKILL.md` is one skill. Each skill's frontmatter is
 * validated against the rules @deepseek-ai/dsh-skill-filesystem enforces,
 * because a rejected field drops the whole skill from the catalog with nothing
 * but a warning, and a rejected *skill* is invisible to the model.
 *
 * A second gate proves the vendored bundle is self-contained: every relative
 * `references/`, `assets/`, and `scripts/` target `SKILL.md` routes to must
 * exist inside the bundle. That is what makes the copy usable rather than
 * merely present.
 *
 * `--check` answers "would sync change anything", for CI and pre-commit.
 *
 * Usage:
 *   node scripts/sync-skills.mjs [--check] [--upstream <dir>]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')
const UPSTREAM_RECORD = join(PACKAGE_ROOT, 'upstream.json')
const UPSTREAM_MANIFEST = join('.claude-plugin', 'plugin.json')
const SKILL_FILE = 'SKILL.md'

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
 * the whole skill, so the sync must fail loudly instead.
 */
const FORBIDDEN_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
])

/**
 * Resource roots this package promises to ship whole. A `SKILL.md` link into
 * one of these that the bundle does not contain is a broken port.
 */
const BUNDLED_RESOURCE_ROOTS = ['references', 'assets', 'scripts']

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BOOLEAN_WORDS = new Set(['true', 'yes', 'on', 'false', 'no', 'off', '1', '0'])

function parseArguments(argv) {
  const options = { check: false, upstream: resolve(PACKAGE_ROOT, '..', 'diagram-design') }
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

/**
 * Collapse CRLF to LF, at the byte level.
 *
 * A local checkout is not authoritative for content: under `core.autocrlf` or a
 * `.gitattributes` filter, one repository blob lands on disk as LF on one
 * machine and CRLF on another. Both `sync` and `--check` therefore compare and
 * write LF-normalized bytes, so a Windows checkout cannot be mistaken for
 * drift. (This upstream pins `SKILL.md` to `eol=lf` for its own byte cap; the
 * normalization here keeps every vendored file on the same footing.)
 */
function normalizeNewlines(buffer) {
  const bytes = []
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) continue
    bytes.push(buffer[index])
  }
  return Buffer.from(bytes)
}

/** Read a file as LF-normalized UTF-8 text. */
async function readText(path) {
  return normalizeNewlines(await readFile(path)).toString('utf8')
}

/** Split `---` delimited frontmatter from the body, as the provider does. */
function splitFrontmatter(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') throw new Error('missing leading "---"')
  const closing = lines.indexOf('---', 1)
  if (closing < 0) throw new Error('missing closing "---"')
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
  if (!name) problems.push('frontmatter has no "name"')
  if (!description) problems.push('frontmatter has no "description"')
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

  const allowsModel = !keys.includes('disable-model-invocation')
    || !['true', 'yes', 'on', '1'].includes(
      (frontmatterScalar(frontmatterLines, 'disable-model-invocation') ?? '').toLowerCase(),
    )
  const allowsUser = !keys.includes('user-invocable')
    || ['true', 'yes', 'on', '1'].includes(
      (frontmatterScalar(frontmatterLines, 'user-invocable') ?? '').toLowerCase(),
    )
  if (!allowsModel && !allowsUser) {
    problems.push('the invocation policy hides the skill from both the model and the human')
  }

  return {
    name,
    description,
    version: frontmatterScalar(frontmatterLines, 'version'),
    invocation: allowsModel ? 'model' : 'user',
    descriptionBytes: Buffer.byteLength(description ?? '', 'utf8'),
    problems,
    warnings,
  }
}

/**
 * Every relative `references/`, `assets/`, and `scripts/` target that
 * `SKILL.md` routes to must exist inside the bundle.
 */
function checkResourceClosure(skillDir, raw) {
  const problems = []
  const seen = new Set()
  for (const match of raw.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || seen.has(target)) continue
    seen.add(target)
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('<')) continue
    const segments = target.split('/')
    if (segments.length < 2 || !BUNDLED_RESOURCE_ROOTS.includes(segments[0])) continue
    if (!existsSync(join(skillDir, target))) {
      problems.push(`${SKILL_FILE} links to "${target}", which the bundle does not contain`)
    }
  }
  return problems
}

function execFileSyncSafe(operation) {
  try {
    return operation()
  } catch {
    return undefined
  }
}

/** Every file under a skill bundle, relative to it, sorted. */
async function collectBundleFiles(skillDir, current = skillDir, collected = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) await collectBundleFiles(skillDir, absolute, collected)
    else if (entry.isFile()) collected.push(relative(skillDir, absolute).split(sep).join('/'))
  }
  return collected.sort()
}

async function digestBundle(skillDir, files) {
  const hash = createHash('sha256')
  for (const file of files) {
    const content = normalizeNewlines(await readFile(join(skillDir, file)))
    hash.update(file)
    hash.update('\0')
    hash.update(createHash('sha256').update(content).digest('hex'))
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** Discover `<upstream>/skills/<name>/SKILL.md` bundles and validate each one. */
async function readUpstream(upstreamDir) {
  const manifestPath = join(upstreamDir, UPSTREAM_MANIFEST)
  if (!existsSync(manifestPath)) {
    throw new Error(`no ${UPSTREAM_MANIFEST} under ${upstreamDir}; is that the checkout?`)
  }
  const manifest = JSON.parse(await readText(manifestPath))

  const skillsRoot = join(upstreamDir, 'skills')
  if (!existsSync(skillsRoot)) throw new Error(`no skills/ directory under ${upstreamDir}`)
  const directoryNames = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(join(skillsRoot, name, SKILL_FILE)))
    .sort()
  if (directoryNames.length === 0) {
    throw new Error(`no <upstream>/skills/<name>/${SKILL_FILE} bundles found`)
  }

  const skills = []
  const failures = []
  const warnings = []
  for (const directoryName of directoryNames) {
    const skillDir = join(skillsRoot, directoryName)
    const raw = await readText(join(skillDir, SKILL_FILE))
    const contract = readSkillContract(directoryName, raw)
    const closureProblems = checkResourceClosure(skillDir, raw)
    for (const problem of [...contract.problems, ...closureProblems]) {
      failures.push(`${directoryName}: ${problem}`)
    }
    for (const warning of contract.warnings) warnings.push(`${directoryName}: ${warning}`)
    if (contract.problems.length > 0 || closureProblems.length > 0) continue

    const files = await collectBundleFiles(skillDir)
    skills.push({
      name: contract.name,
      version: contract.version ?? null,
      invocation: contract.invocation,
      descriptionBytes: contract.descriptionBytes,
      files,
      digest: await digestBundle(skillDir, files),
      sourceDir: skillDir,
    })
  }

  if (failures.length > 0) {
    throw new Error(`upstream skills failed validation:\n  ${failures.join('\n  ')}`)
  }
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
    manifest: UPSTREAM_MANIFEST.split(sep).join('/'),
  }
}

function buildRecord(source, skills) {
  return {
    source,
    vendored: {
      note: 'Skill files are copied byte for byte with LF line endings; no upstream path is excluded.',
      roots: BUNDLED_RESOURCE_ROOTS,
    },
    skills: skills.map(skill => ({
      name: skill.name,
      version: skill.version,
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
      // Written normalized, so the vendored tree is LF whatever the checkout was.
      await writeFile(destination, normalizeNewlines(await readFile(join(skill.sourceDir, file))))
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

  const expected = new Set(skills.map(skill => skill.name))
  if (existsSync(SKILLS_DIR)) {
    for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !expected.has(entry.name)) {
        problems.push(`skills/${entry.name} is not shipped by the upstream skills tree`)
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

  const fileCount = skills.reduce((total, skill) => total + skill.files.length, 0)
  const summary = `${skills.length} skill (${fileCount} files) from `
    + `${source.repository ?? 'upstream'} v${source.version ?? '?'}`
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
  for (const skill of skills) {
    console.log(`  ${skill.name}: ${skill.files.length} files, `
      + `description ${skill.descriptionBytes} bytes, invocation ${skill.invocation}`)
  }
}

await main()
