# CIV Pause Handoff

- Pause date: 2026-09-13
- Branch: `main`
- Starting HEAD: `39f1b4caafac5ce1131a7bb93ce1729866ae96b9` — `Harden credit and debit note integrity`
- Current state: CIV is largely built. Official GRA integration remains pending.

## Recently completed

- Fixed the subscription test's stale VOIDED document fixture.
- Removed confirmed concurrent Prisma queries on the same transaction client.
- Added the authenticated application loading spinner.
- Enforced cumulative credit-note limits and frozen tax-context integrity for credit/debit notes.

## Resume priorities

The next technical milestone is partial-payment tax-point correctness.

Major remaining non-GRA work includes authentication recovery/security hardening, production billing and live Paystack, Vault document persistence with Original/Customer variants, document sharing/delivery, and production security, deployment, monitoring, and documentation cleanup.

GRA-blocked work includes the official E-VAT/CIS API adapter, UAT credentials/authentication, official fiscal ID/signature/QR/security-response mapping, VAT sales-receipt authorization, and GRA testing, certification, and sign-off.

Known non-blocking issue: the existing PostgreSQL SSL-mode warning still requires production hardening.

## Resume instruction

Inspect this handoff and the current Git state before making new CIV changes. Do not guess or build GRA endpoints until authoritative GRA documentation is received.
