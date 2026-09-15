import { describe, expect, it } from 'vitest';
import { limparCPF, mascararCPF, validarCPF } from '../src/cpf.js';

describe('validarCPF', () => {
  it('aceita CPFs válidos, com e sem máscara', () => {
    expect(validarCPF('529.982.247-25')).toBe(true);
    expect(validarCPF('52998224725')).toBe(true);
    expect(validarCPF('111.444.777-35')).toBe(true);
  });

  it('rejeita CPF com dígito verificador errado', () => {
    expect(validarCPF('529.982.247-26')).toBe(false);
    expect(validarCPF('11144477736')).toBe(false);
  });

  it('rejeita as sequências repetidas, que passariam no cálculo do DV', () => {
    for (let d = 0; d <= 9; d++) {
      expect(validarCPF(String(d).repeat(11))).toBe(false);
    }
  });

  it('rejeita tamanho diferente de 11 dígitos', () => {
    expect(validarCPF('')).toBe(false);
    expect(validarCPF('5299822472')).toBe(false);
    expect(validarCPF('529982247251')).toBe(false);
  });

  it('rejeita CNPJ — autenticação por CPF é só de pessoa física', () => {
    expect(validarCPF('11.222.333/0001-81')).toBe(false);
  });

  it('rejeita entrada sem dígito nenhum', () => {
    expect(validarCPF('abc.def.ghi-jk')).toBe(false);
  });
});

describe('limparCPF', () => {
  it('remove tudo que não for dígito', () => {
    expect(limparCPF('529.982.247-25')).toBe('52998224725');
    expect(limparCPF(' 529 982 247 25 ')).toBe('52998224725');
  });
});

describe('mascararCPF', () => {
  it('preserva apenas os 5 últimos dígitos', () => {
    expect(mascararCPF('52998224725')).toBe('***.***.247-25');
  });

  it('não vaza nada quando a entrada não é um CPF', () => {
    expect(mascararCPF('123')).toBe('***');
  });
});
