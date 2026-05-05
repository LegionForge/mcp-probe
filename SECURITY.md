# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | No — upgrade to latest |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues to: jp@legionforge.org

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Suggested fix if available

You will receive acknowledgement within 72 hours. Critical issues are targeted for a fix within 14 days.

## Disclosure Policy

We follow coordinated disclosure:
1. You report privately to jp@legionforge.org
2. We confirm and assess within 72 hours
3. We fix and prepare a release
4. We notify you when the fix is available
5. We publish a security advisory on GitHub

We request that you do not disclose publicly until a fix is released, or 90 days have elapsed (whichever comes first).

## Security Controls

Aligned with OWASP SAMM Level 1:

| Control | Tool | Where |
|---------|------|--------|
| Static analysis | Semgrep (p/javascript, p/typescript, p/nodejs), CodeQL | CI (`sast.yml`) |
| Dependency CVE scan | npm audit | CI (`audit.yml`) |
| License compliance | license-checker | CI (`audit.yml`) |
| Secret scanning | gitleaks | CI (`secrets.yml`) + pre-commit |
| Type safety | TypeScript strict mode | CI (`ci.yml`) + pre-commit |
| Pre-commit hooks | tsc, gitleaks, file hygiene | Local dev |

## Scope Statement

mcp-probe is an operational diagnostic tool, not a security testing tool. It is designed exclusively for use against MCP services you own or are explicitly authorized to access.

Unauthorized use of this tool to probe, scan, or test systems without authorization may violate the LICENSE and applicable law, including the Computer Fraud and Abuse Act (18 U.S.C. § 1030). See `ACCEPTABLE-USE.md` for the full usage policy.

Any reports of mcp-probe being used to conduct unauthorized testing will be treated as a potential LICENSE violation. Report such incidents to jp@legionforge.org.
