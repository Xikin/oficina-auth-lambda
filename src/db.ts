import { Pool } from 'pg';

/**
 * Acesso ao RDS PostgreSQL.
 *
 * Usa `pg` diretamente em vez do Prisma por três motivos:
 *   1. o Prisma Client empacotado com o engine nativo passa de 40 MB, o que
 *      estoura o limite prático de cold start aceitável para autenticação;
 *   2. a Lambda faz uma única consulta — não precisa de ORM;
 *   3. o schema é de propriedade da API (é ela quem roda `prisma migrate deploy`);
 *      aqui só lemos, com SQL explícito.
 *
 * O Pool é criado no escopo do módulo, fora do handler: invocações "quentes"
 * reaproveitam a conexão TCP e o handshake TLS, o que derruba a latência de
 * ~300ms para ~15ms. `max: 1` porque cada container atende uma invocação por vez
 * e o db.t3.micro tem um teto baixo de conexões.
 */

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
    // Se o RDS não responder, é melhor falhar rápido e devolver 503 do que
    // segurar a invocação até o timeout de 10s da função.
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    // O RDS exige TLS; o certificado é da CA da Amazon, que não está no
    // bundle da Lambda. Ver ADR-0006 para o trade-off.
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

/**
 * Consulta existência e status do cliente pelo CPF.
 *
 * `cpf_cnpj` é armazenado apenas com dígitos e tem índice UNIQUE
 * (ver prisma/schema.prisma no repositório da API), então a busca é O(log n).
 * Retorna `null` quando o CPF não existe — o chamador distingue
 * "não existe" de "existe mas está inativo".
 */
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
