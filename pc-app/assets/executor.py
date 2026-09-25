"""Legacy executor removed for security.

The old copy accepted commands/code from messages and invoked a host shell or
dynamic exec. Use the separately designed Orin Agent runtime with scoped
approvals and workspace isolation. Do not restore this file from old releases.
"""

raise RuntimeError("legacy executor is disabled; use the approved Orin Agent runtime")
