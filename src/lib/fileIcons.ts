// File type icons for the file references a reply names: the common types
// from the VS Code Material Icon Theme (MIT), mapped the way its manifest
// (dist/material-icons.json) maps them. A type not listed gets the plain file.

const svgs = import.meta.glob<string>(
	'/node_modules/material-icon-theme/icons/{markdown,mdx,typescript,typescript-def,react_ts,javascript,react,rust,go,python,ruby,java,kotlin,swift,c,h,cpp,hpp,csharp,php,lua,dart,zig,svelte,vue,html,css,sass,json,toml,toml_light,yaml,xml,settings,tune,console,powershell,database,proto,graphql,svg,image,pdf,video,audio,table,zip,document,log,lock,diff,git,webassembly,jupyter,terraform,nix,nodejs,tsconfig,docker,makefile,readme,license,changelog,agent,claude,go-mod,pnpm,pnpm_light,vite,file}.svg',
	{ query: '?raw', import: 'default', eager: true }
);

/** Whole file names, lower case. */
const NAMES: Record<string, string> = {
	'package.json': 'nodejs',
	'tsconfig.json': 'tsconfig',
	dockerfile: 'docker',
	makefile: 'makefile',
	'readme.md': 'readme',
	license: 'license',
	'changelog.md': 'changelog',
	'agents.md': 'agent',
	'claude.md': 'claude',
	'.gitignore': 'git',
	'go.mod': 'go-mod',
	'pnpm-lock.yaml': 'pnpm',
	'pnpm-workspace.yaml': 'pnpm',
	'vite.config.ts': 'vite',
	'vite.config.js': 'vite',
	'svelte.config.js': 'svelte'
};

/** Extensions, lower case; the longest that matches wins (`d.ts` over `ts`). */
const EXTS: Record<string, string> = {
	md: 'markdown', markdown: 'markdown', mdx: 'mdx',
	ts: 'typescript', mts: 'typescript', cts: 'typescript', 'd.ts': 'typescript-def', tsx: 'react_ts',
	js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'react',
	rs: 'rust', go: 'go', py: 'python', rb: 'ruby', java: 'java', kt: 'kotlin', kts: 'kotlin',
	swift: 'swift', c: 'c', h: 'h', cpp: 'cpp', cc: 'cpp', hpp: 'hpp', cs: 'csharp',
	php: 'php', lua: 'lua', dart: 'dart', zig: 'zig',
	svelte: 'svelte', vue: 'vue', html: 'html', css: 'css', scss: 'sass',
	json: 'json', jsonc: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml', xml: 'xml', plist: 'xml',
	ini: 'settings', conf: 'settings', env: 'tune',
	sh: 'console', bash: 'console', zsh: 'console', bat: 'console', ps1: 'powershell',
	sql: 'database', proto: 'proto', graphql: 'graphql',
	svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
	pdf: 'pdf', mp4: 'video', mov: 'video', mp3: 'audio', wav: 'audio', csv: 'table',
	zip: 'zip', gz: 'zip', txt: 'document', log: 'log', lock: 'lock',
	diff: 'diff', patch: 'git', wasm: 'webassembly', ipynb: 'jupyter', tf: 'terraform', nix: 'nix'
};

/** The icons drawn too light for a light background, which the theme redraws. */
const LIGHT = new Set(['toml', 'pnpm']);

/** The icon name for a file path. */
export function fileIconName(path: string): string {
	const base = path.split(/[\\/]/).pop()!.toLowerCase();
	if (NAMES[base]) return NAMES[base];
	for (let i = base.indexOf('.'); i !== -1; i = base.indexOf('.', i + 1)) {
		const icon = EXTS[base.slice(i + 1)];
		if (icon) return icon;
	}
	return 'file';
}

// Inline SVGs share the page's ids: each icon's own go under its name.
const svg = (name: string, cls: string) =>
	svgs[`/node_modules/material-icon-theme/icons/${name}.svg`]
		.replace(/(id="|url\(#|href="#)/g, `$1fi-${name}-`)
		.replace('<svg ', `<svg class="${cls}" aria-hidden="true" `);

/** The icon for a file path, as inline SVG markup. */
export function fileIconHtml(path: string): string {
	const name = fileIconName(path);
	return LIGHT.has(name) ? svg(name, 'fi fi-dark') + svg(`${name}_light`, 'fi fi-light') : svg(name, 'fi');
}
