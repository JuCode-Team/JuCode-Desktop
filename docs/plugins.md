# First-party plugins

JuCode Desktop uses a small built-in plugin registry. It is not a third-party JavaScript runtime: plugins are TypeScript modules shipped with the app, and native capabilities can be exposed through narrowly scoped Tauri commands.

Each manifest in `src/lib/plugins/registry.ts` declares:

- `id` and human-readable `name`
- the plugin-owned `commands`
- an optional required `bin`
- whether the plugin is enabled by default

Users can enable or disable plugins in **Settings → Extensions → Plugins**. The choice is stored locally. Disabled plugins do not initialize or show their GitPanel controls.

## GitHub Pull Requests

`src/lib/plugins/github-pr.ts` owns GitHub CLI detection, authentication checks, PR lookup, and PR creation. Its optional binary is `gh`.

The native bridge is isolated in `src-tauri/src/plugins/github_pr.rs`. It runs without prompts and allows only the arguments required by the plugin (`--version`, `auth status`, `pr view`, and `pr create`). It does not provide arbitrary shell or GitHub CLI execution.

To add another first-party plugin, add its manifest and module to the registry, keep its UI behind the enabled setting, and add a focused native allowlist only when the feature needs OS-level access.
