import { BOOKING_TRANSITIONS, BookingStatusName, canTransition, canTransitionItem, confirmationOutcome, sourcesOf } from './booking-state';

describe('maquina de estados de la reserva', () => {
  it('sigue el flujo feliz completo', () => {
    const path: BookingStatusName[] = ['DRAFT', 'QUOTED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCEL_REQUESTED', 'CANCELLED'];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
  });

  it('nunca salta a CONFIRMED sin pasar por la confirmacion del proveedor', () => {
    expect(sourcesOf('CONFIRMED').sort()).toEqual(['PENDING_CONFIRMATION', 'REQUIRES_REVIEW']);
    expect(canTransition('HELD', 'CONFIRMED')).toBe(false);
    expect(canTransition('QUOTED', 'CONFIRMED')).toBe(false);
  });

  it('los estados finales no tienen salida', () => {
    for (const s of ['CANCELLED', 'FAILED', 'EXPIRED'] as BookingStatusName[]) expect(BOOKING_TRANSITIONS[s]).toEqual([]);
  });

  it('una reserva confirmada solo se cancela (no vuelve a fallar ni a vencer)', () => {
    expect(BOOKING_TRANSITIONS.CONFIRMED).toEqual(['CANCEL_REQUESTED']);
    expect(canTransition('CONFIRMED', 'FAILED')).toBe(false);
  });

  it('transiciones de item', () => {
    expect(canTransitionItem('HELD', 'PENDING_CONFIRMATION')).toBe(true);
    expect(canTransitionItem('PENDING', 'CONFIRMED')).toBe(false);
    expect(canTransitionItem('CONFIRMED', 'FAILED')).toBe(false);
  });
});

describe('confirmationOutcome', () => {
  it.each([
    [['CONFIRMED', 'CONFIRMED'], 'CONFIRMED'],
    [['CONFIRMED', 'FAILED'], 'COMPENSATING'],
    [['PENDING_CONFIRMATION', 'FAILED'], 'COMPENSATING'],
    [['FAILED', 'FAILED'], 'FAILED'],
    [['CONFIRMED', 'REQUIRES_REVIEW'], 'REQUIRES_REVIEW'],
    [['CONFIRMED', 'PENDING_CONFIRMATION'], null],
    [[], 'FAILED'],
  ] as const)('%j -> %s', (items, expected) => {
    expect(confirmationOutcome([...items])).toBe(expected);
  });
});
