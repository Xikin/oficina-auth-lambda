export function limparCPF(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

export function validarCPF(cpf: string): boolean {
  const c = limparCPF(cpf);

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

export function mascararCPF(cpf: string): string {
  const c = limparCPF(cpf);
  if (c.length !== 11) return '***';
  return `***.***.${c.slice(6, 9)}-${c.slice(9)}`;
}
