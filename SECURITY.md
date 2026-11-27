# Security

This repository is a **candidate** client connector for o-MATIC Server. It does
not ship credentials, bearer tokens, or factory database passwords.

Report security issues privately to LucidIT, LLC via the contact paths published
at https://o-matic.ai or https://lucidit.io (or `info@lucidit.io`). Do not open
public issues for undisclosed vulnerabilities.

The Server remains the control plane for authentication, grants, and tool
authorization. Client hooks and preflight checks are fail-closed helpers; they
do not grant access.
