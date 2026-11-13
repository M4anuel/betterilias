# Dependabot review — 13 November 2026

The overlapping frontend PRs are consolidated into a single tested dependency
update and regenerated npm lockfile. Existing application changes are preserved.

| PR | Update | Decision |
| --- | --- | --- |
| #1 | docker/metadata-action 6.2.0 | Apply pinned commit |
| #2 | docker/setup-qemu-action 4.4.0 | Apply pinned commit |
| #3 | Python image 3.15 | Defer; retain Python 3.14 |
| #4 | docker/setup-buildx-action 4.4.1 | Apply pinned commit |
| #5 | Node image 26 | Apply pinned image; align CI with Node 26 LTS |
| #6 | docker/build-push-action 7.4.0 | Apply pinned commit |
| #7 | docker/login-action 4.8.0 | Apply pinned commit |
| #8, #11 | React DOM / React 19.3.1 | Apply together |
| #9 | lucide-react 1.70.0 | Apply |
| #10 | TypeScript 7.0.2 | Apply with the official compiler-API compatibility package |
| #12 | @vitejs/plugin-react 6.2.1 | Apply |

## TypeScript compatibility

The failing PR called `ScriptTarget.Latest` through `require('typescript')`.
TypeScript 7 supplies a native CLI and no JavaScript compiler API. The localisation
scanner needs AST traversal, and allocation-preference tests use `transpileModule`.
Both now import `@typescript/typescript6`; the build invokes TypeScript 7's CLI
by its package path, avoiding a hoisted compatibility dependency shadowing the
`tsc` executable. This follows
[Microsoft's documented side-by-side approach](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
Localisation checks remain mandatory and no checks are suppressed.

## Python 3.15 deferral

PR #3 fails in the actual production Docker build: the runtime lock pins
`pydantic-core==2.46.5`, for which pip cannot find a CPython 3.15 binary wheel.
The Docker build intentionally requires binary wheels and hashes. Switching the
image alone cannot work; changing that policy would weaken the existing build.
Revisit Python 3.15 with an explicit Pydantic/runtime-lock migration and Linux
amd64/arm64 container verification. The temporary Dependabot ignore covers only
Python 3.15; other version/digest updates remain enabled.

## CI and future updates

The new Docker Actions use Node 24 internally and require runner 2.327.1 or later;
the workflow uses GitHub-hosted `ubuntu-latest`. No removed inputs or outputs are
used by this workflow. Every Action remains pinned to the commit proposed by its PR.
The application's frontend build and CI use Node 26, currently
[an LTS release](https://nodejs.org/en/about/previous-releases).

Future React/React DOM updates are grouped so their versions can be verified
together. Docker Actions are grouped into one review; automatic merging is not enabled.

Verification includes the full backend suite, native TypeScript/Vite build,
localisation and JavaScript tests, representative mobile/navigation/management
browser regressions, npm audit, launcher syntax, and the production container
build/HTTPS smoke test. Browser regressions use mocked Chromium emulation, not
physical Apple/Android devices or live ILIAS sessions. Hosted CI must also pass
before the reviewed result is published to main.

The older sidebar browser case assumed removing the final divider automatically
restored subject groups. Current per-semester custom navigation intentionally keeps
the remaining order; the regression now exercises the existing explicit reset
button and still verifies draft preservation, divider removal and restored groups.
