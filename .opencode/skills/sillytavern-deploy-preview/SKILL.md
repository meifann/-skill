---
name: sillytavern-deploy-preview
description: Use when deploying, starting, previewing, or validating a SillyTavern web instance in the workspace.
---

# SillyTavern Deploy Preview

Deploy and validate a SillyTavern instance for local development and platform preview.

## Workflow

1. Locate the SillyTavern project by finding a `package.json` whose name is `sillytavern`.
2. Read the project README and existing `config.yaml` before changing configuration.
3. Install dependencies with the package manager used by the repository.
4. Preserve existing user data, authentication, and unrelated configuration values.
5. Apply the preview configuration described in `references/configuration.md`.
6. Load the `deploy-website` skill and start the server through its background terminal workflow.
7. Confirm the server listens on the expected port and returns HTTP 200.
8. Run the bundled Playwright validator from the repository root:

```bash
node .opencode/skills/sillytavern-deploy-preview/scripts/verify-playwright.mjs /workspace/SillyTavern http://127.0.0.1:8000
```

9. Request the platform preview URL for the listening port and verify its proxy status.

## Safety Rules

- Keep authentication enabled for any network-accessible instance.
- Treat `securityOverride: true` as a temporary development setting requiring explicit user approval.
- Preserve `dataRoot` and never overwrite user chats, characters, personas, or secrets.
- Use managed background terminals for the server process.
- Stop only the managed terminal that was started for this deployment.
- Never terminate processes by name or force-kill an unknown port owner.

## Validation Criteria

- The home page returns HTTP 200.
- The document title contains `SillyTavern`.
- The rendered page includes `SillyTavern` and at least one of `Chat`, `Characters`, or `API`.
- `/style.css` and `/manifest.json` return successful responses.
- A screenshot is written to `/tmp/sillytavern-playwright.png`.

## Recovery

- For a YAML duplicate-key error, edit the existing key and keep one canonical value.
- For a port conflict, identify the owning process and reuse its port when it is the intended server.
- For a preview connection error, inspect the managed terminal log and confirm the server listens on `0.0.0.0`.
- For a Playwright import error, install the repository development dependencies before validation.
