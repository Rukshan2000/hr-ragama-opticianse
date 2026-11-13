# Implement Production-Ready Passkey Authentication (WebAuthn)

Act as a Senior Backend Engineer and Security Architect. Implement a complete, production-ready Passkey Authentication system using the WebAuthn standard.

## 1. First: Analyze the Existing Project

Before making any changes:

- Inspect the entire project structure.
- Identify the existing frontend and backend frameworks.
- Identify the current authentication and authorization system.
- Inspect the user database schema and existing user model.
- Identify session management, JWT handling, middleware and API conventions.
- Identify existing Redis integration, if available.
- Review existing coding standards and architectural patterns.

Do not blindly replace existing authentication functionality.

Integrate passkey authentication into the existing architecture while maintaining backward compatibility.

## 2. Technology Requirements

Preferred technologies (adapt to the existing project):

- Backend: Node.js
- Frontend: Existing frontend framework (Angular / React / Next.js)
- WebAuthn library: @simplewebauthn/server
- Browser library: @simplewebauthn/browser
- Database: PostgreSQL
- Database migrations: Knex.js
- Temporary challenge storage: Redis (if available)

Use official, maintained libraries. Do not implement cryptographic algorithms manually.

## 3. Passkey Registration

Implement the complete WebAuthn registration flow.

API endpoints:

POST /auth/passkeys/register/options

Responsibilities:

- Authenticate the existing user before registration.
- Generate registration options using SimpleWebAuthn.
- Generate a cryptographically secure challenge.
- Configure RP ID and RP Name.
- Configure supported algorithms and user verification.
- Support platform and cross-platform authenticators.
- Store the challenge temporarily.
- Return registration options to the frontend.

POST /auth/passkeys/register/verify

Responsibilities:

- Receive the browser's registration response.
- Retrieve the original challenge.
- Verify the WebAuthn registration response.
- Validate the expected challenge, origin and RP ID.
- Verify user presence and user verification according to policy.
- Extract the credential ID and public key.
- Store credential information in PostgreSQL.
- Delete the challenge after verification.
- Prevent duplicate credential registration.

## 4. Passkey Login

Implement passwordless authentication.

API endpoints:

POST /auth/passkeys/login/options

Responsibilities:

- Generate authentication options.
- Support discoverable credentials (usernameless login).
- Support email-based passkey login.
- Generate a unique challenge for each authentication attempt.
- Store the challenge temporarily.
- Return authentication options to the frontend.

POST /auth/passkeys/login/verify

Responsibilities:

- Receive the authentication response.
- Find the matching credential.
- Retrieve the stored public key and counter.
- Retrieve the original challenge.
- Verify the signature using SimpleWebAuthn.
- Validate the challenge, origin and RP ID.
- Validate user verification according to policy.
- Update the authenticator counter.
- Delete the challenge.
- Create a normal authenticated session using the existing authentication system.
- Apply existing authorization and account status checks.

Never authenticate a user based only on frontend validation.

## 5. Database Design

Create a new migration for:

### user_passkeys

Fields:

- id (UUID, primary key)
- user_id (foreign key)
- credential_id (unique)
- public_key
- counter (BIGINT)
- transports (JSONB)
- device_type
- backed_up
- device_name (nullable)
- created_at
- updated_at
- last_used_at

Add appropriate indexes and foreign key constraints.

Use the credential representation required by the installed SimpleWebAuthn version.

Do not store private keys or biometric information.

For temporary challenges, use Redis with short expiration times. If Redis is unavailable, implement an appropriate secure alternative.

## 6. Passkey Management

Implement authenticated user management endpoints:

GET /auth/passkeys

- List registered passkeys.
- Show device name, device type, creation date and last-used date.

PATCH /auth/passkeys/:id

- Update the passkey's display name.

DELETE /auth/passkeys/:id

- Remove a registered passkey.
- Require recent authentication or another suitable re-authentication mechanism.
- Prevent unauthorized deletion.
- Avoid locking users out by removing their only available authentication method without a recovery option.

## 7. Frontend Implementation

Implement a clean and modern Passkey experience.

Required features:

- Register a new passkey.
- Login using a passkey.
- Login using email and passkey.
- Discoverable passkey login where supported.
- Display browser/device authentication prompts.
- Show loading states.
- Handle cancellation and errors.
- Handle unsupported browsers.
- Show success and failure notifications.
- Manage registered passkeys.
- Rename and remove registered passkeys.

Use:

navigator.credentials.create()

navigator.credentials.get()

Prefer SimpleWebAuthn browser helpers instead of manually implementing WebAuthn request handling.

Do not collect or process Face ID, Touch ID or fingerprint data.

## 8. Security Requirements

Security is a priority.

Implement:

- HTTPS requirement in production.
- Secure and HttpOnly session cookies where applicable.
- SameSite cookie configuration.
- CSRF protection for cookie-based authentication.
- Strict expectedOrigin validation.
- Correct RP ID validation.
- Cryptographically secure challenges.
- Single-use challenge validation.
- Short challenge expiration.
- Challenge isolation for concurrent authentication attempts.
- Rate limiting.
- Credential ownership validation.
- Signature verification on the backend.
- User verification enforcement according to configuration.
- Account disabled/blocked status validation.
- Safe error handling without leaking sensitive information.
- Audit logging for registration, login and removal.
- Session invalidation where appropriate.

Never trust frontend-supplied user IDs to determine credential ownership.

## 9. Configuration

Use environment variables.

Example:

RP_NAME=My Application
RP_ID=example.com
EXPECTED_ORIGIN=https://example.com
PASSKEY_CHALLENGE_TTL=300
PASSKEY_USER_VERIFICATION=required

Never hardcode production domains or secrets.

Validate configuration during application startup.

RP ID must be a valid domain suffix of the expected origin hostname. Do not permit arbitrary origins.

## 10. Error Handling

Handle common WebAuthn errors:

- NotAllowedError
- InvalidStateError
- NotSupportedError
- SecurityError
- Challenge mismatch
- Invalid signature
- Unknown credential
- Expired challenge
- Duplicate credential
- User verification failure

Return consistent API error responses without exposing internal cryptographic details.

## 11. Testing

Write automated tests covering:

- Passkey registration.
- Successful registration verification.
- Duplicate credential rejection.
- Passkey login.
- Invalid signature rejection.
- Challenge mismatch rejection.
- Expired challenge rejection.
- Challenge replay rejection.
- Wrong origin rejection.
- Wrong RP ID rejection.
- Unknown credential rejection.
- Credential removal.
- Unauthorized access.
- Disabled user login rejection.
- Concurrent authentication attempts.

Use mocks or suitable WebAuthn test authenticators for automated backend tests.

## 12. Documentation

Create documentation covering:

- Architecture overview.
- Registration flow.
- Authentication flow.
- API documentation.
- Database schema.
- Environment configuration.
- Local development setup.
- HTTPS and production deployment.
- Browser compatibility.
- Account recovery.
- Security considerations.

Include Mermaid sequence diagrams for registration and login.

## 13. Implementation Rules

- Follow existing project architecture and conventions.
- Avoid unnecessary dependencies.
- Do not break existing password/email authentication.
- Do not remove existing authentication middleware.
- Do not duplicate existing user/session logic.
- Use transactions where appropriate.
- Add database migrations instead of modifying production databases manually.
- Use TypeScript if the project already uses TypeScript.
- Keep code modular, maintainable and scalable.
- Do not leave placeholder implementations or TODO-only functionality.
- Do not claim a feature is complete without implementing and testing it.

## 14. Execution Strategy

Work in the following order:

1. Analyze the existing project.
2. Present a short implementation plan.
3. Identify required database changes.
4. Implement backend registration.
5. Implement backend authentication.
6. Implement challenge storage and validation.
7. Implement frontend registration and login.
8. Implement passkey management.
9. Add security protections.
10. Write and execute tests.
11. Update documentation.
12. Provide a final implementation report.

Start by analyzing the existing repository. Then proceed with implementation while preserving the current authentication system.
