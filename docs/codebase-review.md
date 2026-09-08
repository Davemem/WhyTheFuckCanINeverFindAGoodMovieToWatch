# Codebase review — 8 September 2026

Reviewed the frontend pages and shared UI scripts, API routing and discovery, authentication and saved-data stores, database schemas, ingestion scripts, dependency lockfile, and deployment configuration.

## Changes

- Fixed repeated searches invalidating their own pending results, stale suggestions crossing categories, and reset allowing old results to reappear.
- Prevented delayed session, account, and library responses from replacing newer account state. Serialized account saves so rapid toggles use confirmed results. Synchronized anonymous saves across tabs and stopped account enrichment from leaking into anonymous storage.
- Matched filmography enrichment batches to the API's two-movie limit and preserved previously enriched cards during overlapping requests.
- Split large imports into requests of 20 records per collection and committed each import request transactionally. Enforced safe movie IDs, typed library flags, and bounded JSON nesting. Preserved UTF-8 characters split across request chunks and returned proper errors for invalid or oversized JSON.
- Required verified Google emails, serialized first sign-ins by provider subject, and prevented automatic takeover of an existing account by a different subject sharing its email. Logout now reports database revocation failures instead of silently claiming success.
- Shared simultaneous upstream/discovery requests, moved server disk-cache reads and writes off the synchronous path, made cache writes atomic, and reused parsed people indexes until the file changes. Corrected TMDb's minimum-vote parameter and removed credential-bearing URLs from upstream errors.
- Avoided retrying SQL statements after ambiguous failures and handled idle connection errors.
- Protected hydration with a Postgres session lock, recovered interrupted batches, saved completed people promptly, and isolated bad records. Made recognition replacement transactional and restricted it to hydrated people. Fixed export stream completion timing and reused the bounded-memory export reader in index builds.
- Added browser-state, HTTP/cache, export, and Postgres integration regressions, syntax checks, reproducible npm builds, and explicit deployment-job skipping when GitHub hooks are absent. Added a health endpoint reporting the deployed commit.

## Verification coverage

The local suite exercises real frontend scripts in jsdom, HTTP request parsing over a local server, concurrent cache behavior, and a real curl/gzip export stream. The integration suite uses an explicit disposable Postgres database and checks recognition rollback, exclusive worker execution, abandoned claims, partial hydration failure, concurrent account creation, and saved-library behavior. GitHub Actions provisions that database.

Browser smoke checks cover anonymous search, save, watched status, and saved-title navigation. Deployment verification checks Render's web and worker status and the live web revision. Google Identity Services itself still requires a real interactive Google sign-in; mocked browser sessions and database tests do not substitute for that flow.

## Remaining considerations

The custom server remains a large module, and the frontend retains some legacy local-storage fallback duplication. Breaking these apart is a separate architectural change. Upstream movie/award/provider coverage remains dependent on TMDb and OMDb. Cache files remain subject to the host's disk lifecycle; cache size and public API traffic limits merit monitoring as usage grows.
