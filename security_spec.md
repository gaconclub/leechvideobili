# Security Specification — Gemini API Account Cloud Vault

## 1. Data Invariants
1. **Strict Owner Isolation (Zero Cross-User Access)**: All documents under `/users/{userId}`, `/users/{userId}/geminiAccounts/{accountId}`, and `/users/{userId}/poolSettings/{settingId}` are strictly private to the authenticated, email-verified user whose `request.auth.uid == userId`.
2. **Master Gate Enforcement**: No subcollection document (`/geminiAccounts/{accountId}` or `/poolSettings/{settingId}`) may be read or written unless the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Timestamps**: `uid` / `ownerId`, `id`, and `createdAt` are immutable after creation; `createdAt` (on create) and `updatedAt` (on create and update) MUST equal `request.time`.
4. **Strict Schema & Bounds**: Every string has explicit `.size()` min/max bounds, IDs match `^[a-zA-Z0-9_\-]+$`, and no shadow/extra keys are permitted on create (`hasAll` + `hasOnly`) or update (`affectedKeys().hasOnly(...)`).
5. **Query Enforcement**: `allow list` on `/users/{userId}/geminiAccounts` explicitly verifies `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/uid_A/geminiAccounts/gem_1` with `auth == null`.
2. **Cross-User Read**: `GET /users/uid_A/geminiAccounts/gem_1` signed in as `uid_B`.
3. **Unverified Email Write**: `CREATE /users/uid_A` signed in as `uid_A` with `email_verified: false`.
4. **Identity Spoofing on Create**: `CREATE /users/uid_A/geminiAccounts/gem_1` with `ownerId: "uid_B"`.
5. **Shadow Field Injection on Create**: `CREATE /users/uid_A/geminiAccounts/gem_1` including extra field `"isAdmin": true`.
6. **Oversized ID Poisoning**: `CREATE /users/uid_A/geminiAccounts/<200-char-invalid-id>` with characters outside `^[a-zA-Z0-9_\-]+$`.
7. **Orphaned Subcollection Write (Missing Master Gate)**: `CREATE /users/uid_A/geminiAccounts/gem_1` before `/users/uid_A` exists.
8. **Client-Forged Timestamp**: `CREATE /users/uid_A/geminiAccounts/gem_1` with `createdAt` != `request.time`.
9. **Immutable Field Mutation**: `UPDATE /users/uid_A/geminiAccounts/gem_1` changing `ownerId` or `createdAt` or `id`.
10. **Value Poisoning on Update**: `UPDATE /users/uid_A/geminiAccounts/gem_1` setting `label` to a 500-character string or non-string boolean.
11. **Shadow Field Injection on Update**: `UPDATE /users/uid_A/poolSettings/gemini` adding `"role": "admin"`.
12. **Unscoped List Query**: `LIST /users/uid_B/geminiAccounts` signed in as `uid_A`.
