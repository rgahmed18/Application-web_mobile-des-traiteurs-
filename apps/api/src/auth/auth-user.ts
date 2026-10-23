import type { Request } from 'express';

import type { Role } from '../generated/prisma/client';

/** Contenu signé de l'access token JWT. */
export interface AccessTokenPayload {
  sub: string; // userId
  tid: string | null; // traiteur actif
  mid: string | null; // membership actif
  role: Role;
  sa: boolean; // super administrateur
  /** Accès de la plateforme chez ce traiteur (super admin entré pour dépanner). */
  pa?: string | null;
  typ: 'access';
}

/** Utilisateur authentifié, attaché à la requête par JwtAuthGuard. */
export interface AuthenticatedUser {
  userId: string;
  traiteurId: string | null;
  membershipId: string | null;
  role: Role;
  isSuperAdmin: boolean;
  /** Super admin entré chez un traiteur : accès (motif, durée) revérifié à chaque requête. */
  platformAccessId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function toAuthenticatedUser(payload: AccessTokenPayload): AuthenticatedUser {
  return {
    userId: payload.sub,
    traiteurId: payload.tid,
    membershipId: payload.mid,
    role: payload.role,
    isSuperAdmin: payload.sa,
    platformAccessId: payload.pa ?? null,
  };
}
