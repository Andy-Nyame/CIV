# CIV database environments

CIV uses one Neon project with separate `development` and `production`
branches. A staging branch can be added later without changing this convention.

## Variables

- `APP_ENV` is `development` locally and `production` in the deployed app.
- `DATABASE_URL` is the pooled Neon connection used by the running application.
  Its hostname includes `-pooler`.
- `DIRECT_URL` is the matching direct Neon connection used by Prisma migrations,
  seed operations, and other administrative commands.

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

The safety check refuses a development migration when `APP_ENV` is not
`development`, when a required URL is missing, or when the pooled and direct
URLs do not describe the same Neon endpoint, database, and role.

## Production

Production values belong in the deployment platform's secret configuration,
using the production Neon branch. Do not create a real `.env.production` in the
repository. `.env.production.example` documents the required shape only.

`npm run db:migrate:deploy` is reserved for a separately authorized production
deployment. It validates `APP_ENV=production` before applying the committed
migration history. Phase 0C.1 does not run this command against production.
