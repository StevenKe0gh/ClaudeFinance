# Steuererklärung worksheet

A private claude.ai page for preparing a student's German income tax returns for 2024–2026. Live at https://claude.ai/artifact/Nn1taQi88XwK5KkD4q3HTy (owner only).

- Enter each internship once (dates, hours per week, €/h, how it was paid). The page splits it into tax years.
- Wage tax withheld is estimated from a tax-class-I payroll until the figures from the Lohnsteuerbescheinigung are entered.
- Covers Anlage N (wages, commuting, home office), Vorsorgeaufwand, first-degree costs (Sonderausgaben) or second-degree costs (Werbungskosten with loss carry-forward), Anlage KAP with the Günstigerprüfung, and work without a contract (Anlage G/S + EÜR, mandatory filing above 410 €).
- Lists every ELSTER entry with a copy button.

Entries are stored under the viewer's private `data/users/<id>/steuer` document (with a localStorage fallback). Nothing personal is in this repository.

```bash
node --test steuer/tests/*.test.mjs   # tariff and scenario tests
node steuer/build.mjs                 # writes steuer/dist/index.html
node steuer/build.mjs --check         # CI: fails if dist is stale
```

Parameters (`src/tax.mjs`): § 32a EStG tariffs for 2024 (Grundfreibetrag 11.784 €, raised retroactively by the Steuerfortentwicklungsgesetz), 2025 (12.096 €) and 2026 (12.348 €); Arbeitnehmer-Pauschbetrag 1.230 €; Sparer-Pauschbetrag 1.000 €; Soli exemption thresholds; minijob limits. Estimates only; the Finanzamt's assessment is binding.
