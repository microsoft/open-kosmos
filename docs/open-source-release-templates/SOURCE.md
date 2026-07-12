# Open-Source Release Template Source

The initial files were copied from `microsoft/open-kosmos` at commit
`e2567e84f87bdaa2a181f1c612bc1460aaeb2039` on 2026-07-11:

- `LICENSE`
- `NOTICE`
- `SECURITY.md`
- `SUPPORT.md`
- `CODE_OF_CONDUCT.md`

`CONTRIBUTING.md` and `ISSUE_TEMPLATE.md` are derived from the Microsoft
repository templates at `microsoft/repo-templates` commit
`53e37ec5034556dc89c0ff8dc9e169a1dae0282b`:

- `projections/azure-samples/CONTRIBUTING.md`
- `projections/azure-samples/.github/ISSUE_TEMPLATE.md`

The raw SHA-256 values supplied with the approved `microsoft/open-kosmos`
reference are:

| File | Raw SHA-256 |
| --- | --- |
| `LICENSE` | `4431f3d58587618414187c833224cb95481965b6855f520a87c6921f42130e78` |
| `NOTICE` | `a801f4107f82e3e889b9eeaa4665e7273eea08b17bb479360af944e57cfd9e79` |
| `SECURITY.md` | `4cc9236d2b3a6f7fd3718d7596396ade0b5146bf921f660852216d26e35f8022` |
| `SUPPORT.md` | `d2dc6c986379493ff56d5f4a6fddec3e7326c30382b7e1459938e1fe40cc4d29` |
| `CODE_OF_CONDUCT.md` | `9d45a586fce701502d173a7c10c71c8bd4f23e23d5a4a06e9d00eb57a9c11205` |

The checker normalizes CRLF to LF, strips trailing spaces and tabs from every
line, and retains exactly one final newline before hashing or comparing files.
The approved source versions of `NOTICE` and `SUPPORT.md` are retained under
`upstream/` because their published templates require the following
substitutions:

- `NOTICE` replaces the generic `npx license-checker --summary` instruction
  with the repository's deterministic inventory command and generated evidence
  paths. It does not assert that the upstream third-party list is complete.
- `SUPPORT.md` removes the unpublished owner TODO and maintainer placeholders,
  directs public questions and bugs to GitHub Issues, and directs security
  reports to `SECURITY.md`.

Other permitted substitutions in derived templates are the project name,
relative repository links, current operating-system language, and instructions
that prevent public disclosure of credentials, personal data, or
vulnerabilities. The Microsoft security and code-of-conduct blocks are
invariant and must not be paraphrased.

The active root files are normalized exact copies of the reviewed active
templates. Automated checks enforce active-template equality, canonical
upstream checksums, and post-substitution template checksums. `NOTICE` is
supplemented by the generated dependency inventory; legal review of bundled
binaries and final copyright ownership remains required before publication.

Approving owner: pending designation by the repository owner and Legal/Open
Source review. This unresolved organizational approval is tracked in
`docs/open-source-release-cleanup.md` and is not represented as completed by
the checksum check.
