"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";
import { mfaApi, passkeysApi } from "@/lib/api/endpoints";

const noop = () => () => {};
/** False during SSR, real browser capability after hydration. */
export const usePasskeysSupported = () => useSyncExternalStore(noop, browserSupportsWebAuthn, () => false);

/** User dismissed the browser prompt; callers stay quiet instead of showing an error. */
export class PasskeyCancelled extends Error {}

/** Turns WebAuthn DOMExceptions into messages a person can act on. Biometrics never leave the device. */
function friendly(e: unknown): Error {
  const name = e instanceof WebAuthnError ? (e.cause as Error | undefined)?.name ?? e.name : (e as Error)?.name;
  switch (name) {
    case "NotAllowedError":
    case "AbortError":
      return new PasskeyCancelled("Passkey prompt was cancelled or timed out");
    case "InvalidStateError":
      return new Error("This device already has a passkey for your account");
    case "NotSupportedError":
      return new Error("This browser or device doesn't support passkeys");
    case "SecurityError":
      return new Error("Passkeys aren't available on this site address");
    default:
      return e instanceof Error ? e : new Error("Passkey request failed");
  }
}

export async function createPasskey(deviceName?: string) {
  const { data } = await passkeysApi.registerOptions();
  let response;
  try {
    response = await startRegistration({ optionsJSON: data.options });
  } catch (e) {
    throw friendly(e);
  }
  return passkeysApi.registerVerify({ challengeId: data.challengeId, response, deviceName });
}

/** With an email, offers only that account's passkeys; without, lets the device pick one. */
export async function signInWithPasskey(email?: string) {
  const { data } = await passkeysApi.loginOptions(email);
  let response;
  try {
    response = await startAuthentication({ optionsJSON: data.options });
  } catch (e) {
    throw friendly(e);
  }
  return passkeysApi.loginVerify({ challengeId: data.challengeId, response });
}

/** Second step of a password login, using a registered passkey. */
export async function verifyMfaWithPasskey(mfaToken: string) {
  const { data: optionsJSON } = await mfaApi.passkeyOptions(mfaToken);
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (e) {
    throw friendly(e);
  }
  return mfaApi.verify({ mfaToken, method: "passkey", response });
}
