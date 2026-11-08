#!/usr/bin/env node
// Usage: pnpm release <patch|minor|major|x.y.z[-pre]> [--no-git]
// Bumps the version in package.json, src-tauri/tauri.conf.json and
// src-tauri/Cargo.toml (+ Cargo.lock), commits, and creates a vX.Y.Z tag.
// Then push with: git push --follow-tags
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const noGit = args.includes('--no-git')
const arg = args.find((a) => !a.startsWith('--'))
if (!arg) {
    console.error('Usage: pnpm release <patch|minor|major|x.y.z>')
    process.exit(1)
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = (cmd) => execSync(cmd).toString().trim()

if (!noGit && out('git status --porcelain')) {
    console.error('Working tree is not clean. Commit or stash changes first.')
    process.exit(1)
}

const pkgPath = 'package.json'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = pkg.version.split('-')[0].split('.').map(Number)

let next
if (arg === 'patch') next = `${maj}.${min}.${pat + 1}`
else if (arg === 'minor') next = `${maj}.${min + 1}.0`
else if (arg === 'major') next = `${maj + 1}.0.0`
else if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg)) next = arg
else {
    console.error(`Invalid version: ${arg}`)
    process.exit(1)
}

const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, 'utf8')))
const replaceFirst = (re, to) => (s) => {
    if (!re.test(s)) throw new Error(`version not found for ${re}`)
    return s.replace(re, to)
}

edit(pkgPath, replaceFirst(/("version":\s*")[^"]+(")/, `$1${next}$2`))
edit('src-tauri/tauri.conf.json', replaceFirst(/("version":\s*")[^"]+(")/, `$1${next}$2`))
edit('src-tauri/Cargo.toml', replaceFirst(/^(version\s*=\s*")[^"]+(")/m, `$1${next}$2`))

// Refresh Cargo.lock for the new package version.
run('cargo update --manifest-path src-tauri/Cargo.toml --package hub')

if (noGit) {
    console.log(next)
    process.exit(0)
}

run('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock')
run(`git commit -m "chore(release): v${next}"`)
run(`git tag -a v${next} -m "v${next}"`)
console.log(`\nTagged v${next}. Publish with:\n  git push --follow-tags`)
