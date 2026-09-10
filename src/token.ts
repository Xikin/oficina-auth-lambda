import jwt from 'jsonwebtoken';
import type { ClienteAutenticavel } from './db.js';

/**
 * Emissão do JWT consumido pelas rotas protegidas da API.
 *
 * O contrato do payload é o mesmo do login interno da API
 * (`src/domain/services/token.service.interface.ts`): `sub`, `email` e `role`.
 * Acrescentamos `cpf` e `nome`, e usamos `role: 'CLIENTE'` — um papel que a API
 * passou a reconhecer na Fase 3, com autorização restrita aos próprios recursos.
 *
 * `email` é opcional aqui porque `Cliente.email` é nullable no schema; o login
 * interno sempre tem e-mail porque `Usuario.email` é obrigatório e único.
 */

export interface PayloadCliente {
  sub: string;
  role: 'CLIENTE';
  cpf: string;
  nome: string;
  email?: string;
}

export function emitirToken(
  cliente: ClienteAutenticavel,
  cpf: string,
  segredo: string,
  expiraEm: string,
): { token: string; expiresIn: string } {
  const payload: PayloadCliente = {
    sub: cliente.id,
    role: 'CLIENTE',
    cpf,
    nome: cliente.nome,
    ...(cliente.email ? { email: cliente.email } : {}),
  };

  const token = jwt.sign(payload, segredo, {
    expiresIn: expiraEm as jwt.SignOptions['expiresIn'],
    issuer: 'oficina-auth-lambda',
  });

  return { token, expiresIn: expiraEm };
}
