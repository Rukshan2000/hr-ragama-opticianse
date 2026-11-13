import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { appConfig } from '../../config/app.config';
import { AppError, NotFoundError, UnauthorizedError } from '../../shared/errors/app-error';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import { authRepository } from './auth.repository';
import { authService } from './auth.service';
import type { ClientInfo } from './auth.types';
import { mfaRepository } from './mfa.repository';
import { passkeyRepository, type ChallengePurpose, type PasskeyRow } from './passkey.repository';

const cfg = appConfig.passkeys;

// Deliberately coarse: callers learn *that* a ceremony failed, never which cryptographic check did.
const challengeError = () =>
  new AppError(
    400,
    'Passkey request expired or invalid; please try again',
    'PASSKEY_CHALLENGE_INVALID',
  );
const verificationError = () =>
  new AppError(400, 'Passkey verification failed', 'PASSKEY_VERIFICATION_FAILED');
const loginError = () => new AppError(401, 'Passkey sign-in failed', 'PASSKEY_LOGIN_FAILED');

async function issueChallenge(purpose: ChallengePurpose, challenge: string, userId: string | null) {
  return passkeyRepository.insertChallenge({
    purpose,
    challenge,
    user_id: userId,
    expires_at: new Date(Date.now() + cfg.challengeTtlMs),
  });
}

/** Single-use: the row is deleted on first read whatever the outcome, so replays always fail. */
async function takeChallenge(id: string, purpose: ChallengePurpose) {
  const row = await passkeyRepository.consumeChallenge(id, purpose);
  if (!row || row.expires_at <= new Date()) throw challengeError();
  return row;
}

/** Verifies a signed assertion against a stored credential and advances its counter. */
export async function verifyAssertion(
  passkey: PasskeyRow,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
) {
  let info;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpId,
      requireUserVerification: cfg.requireUserVerification,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
    });
    if (!result.verified) throw loginError();
    info = result.authenticationInfo;
  } catch {
    throw loginError();
  }
  await passkeyRepository.recordUse(passkey.id, info.newCounter, info.credentialBackedUp);
  return info;
}

export const toPasskeyDto = (p: PasskeyRow) => ({
  id: p.id,
  deviceName: p.device_name,
  deviceType: p.device_type,
  backedUp: p.backed_up,
  transports: p.transports,
  createdAt: p.created_at,
  lastUsedAt: p.last_used_at,
});

export const passkeyService = {
  async registrationOptions(userId: string) {
    const user = await authRepository.findCredentialsById(userId);
    if (!user?.is_active) throw new UnauthorizedError();
    const existing = await passkeyRepository.listForUser(userId);
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id), // opaque handle, no PII
      timeout: cfg.challengeTtlMs,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports })),
      // No authenticatorAttachment: platform (Touch ID, Windows Hello) and roaming keys both work.
      authenticatorSelection: { residentKey: 'preferred', userVerification: cfg.userVerification },
      supportedAlgorithmIDs: [-8, -7, -257], // EdDSA, ES256, RS256
    });
    const challengeId = await issueChallenge('registration', options.challenge, userId);
    return { challengeId, options };
  },

  async verifyRegistration(
    userId: string,
    input: { challengeId: string; response: RegistrationResponseJSON; deviceName?: string },
  ) {
    const challenge = await takeChallenge(input.challengeId, 'registration');
    // The challenge is bound to the authenticated user who requested it.
    if (challenge.user_id !== userId) throw challengeError();

    let info;
    try {
      const result = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: cfg.origins,
        expectedRPID: cfg.rpId,
        requireUserPresence: true,
        requireUserVerification: cfg.requireUserVerification,
      });
      if (!result.verified) throw verificationError();
      info = result.registrationInfo;
    } catch {
      throw verificationError();
    }

    try {
      return await passkeyRepository.insert({
        user_id: userId,
        credential_id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? input.response.response.transports ?? [],
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        device_name: input.deviceName ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError(409, 'This passkey is already registered', 'PASSKEY_DUPLICATE');
      throw err;
    }
  },

  /** With an email: offers that user's credentials. Without: discoverable (usernameless) login. */
  async loginOptions(email?: string) {
    let userId: string | null = null;
    let allowCredentials: { id: string; transports?: string[] }[] | undefined;
    if (email) {
      const user = await authRepository.findCredentialsByEmail(email);
      const passkeys = user ? await passkeyRepository.listForUser(user.id) : [];
      // Unknown email or no passkeys: fall back to discoverable login rather than reveal that.
      if (user && passkeys.length) {
        userId = user.id;
        allowCredentials = passkeys.map((p) => ({ id: p.credential_id, transports: p.transports }));
      }
    }
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpId,
      allowCredentials,
      userVerification: cfg.userVerification,
      timeout: cfg.challengeTtlMs,
    });
    const challengeId = await issueChallenge('authentication', options.challenge, userId);
    return { challengeId, options };
  },

  async verifyLogin(
    input: { challengeId: string; response: AuthenticationResponseJSON; tenantSlug?: string },
    client: ClientInfo,
  ) {
    const challenge = await takeChallenge(input.challengeId, 'authentication');
    const passkey = await passkeyRepository.findByCredentialId(input.response.id);
    if (!passkey) throw loginError();
    // Ownership comes from the stored credential, never from client-supplied ids.
    if (challenge.user_id && challenge.user_id !== passkey.user_id) throw loginError();

    await verifyAssertion(passkey, input.response, challenge.challenge);

    // Status is checked only after the signature, so it isn't revealed to non-owners.
    // Password lockout intentionally does not block passkeys: it would let anyone lock a user out.
    const user = await authRepository.findCredentialsById(passkey.user_id);
    if (!user?.is_active) throw new AppError(403, 'Account is deactivated', 'FORBIDDEN');

    const session = await authService.startSession(user, input.tenantSlug, client);
    return { session, userId: user.id, passkeyId: passkey.id };
  },

  async list(userId: string) {
    return (await passkeyRepository.listForUser(userId)).map(toPasskeyDto);
  },

  async rename(userId: string, id: string, deviceName: string) {
    const row = await passkeyRepository.rename(id, userId, deviceName);
    if (!row) throw new NotFoundError('Passkey');
    return toPasskeyDto(row);
  },

  /**
   * Re-authenticates with the password first. Every account keeps a password, so removing the
   * last passkey can never lock a user out.
   */
  async remove(userId: string, id: string, currentPassword: string) {
    await authService.verifyCurrentPassword(userId, currentPassword);
    const passkeys = await passkeyRepository.listForUser(userId);
    if (!passkeys.some((p) => p.id === id)) throw new NotFoundError('Passkey');
    // Removing the last passkey would silently switch off passkey 2-step verification.
    if (passkeys.length === 1 && (await mfaRepository.isPasskeyFactorEnabled(userId))) {
      throw new AppError(
        409,
        'Turn off passkey 2-step verification before removing your last passkey',
        'CONFLICT',
      );
    }
    await passkeyRepository.remove(id, userId);
  },
};
