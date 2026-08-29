# Skills marketplace

JuCode Desktop combines two upstream sources in one marketplace:

- the official JuCode marketplace at `/v1/skills/marketplace`;
- [`anthropics/skills`](https://github.com/anthropics/skills), fetched directly from GitHub.

Desktop does not mirror or self-host either source. The Anthropic listing uses the small public
metadata snapshot in `src-tauri/resources/anthropic-skills.json` so GitHub API availability and
anonymous rate limits cannot make the source disappear. Installing one of those skills fetches its
current files directly from `raw.githubusercontent.com` after reading the repository tree from the
GitHub API.

Use `node scripts/refresh-anthropic-skills.mjs` to refresh the snapshot. The script discovers public
skill directories through the GitHub Contents API, reads each `SKILL.md` frontmatter, checks its
`LICENSE.txt`, and preserves curated tags already in the snapshot. Review the diff, especially
license classification, before committing an update.

## Install location and safety

The active session backend selects the personal install directory:

- JuCode and Codex sessions: `~/.jucode/skills/<id>`;
- Claude Code sessions: `~/.claude/skills/<id>`.

Skill IDs and every downloaded relative path are validated before joining them to that directory.
GitHub tree links, submodules, absolute paths, and parent traversal are rejected. Downloads are
limited to 20 MiB per file, 100 MiB total, and 4,096 files. JuCode zip and tar.gz packages retain
their existing 20 MiB compressed limit, 100 MiB extracted limit, and the same traversal/link/file
count checks. Installation stages files next to the destination and atomically replaces the old
version only after a valid `SKILL.md` exists.

Skills are executable instructions and may include scripts. Treat installation like installing
software and review upstream content before using it with sensitive projects.

## Anthropic document-skill licensing

Most examples in `anthropics/skills` are Apache-2.0. The `docx`, `pdf`, `pptx`, and `xlsx` folders
are different: Anthropic describes them as source-available rather than open source, and their
terms prohibit redistribution. JuCode does not bundle or redistribute those files; an explicit
install downloads the selected folder from Anthropic's GitHub repository to the user's machine.
Users remain responsible for the upstream terms.

Anthropic's preset document skills for Word, PDF, PowerPoint, and Excel are available in supported
Claude API/hosted surfaces, but they are not preset skills in Claude Code. Claude Code supports
filesystem-based custom skills instead. A repository copy installed into `~/.claude/skills` is a
custom skill and does not become, or carry the runtime guarantees of, Anthropic's preset hosted
skill.
