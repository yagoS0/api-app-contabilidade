jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guideIngestionLock: { create: jest.fn(), updateMany: jest.fn() } } }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { acquireGuideLease } from "../GuideLockService.js";

let row;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00Z"));
  row = null;
  prisma.guideIngestionLock.create.mockImplementation(async ({ data }) => {
    if (row) throw Object.assign(new Error("unique"), { code: "P2002" });
    row = { ...data };
  });
  prisma.guideIngestionLock.updateMany.mockImplementation(async ({ where, data }) => {
    const matches = where.OR ? row && (!row.lockedUntil || row.lockedUntil <= new Date())
      : row && +row.lockedUntil === +where.lockedUntil;
    if (!matches) return { count: 0 };
    row = { ...row, ...data }; return { count: 1 };
  });
});
afterEach(() => jest.useRealTimers());

test("dono antigo não libera reserva retomada depois da expiração", async () => {
  const first = await acquireGuideLease("capture", 60000);
  expect(await acquireGuideLease("capture", 60000)).toBeNull();
  jest.setSystemTime(new Date(Date.now() + 61000));
  const next = await acquireGuideLease("capture", 60000);
  expect(() => first.assertActive()).toThrow();
  const expected = row.lockedUntil;
  await first.release();
  expect(row.lockedUntil).toEqual(expected);
  next.assertActive();
  await next.release();
  expect(row.lockedUntil).toBeNull();
});

test("renovação mantém execução longa exclusiva", async () => {
  const lease = await acquireGuideLease("capture", 60000);
  await jest.advanceTimersByTimeAsync(80000);
  lease.assertActive();
  expect(await acquireGuideLease("capture", 60000)).toBeNull();
  await lease.release();
});
