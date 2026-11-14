# Nysera Desktop

Chat with your AI agents and run multi-model lanes on your own projects — in one window.

- **Bots** — Nysera (coding), Aria (research), Juno (ops). Pick any OpenRouter model per chat. Replies stream in.
- **Run lanes** — choose a project folder, describe a task. A planner splits it into lanes, lanes run in parallel on each category's model chain (with fallback), and a lane is only **verified** when your test command passes or a reviewer model passes it. Same engine as the [`nysera` CLI](https://nysera.app).
- **Your key, your machine** — your OpenRouter key is stored locally, encrypted with the OS keychain when available. Model chains are shared with the CLI (`~/.nysera/routing/model-chains.json`).
- **Demo mode** — try everything with canned replies, no key needed.

## Download

Get the latest installers from [Releases](../../releases/latest):

| OS | File |
|---|---|
| macOS (Apple silicon) | `Nysera-mac-arm64.dmg` |
| Windows (x64) | `Nysera-Setup-win-x64.exe` |

The app is not code-signed yet:
- **macOS:** open it once, then go to System Settings → Privacy & Security → **Open Anyway**.
- **Windows:** on the SmartScreen screen click **More info → Run anyway**.

## Develop

```bash
npm install
npm start
```

## Release

Bump the version in `package.json` and push to `main`. GitHub Actions builds the macOS `.dmg` and Windows `.exe` and attaches them to a release.

```bash
npm version patch --no-git-tag-version && git commit -am "v$(node -p "require('./package.json').version")" && git push
```

## License

MIT
