import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Paramètres Argon2id recommandés par l'OWASP (19 Mio, 2 itérations, 1 thread).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Vérifie contre un hash factice : appelé quand l'utilisateur n'existe pas ou n'a pas de
   * mot de passe, pour que le temps de réponse ne révèle pas l'existence d'un compte.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-constant-time-1');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
