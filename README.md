<div align="center">

<img src="docs/logo.png" width="96" alt="Nysera logo">

# Nysera Desktop

**Your AI agents and multi-model lanes, in one window.**
Chat with Nysera, Aria and Juno, or hand a whole task to the crew and watch the lanes get verified.

[![Latest release](https://img.shields.io/github/v/release/nysera-dev/nysera-desktop?style=flat-square&color=c58cff)](https://github.com/nysera-dev/nysera-desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/nysera-dev/nysera-desktop/total?style=flat-square&color=ff7ac2)](https://github.com/nysera-dev/nysera-desktop/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/nysera-dev/nysera-desktop/build.yml?style=flat-square&label=build)](https://github.com/nysera-dev/nysera-desktop/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-b8d86b?style=flat-square)](LICENSE)

<a href="https://github.com/nysera-dev/nysera-desktop/releases/latest/download/Nysera-mac-arm64.dmg"><img src="https://img.shields.io/badge/Download-macOS%20(Apple%20silicon)-ff7ac2?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS (Apple silicon)"></a>
<a href="https://github.com/nysera-dev/nysera-desktop/releases/latest/download/Nysera-Setup-win-x64.exe"><img src="https://img.shields.io/badge/Download-Windows%20(x64)-c58cff?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows (x64)"></a>

[Website](https://nysera.app) · [CLI](https://github.com/nysera-dev/nysera) · [Releases](https://github.com/nysera-dev/nysera-desktop/releases)

<img src="docs/desktop-run.png" alt="Nysera Desktop: three lanes run in parallel and verified by a test command" width="860">

</div>

---

## Features

- **Bots** — **Nysera** (lead coding agent), **Aria** (research) and **Juno** (ops & deploys). Pick any OpenRouter model per chat; replies stream in and history is kept.
- **Run lanes** — choose a project folder and describe a task. A planner splits it into lanes, lanes run in parallel on each category's model chain (with automatic fallback), and a lane is only **verified** when your test command passes or a reviewer model passes it. Same engine as the [`nysera` CLI](https://github.com/nysera-dev/nysera).
- **Safe writes** — files are only written into the project when you tick *Write files*, and originals are backed up into the run folder first.
- **Your key, your machine** — your OpenRouter key is stored locally, encrypted with your OS keychain when available. Model chains are shared with the CLI.
- **Always real** — every chat reply and every lane comes from a live model on your own OpenRouter key.

<img src="docs/desktop-chat.png" alt="Chatting with the Nysera bot" width="860">

## First launch

The app is not code-signed yet, so your OS will warn you the first time:

| OS | What to do |
|---|---|
| macOS | Open the app once, then go to **System Settings → Privacy & Security → Open Anyway**. |
| Windows | On the blue SmartScreen screen, click **More info → Run anyway**. |

Then open **Settings** in the app and paste an [OpenRouter API key](https://openrouter.ai/settings/keys) to start.

## Develop

```bash
npm install
npm start
```

## Release

Bump `version` in `package.json` and push to `main`. GitHub Actions builds the macOS `.dmg` (Apple silicon, ad-hoc signed) and the Windows `.exe`, and publishes them as release `vX.Y.Z`. The download buttons above always point at the latest release.

## Contributing

Bug reports and ideas are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and open an [issue](https://github.com/nysera-dev/nysera-desktop/issues/new/choose).

## License

[MIT](LICENSE)
