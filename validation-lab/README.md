# ApexCore ERP — External Validation Laboratory

This folder is **outside** the application source trees (`backend/`, `frontend/`, `e2e/`).

It contains independent validation scripts and raw evidence used to produce:

`../test report/Enterprise_System_Validation_Report.md`

## Rules

- Do not modify application source from this lab.
- Evidence is written only under `validation-lab/evidence/`.
- Credentials for live probes come from environment variables or documented defaults for the local platform-owner workspace.

## Run

```bash
node validation-lab/scripts/run-validation.mjs
node validation-lab/scripts/perf-rerun.mjs
node validation-lab/scripts/db-probe.mjs
node validation-lab/scripts/reliability-probe.mjs
```
