import { fromCents, isMoney, MoneyFormatError, sameMoney, toCents } from './money';

describe('money', () => {
  it('convierte entre texto decimal y centavos sin coma flotante', () => {
    expect(toCents('0.1')).toBe(10);
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents('-5.05')).toBe(-505);
    expect(fromCents(10)).toBe('0.10');
    expect(fromCents(-505)).toBe('-5.05');
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30');
  });

  it('rechaza formatos invalidos', () => {
    expect(() => toCents('1.234')).toThrow(MoneyFormatError);
    expect(() => toCents('1e3')).toThrow(MoneyFormatError);
    expect(() => toCents('')).toThrow(MoneyFormatError);
    expect(isMoney({ amount: '10.00', currency: 'usd' })).toBe(false);
    expect(isMoney({ amount: '10.00', currency: 'USD' })).toBe(true);
  });

  it('compara importe y moneda', () => {
    expect(sameMoney({ amount: '100.5', currency: 'USD' }, { amount: '100.50', currency: 'USD' })).toBe(true);
    expect(sameMoney({ amount: '100.50', currency: 'USD' }, { amount: '100.50', currency: 'EUR' })).toBe(false);
  });
});
