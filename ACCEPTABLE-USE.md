# Acceptable Use Policy

**mcp-probe is a connectivity and configuration advisor for MCP services you own or operate.**

This document states what this tool is for and what it is not for. If you're unsure whether your use case is appropriate, read this first.

---

## This tool is for

- Testing MCP servers **you own** or **deploy**
- Verifying MCP connectivity in environments **you control** (local, LAN, cloud infrastructure you operate)
- Diagnosing configuration problems in AI client setups **on your own machines**
- CI/CD health checks against **your own deployed services**
- Testing as part of a **contracted and authorized** engagement where you have explicit written permission to test the target system

---

## This tool is not for

**The following uses are prohibited under the LICENSE and this policy:**

- Testing, probing, scanning, or accessing any system, network, or service **without the express written authorization of its owner**
- Penetration testing or vulnerability assessment of systems you **do not own or control**
- Denial-of-service attacks or anything that interferes with service availability
- Reconnaissance, fingerprinting, or discovery of systems **you do not have authorization to test**
- Any use that violates applicable law, including the Computer Fraud and Abuse Act (CFAA), the UK Computer Misuse Act, the EU NIS2 Directive, or equivalent statutes in your jurisdiction

---

## The Simple Test

Using this tool against systems you do not own or control is the digital
equivalent of picking your neighbor's lock to check if their door works.
It does not matter that you did not steal anything. The breaking-in is
the violation.

There is a very simple test for whether your use of mcp-probe is authorized:
**if you have to ask yourself whether you have permission to test the target
system, you do not have permission.**

This tool is not for people who need to ask that question. If you are already
typing the URL of someone else's server and feeling clever about it — stop.
You are not clever. You are in violation of this license, probably in violation
of federal law, and definitely in violation of the spirit in which this
software was released.

**Don't be a dick.**

---

## Why we're explicit about this

mcp-probe performs real HTTP requests and protocol-level interactions with the
services you configure. The same capabilities that make it useful for
diagnosing your own infrastructure could be misused against systems you have
no right to access.

We are not a security testing tool. We do not want to be. If you need a
penetration testing framework, this is not it.

---

## Reporting misuse

If you observe mcp-probe being used to target systems without authorization,
report it to: **security@legionforge.org**

---

## Summary

Own it or have a signed authorization to test it. Everything else is out of scope.

*Unauthorized use violates Condition 2 of the LICENSE, exceeds the scope of
the rights granted, and constitutes copyright infringement. It may also
violate applicable criminal and civil law.*
