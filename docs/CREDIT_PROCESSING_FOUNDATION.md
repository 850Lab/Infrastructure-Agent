# Credit Processing Foundation

## Current safety state

This branch adds the first isolated foundation for credit processing. It is
disabled by default and permits synthetic case metadata only.

- Real document upload: **locked**
- Object storage: **not connected**
- AI document processing: **not connected**
- Database migration: **not applied automatically**
- Deployment: **not performed**

Set `CREDIT_PROCESSING_ENABLED=true` only after applying the schema migration
in a non-production environment. That flag still does not enable document
uploads.

## Before accepting real documents

1. Use private encrypted object storage with short-lived signed URLs.
2. Limit allowed types and sizes; verify file signatures, not only extensions.
3. Add malware scanning before processing.
4. Create client-level authorization checks for every case and document.
5. Define automatic deletion and failed-upload cleanup.
6. Confirm the selected AI provider's data handling and retention settings.
7. Replace the single-process login limiter with a shared or edge limiter.
8. Complete a security review and synthetic end-to-end test.

Credit report contents, government IDs, and proof-of-address documents must
never be committed to Git, written to application logs, or stored directly in
the PostgreSQL tables.
