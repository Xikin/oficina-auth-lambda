import { Pool } from 'pg';

let pool: Pool | undefined;

export function obterPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada na função');
  }

  pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

export interface ClienteAutenticavel {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
}

export async function buscarClientePorCPF(cpf: string): Promise<ClienteAutenticavel | null> {
  const { rows } = await obterPool().query<ClienteAutenticavel>(
    `SELECT id, nome, email, ativo
       FROM clientes
      WHERE cpf_cnpj = $1
        AND tipo_pessoa = 'FISICA'
      LIMIT 1`,
    [cpf],
  );

  return rows[0] ?? null;
}
