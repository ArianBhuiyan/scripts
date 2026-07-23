# CMDB Assessment Rejected Notification Content

Notification:

```text
CMDB Assessment Rejected - Owner Correction Required
```

Table:

```text
CMDB Assessment [u_cmdb_assessment]
```

When To Send:

```text
Send when: Record inserted or updated
Updated: true
Condition: State is Rejected
```

Who Will Receive:

```text
Users/Groups in fields: Assigned Group
```

If the `CMDB Assessment Review State Handler` Business Rule is active, rejected assessments are assigned back to Owner Group before notification processing. If that Business Rule is not active, use `Owner Group` as the recipient field instead.

Required Notification Email Script:

```text
cmdb_assessment_rejection_link
```

Notification Email Script source:

```text
ArianBhuiyan/scripts: servicenow/cmdb-assessment-rejection-link-mail-script.js
```

Subject:

```text
CMDB Assessment Rejected - Correction Required
```

Message HTML:

```html
<p>A CMDB assessment was rejected by EACM and needs correction.</p>

<p>
  <strong>Assessment Year:</strong> ${u_assessment_year}<br>
  <strong>Class:</strong> ${u_class}<br>
  <strong>Owner Group:</strong> ${u_owner_group}<br>
  <strong>Submitted By:</strong> ${u_submitted_by}<br>
  <strong>State:</strong> ${u_state}
</p>

<p>Please reopen the assessment questionnaire, update the answers, and submit it again for EACM review.</p>

${mail_script:cmdb_assessment_rejection_link}

<p>${URI_REF}</p>
```
