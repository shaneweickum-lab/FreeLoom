import { describe, expect, it } from "vitest";
import { meetsMinimumStrength, scorePassword } from "./passwordStrength";

describe("scorePassword", () => {
  it("scores an empty password as weak", () => {
    expect(scorePassword("").strength).toBe("weak");
  });

  it("scores a known common password as weak regardless of length", () => {
    expect(scorePassword("password123").strength).toBe("weak");
    expect(scorePassword("PASSWORD123").strength).toBe("weak");
  });

  it("scores a short, low-variety password as weak", () => {
    expect(scorePassword("abc123").strength).toBe("weak");
  });

  it("caps low-character-variety passwords even when long", () => {
    expect(scorePassword("aaaaaaaaaaaaaaaa").strength).toBe("weak");
  });

  it("scores a reasonably long password with mixed classes as good or better", () => {
    expect(scorePassword("Tr0ub4dor&3").strength).not.toBe("weak");
  });

  it("scores a long, high-variety password as strong", () => {
    expect(scorePassword("C0rrect!Horse#Battery$Staple9").strength).toBe("strong");
  });

  it("scores a long all-lowercase passphrase as at least good", () => {
    expect(scorePassword("correcthorsebatterystaple").strength).not.toBe("weak");
  });
});

describe("meetsMinimumStrength", () => {
  it("rejects weak passwords", () => {
    expect(meetsMinimumStrength("123456")).toBe(false);
  });

  it("accepts good or strong passwords", () => {
    expect(meetsMinimumStrength("Tr0ub4dor&3")).toBe(true);
    expect(meetsMinimumStrength("C0rrect!Horse#Battery$Staple9")).toBe(true);
  });
});
