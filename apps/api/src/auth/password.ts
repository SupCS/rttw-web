import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  maxMemory: number;
};

const defaultParameters: ScryptParameters = {
  cost: 65_536,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
  maxMemory: 96 * 1024 * 1024,
};

export type PasswordHasher = {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
};

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, parameters.keyLength, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem: parameters.maxMemory,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function createScryptPasswordHasher(parameters: ScryptParameters = defaultParameters): PasswordHasher {
  return {
    async hash(password) {
      const salt = randomBytes(16);
      const key = await deriveKey(password, salt, parameters);
      return [
        'scrypt',
        parameters.cost,
        parameters.blockSize,
        parameters.parallelization,
        salt.toString('base64url'),
        key.toString('base64url'),
      ].join('$');
    },

    async verify(password, encodedHash) {
      const [algorithm, costValue, blockSizeValue, parallelizationValue, saltValue, keyValue, extra] = encodedHash.split('$');
      if (algorithm !== 'scrypt' || !costValue || !blockSizeValue || !parallelizationValue || !saltValue || !keyValue || extra) {
        return false;
      }

      const storedKey = Buffer.from(keyValue, 'base64url');
      const parsedParameters: ScryptParameters = {
        cost: Number(costValue),
        blockSize: Number(blockSizeValue),
        parallelization: Number(parallelizationValue),
        keyLength: storedKey.length,
        maxMemory: parameters.maxMemory,
      };
      if (!Number.isInteger(parsedParameters.cost)
        || !Number.isInteger(parsedParameters.blockSize)
        || !Number.isInteger(parsedParameters.parallelization)
        || parsedParameters.cost < 2
        || parsedParameters.blockSize < 1
        || parsedParameters.parallelization < 1
        || parsedParameters.keyLength < 16
        || parsedParameters.keyLength > 64) {
        return false;
      }

      try {
        const actualKey = await deriveKey(password, Buffer.from(saltValue, 'base64url'), parsedParameters);
        return actualKey.length === storedKey.length && timingSafeEqual(actualKey, storedKey);
      } catch {
        return false;
      }
    },
  };
}
