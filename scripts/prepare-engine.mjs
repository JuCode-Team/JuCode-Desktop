// Build the jucode engine (release) from the JuCode-CLI checkout and stage it as
// a Tauri sidecar named with the host target triple, so `tauri build` can bundle
// it next to the app binary. Cross-platform (macOS / Linux / Windows) so it works
// both locally and in CI; the bash original only handled Unix.
//
// JuCode-CLI is resolved from JUCODE_CLI_DIR, else a sibling `../JuCode-CLI`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.JUCODE_CLI_DIR
	? resolve(process.env.JUCODE_CLI_DIR)
	: join(root, '..', 'JuCode-CLI');

if (!existsSync(join(cli, 'Cargo.toml'))) {
	console.error(`JuCode-CLI checkout not found at ${cli} (set JUCODE_CLI_DIR to override)`);
	process.exit(1);
}

// Host target triple, e.g. aarch64-apple-darwin / x86_64-pc-windows-msvc.
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
	.split('\n')
	.find((l) => l.startsWith('host:'))
	?.slice('host:'.length)
	.trim();
if (!triple) {
	console.error('could not determine host target triple from `rustc -vV`');
	process.exit(1);
}

execFileSync(
	'cargo',
	['build', '--release', '--manifest-path', join(cli, 'Cargo.toml'), '--bin', 'jucode'],
	{ stdio: 'inherit' }
);

const ext = process.platform === 'win32' ? '.exe' : '';
const src = join(cli, 'target', 'release', `jucode${ext}`);
const outDir = join(root, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, `jucode-${triple}${ext}`);
copyFileSync(src, dest);
console.log(`staged engine sidecar: ${dest}`);
