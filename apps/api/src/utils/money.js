import { Prisma } from '@prisma/client';

/** Exact decimal arithmetic for money. Never use JavaScript numbers for amounts. */
export const Decimal = Prisma.Decimal;

export const toDecimal = (value) => (value instanceof Decimal ? value : new Decimal(value));

/** Rounds to 2 decimal places, half-up (currency minor units). */
export const roundMoney = (value) => toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const sumMoney = (values) => values.reduce((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
