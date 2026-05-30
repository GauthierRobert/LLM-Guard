import { describe, it, expect } from "vitest";
import {
  luhnCheck,
  isValidIPv4,
  looksLikeJwt,
  isReservedExampleEmail,
} from "./validators";

describe("luhnCheck", () => {
  it("accepts a valid card number", () => {
    expect(luhnCheck("4242 4242 4242 4242")).toBe(true);
    expect(luhnCheck("4111111111111111")).toBe(true);
  });
  it("rejects an invalid card number", () => {
    expect(luhnCheck("4242 4242 4242 4243")).toBe(false);
    expect(luhnCheck("1234 5678 9012 3456")).toBe(false);
  });
  it("rejects too-short input", () => {
    expect(luhnCheck("5")).toBe(false);
    expect(luhnCheck("")).toBe(false);
  });
});

describe("isValidIPv4", () => {
  it("accepts a real address", () => {
    expect(isValidIPv4("192.168.1.1")).toBe(true);
    expect(isValidIPv4("0.0.0.0")).toBe(true);
    expect(isValidIPv4("255.255.255.255")).toBe(true);
  });
  it("rejects out-of-range octets", () => {
    expect(isValidIPv4("1.2.3.999")).toBe(false);
    expect(isValidIPv4("256.1.1.1")).toBe(false);
  });
  it("rejects leading zeros / version strings", () => {
    expect(isValidIPv4("01.0.0.1")).toBe(false);
    expect(isValidIPv4("1.2.3")).toBe(false);
    expect(isValidIPv4("1.2.3.4.5")).toBe(false);
  });
});

describe("looksLikeJwt", () => {
  it("detects a real JWT header", () => {
    // header {"alg":"HS256","typ":"JWT"}
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123";
    expect(looksLikeJwt(jwt)).toBe(true);
  });
  it("rejects non-JWT strings", () => {
    expect(looksLikeJwt("notajwt.at.all")).toBe(false);
    expect(looksLikeJwt("")).toBe(false);
  });
});

describe("isReservedExampleEmail", () => {
  it("flags RFC-2606 reserved domains", () => {
    expect(isReservedExampleEmail("a@example.com")).toBe(true);
    expect(isReservedExampleEmail("a@example.org")).toBe(true);
    expect(isReservedExampleEmail("a@foo.test")).toBe(true);
    expect(isReservedExampleEmail("a@host.localhost")).toBe(true);
  });
  it("does not flag real domains", () => {
    expect(isReservedExampleEmail("a@gmail.com")).toBe(false);
    expect(isReservedExampleEmail("a@company.fr")).toBe(false);
  });
});
