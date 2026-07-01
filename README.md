# Scripts

Shared scripts for project automation, including ServiceNow development work.

Organize scripts by platform or project and document required inputs, configuration, and safe test procedures alongside each script.

## ServiceNow

- [`generate-annual-cmdb-risk-assessments.js`](servicenow/generate-annual-cmdb-risk-assessments.js) — Flow Designer custom Action Script step that finds distinct CMDB classes with an Installed or Pending Install CI, skips excluded and previously assessed classes, and creates annual assessment records. Keep `dry_run` enabled until results are validated.
