import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOutputDirectory, writeExportFileInDirectory } from "./automationFileExport";

const { joinMock, openMock, statMock, writeFileMock } = vi.hoisted(() => ({
  joinMock: vi.fn(),
  openMock: vi.fn(),
  statMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ join: joinMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
vi.mock("@tauri-apps/plugin-fs", () => ({ stat: statMock, writeFile: writeFileMock }));

describe("directory export helpers", () => {
  beforeEach(() => {
    joinMock.mockReset();
    openMock.mockReset();
    statMock.mockReset();
    writeFileMock.mockReset();
  });

  it("opens a single directory picker and returns the selected path", async () => {
    openMock.mockResolvedValue("C:\\Reports");

    await expect(chooseOutputDirectory({ title: "选择报告目录", defaultPath: "C:\\Previous" })).resolves.toBe("C:\\Reports");
    expect(openMock).toHaveBeenCalledWith({
      title: "选择报告目录",
      defaultPath: "C:\\Previous",
      directory: true,
      multiple: false,
      recursive: true,
    });
  });

  it("writes a new report without overwriting an existing file", async () => {
    joinMock.mockImplementation(async (directory: string, fileName: string) => `${directory}\\${fileName}`);
    statMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("not found"));
    writeFileMock.mockResolvedValue(undefined);

    await expect(writeExportFileInDirectory({
      directory: "C:\\Reports",
      fileName: "批量测活.xlsx",
      contents: new Uint8Array([1, 2, 3]),
    })).resolves.toBe("C:\\Reports\\批量测活-2.xlsx");

    expect(writeFileMock).toHaveBeenCalledWith(
      "C:\\Reports\\批量测活-2.xlsx",
      new Uint8Array([1, 2, 3]),
      { createNew: true },
    );
  });

  it("rejects a file name that could escape the selected directory", async () => {
    await expect(writeExportFileInDirectory({
      directory: "C:\\Reports",
      fileName: "..\\outside.xlsx",
      contents: new Uint8Array(),
    })).rejects.toThrow("导出文件名无效");
    expect(joinMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
