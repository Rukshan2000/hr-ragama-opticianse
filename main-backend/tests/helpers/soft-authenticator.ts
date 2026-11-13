import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** Minimal CBOR encoder: just what WebAuthn attestation objects and COSE keys need. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) {
    const parts: Buffer[] = [head(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error('unsupported CBOR value');
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64u = (b: Buffer) => b.toString('base64url');

export interface Ceremony {
  origin?: string;
  rpId?: string;
  challenge?: string; // override to simulate a mismatch
  uv?: boolean;
}

/** A software passkey (ES256) that produces real, verifiable WebAuthn responses. */
export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly cose: Buffer;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
  }

  get id() {
    return b64u(this.credentialId);
  }

  private authData(rpId: string, uv: boolean, attested: boolean) {
    const flags = 0x01 | (uv ? 0x04 : 0) | (attested ? 0x40 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.counter);
    const parts: Buffer[] = [sha256(rpId), Buffer.from([flags]), counter];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.cose);
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(options: { challenge: string }, c: Ceremony = {}) {
    const clientDataJSON = this.clientData(
      'webauthn.create',
      c.challenge ?? options.challenge,
      c.origin ?? 'http://localhost:3000',
    );
    const authData = this.authData(c.rpId ?? 'localhost', c.uv ?? true, true);
    const attestationObject = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  login(options: { challenge: string }, c: Ceremony & { tamper?: boolean } = {}) {
    const clientDataJSON = this.clientData(
      'webauthn.get',
      c.challenge ?? options.challenge,
      c.origin ?? 'http://localhost:3000',
    );
    const authData = this.authData(c.rpId ?? 'localhost', c.uv ?? true, false);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    if (c.tamper) signature[signature.length - 1]! ^= 0xff;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
    };
  }
}
