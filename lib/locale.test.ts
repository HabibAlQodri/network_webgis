import { describe, expect, it } from "vitest";
import { detectLocale, formatNumber, localizeDataMessage, text } from "./locale";

describe("detectLocale", () => {
  it("uses the first supported language in the browser preference order", () => {
    expect(detectLocale(["id-ID", "en-US"])).toBe("id");
    expect(detectLocale(["id"])).toBe("id");
    expect(detectLocale(["fr-FR", "id-ID", "en-US"])).toBe("id");
    expect(detectLocale(["en-US", "id-ID"])).toBe("en");
  });

  it("falls back to English for other and missing languages", () => {
    expect(detectLocale(["en-GB"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("locale formatting and messages", () => {
  it("formats numbers using the selected locale", () => {
    expect(formatNumber(1234, "en")).toBe("1,234");
    expect(formatNumber(1234, "id")).toBe("1.234");
  });

  it("selects localized copy and data loading messages", () => {
    expect(text("id", "Export data", "Ekspor data")).toBe("Ekspor data");
    expect(localizeDataMessage("Cell site data is corrupted or has an invalid format.", "id"))
      .toBe("Data BTS rusak atau formatnya tidak valid.");
    expect(localizeDataMessage("Cell site data is corrupted or has an invalid format.", "en"))
      .toBe("Cell site data is corrupted or has an invalid format.");
  });
});
