# Agent Notes

## Fork Branch Map

This fork keeps upstream sync, local integration, and PR work separated.

```text
kwickramasekara/opencode-chat:main
        │
        ▼
origin/upstream                 mirror of upstream/main
        │
        ▼
origin/main                     fork integration branch with accepted/local features
        ├── origin/fix/remote-vscode-mode   PR branch for one upstream PR
        └── origin/<type>/<short-topic>      future per-PR branches
```

| Branch | Purpose |
| --- | --- |
| `upstream` | Exact mirror of upstream `main`; do not add fork changes here. |
| `main` | Integration branch for this fork; may contain multiple local/PR-ready features. |
| `<type>/<short-topic>` | One upstream PR branch per focused change. |

When creating upstream PRs, branch from the fork's current intended base, push the per-PR branch, and open the PR from that branch — not from `main`.
