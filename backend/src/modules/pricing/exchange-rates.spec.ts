import { convertCents, convertCentsInverse, rateToScaled } from './exchange-rates.service';

describe('conversion de moneda en enteros', () => {
  it('convierte con redondeo half-up a centavos', () => {
    expect(convertCents(10_000, rateToScaled('0.92'))).toBe(9_200); // 100.00 USD -> 92.00
    expect(convertCents(1, rateToScaled('0.5'))).toBe(1); // 0.005 -> 0.01 (half-up)
    expect(convertCents(30_800, rateToScaled('1.08695652'))).toBe(33_478); // 308.00 EUR -> 334.78 USD
  });

  it('la tasa inversa divide', () => {
    expect(convertCentsInverse(9_200, rateToScaled('0.92'))).toBe(10_000);
    expect(convertCentsInverse(100, rateToScaled('3'))).toBe(33);
  });

  it('rechaza tasas mal formadas', () => {
    expect(() => rateToScaled('1,5')).toThrow();
    expect(() => rateToScaled('-1')).toThrow();
  });
});
