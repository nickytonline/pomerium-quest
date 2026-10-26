# Agent guidelines

## Commits

- Commit often, in logical pieces: one commit per change that stands on its own. Split a larger
  feature as you build it (for example the engine, then each place it's wired in, then the UI)
  rather than landing it as one big commit at the end.
- Commit each piece once `npm run check` passes, and push to `main` right away.
- Use conventional commits with a scope, such as `feat(game): …`, `fix(quest): …` or `feat(oracle): …`.
- Don't rewrite history that's already pushed.
