/**
 * Validação de CPF por dígito verificador.
 *
 * Portada de `src/shared/utils/validators.ts` do repositório oficina-mvp,
 * com uma diferença deliberada: aqui NÃO existe o ramo de CNPJ. O requisito
 * da Fase 3 é "validar o CPF do cliente" — aceitar 14 dígitos abriria a
 * autenticação de pessoa física para documento de pessoa jurídica.
 *
 * A duplicação de ~13 linhas é intencional: transformar isso num pacote npm
 * compartilhado acoplaria o ciclo de release da Lambda ao da API, e o custo
 * de manutenção de um algoritmo que não muda desde 1998 é praticamente nulo.
 */

export function limparCPF(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

export function validarCPF(cpf: string): boolean {
  const c = limparCPF(cpf);

  // Rejeita tamanho errado e as 10 sequências repetidas (000..., 111...),
  // que passam no cálculo do dígito verificador mas nunca são emitidas.
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;

  let s = 0;
  for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== +c[9]) return false;

  s = 0;
  for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === +c[10];
}

/** Mascara o CPF para log: 123.456.789-09 -> ***.***.789-09 */
export function mascararCPF(cpf: string): string {
  const c = limparCPF(cpf);
  if (c.length !== 11) return '***';
  return `***.***.${c.slice(6, 9)}-${c.slice(9)}`;
}
