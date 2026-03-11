import { describe, it, expect } from "bun:test";
import {
  validateUploadPlan,
  getMkdirPaths,
  runUploadWithProgress,
  type UploadEntry,
  type UploadDeps,
} from "../folder-upload";

describe("validateUploadPlan", () => {
  it("rejects when over maxFiles", () => {
    const entries: UploadEntry[] = Array.from({ length: 501 }, (_, i) => ({
      relativePath: `f/file${i}.txt`,
      file: new File(["x"], `file${i}.txt`),
    }));
    expect(validateUploadPlan(entries)).toEqual({ ok: false, message: "超过 500 个文件" });
  });
  it("rejects when path depth > 10", () => {
    const deep = "a/b/c/d/e/f/g/h/i/j/k/file.txt";
    expect(validateUploadPlan([{ relativePath: deep, file: new File(["x"], "file.txt") }])).toEqual({
      ok: false,
      message: "路径过深",
    });
  });
  it("rejects when single file > 4MB", () => {
    const big = new File([new ArrayBuffer(5 * 1024 * 1024)], "big.bin");
    expect(validateUploadPlan([{ relativePath: "big.bin", file: big }])).toEqual({
      ok: false,
      message: "big.bin 超过 4MB",
    });
  });
  it("accepts valid plan", () => {
    expect(validateUploadPlan([{ relativePath: "a/b.txt", file: new File(["x"], "b.txt") }])).toEqual({ ok: true });
  });
});

describe("getMkdirPaths", () => {
  it("returns unique parent dirs sorted", () => {
    const entries: UploadEntry[] = [
      { relativePath: "foo/a/b.txt", file: new File([], "b.txt") },
      { relativePath: "foo/a/c.txt", file: new File([], "c.txt") },
      { relativePath: "foo/d.txt", file: new File([], "d.txt") },
    ];
    expect(getMkdirPaths(entries)).toEqual(["foo", "foo/a"]);
  });
});

describe("runUploadWithProgress", () => {
  it("creates dirs, uploads files with concurrency 2, reports progress (1,3),(2,3),(3,3)", async () => {
    const createFolderCalls: [string, string][] = [];
    const uploadFileCalls: [string, File][] = [];
    const deps: UploadDeps = {
      createFolder: async (parentPath, name) => {
        createFolderCalls.push([parentPath, name]);
      },
      uploadFile: async (path, file) => {
        uploadFileCalls.push([path, file]);
      },
    };
    const progressCalls: [number, number][] = [];
    const entries: UploadEntry[] = [
      { relativePath: "a/1.txt", file: new File(["1"], "1.txt") },
      { relativePath: "a/2.txt", file: new File(["2"], "2.txt") },
      { relativePath: "b/3.txt", file: new File(["3"], "3.txt") },
    ];
    const result = await runUploadWithProgress(entries, "", deps, {
      onProgress: (done, total) => progressCalls.push([done, total]),
    });
    expect(progressCalls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result).toEqual({ success: 3, failed: 0, errors: [] });
    expect(createFolderCalls).toEqual([["/", "a"], ["/", "b"]]);
    expect(uploadFileCalls.map(([p]) => p)).toEqual(["a/1.txt", "a/2.txt", "b/3.txt"]);
  });
});
