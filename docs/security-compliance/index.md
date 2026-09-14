---
kind: spec
title: "Security and Compliance Checklist"
---

# Security and Compliance Checklist

- Primary storage and backups: **region decision (2026-09-15, see `docs/MUMBAI_BOOTSTRAP.md`): Sydney (`ap-southeast-2`) hosting is explicitly business-accepted; India/Mumbai (`ap-south-1`) data residency is NOT a hard requirement for this project.** Region selection remains subject to performance, security, contractual and applicable compliance requirements at the time of each decision — this is not a blanket exemption from future regulatory review (e.g. DPDP), only a closure of the earlier assumption that `ap-south-1` was mandatory.
- Google sign-in allow-list for staff; client OTP authentication; never store OTPs.
- Encrypt sensitive data at rest/in transit; isolate credentials from normal application data.
- If passwords are vaulted, require envelope encryption, least privilege, just-in-time access, rotation, revocation, operator audit and emergency disablement.
- Audit every create/change/view/download/external action/admin action; make logs tamper-evident.
- Apply client-level authorization to every query, file URL, dashboard, notification and AI context.
- Use expiring, scoped secure document links; no public object URLs.
- Daily encrypted backup, restore test, RTO/RPO monitoring and Google Drive secondary copy; Drive is not the only evidence store.
- Proposed retention: active case plus eight financial years after closure, subject to counsel confirmation; legal hold overrides deletion.
- Preserve evidence for filing/court audit: original file, immutable hash, extracted fields, corrections, message metadata, portal screenshots/PDF, reference number, DD/hearing artifacts.
- Privacy notice, grievance contact, data minimization and deletion/anonymisation workflow must be reviewed against applicable DPDP commencement/rules before production.
- AI provider contract must prohibit training on case data, document region/retention/subprocessors and log model/version/prompt/source references.
- AI cannot independently decide legal eligibility, confirm payment, accept settlement, invent filing facts or submit legally significant content.
- Portal automation must fail closed on CAPTCHA/security controls or UI drift; no bypassing protections.
