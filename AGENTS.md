# Project boundaries

This repository contains a localhost-only synthetic prototype. Keep all existing user data outside this repository.
- Do not read or import messenger exports, derived datasets, credentials, or other project files unless the user explicitly authorizes that separate work.
- Never commit environment files, keys, databases, user relationship settings, conversations, exports, or caches.
- Synthetic fixtures must clearly identify themselves as fictional.
- Demo identity headers are intentionally not production authentication. Keep the production startup block and loopback binding.
- Do not add a model/API call, deployment, persistent credential, remote repository, or push without authorization for that step.
- Run npm run typecheck, npm run lint, and npm test after behavioral changes.

## Public source policy

Only public-safe code, synthetic fixtures, generic requirements and tests may enter main. Never push local archival branches/tags or user conversation quotations. Audit file contents and reachable commit metadata before an explicit branch push. Use the public GitHub login and noreply email for public commits. Repository visibility does not authorize personal-data transfer or app deployment.
