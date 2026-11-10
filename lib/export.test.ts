import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCanvasAsPNG, exportFilename } from "./export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("exportFilename", () => {
  it("creates a dated PNG filename", () => {
    expect(exportFilename(["cell-sites", "map-view"], "png", new Date("2024-01-02T12:00:00Z")))
      .toBe("cell-sites_map-view_2024-01-02.png");
  });

  it("uses an English fallback name", () => {
    expect(exportFilename([], "png", new Date("2024-01-02T12:00:00Z")))
      .toBe("cell-sites_2024-01-02.png");
  });
});

describe("downloadCanvasAsPNG", () => {
  it("downloads a PNG blob from the map canvas", async () => {
    vi.useFakeTimers();
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const createElement = vi.fn(() => anchor);
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement, body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:map-image");
    const blob = new Blob(["png data"], { type: "image/png" });
    const canvas = {
      toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
    };

    await downloadCanvasAsPNG("map.png", canvas);

    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe("map.png");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("reports when the browser cannot create a PNG blob", async () => {
    const canvas = {
      toBlob: vi.fn((callback: BlobCallback) => callback(null)),
    };

    await expect(downloadCanvasAsPNG("map.png", canvas))
      .rejects.toThrow("The browser could not create a PNG image from the map canvas.");
  });
});
