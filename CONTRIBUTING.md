# Contributing to Nysera Desktop

Thanks for helping! Nysera is small on purpose, so a short, focused change is the easiest to review.

## Reporting a bug

Open an [issue](https://github.com/nysera-dev/nysera-desktop/issues/new/choose) with:

- what you ran or clicked, and what you expected
- what happened instead (error text or a screenshot)
- App version (bottom of the sidebar) and your OS (e.g. macOS 15 on Apple silicon, Windows 11)

**Never paste your OpenRouter API key** into an issue, a log or a screenshot.

## Suggesting a feature

Open a feature request and describe the problem first, then the change you have in mind.

## Working on the code

```bash
git clone https://github.com/nysera-dev/nysera-desktop
cd nysera-desktop
npm install
npm start
```

- No new runtime dependencies without a good reason — the project uses plain Node.js.
- Keep the honesty rules: a lane is only `verified` when a test or review actually passed.
- Try your change with demo mode on and with a real key, on the OS you changed things for.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change and describe *why* in the PR.
3. Link the issue it fixes, if there is one.

By contributing you agree your work is released under the [MIT License](LICENSE).
