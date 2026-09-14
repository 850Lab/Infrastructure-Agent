# Credit Processing Foundation

## Current safety state

This branch adds the first isolated foundation for credit processing. It is
disabled by default and permits synthetic case metadata only.

- Real document upload: **locked**
- Object storage: **not connected**
- Cloudflare R2 upload code: **installed but disabled**
- AI document processing: **not connected**
- Database migration: **not applied automatically**
- Deployment: **not performed**

Set `CREDIT_PROCESSING_ENABLED=true` only after applying the schema migration
in a non-production environment. That flag still does not enable document
uploads.

## Cloudflare R2 placeholders

The server expects these secrets later; do not place them in Git or expose them
to the browser:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

`CREDIT_STORAGE_UPLOADS_ENABLED=true` is a separate safety switch. Leave it off
until the private bucket, CORS restrictions, lifecycle deletion, malware scan,
and synthetic end-to-end test are complete.

When enabled for synthetic testing, the browser receives a five-minute signed
PUT URL. The object name is random and does not contain the consumer's name or
original filename. The API accepts PDF, JPEG, and PNG files, with a 75 MB limit
for each credit report and a 20 MB limit for ID or proof of address. It verifies
the stored object's type, length, and SHA-256 metadata, then leaves it in
`uploaded_unscanned`. Unscanned files cannot enter AI processing.

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
