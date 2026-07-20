import { describe, expect, it } from "vitest";
import { formatCountdown } from "./useCountdown";

describe("formatCountdown", () => {
  it("formats sub-minute remainders as m:ss", () => {
    expect(formatCountdown(45_000)).toBe("0:45");
  });

  it("formats minutes as m:ss", () => {
    expect(formatCountdown(58 * 60_000 + 32_000)).toBe("58:32");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatCountdown(60 * 60_000 + 5 * 60_000 + 3_000)).toBe("1:05:03");
  });

  it("clamps negative/expired durations to zero", () => {
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});
