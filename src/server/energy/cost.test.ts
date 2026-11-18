import { describe, expect, it } from "vitest";
import {
  billEstimate,
  billingPeriod,
  localNow,
  type MonthUsage,
  parseMonitor,
  parseMonth,
  pickRate,
} from "./cost";

const NY = "America/New_York";
/** Noon in New York on a day (EST, UTC-5). */
const at = (ymd: string, hhmm = "12:00") => Date.parse(`${ymd}T${hhmm}:00-05:00`);

describe("electricity cost", () => {
  it("reads the rate, billing day and area from Sense's monitor overview", () => {
    const m = parseMonitor({
      monitor_overview: {
        monitor: {
          time_zone: NY,
          solar_configured: false,
          attributes: {
            cost: 11.163,
            sell_back_rate: 11.163,
            user_set_cost: true,
            cycle_start: 13,
            electricity_cost: {
              location: "Oregon",
              cost: 14.26,
              national_electricity_cost: { location: "United States", cost: 18.34 },
            },
          },
        },
      },
    });
    expect(m).toEqual({
      solar: false,
      timeZone: NY,
      rate: 11.163,
      rateSetByUser: true,
      sellBack: 11.163,
      cycleStart: 13,
      area: "Oregon",
      areaRate: 14.26,
      nationalRate: 18.34,
    });
    expect(parseMonitor(null)).toMatchObject({ solar: false, rateSetByUser: false });
  });

  it("uses Hearth's rate, else the one set in Sense, else the area's average", () => {
    const m = parseMonitor({
      monitor_overview: {
        monitor: {
          attributes: {
            cost: 12,
            user_set_cost: false,
            electricity_cost: { location: "Ohio", cost: 15.5 },
          },
        },
      },
    });
    expect(pickRate({ rate: 9.5 }, m)).toMatchObject({ rate: 9.5, rateFrom: "hearth" });
    expect(pickRate({}, m)).toMatchObject({ rate: 15.5, rateFrom: "average", area: "Ohio" });
    expect(pickRate({}, { ...m, rateSetByUser: true })).toMatchObject({
      rate: 12,
      rateFrom: "sense",
    });
    expect(pickRate({}, undefined)).toBeNull();
  });

  it("finds the bill today is in, from the billing day, where the home is", () => {
    // 16 Nov, billing on the 13th: 13 Nov to 13 Dec, three and a half days in.
    expect(billingPeriod(at("2026-11-16"), NY, 13)).toEqual({
      start: "2026-11-13",
      end: "2026-12-13",
      days: 30,
      elapsed: 3.5,
      months: [{ y: 2026, m: 11, from: 13, to: 16 }],
    });
    // 5 Nov is still October's bill, across two calendar months.
    expect(billingPeriod(at("2026-11-05", "00:00"), NY, 13)).toMatchObject({
      start: "2026-10-13",
      end: "2026-11-13",
      days: 31,
      elapsed: 23,
      months: [
        { y: 2026, m: 10, from: 13, to: 31 },
        { y: 2026, m: 11, from: 1, to: 5 },
      ],
    });
    // The 31st in February is the 28th; no billing day is the calendar month.
    expect(billingPeriod(at("2027-02-28"), NY, 31)).toMatchObject({
      start: "2027-02-28",
      end: "2027-03-31",
    });
    expect(billingPeriod(at("2026-11-16"), NY)).toMatchObject({
      start: "2026-11-01",
      end: "2026-12-01",
    });
    // 11 pm in New York is already tomorrow in UTC: the home's day counts.
    expect(localNow(Date.parse("2026-11-16T23:30:00-05:00"), NY)).toMatchObject({ d: 16 });
  });

  it("adds up this bill and projects it, with the fixed charge", () => {
    const period = billingPeriod(at("2026-11-16"), NY, 13);
    const nov: MonthUsage = parseMonth(
      { consumption: { usage_breakdown_kwh: Array.from({ length: 30 }, (_, i) => i + 1) } },
      null,
    );
    // Days 13 to 16: 13 + 14 + 15 + 16 = 58 kWh, at 10 ¢.
    const est = billEstimate(period, new Map([["2026-11", nov]]), {
      rate: 10,
      fixed: 12,
      solar: false,
    });
    expect(est).toEqual({
      start: "2026-11-13",
      end: "2026-12-13",
      days: 30,
      elapsed: 3.5,
      kwh: 58,
      cost: 17.8,
      projectedKwh: 497,
      projectedCost: 61.71,
    });
    // Before a day has gone by there's no pace to project from.
    const early = billingPeriod(at("2026-11-13", "08:00"), NY, 13);
    expect(
      billEstimate(early, new Map([["2026-11", nov]]), { rate: 10, solar: false }),
    ).toMatchObject({
      kwh: 13,
      projectedCost: undefined,
    });
  });

  it("with solar, charges what's bought and takes off what's sold", () => {
    const period = billingPeriod(at("2026-11-02"), NY, 1);
    const nov = parseMonth(
      { consumption: { usage_breakdown_kwh: [20, 20] } },
      { breakdown: { net_kwh: [-15, 5] } },
    );
    const est = billEstimate(period, new Map([["2026-11", nov]]), {
      rate: 20,
      sellBack: 5,
      solar: true,
    });
    // Bought 15 kWh at 20 ¢, sold 5 at 5 ¢.
    expect(est.cost).toBe(2.75);
    expect(est.kwh).toBe(40);
  });
});
