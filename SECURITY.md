# Security Policy

## Supported Versions

| Version | GNOME Shell | Supported          |
|---------|-------------|--------------------|
| master  | 47–50       | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in XDock, please report it responsibly:

1. **Do NOT open a public issue** for security vulnerabilities
2. **Email:** Open a [private security advisory](https://github.com/dmzoneill-forks/xdock/security/advisories/new) on GitHub
3. **Include:** A description of the vulnerability, steps to reproduce, and potential impact

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Scanning

This project runs automated security scanning on every push and pull request:

- **CodeQL** — GitHub's static analysis for JavaScript (SAST)
- **Semgrep** — Static analysis for JS, Python, and shell scripts
- **TruffleHog** — Secret and credential detection in git history
- **npm audit** — Dependency vulnerability scanning (CVEs)
- **OSV-Scanner** — Google's Open Source Vulnerability database scanning
- **Trivy** — Container image vulnerability scanning
- **Dependabot** — Automated dependency update PRs
- **License audit** — GPL compatibility checking with SBOM generation

## Scope

XDock is a GNOME Shell extension that runs with the same privileges as GNOME Shell itself. Security considerations include:

- **D-Bus interactions** — The extension communicates with system services via D-Bus
- **Extension preferences** — Settings UI runs in a separate process with GTK4
- **File system access** — Limited to reading app icons, desktop files, and GSettings
- **No network access** — The extension does not make network requests
- **No data collection** — No telemetry, analytics, or user data is collected
