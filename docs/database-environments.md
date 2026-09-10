# CIV database environments

CIV uses one Neon project with separate `development` and `production`
branches. A staging branch can be added later without changing this convention.

## Variables

- `APP_ENV` is `development` locally and `production` in the deployed app.
- `DATABASE_URL` is the pooled Neon connection used by the running application.
  Its hostname includes `-pooler`.
- `DIRECT_URL` is the matching direct Neon connection used by Prisma migrations,
  seed operations, and other administrative commands.
- `CIV_EXPECTED_DATABASE_HOST` optionally pins guarded commands to one explicit,
  non-secret endpoint hostname. Development environments should also set
  `CIV_PRODUCTION_DATABASE_HOST` so development commands reject that endpoint.

Copy both URLs from the matching Neon branch and preserve Neon's connection
parameters, including SSL parameters. Do not derive one URL from the other.

## Development

Store real development values in the ignored `.env` file. Before running a
development migration, verify all three values belong to the development branch:

```sh
npm run db:check:dev
npm run db:migrate:dev -- --name initial_civ_schema
npm run db:seed
```

The safety check refuses a development operation when `APP_ENV` is not
`development`, `NODE_ENV` is `production`, TLS is not required, the URLs are
not matching Neon pooled/direct endpoints, an endpoint pin does not match, or
the target is explicitly marked as production. `prisma/seed.ts` also performs
this check itself and requires the confirmation flag supplied by
`npm run db:seed`; invoking the seed file directly fails closed.

## Production

Production values belong in the deployment platform's secret configuration,
using the production Neon branch. Do not create a real `.env.production` in the
repository. `.env.production.example` documents the required shape only.

`npm run db:migrate:deploy` is reserved for a separately authorized production
deployment. It validates `APP_ENV=production` before applying the committed
migration history. Phase 0C.1 does not run this command against production.

## Historical migration safety

Two already-committed migrations assume their target tables are empty:

- `20260812084517_add_team_invitations` adds required `Invitation.tokenHash`
  without a default or backfill.
- `20260821220000_create_phase_1_draft_engine` adds required
  `Document.draftReference`, `DocumentLine.lineSubtotal`, and
  `DocumentLine.lineTotal` without defaults or backfills.

They are already applied on the configured Development database. Do not replay
this history directly over an older populated database. First test it against a
branch containing representative data and introduce a forward-only staged
backfill migration if any target environment predates those migrations.
